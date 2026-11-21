"""Restock action: turn the reorder plan into purchase orders the owner can act on.

    plan -> one purchase order (PO) per supplier -> owner edits quantities
         -> WhatsApp-ready message (English / Hinglish / Hindi) -> owner sends it himself
         -> marks PO "sent" -> marks "received" -> stock goes up, alerts recompute.

Muneem never sends a message or places an order. It drafts; the owner decides.
"""

from __future__ import annotations

import csv
import io
import logging
import math
import re
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from urllib.parse import quote
from uuid import uuid4

from pydantic import BaseModel, Field

from app.analytics import stock as stock_mod
from app.core.money import add_gst, fmt_inr
from app.core.text import csv_safe

log = logging.getLogger("muneem.restock")

Lang = Literal["en", "hinglish", "hi"]
Status = Literal["draft", "sent", "received", "cancelled"]
TRANSITIONS = {"draft": {"sent", "cancelled"}, "sent": {"received", "cancelled"},
               "received": set(), "cancelled": set()}


class POLine(BaseModel):
    item_id: str
    name: str
    qty: int
    suggested_qty: int
    pack_size: int = 1
    packs: int = 0
    unit_cost_paise: int
    gst_rate: int
    value_paise: int = 0
    value_incl_gst_paise: int = 0
    tier: str = "OK"
    days_left: float | None = None
    why: str = ""
    edited: bool = False


class PurchaseOrder(BaseModel):
    po_id: str
    draft_id: str
    created_at: str
    status: Status = "draft"
    supplier_id: str
    supplier: str
    language: Lang = "hinglish"
    show_prices: bool = True
    lead_time_days: int = 2
    expected_delivery: str = ""
    lines: list[POLine] = Field(default_factory=list)
    total_paise: int = 0
    total_incl_gst_paise: int = 0
    message: str = ""
    whatsapp_url: str = ""
    dataset_version: str = ""
    history: list[dict] = Field(default_factory=list)


class RestockDraft(BaseModel):
    draft_id: str
    created_at: str
    as_of: str
    budget_paise: int | None = None
    orders: list[PurchaseOrder]
    deferred: list[dict] = Field(default_factory=list)
    total_paise: int = 0
    total_incl_gst_paise: int = 0
    formula: str = stock_mod.STOCK_FORMULA


# ------------------------------------------------------------------ messages
def _fmt_date(d: date, lang: str) -> str:
    return d.strftime("%d %b %Y") if lang != "hi" else d.strftime("%d-%m-%Y")


def build_message(po: PurchaseOrder, shop: str, today: date) -> str:
    lang = po.language
    lines = [l for l in po.lines if l.qty > 0]
    deliver = _fmt_date(date.fromisoformat(po.expected_delivery), lang)
    if lang == "hi":
        out = [f"नमस्ते {po.supplier} जी,", f"{shop} से ऑर्डर ({_fmt_date(today, lang)}):"]
        unit, pack = "पीस", "पैक"
    elif lang == "hinglish":
        out = [f"Namaste {po.supplier} ji,", f"{shop} se order ({_fmt_date(today, lang)}):"]
        unit, pack = "pcs", "packet"
    else:
        out = [f"Hello {po.supplier},", f"Order from {shop} ({_fmt_date(today, lang)}):"]
        unit, pack = "pcs", "pack"
    for i, l in enumerate(lines, 1):
        packs = f" ({l.packs} {pack} × {l.pack_size})" if l.pack_size > 1 else ""
        out.append(f"{i}. {l.name} - {l.qty} {unit}{packs}")
    if po.show_prices:
        total = fmt_inr(po.total_incl_gst_paise)
        out.append({"hi": f"अनुमानित कुल: {total} (GST सहित)",
                    "hinglish": f"Anumaanit total: {total} (GST sahit)",
                    "en": f"Estimated total: {total} incl. GST"}[lang])
    out.append({"hi": f"कृपया {deliver} तक डिलीवरी कर दें। धन्यवाद।",
                "hinglish": f"Kripya {deliver} tak delivery kar dijiye. Dhanyavaad.",
                "en": f"Please deliver by {deliver}. Thank you."}[lang])
    return "\n".join(out)


