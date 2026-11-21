"""Bill scanning: photo / PDF of a bill -> structured lines -> matched to the shop's catalog.

Flow
1. `read_files` checks each upload by its magic bytes (never the declared type) and size.
2. An extractor turns the images into a `BillExtraction`:
   - GeminiBillExtractor: Gemini vision with a JSON response schema, temperature 0.
   - FakeBillExtractor: deterministic test fixture (BILL_SCAN_FAKE=1); always labelled "fake".
3. `analyse` matches every line to a catalog item (Hinglish-aware matcher) and runs checks:
   qty x rate vs amount, lines vs grand total, date sanity, duplicate bill number, price vs MRP.
Nothing is written here. The user reviews the draft in the app and commits it (api/bills.py).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from app.core.lexicon import match_names
from app.store.dataset import Dataset

log = logging.getLogger("muneem.bill_scan")

MIME_BY_MAGIC: list[tuple[bytes, int, str]] = [
    (b"\xff\xd8\xff", 0, "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", 0, "image/png"),
    (b"%PDF-", 0, "application/pdf"),
    (b"WEBP", 8, "image/webp"),
    (b"ftypheic", 4, "image/heic"), (b"ftypheix", 4, "image/heic"),
    (b"ftypmif1", 4, "image/heif"), (b"ftypmsf1", 4, "image/heif"),
]
AUTO_MATCH_SCORE = 0.55


class ScanError(ValueError):
    pass


def sniff_mime(data: bytes) -> str | None:
    for magic, offset, mime in MIME_BY_MAGIC:
        if data[offset:offset + len(magic)] == magic:
            if mime == "image/webp" and data[:4] != b"RIFF":
                continue
            return mime
    return None


@dataclass
class BillFile:
    name: str
    mime: str
    data: bytes


def read_files(files: list[tuple[str, bytes]], max_files: int, max_mb: int) -> list[BillFile]:
    if not files:
        raise ScanError("Attach at least one photo or PDF of the bill")
    if len(files) > max_files:
        raise ScanError(f"At most {max_files} pages per bill")
    out = []
    for name, data in files:
        if len(data) > max_mb * 1024 * 1024:
            raise ScanError(f"'{name}' is larger than {max_mb} MB")
        if len(data) < 100:
            raise ScanError(f"'{name}' is empty or not an image")
        mime = sniff_mime(data)
        if mime is None:
            raise ScanError(f"'{name}' is not a JPEG, PNG, WebP, HEIC or PDF file")
        out.append(BillFile(name=name[:120], mime=mime, data=data))
    return out


# ------------------------------------------------------------------ extraction schema
class BillLine(BaseModel):
    description: str = Field(..., description="Item name exactly as printed or written on the bill")
    quantity: float | None = Field(None, description="Number of units; null if not readable")
    unit: str | None = Field(None, description="Unit as written, e.g. pcs, kg, L, pkt, box")
    unit_price: float | None = Field(None, description="Price per unit in rupees; null if not shown")
    amount: float | None = Field(None, description="Line total in rupees as printed")
    gst_rate: float | None = Field(None, description="GST percent for this line if printed")


class BillExtraction(BaseModel):
    bill_type: Literal["sale", "purchase", "unknown"] = Field(
        "unknown", description="sale = shop sold to a customer (cash memo / receipt issued by the shop); "
                               "purchase = supplier / wholesaler invoice for goods the shop bought")
    vendor_name: str | None = Field(None, description="Business name at the top of the bill")
    vendor_gstin: str | None = None
    customer_name: str | None = None
    bill_number: str | None = Field(None, description="Invoice / bill / memo number")
    bill_date: str | None = Field(None, description="Bill date as YYYY-MM-DD")
    payment_mode: Literal["cash", "UPI", "card", "credit", "unknown"] = "unknown"
    lines: list[BillLine] = Field(default_factory=list)
    subtotal: float | None = None
    tax_total: float | None = None
    discount: float | None = None
    grand_total: float | None = None
    handwritten: bool = False
    legibility: Literal["good", "fair", "poor"] = "fair"
    notes: str | None = Field(None, description="Anything unreadable or ambiguous, briefly")


PROMPT = """You read retail bills from Indian kirana / grocery shops and their wholesale suppliers.
The images are pages of ONE bill (printed thermal receipt, GST tax invoice, or handwritten kachcha
bill / cash memo; English, Hindi or Hinglish).
Extract every item line. Rules:
- Copy item names as written (keep brand and pack size, e.g. "Aashirvaad Atta 5kg"); transliterate
  Hindi to Latin script.
