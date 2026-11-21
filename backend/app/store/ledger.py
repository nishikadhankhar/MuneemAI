"""Ledger writes used by bill scanning: add products, adjust stock, record a sale.

Every change builds a new Dataset version (like an upload), so KPIs, alerts, findings,
udhaar and the chat agent all recompute from the same numbers the dashboard shows.
Money stays in integer paise inside the Dataset; this module converts rupees at the edge.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import pandas as pd

from app.ingest.schema import PAYMENT_MAP, VALID_GST, LEGACY_GST
from app.store.dataset import Dataset
from app.store.manager import DataManager

UNKNOWN_SUPPLIER = ("S00", "Unassigned supplier")


def paise(rupees: float) -> int:
    return int(round(float(rupees) * 100))


def norm_payment(mode: str | None) -> str:
    m = (mode or "cash").strip().lower()
    return PAYMENT_MAP.get(m, "UPI" if m == "upi" else "cash")


def _rebuild(ds: Dataset, **changes) -> Dataset:
    fields = dict(items=ds.items, sales=ds.sales, inventory=ds.inventory, expenses=ds.expenses,
                  suppliers=ds.suppliers, as_of=ds.as_of, source=ds.source,
                  customers=ds.customers, repayments=ds.repayments)
    fields.update(changes)
    return Dataset(**fields)


def _next_item_ids(ds: Dataset, n: int) -> list[str]:
    nums = [int(i[1:]) for i in ds.items["item_id"] if len(i) > 1 and i[0] in "IN" and i[1:].isdigit()]
    start = max(nums, default=0) + 1
    return [f"N{start + k:03d}" for k in range(n)]


def _ensure_supplier(suppliers: pd.DataFrame) -> pd.DataFrame:
    if UNKNOWN_SUPPLIER[0] in set(suppliers["supplier_id"]):
        return suppliers
    row = pd.DataFrame([{"supplier_id": UNKNOWN_SUPPLIER[0], "name": UNKNOWN_SUPPLIER[1],
                         "whatsapp_placeholder": "", "lead_time_days": 2}])
    return pd.concat([suppliers, row], ignore_index=True)


@dataclass
class NewItem:
    name: str
    category: str
    selling_price: float  # rupees, incl. GST
    cost_price: float  # rupees, ex GST
    gst_rate: int = 0
    stock_quantity: float = 0


def add_items(m: DataManager, new: list[NewItem]) -> tuple[Dataset, list[str]]:
    """Add products (and their opening stock). Returns the new dataset and the new item_ids."""
    ds = m.require()
    for it in new:
        if not it.name.strip():
            raise ValueError("Product name is required")
        if it.selling_price <= 0 or it.cost_price < 0:
            raise ValueError(f"'{it.name}': selling price must be > 0 and cost >= 0")
        if it.gst_rate not in VALID_GST | LEGACY_GST:
            raise ValueError(f"'{it.name}': GST rate must be one of {sorted(VALID_GST | LEGACY_GST)}")
    ids = _next_item_ids(ds, len(new))
    items = pd.concat([ds.items, pd.DataFrame([{
        "item_id": iid, "name": it.name.strip()[:80], "category": (it.category or "General").strip()[:40],
        "hsn": "", "mrp_paise": paise(it.selling_price), "cost_paise": paise(it.cost_price),
        "gst_rate": int(it.gst_rate), "pack_size": 1, "supplier_id": UNKNOWN_SUPPLIER[0],
        "lead_time_days": 2} for iid, it in zip(ids, new)])], ignore_index=True)
    inv = pd.concat([ds.inventory, pd.DataFrame([{
        "item_id": iid, "stock_qty": float(max(0, it.stock_quantity)), "as_of_date": pd.Timestamp(ds.as_of)}
        for iid, it in zip(ids, new)])], ignore_index=True)
    out = _rebuild(ds, items=items, inventory=inv, suppliers=_ensure_supplier(ds.suppliers))
    m.replace(out)
    return out, ids


def adjust_stock(m: DataManager, deltas: dict[str, float]) -> Dataset:
    """Add (or with a negative delta, remove) stock. Stock never goes below zero."""
    ds = m.require()
    unknown = set(deltas) - set(ds.items["item_id"])
    if unknown:
        raise ValueError(f"Unknown items: {', '.join(sorted(unknown))}")
    inv = ds.inventory.copy()
    # collapse to one row per item so a delta applies once
    inv = inv.groupby("item_id", as_index=False).agg(stock_qty=("stock_qty", "sum"),
                                                     as_of_date=("as_of_date", "max"))
    missing = [i for i in deltas if i not in set(inv["item_id"])]
    if missing:
        inv = pd.concat([inv, pd.DataFrame({"item_id": missing, "stock_qty": 0.0,
                                            "as_of_date": pd.Timestamp(ds.as_of)})], ignore_index=True)
    inv["stock_qty"] = (inv["stock_qty"].clip(lower=0) + inv["item_id"].map(deltas).fillna(0)).clip(lower=0)
    out = _rebuild(ds, inventory=inv)
    m.replace(out)
    return out


def default_sale_date(ds: Dataset) -> date:
    """Real shops: today. The synthetic sample is frozen at its own as-of date, so demo sales land
    on that day instead of opening an empty gap that would distort 'yesterday' and udhaar ageing."""
    return ds.as_of if ds.source == "sample" else date.today()


@dataclass
class SaleLine:
    item_id: str
    quantity: float
    unit_price: float | None = None  # rupees incl. GST; default = item MRP


def record_sale(m: DataManager, lines: list[SaleLine], *, payment_mode: str = "cash",
                sale_date: date | None = None, invoice_id: str | None = None,
                customer_id: str = "", reduce_stock: bool = True) -> tuple[Dataset, str]:
    """Append one bill (several lines) to sales and take the units out of stock."""
    ds = m.require()
    if not lines:
        raise ValueError("A bill needs at least one line")
    idx = ds.item_index
    for ln in lines:
        if ln.item_id not in idx.index:
            raise ValueError(f"Unknown item '{ln.item_id}'")
        if not ln.quantity or ln.quantity <= 0:
            raise ValueError(f"Quantity for '{ln.item_id}' must be > 0")
        if ln.unit_price is not None and ln.unit_price <= 0:
            raise ValueError(f"Price for '{ln.item_id}' must be > 0")
    d = sale_date or default_sale_date(ds)
    inv_id = (invoice_id or f"POS{pd.Timestamp.now():%y%m%d%H%M%S}")[:40]
    if inv_id in set(ds.sales["invoice_id"]):
        raise ValueError(f"Bill number '{inv_id}' already exists")
    rows = pd.DataFrame([{
        "invoice_id": inv_id, "date": pd.Timestamp(d), "item_id": ln.item_id, "qty": float(ln.quantity),
        "unit_price_paise": paise(ln.unit_price) if ln.unit_price else int(idx.at[ln.item_id, "mrp_paise"]),
        "payment_mode": norm_payment(payment_mode), "customer_id": customer_id or ""} for ln in lines])
    sales = pd.concat([ds.sales, rows], ignore_index=True)
    out = _rebuild(ds, sales=sales, as_of=max(ds.as_of, d))
    if reduce_stock:
        m.replace(out)
        deltas: dict[str, float] = {}
        for ln in lines:
            deltas[ln.item_id] = deltas.get(ln.item_id, 0.0) - float(ln.quantity)
        out = adjust_stock(m, deltas)
    else:
        m.replace(out)
    return out, inv_id