def whatsapp_url(message: str, phone: str | None) -> str:
    """wa.me link with the text pre-filled. A number is used only if the supplier record
    holds a real one (placeholders like '+91-XXXXX-00001' are skipped)."""
    digits = ""
    if phone and "x" not in phone.lower():
        d = re.sub(r"\D", "", phone)
        if 10 <= len(d) <= 15:
            digits = d if len(d) > 10 else "91" + d
    return f"https://wa.me/{digits}?text={quote(message)}"


def _recompute(po: PurchaseOrder, shop: str, phone: str | None, today: date) -> PurchaseOrder:
    for l in po.lines:
        l.packs = math.ceil(l.qty / l.pack_size) if l.pack_size > 0 else l.qty
        l.value_paise = l.qty * l.unit_cost_paise
        l.value_incl_gst_paise = int(add_gst(l.value_paise, l.gst_rate))
    po.total_paise = sum(l.value_paise for l in po.lines)
    po.total_incl_gst_paise = sum(l.value_incl_gst_paise for l in po.lines)
    po.message = build_message(po, shop, today)
    po.whatsapp_url = whatsapp_url(po.message, phone)
    return po


# ------------------------------------------------------------------ store
class RestockStore:
    def __init__(self, manager):
        self.m = manager
        self.orders: dict[str, PurchaseOrder] = {}
        self._lock = threading.RLock()
        self._loaded = False

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _today(self) -> date:
        return date.today()

    def _phone(self, supplier_id: str) -> str | None:
        si = self.m.require().supplier_index
        return si["whatsapp_placeholder"].get(supplier_id) if supplier_id in si.index else None

    def _persist(self, po: PurchaseOrder) -> None:
        if self.m.sql is not None:
            try:
                self.m.sql.upsert_purchase_order(po.model_dump())
            except Exception as exc:  # pragma: no cover - best effort
                log.warning("could not save purchase order %s: %s", po.po_id, exc)
            return
        if self.m.db is None:
            return
        try:
            self.m.db.collection("purchase_orders").insert(
                {"_key": po.po_id, **po.model_dump()}, overwrite=True)
        except Exception as exc:  # pragma: no cover - best effort
            log.warning("could not save purchase order %s: %s", po.po_id, exc)

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            self._load_from_db()
        finally:
            if not self.orders:
                self._load_sample()

    # Sample shop only: a short order history so "Stock & orders" is not empty on first open.
    # (supplier_id, created days ago, outcome, delivered days after sending); dates are relative
    # to today so the pipeline shows "waiting" and "late" correctly. Received orders are history:
    # their stock is already in the sample inventory, so they do not add stock again.
    SAMPLE_ORDERS = [
        ("S01", 12, "received", 2), ("S02", 9, "received", 6), ("S07", 6, "received", 3),
        ("S06", 7, "sent", None), ("S03", 1, "sent", None), ("S05", 5, "cancelled", None),
    ]

    def _load_sample(self) -> None:
        try:
            ds = self.m.require()
        except Exception:
            return
        if ds.source != "sample":
            return
        sold = ds.sales_window(30).groupby("item_id")["qty"].sum()
        sup_idx, today, shop = ds.supplier_index, self._today(), self.m.settings.shop_name
        for n, (sid, ago, outcome, took) in enumerate(self.SAMPLE_ORDERS, start=1):
            if sid not in sup_idx.index:
                continue
            items = ds.items[ds.items["supplier_id"] == sid].copy()
            items["sold"] = items["item_id"].map(sold).fillna(0)
            items = items.sort_values("sold", ascending=False).head(3)
            if items.empty:
                continue
            created = today - timedelta(days=ago)
            stamp = lambda d, h: datetime(d.year, d.month, d.day, h, 30, tzinfo=timezone.utc).isoformat()  # noqa: E731
            lead = int(sup_idx.at[sid, "lead_time_days"])
            lines = []
            for r in items.itertuples(index=False):
                daily = max(r.sold / 30, 0.5)
                qty = max(int(r.pack_size), int(math.ceil(daily * (lead + 4) / r.pack_size)) * int(r.pack_size))
                lines.append(POLine(item_id=r.item_id, name=r.name, qty=qty, suggested_qty=qty,
                                    pack_size=int(r.pack_size), unit_cost_paise=int(r.cost_paise),
                                    gst_rate=int(r.gst_rate), why="sample order"))
            po = PurchaseOrder(
                po_id=f"PO-{created:%y%m%d}-S{n:02d}", draft_id="sample", created_at=stamp(created, 4),
                supplier_id=sid, supplier=str(sup_idx.at[sid, "name"]), lead_time_days=lead,
                expected_delivery=(created + timedelta(days=lead)).isoformat(), lines=lines,
                dataset_version=ds.version, history=[{"status": "draft", "at": stamp(created, 4)}])
            if outcome in ("sent", "received"):
                po.history.append({"status": "sent", "at": stamp(created, 5)})
            if outcome == "received":
                po.history.append({"status": "received", "at": stamp(created + timedelta(days=took), 9),
                                   "received_qty": {l.item_id: l.qty for l in lines}})
            if outcome == "cancelled":
                po.history.append({"status": "cancelled", "at": stamp(created, 8)})
            po.status = outcome
            _recompute(po, shop, self._phone(sid), created)
            self.orders[po.po_id] = po
        try:  # and today's draft from the live reorder plan, so the Draft tab has work waiting
            self.create_draft()
        except Exception as exc:  # pragma: no cover - empty plan is fine
            log.info("no sample draft: %s", exc)

    def _load_from_db(self) -> None:
        if self.m.sql is not None:
            try:
                for d in self.m.sql.purchase_orders():
                    po = PurchaseOrder(**d)
                    self.orders[po.po_id] = po
            except Exception as exc:  # pragma: no cover
                log.warning("could not load purchase orders: %s", exc)
            return
        if self.m.db is None:
            return
        try:
            for d in self.m.db.aql.execute(
                    "FOR p IN purchase_orders SORT p.created_at RETURN UNSET(p, '_id', '_rev', '_key')"):
                po = PurchaseOrder(**d)
                self.orders[po.po_id] = po
        except Exception as exc:  # pragma: no cover
            log.warning("could not load purchase orders: %s", exc)

    # -- create ---------------------------------------------------------------
    def create_draft(self, budget_rs: float | None = None, supplier_id: str | None = None,
                     language: Lang = "hinglish", show_prices: bool = True,
                     overrides: dict[str, int] | None = None,
                     exclude: list[str] | None = None, save: bool = True) -> RestockDraft:
        from app.core.money import to_paise

        ds = self.m.require()
        budget = to_paise(budget_rs) if budget_rs is not None else None
        plan = stock_mod.reorder_plan(self.m.stock(), ds, budget, supplier_id)
        overrides, exclude = overrides or {}, set(exclude or [])
        st = self.m.stock().set_index("item_id")
        draft_id = uuid4().hex[:10]
        now, today = self._now(), self._today()
        by_sup: dict[str, PurchaseOrder] = {}
        sup_idx = ds.supplier_index
        for r in plan.rows:
            if r["item_id"] in exclude:
                continue
            sid = r["supplier_id"]
            if sid not in by_sup:
                lead = int(sup_idx["lead_time_days"].get(sid, r["inputs"]["L"])) \
                    if sid in sup_idx.index else r["inputs"]["L"]
                by_sup[sid] = PurchaseOrder(
                    po_id=f"PO-{today:%y%m%d}-{uuid4().hex[:6].upper()}", draft_id=draft_id,
                    created_at=now, supplier_id=sid, supplier=r["supplier"], language=language,
                    show_prices=show_prices, lead_time_days=lead,
                    expected_delivery=(today + timedelta(days=lead)).isoformat(),
                    dataset_version=ds.version, history=[{"status": "draft", "at": now}])
            qty = int(overrides.get(r["item_id"], r["order_qty"]))
            by_sup[sid].lines.append(POLine(
                item_id=r["item_id"], name=r["name"], qty=max(0, qty), suggested_qty=r["wanted_qty"],
                pack_size=r["pack_size"], unit_cost_paise=int(st.at[r["item_id"], "unit_cost_paise"]),
                gst_rate=int(st.at[r["item_id"], "gst_rate"]), tier=r["tier"],
                days_left=r["days_left"], why=r["why"], edited=r["item_id"] in overrides))
        orders = []
        with self._lock:
            self._load()
            for sid, po in by_sup.items():
                _recompute(po, self.m.settings.shop_name, self._phone(sid), today)
                if save:
                    self.orders[po.po_id] = po
                    self._persist(po)
                orders.append(po)
        orders.sort(key=lambda p: (-sum(l.tier == "CRITICAL" for l in p.lines), -p.total_paise))
        return RestockDraft(
            draft_id=draft_id, created_at=now, as_of=ds.as_of.isoformat(), budget_paise=budget,
            orders=orders, deferred=plan.meta.get("deferred", []),
            total_paise=sum(p.total_paise for p in orders),
            total_incl_gst_paise=sum(p.total_incl_gst_paise for p in orders))

    # -- read -------------------------------------------------------------------
    def get(self, po_id: str) -> PurchaseOrder:
        with self._lock:
            self._load()
            if po_id not in self.orders:
                raise KeyError(po_id)
            return self.orders[po_id]

    def list(self, status: str | None = None, draft_id: str | None = None) -> list[PurchaseOrder]:
        with self._lock:
            self._load()
            out = [p for p in self.orders.values()
                   if (status is None or p.status == status) and
                   (draft_id is None or p.draft_id == draft_id)]
        return sorted(out, key=lambda p: p.created_at, reverse=True)

    # -- edit -------------------------------------------------------------------
    def edit(self, po_id: str, quantities: dict[str, int] | None = None,
             language: Lang | None = None, show_prices: bool | None = None) -> PurchaseOrder:
        with self._lock:
            po = self.get(po_id)
            if po.status != "draft":
                raise ValueError(f"Order {po_id} is '{po.status}' - only drafts can be edited")
            known = {l.item_id for l in po.lines}
            unknown = set(quantities or {}) - known
            if unknown:
                raise ValueError(f"Items not in this order: {', '.join(sorted(unknown))}")
            for l in po.lines:
                if quantities and l.item_id in quantities:
                    q = int(quantities[l.item_id])
                    if q < 0:
                        raise ValueError("Quantity cannot be negative")
                    l.qty, l.edited = q, q != l.suggested_qty or l.edited
            if language:
                po.language = language
            if show_prices is not None:
                po.show_prices = show_prices
            _recompute(po, self.m.settings.shop_name, self._phone(po.supplier_id), self._today())
            self._persist(po)
            return po

    def set_status(self, po_id: str, status: Status,
                   received_qty: dict[str, int] | None = None) -> PurchaseOrder:
        with self._lock:
            po = self.get(po_id)
            if status not in TRANSITIONS[po.status]:
                raise ValueError(f"Cannot move order from '{po.status}' to '{status}'")
            entry = {"status": status, "at": self._now()}
            if status == "received":
                got = {l.item_id: int((received_qty or {}).get(l.item_id, l.qty)) for l in po.lines}
                got = {k: v for k, v in got.items() if v > 0}
                self.m.receive_stock(got)
                entry["received_qty"] = got
            po.status = status
            po.history.append(entry)
            self._persist(po)
            return po

    # -- export -----------------------------------------------------------------
    def to_csv(self, orders: list[PurchaseOrder]) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["po_id", "status", "supplier", "item_id", "item", "qty", "pack_size", "packs",
                    "unit_cost_ex_gst", "value_ex_gst", "gst_rate", "value_incl_gst", "tier",
                    "days_left", "expected_delivery"])
        for po in orders:
            for l in po.lines:
                if l.qty <= 0:
                    continue
                w.writerow([po.po_id, po.status, csv_safe(po.supplier), csv_safe(l.item_id),
                            csv_safe(l.name), l.qty, l.pack_size, l.packs,
                            f"{l.unit_cost_paise / 100:.2f}", f"{l.value_paise / 100:.2f}",
                            l.gst_rate, f"{l.value_incl_gst_paise / 100:.2f}", l.tier,
                            "" if l.days_left is None else l.days_left, po.expected_delivery])
        return buf.getvalue()
