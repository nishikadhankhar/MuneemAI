"""Ledger write path + bill scanning (scan -> review -> commit)."""

import io
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.ingest.bill_scan import (BillExtraction, BillLine, FakeBillExtractor, ScanError, analyse,
                                  read_files, sniff_mime)
from app.main import create_app
from app.store import ledger as L

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 400
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 400


@pytest.fixture()
def client(settings):
    """Fresh app per test: every test starts from the sample dataset."""
    with TestClient(create_app()) as c:
        c.post("/api/sample")
        c.app.state.bill_extractor = FakeBillExtractor(c.app.state.manager.require)
        yield c


# ------------------------------------------------------------------ ledger writes (store)
def _stock(client) -> dict:
    return {i["item_id"]: i["stock"] for i in client.get("/api/items").json()}


def _m(client):
    return client.app.state.manager


def test_record_sale_updates_stock_and_keeps_sample_date(client):
    before, as_of = _stock(client)["I001"], client.get("/api/dataset").json()["as_of"]
    ds, inv_id = L.record_sale(_m(client), [L.SaleLine("I001", 2)], payment_mode="UPI")
    assert _stock(client)["I001"] == max(0, before - 2)
    row = ds.sales[ds.sales["invoice_id"] == inv_id].iloc[0]
    assert row["payment_mode"] == "UPI" and row["date"].date().isoformat() == as_of
    assert client.get("/api/dataset").json()["as_of"] == as_of


def test_record_sale_validation(client):
    with pytest.raises(ValueError, match="Unknown item"):
        L.record_sale(_m(client), [L.SaleLine("NOPE", 1)])
    with pytest.raises(ValueError):
        L.record_sale(_m(client), [L.SaleLine("I001", 0)])


def test_stock_adjust_never_negative(client):
    L.adjust_stock(_m(client), {"I001": -10_000})
    assert _stock(client)["I001"] == 0


def test_add_product(client):
    _, ids = L.add_items(_m(client), [L.NewItem("Kesar Badam Cookies 200g", "Snacks & Biscuits", 40, 30, 18, 12)])
    item = {i["item_id"]: i for i in client.get("/api/items").json()}[ids[0]]
    assert item["stock"] == 12 and item["gst_rate"] == 18
    with pytest.raises(ValueError, match="GST"):
        L.add_items(_m(client), [L.NewItem("X", "General", 2, 1, 7)])


# ------------------------------------------------------------------ bill scan: unit
def test_sniff_mime_uses_magic_bytes():
    assert sniff_mime(JPEG) == "image/jpeg" and sniff_mime(PNG) == "image/png"
    assert sniff_mime(b"%PDF-1.7" + b"0" * 200) == "application/pdf"
    assert sniff_mime(b"<html>" + b"0" * 200) is None


def test_read_files_limits():
    with pytest.raises(ScanError):
        read_files([], 4, 8)
    with pytest.raises(ScanError):
        read_files([("x.jpg", b"not an image" * 20)], 4, 8)
    with pytest.raises(ScanError):
        read_files([("a.jpg", JPEG)] * 5, 4, 8)
    assert read_files([("a.jpg", JPEG)], 4, 8)[0].mime == "image/jpeg"


def test_analyse_matches_hinglish_and_flags_math(ds):
    ex = BillExtraction(bill_type="sale", bill_number="M-1", bill_date="2026-11-10", lines=[
        BillLine(description="CHAKKI ATTA 5KG", quantity=2, unit_price=265, amount=530),
        BillLine(description="toor dal 1 kg", quantity=1, unit_price=166, amount=200),  # math wrong
        BillLine(description="Zzyzx gadget", quantity=1, unit_price=99, amount=99),
    ], grand_total=900)
    out = analyse(ex, ds, today=date(2026, 11, 13))
    l1, l2, l3 = out["lines"]
    assert l1["match"]["item_id"] == "I001" and not l1["flags"]
    assert l2["match"] and any("amount" in f for f in l2["flags"])
    assert l3["match"] is None
    assert out["matched"] == 2 and out["unmatched"] == 1
    assert any("bill total" in w for w in out["warnings"])


def test_pack_size_spacing_still_matches(ds):
    from app.ingest.bill_scan import normalize_pack
    assert normalize_pack("Aata 5 kg") == "Aata 5kg"
    assert normalize_pack("Doodh 500 ML / 1 Ltr / 200 gm") == "Doodh 500ml / 1l / 200g"
    ex = BillExtraction(bill_type="sale", lines=[BillLine(description="Aata 5 kg", quantity=2, unit_price=265, amount=530)])
    assert analyse(ex, ds, today=date(2026, 11, 13))["lines"][0]["match"]["item_id"] == "I001"


def test_analyse_fills_missing_numbers_and_checks_dates(ds):
    ex = BillExtraction(bill_type="purchase", bill_date="2031-01-01",
                        lines=[BillLine(description="Sugar 1kg", quantity=10, amount=420)])
    out = analyse(ex, ds, today=date(2026, 11, 13))
    assert out["lines"][0]["unit_price"] == 42
    assert any("future" in w for w in out["warnings"])


# ------------------------------------------------------------------ bill scan: API
def test_status_without_key_reports_unavailable(settings):
    with TestClient(create_app()) as c:
        st = c.get("/api/bills/status").json()
        assert st["available"] is False and "LLM_API_KEY" in st["reason"]
        r = c.post("/api/bills/scan", files={"files": ("b.jpg", io.BytesIO(JPEG), "image/jpeg")})
        assert r.status_code in (409, 503)


