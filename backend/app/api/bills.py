"""Bill scanning endpoints: scan (read only) -> the owner reviews -> commit (writes to the ledger)."""

from __future__ import annotations

import threading
import time
from datetime import date
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from app.api.deps import dataset, manager
from app.ingest.bill_scan import (FakeBillExtractor, GeminiBillExtractor, ScanError, analyse,
                                  read_files)
from app.store import ledger as L
from app.store.manager import DataManager

router = APIRouter(prefix="/api/bills", tags=["bill-scan"])

_SCANS: dict[str, dict] = {}
_SAVED: list[dict] = []  # bills the owner saved, newest last (kept for the session, like the dataset)
MAX_SAVED = 500
_LOCK = threading.Lock()
SCAN_TTL_S = 3600
MAX_SCANS = 100


def _remember(scan: dict) -> None:
    now = time.time()
    with _LOCK:
        for k in [k for k, v in _SCANS.items() if now - v["_t"] > SCAN_TTL_S]:
            _SCANS.pop(k, None)
        while len(_SCANS) >= MAX_SCANS:
            _SCANS.pop(next(iter(_SCANS)))
        _SCANS[scan["scan_id"]] = {**scan, "_t": now}


def _get(scan_id: str) -> dict:
    with _LOCK:
        s = _SCANS.get(scan_id)
    if s is None:
        raise HTTPException(404, "Scan not found or expired - scan the bill again")
    return s


def extractor(request: Request):
    """Gemini when LLM_API_KEY is set; the test fixture only when BILL_SCAN_FAKE=1."""
    st = request.app.state
    if getattr(st, "bill_extractor", None) is not None:
        return st.bill_extractor
    s = st.manager.settings
    if s.bill_scan_fake:
        st.bill_extractor = FakeBillExtractor(st.manager.require)
    elif s.llm_api_key:
        models = [m.strip() for m in (s.bill_scan_model or s.llm_model).split(",") if m.strip()]
        st.bill_extractor = GeminiBillExtractor(s.llm_api_key, models, timeout_s=s.bill_scan_timeout_s)
    else:
        return None
    return st.bill_extractor


@router.get("/status")
def scan_status(request: Request):
    ex = extractor(request)
    s = request.app.state.manager.settings
    return {"available": ex is not None, "mode": ex.mode if ex else None,
            "max_files": s.bill_scan_max_files, "max_mb": s.bill_scan_max_mb,
            "reason": None if ex else "Set LLM_API_KEY (Gemini) in .env to read bill photos."}


@router.get("/saved")
def saved_bills(bill_type: Literal["sale", "purchase"] | None = None, limit: int = 100):
    """Bills saved through scanning, newest first, with their lines."""
    with _LOCK:
        rows = [b for b in reversed(_SAVED) if bill_type is None or b["bill_type"] == bill_type]
    limit = max(1, min(limit, MAX_SAVED))
    return {"bills": rows[:limit], "count": len(rows),
            "totals": {"purchase": round(sum(b["total"] for b in rows if b["bill_type"] == "purchase"), 2),
                       "sale": round(sum(b["total"] for b in rows if b["bill_type"] == "sale"), 2)}}


@router.post("/scan", dependencies=[Depends(dataset)])
async def scan(request: Request, files: list[UploadFile] = File(...),
               hint: str | None = Form(None, max_length=200), m: DataManager = Depends(manager)):
    ex = extractor(request)
    if ex is None:
        raise HTTPException(503, "Bill scanning needs a Gemini key: set LLM_API_KEY in .env and restart.")
    s = m.settings
    raw = []
    for f in files[: s.bill_scan_max_files + 1]:
        raw.append((f.filename or "bill", await f.read(s.bill_scan_max_mb * 1024 * 1024 + 1)))
    try:
        bill_files = read_files(raw, s.bill_scan_max_files, s.bill_scan_max_mb)
        t0 = time.time()
        extraction = ex.extract(bill_files, hint)
        result = analyse(extraction, m.require())
    except ScanError as exc:
        raise HTTPException(422, str(exc)) from exc
    scan_id = uuid4().hex[:12]
    out = {"scan_id": scan_id, **result,
           "engine": {"mode": ex.mode, "model": ex.model, "latency_ms": int((time.time() - t0) * 1000)},
           "files": [{"name": f.name, "type": f.mime, "bytes": len(f.data)} for f in bill_files]}
    _remember({**out, "committed": None})
    return out


class NewProduct(BaseModel):
    name: str = Field(..., min_length=1, max_length=300)  # bills print long names; stored as the first 80 chars
    category: str = Field("General", max_length=60)
    selling_price: float = Field(..., gt=0)
    cost_price: float = Field(..., ge=0)
    gst_rate: int = 0


