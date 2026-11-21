"""Inventory overview and the recent-transactions feed."""

from fastapi.testclient import TestClient

from app.main import create_app
from app.store import ledger as L


def test_inventory_lists_every_product_with_quantity(settings):
    with TestClient(create_app()) as c:
        inv = c.get("/api/inventory").json()
        assert inv["totals"]["skus"] == len(inv["items"]) == 64
        assert inv["totals"]["units"] == sum(i["stock"] for i in inv["items"])
        assert inv["totals"]["value_cost_rs"] > 0 and sum(inv["totals"]["tiers"].values()) == 64
        it = next(i for i in inv["items"] if i["item_id"] == "I001")
        assert it["supplier"] and it["stock"] >= 0 and it["tier"] in ("CRITICAL", "SOON", "OK", "UNKNOWN")
        # same numbers the stock analytics use
        stock = {r["item_id"]: r["stock"] for r in c.get("/api/stock").json()["rows"]}
        assert all(abs(i["stock"] - stock[i["item_id"]]) < 1e-9 for i in inv["items"])


def test_recent_transactions_newest_first_and_includes_new_sale(settings):
    with TestClient(create_app()) as c:
        m = c.app.state.manager
        _, inv_id = L.record_sale(m, [L.SaleLine("I001", 1)], payment_mode="UPI", invoice_id="NEWEST-1")
        t = c.get("/api/transactions", params={"kind": "sale", "limit": 5}).json()
        assert t["transactions"][0]["id"] == "NEWEST-1" and t["transactions"][0]["lines"][0]["name"]
        dates = [r["date"] for r in t["transactions"]]
        assert dates == sorted(dates, reverse=True)
        p = c.get("/api/transactions", params={"kind": "purchase"}).json()
        assert p["count"] >= 1 and all(r["kind"] == "purchase" for r in p["transactions"])


def test_scanned_bill_is_listed_first_even_with_an_old_printed_date(settings):
    import io
    PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 400
    from app.ingest.bill_scan import FakeBillExtractor
    with TestClient(create_app()) as c:
        c.app.state.bill_extractor = FakeBillExtractor(c.app.state.manager.require)
        scan = c.post("/api/bills/scan", files={"files": ("p.png", io.BytesIO(PNG), "image/png")}).json()
        ln = next(l for l in scan["lines"] if l["match"])
        r = c.post(f"/api/bills/{scan['scan_id']}/commit", json={"bill_type": "sale", "bill_number": "JUST-NOW",
            "lines": [{"product_id": ln["match"]["item_id"], "quantity": 1, "unit_price": 50}]})
        assert r.status_code == 200, r.text
        first = c.get("/api/transactions", params={"limit": 3}).json()["transactions"][0]
        assert first["id"] == "JUST-NOW" and first["source"] == "scanned bill"