- Numbers are rupees. Never invent a number: use null for anything not readable.
- quantity x unit_price should equal amount; if only two of them are printed, leave the third null.
- Skip totals, tax, round-off, discount and "carry forward" rows from lines.
- bill_date as YYYY-MM-DD (Indian bills are DD/MM/YY).
- payment_mode: UPI if a UPI/QR/Paytm/PhonePe/GPay payment is marked, credit if marked udhaar/credit.
- Mention smudged or cut-off parts in notes."""


class BillExtractor(Protocol):
    mode: str
    model: str | None

    def extract(self, files: list[BillFile], hint: str | None = None) -> BillExtraction: ...


class GeminiBillExtractor:
    mode = "gemini"

    def __init__(self, api_key: str, models: list[str], timeout_s: int = 60):
        from google import genai
        from google.genai import types

        self.types = types
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(
            timeout=timeout_s * 1000, retry_options=types.HttpRetryOptions(attempts=1)))
        self.models = models
        self.model: str | None = None

    def extract(self, files: list[BillFile], hint: str | None = None) -> BillExtraction:
        from google.genai import errors

        T = self.types
        parts = [T.Part.from_bytes(data=f.data, mime_type=f.mime) for f in files]
        text = PROMPT + (f"\nThe shop owner says: {hint[:200]}" if hint else "")
        cfg = T.GenerateContentConfig(temperature=0, response_mime_type="application/json",
                                      response_schema=BillExtraction)
        last: Exception | None = None
        for model in self.models:
            try:
                r = self.client.models.generate_content(model=model, contents=[*parts, text], config=cfg)
            except (errors.ClientError, errors.ServerError) as exc:
                last = exc
                log.warning("bill scan on %s failed: %s", model, str(exc)[:160])
                if getattr(exc, "code", None) in (400, 401, 403):
                    break  # bad key / request: next model won't help
                continue
            except Exception as exc:  # network / timeout
                last = exc
                log.warning("bill scan on %s failed: %s", model, exc)
                continue
            self.model = model
            parsed = r.parsed if isinstance(r.parsed, BillExtraction) else None
            if parsed is None:
                try:
                    parsed = BillExtraction.model_validate_json(r.text or "")
                except Exception as exc:
                    last = exc
                    continue
            return parsed
        raise ScanError(f"Could not read the bill with Gemini ({type(last).__name__ if last else 'no model'}). "
                        "Try a sharper, well-lit photo.")


class FakeBillExtractor:
    """Deterministic stand-in for tests and offline demos. Builds a plausible purchase bill
    from the shop's own catalog. Responses are always labelled mode='fake'."""

    mode = "fake"
    model = "fixture"

    def __init__(self, ds_getter):
        self._ds = ds_getter

    def extract(self, files: list[BillFile], hint: str | None = None) -> BillExtraction:
        ds: Dataset = self._ds()
        top = ds.items.head(4)
        lines = []
        for i, r in enumerate(top.itertuples(index=False)):
            qty = float(10 * (i + 1))
            rate = round(r.cost_paise / 100, 2)
            lines.append(BillLine(description=r.name.upper(), quantity=qty, unit="pcs",
                                  unit_price=rate, amount=round(qty * rate, 2)))
        lines.append(BillLine(description="Kesar Badam Cookies 200g", quantity=6, unit="pkt",
                              unit_price=38.0, amount=228.0))
        total = round(sum(l.amount or 0 for l in lines), 2)
        return BillExtraction(bill_type="purchase", vendor_name="Sharma Traders (test fixture)",
                              bill_number=f"ST-{len(files)}{len(files[0].data) % 1000:03d}",
                              bill_date=ds.as_of.isoformat(), payment_mode="credit", lines=lines,
                              subtotal=total, grand_total=total, legibility="good",
                              notes="Test fixture - not read from the image.")


# ------------------------------------------------------------------ analysis
_UNIT = {"kg": "kg", "kgs": "kg", "kilo": "kg", "g": "g", "gm": "g", "gms": "g", "gram": "g", "grams": "g",
         "l": "l", "lt": "l", "ltr": "l", "litre": "l", "liter": "l", "ml": "ml", "pc": "pcs", "pcs": "pcs"}
