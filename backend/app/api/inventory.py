"""Whole-shop inventory and the recent-transactions feed.

GET /api/inventory     every product with quantity on hand, stock status, value and last sale
GET /api/transactions  recent bills in and out: counter sales, scanned bills, received supplier orders
Both are computed from the same dataset as everything else, so they always agree with the dashboard.
"""

from __future__ import annotations

import math
from typing import Literal

import pandas as pd
from fastapi import APIRouter, Depends, Query

from app.api.deps import dataset, manager
from app.store.manager import DataManager

router = APIRouter(prefix="/api", tags=["inventory"], dependencies=[Depends(dataset)])


def _num(v, nd: int = 2):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return round(float(v), nd)


@router.get("/inventory")
def inventory(m: DataManager = Depends(manager)):
    ds = m.require()
    st = m.stock()
    sup = ds.supplier_index["name"] if len(ds.suppliers) else pd.Series(dtype=str)
    last = ds.last_sale
    out = []
    for r in st.itertuples(index=False):
        qty = float(r.stock)
        ls = last.get(r.item_id)
        out.append({
            "item_id": r.item_id, "name": r.name, "category": r.category,
            "supplier_id": r.supplier_id, "supplier": str(sup.get(r.supplier_id, r.supplier_id)),
            "stock": qty, "pack_size": int(r.pack_size), "tier": r.tier,
            "days_left": _num(r.days_left, 1), "daily_sales": _num(r.d_adj, 1),
            "reorder_point": _num(r.reorder_point, 1), "order_qty": int(r.order_qty or 0),
            "cost_rs": _num(r.unit_cost_paise / 100), "mrp_rs": _num(r.unit_price_paise / 100),
            "gst_rate": int(r.gst_rate),
            "value_cost_rs": _num(qty * r.unit_cost_paise / 100), "value_mrp_rs": _num(qty * r.unit_price_paise / 100),
            "last_sale": ls.date().isoformat() if ls is not None and not pd.isna(ls) else None,
        })
    tiers = {t: sum(1 for x in out if x["tier"] == t) for t in ("CRITICAL", "SOON", "OK", "UNKNOWN")}
    return {
        "as_of": ds.as_of.isoformat(), "items": out,
        "totals": {
            "skus": len(out), "units": round(sum(x["stock"] for x in out), 1),
            "value_cost_rs": round(sum(x["value_cost_rs"] or 0 for x in out), 2),
            "value_mrp_rs": round(sum(x["value_mrp_rs"] or 0 for x in out), 2),
            "out_of_stock": sum(1 for x in out if x["stock"] <= 0), "tiers": tiers,
        },
        "categories": sorted({x["category"] for x in out}),
    }


@router.get("/transactions")
def transactions(kind: Literal["all", "sale", "purchase"] = "all", limit: int = Query(60, ge=1, le=300),
                 m: DataManager = Depends(manager)):
    """Newest first. Sales are grouped per bill; purchases are scanned supplier bills and received orders."""
    from app.api import bills as bills_api

    ds = m.require()
    saved = {b["reference"]: b for b in bills_api._SAVED}
    rows: list[dict] = []

    if kind in ("all", "sale"):
        s = ds.sales_x.copy()
        s["_pos"] = range(len(s))  # later rows = entered later: tie-break within a day
        names = ds.customers.set_index("customer_id")["name"] if len(ds.customers) else pd.Series(dtype=str)
        g = s.groupby("invoice_id", sort=False)
        head = g.agg(date=("date", "max"), pay=("payment_mode", "first"), cust=("customer_id", "first"),
                     total=("line_total_paise", "sum"), units=("qty", "sum"), n=("item_id", "count"), pos=("_pos", "max"))
        for inv_id, h in head.sort_values(["date", "pos"], ascending=False).head(limit).iterrows():
            lines = s[s["invoice_id"] == inv_id]
            rows.append({
                "id": inv_id, "kind": "sale", "date": h["date"].date().isoformat(), "_pos": int(h["pos"]),
                "_sort": (saved[inv_id]["saved_at"][:10], saved[inv_id]["saved_at"]) if inv_id in saved else None,
                "counterparty": str(names.get(h["cust"], "")) if h["cust"] else "Counter sale",
                "payment": h["pay"], "total_rs": round(h["total"] / 100, 2), "units": float(h["units"]), "lines_n": int(h["n"]),
                "source": "scanned bill" if inv_id in saved else "counter",
                "lines": [{"name": l.name, "qty": float(l.qty), "rate_rs": round(l.unit_price_paise / 100, 2),
                           "amount_rs": round(l.line_total_paise / 100, 2)} for l in lines.itertuples()],
            })

    if kind in ("all", "purchase"):
        for b in bills_api._SAVED:
            if b["bill_type"] != "purchase":
                continue
            rows.append({
                "id": b["reference"], "kind": "purchase", "date": (b["bill_date"] or b["saved_at"][:10]), "_pos": 10**9,
                "_sort": (b["saved_at"][:10], b["saved_at"]),
                "counterparty": b.get("vendor") or "Supplier", "payment": b["payment_method"], "total_rs": b["total"],
                "units": sum(l["quantity"] for l in b["lines"]), "lines_n": len(b["lines"]), "source": "scanned bill",
                "lines": [{"name": l["name"], "qty": l["quantity"], "rate_rs": l["unit_price"], "amount_rs": l["amount"]}
                          for l in b["lines"]],
            })
        for po in m.restock.list(status="received"):
            got = next((h for h in po.history if h["status"] == "received"), {})
            rows.append({
                "id": po.po_id, "kind": "purchase", "date": (got.get("at") or po.created_at)[:10], "_pos": 10**9 - 1,
                "counterparty": po.supplier, "payment": "order", "total_rs": round(po.total_incl_gst_paise / 100, 2),
                "units": float(sum(l.qty for l in po.lines)), "lines_n": len(po.lines), "source": "supplier order received",
                "lines": [{"name": l.name, "qty": float(l.qty), "rate_rs": round(l.unit_cost_paise / 100, 2),
                           "amount_rs": round(l.value_incl_gst_paise / 100, 2)} for l in po.lines],
            })

    # newest first; a bill you just scanned counts from the moment it was saved, not its printed date
    rows.sort(key=lambda r: r.get("_sort") or (r["date"], f"{r['_pos']:012d}"), reverse=True)
    for r in rows:
        r.pop("_pos", None)
        r.pop("_sort", None)
    rows = rows[:limit]
    return {"transactions": rows, "count": len(rows),
            "totals": {"sale_rs": round(sum(r["total_rs"] for r in rows if r["kind"] == "sale"), 2),
                       "purchase_rs": round(sum(r["total_rs"] for r in rows if r["kind"] == "purchase"), 2)}}