class CommitLine(BaseModel):
    product_id: str | None = Field(None, max_length=40)
    new_product: NewProduct | None = None
    quantity: float = Field(..., gt=0, le=100_000)
    unit_price: float = Field(..., gt=0, le=10_000_000)


class CommitIn(BaseModel):
    model_config = {"populate_by_name": True}
    bill_type: Literal["sale", "purchase"]
    bill_date: date | None = None
    bill_number: str | None = Field(None, max_length=40)
    payment_method: str = Field("cash", max_length=20)
    update_cost: bool = Field(False, description="purchase: set item cost to the billed rate")
    lines: list[CommitLine] = Field(..., min_length=1, max_length=200)


def _safe_bill_no(s: str | None) -> str | None:
    if not s:
        return None
    clean = "".join(ch for ch in s if ch.isalnum() or ch in "-_/")[:40]
    return clean or None


@router.post("/{scan_id}/commit", dependencies=[Depends(dataset)])
def commit(scan_id: str, req: CommitIn, m: DataManager = Depends(manager)):
    scan_rec = _get(scan_id)
    if scan_rec.get("committed"):
        raise HTTPException(409, f"This bill was already saved ({scan_rec['committed']})")
    for ln in req.lines:
        if not ln.product_id and not ln.new_product:
            raise HTTPException(422, "Every line needs a matched product or a new product")
    try:
        # 1. create products the bill introduced
        new = [ln for ln in req.lines if not ln.product_id]
        if new:
            _, ids = L.add_items(m, [L.NewItem(n.new_product.name, n.new_product.category,
                                               n.new_product.selling_price, n.new_product.cost_price,
                                               n.new_product.gst_rate, 0) for n in new])
            for ln, iid in zip(new, ids):
                ln.product_id = iid
        ds = m.require()
        unknown = {ln.product_id for ln in req.lines} - set(ds.items["item_id"])
        if unknown:
            raise ValueError(f"Unknown products: {', '.join(sorted(unknown))}")
        # 2. write the bill
        if req.bill_type == "sale":
            ds, ref = L.record_sale(m, [L.SaleLine(ln.product_id, ln.quantity, ln.unit_price) for ln in req.lines],
                                    payment_mode=req.payment_method, sale_date=req.bill_date,
                                    invoice_id=_safe_bill_no(req.bill_number))
        else:
            deltas: dict[str, float] = {}
            for ln in req.lines:
                deltas[ln.product_id] = deltas.get(ln.product_id, 0.0) + ln.quantity
            if req.update_cost:
                items = ds.items.copy()
                for ln in req.lines:
                    items.loc[items["item_id"] == ln.product_id, "cost_paise"] = L.paise(ln.unit_price)
                m.replace(L._rebuild(ds, items=items))
            ds = L.adjust_stock(m, deltas)
            ref = _safe_bill_no(req.bill_number) or f"PUR-{scan_id}"
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with _LOCK:
        if scan_id in _SCANS:
            _SCANS[scan_id]["committed"] = ref
    total = round(sum(ln.quantity * ln.unit_price for ln in req.lines), 2)
    names = ds.item_index["name"]
    new_ids = {ln.product_id for ln in new}
    ex = scan_rec.get("extraction", {})
    saved = {
        "reference": ref, "scan_id": scan_id, "bill_type": req.bill_type,
        "bill_date": (req.bill_date or L.default_sale_date(ds)).isoformat() if req.bill_type == "sale"
        else (req.bill_date.isoformat() if req.bill_date else None),
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "vendor": ex.get("vendor_name"),
        "payment_method": L.norm_payment(req.payment_method), "total": total,
        "printed_total": (scan_rec.get("totals") or {}).get("grand_total"),
        "new_products": len(new), "engine": scan_rec.get("engine", {}).get("mode"),
        "files": [f["name"] for f in scan_rec.get("files", [])],
        "lines": [{"product_id": ln.product_id, "name": str(names.get(ln.product_id, ln.product_id)),
                   "quantity": ln.quantity, "unit_price": ln.unit_price,
                   "amount": round(ln.quantity * ln.unit_price, 2), "new_product": ln.product_id in new_ids}
                  for ln in req.lines],
    }
    with _LOCK:
        _SAVED.append(saved)
        del _SAVED[:-MAX_SAVED]
    m.record("bill_scans", {"scan_id": scan_id, "bill_type": req.bill_type, "reference": ref,
                            "lines": len(req.lines), "total_rs": total,
                            "engine": scan_rec.get("engine", {}).get("mode")})
    return {"reference": ref, "bill_type": req.bill_type, "lines": len(req.lines), "total": total,
            "new_products": len(new), "dataset": ds.summary()}