_PACK = re.compile(r"(\d+(?:\.\d+)?)\s*(kgs?|kilo|grams?|gms?|gm|g|litre|liter|ltr|lt|l|ml|pcs|pc)\b", re.I)


def normalize_pack(text: str) -> str:
    """'Aata 5 kg' -> 'Aata 5kg', '500 gm' -> '500g', '1 Ltr' -> '1l' so pack sizes match the catalog."""
    return _PACK.sub(lambda m: m.group(1) + _UNIT[m.group(2).lower()], text)


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= max(1.0, 0.02 * max(abs(a), abs(b)))


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def analyse(ex: BillExtraction, ds: Dataset, today: date | None = None) -> dict:
    today = today or date.today()
    cands = list(zip(ds.items["item_id"], ds.items["name"]))
    idx = ds.item_index
    warnings: list[str] = []
    lines = []
    for n, ln in enumerate(ex.lines, start=1):
        qty, rate, amt = ln.quantity, ln.unit_price, ln.amount
        if rate is None and qty and amt is not None:
            rate = round(amt / qty, 2)
        if qty is None and rate and amt is not None:
            qty = round(amt / rate, 3)
        if amt is None and qty is not None and rate is not None:
            amt = round(qty * rate, 2)
        flags = []
        if qty is not None and rate is not None and amt is not None and not _close(qty * rate, amt):
            flags.append(f"qty x rate = {qty * rate:.2f} but amount is {amt:.2f}")
        if qty is None or rate is None:
            flags.append("quantity or price not readable - please fill in")
        hits = match_names(normalize_pack(ln.description), cands, limit=3, min_score=0.25)
        best = hits[0] if hits and hits[0]["score"] >= AUTO_MATCH_SCORE else None
        match = None
        if best:
            row = idx.loc[best["id"]]
            match = {"item_id": best["id"], "name": best["name"], "score": round(best["score"], 2),
                     "mrp": int(row["mrp_paise"]) / 100, "cost": int(row["cost_paise"]) / 100,
                     "category": row["category"], "gst_rate": int(row["gst_rate"])}
            ref = match["cost"] if ex.bill_type == "purchase" else match["mrp"]
            if rate and ref and not (0.6 * ref <= rate <= 1.5 * ref):
                flags.append(f"price {rate:.2f} is far from usual {ref:.2f} - check the match")
        lines.append({
            "line_no": n, "description": ln.description, "quantity": qty, "unit": ln.unit,
            "unit_price": rate, "amount": amt, "gst_rate": ln.gst_rate, "match": match,
            "suggestions": [{"item_id": h["id"], "name": h["name"], "score": round(h["score"], 2)}
                            for h in hits if not best or h["id"] != best["id"]][:3],
            "flags": flags,
        })
    line_sum = round(sum(l["amount"] or 0 for l in lines), 2)
    if ex.grand_total is not None and lines:
        expected = line_sum + (ex.tax_total or 0) - (ex.discount or 0)
        if not (_close(line_sum, ex.grand_total) or _close(expected, ex.grand_total)):
            warnings.append(f"Items add up to {line_sum:.2f} but the bill total is {ex.grand_total:.2f}"
                            " - a line may be missing or misread")
    d = _parse_date(ex.bill_date)
    if ex.bill_date and d is None:
        warnings.append(f"Bill date '{ex.bill_date}' is not a valid date")
    elif d and d > today + timedelta(days=1):
        warnings.append(f"Bill date {d} is in the future")
    elif d and d < today - timedelta(days=730):
        warnings.append(f"Bill date {d} is more than two years old")
    if ex.bill_number and ex.bill_number in set(ds.sales["invoice_id"]):
        warnings.append(f"Bill number {ex.bill_number} is already in your sales - this may be a duplicate")
    if not lines:
        warnings.append("No item lines found on this bill")
    if ex.legibility == "poor":
        warnings.append("The photo is hard to read - check every line")
    return {
        "extraction": ex.model_dump(),
        "bill_type": ex.bill_type,
        "bill_date": d.isoformat() if d else None,
        "lines": lines,
        "totals": {"lines_total": line_sum, "grand_total": ex.grand_total, "tax_total": ex.tax_total,
                   "discount": ex.discount},
        "matched": sum(1 for l in lines if l["match"]),
        "unmatched": sum(1 for l in lines if not l["match"]),
        "warnings": warnings,
    }