def test_scan_rejects_non_images(client):
    r = client.post("/api/bills/scan", files={"files": ("b.jpg", io.BytesIO(b"<svg>" * 50), "image/jpeg")})
    assert r.status_code == 422 and "not a JPEG" in r.json()["detail"]


def test_purchase_bill_scan_and_commit_adds_stock(client):
    inv0 = _stock(client)
    r = client.post("/api/bills/scan", files=[("files", ("page1.jpg", io.BytesIO(JPEG), "image/jpeg"))])
    assert r.status_code == 200, r.text
    scan = r.json()
    assert scan["engine"]["mode"] == "fake" and scan["bill_type"] == "purchase"
    assert scan["matched"] == 4 and scan["unmatched"] == 1
    lines = []
    for ln in scan["lines"]:
        if ln["match"]:
            lines.append({"product_id": ln["match"]["item_id"], "quantity": ln["quantity"], "unit_price": ln["unit_price"]})
        else:
            lines.append({"new_product": {"name": ln["description"], "category": "Snacks & Biscuits",
                                          "selling_price": 45, "cost_price": ln["unit_price"]},
                          "quantity": ln["quantity"], "unit_price": ln["unit_price"]})
    c = client.post(f"/api/bills/{scan['scan_id']}/commit",
                    json={"bill_type": "purchase", "bill_number": scan["extraction"]["bill_number"], "lines": lines})
    assert c.status_code == 200, c.text
    assert c.json()["new_products"] == 1
    inv1 = _stock(client)
    first = scan["lines"][0]
    pid = first["match"]["item_id"]
    assert inv1[pid] == inv0[pid] + first["quantity"]
    items = client.get("/api/items").json()
    assert any(i["name"] == "Kesar Badam Cookies 200g" and i["stock"] == 6 for i in items)
    again = client.post(f"/api/bills/{scan['scan_id']}/commit", json={"bill_type": "purchase", "lines": lines})
    assert again.status_code == 409


def test_sale_bill_commit_appends_sales(client):
    scan = client.post("/api/bills/scan", files={"files": ("p.png", io.BytesIO(PNG), "image/png")}).json()
    matched = [ln for ln in scan["lines"] if ln["match"]][:2]
    n0 = client.get("/api/dataset").json()["counts"]["sales_lines"]
    as_of = client.get("/api/dataset").json()["as_of"]
    c = client.post(f"/api/bills/{scan['scan_id']}/commit", json={
        "bill_type": "sale", "bill_number": "MEMO 77/A", "bill_date": as_of, "payment_method": "UPI",
        "lines": [{"product_id": ln["match"]["item_id"], "quantity": 1, "unit_price": ln["match"]["mrp"]} for ln in matched]})
    assert c.status_code == 200, c.text
    assert c.json()["reference"] == "MEMO77/A"
    assert client.get("/api/dataset").json()["counts"]["sales_lines"] == n0 + 2


def test_commit_requires_product_per_line(client):
    scan = client.post("/api/bills/scan", files={"files": ("p.png", io.BytesIO(PNG), "image/png")}).json()
    r = client.post(f"/api/bills/{scan['scan_id']}/commit",
                    json={"bill_type": "sale", "lines": [{"quantity": 1, "unit_price": 10}]})
    assert r.status_code == 422
    assert client.post("/api/bills/nope/commit", json={"bill_type": "sale", "lines": [
        {"product_id": "I001", "quantity": 1, "unit_price": 10}]}).status_code == 404


def test_commit_accepts_long_scanned_names(client):
    """Real invoices print long names (brand, colour, HSN); saving must not fail on them."""
    scan = client.post("/api/bills/scan", files={"files": ("p.png", io.BytesIO(PNG), "image/png")}).json()
    long_name = "boAt Airdopes 311 Pro TWS Earbuds (Active Black)(Box) [Airdopes 311 Pro] (HSN-85183011) " * 2
    r = client.post(f"/api/bills/{scan['scan_id']}/commit", json={"bill_type": "sale", "lines": [{
        "new_product": {"name": long_name, "category": "Electronics accessories", "selling_price": 799, "cost_price": 650},
        "quantity": 1, "unit_price": 799}]})
    assert r.status_code == 200, r.text
    names = [i["name"] for i in client.get("/api/items").json()]
    assert long_name.strip()[:80] in names


def test_saved_bills_are_listed_newest_first(client):
    from app.api import bills as B
    B._SAVED.clear()
    for kind in ("purchase", "sale"):
        scan = client.post("/api/bills/scan", files={"files": ("p.png", io.BytesIO(PNG), "image/png")}).json()
        ln = next(l for l in scan["lines"] if l["match"])
        r = client.post(f"/api/bills/{scan['scan_id']}/commit", json={"bill_type": kind, "bill_number": f"T-{kind}",
            "lines": [{"product_id": ln["match"]["item_id"], "quantity": 2, "unit_price": 10}]})
        assert r.status_code == 200, r.text
    out = client.get("/api/bills/saved").json()
    assert out["count"] == 2 and [b["reference"] for b in out["bills"]] == ["T-sale", "T-purchase"]
    b = out["bills"][0]
    assert b["lines"][0]["name"] and b["lines"][0]["amount"] == 20 and b["vendor"]
    assert out["totals"] == {"purchase": 20, "sale": 20}
    assert client.get("/api/bills/saved", params={"bill_type": "purchase"}).json()["count"] == 1
