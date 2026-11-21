"""The sample shop opens with an order history: a draft, waiting/late deliveries, received, cancelled."""

from datetime import date

from fastapi.testclient import TestClient

from app.main import create_app


def test_sample_shop_has_order_history(settings):
    with TestClient(create_app()) as c:
        orders = c.get("/api/restock/orders").json()
        by_status = {s: [o for o in orders if o["status"] == s] for s in ("draft", "sent", "received", "cancelled")}
        assert all(by_status[s] for s in by_status), {s: len(v) for s, v in by_status.items()}
        # at least one sent order is past its expected delivery -> shows as late
        assert any(date.fromisoformat(o["expected_delivery"]) < date.today() for o in by_status["sent"])
        # history orders don't double-count stock: receiving them again is not allowed
        rec = by_status["received"][0]
        assert c.post(f"/api/restock/orders/{rec['po_id']}/status", json={"status": "sent"}).status_code == 409
        assert all(o["message"] and o["lines"] for o in orders)
