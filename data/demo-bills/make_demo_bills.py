"""Generate three demo bill photos for the bill-scanning demo (synthetic, for pitch use only).

    backend/.venv/bin/python data/demo-bills/make_demo_bills.py

1. purchase_invoice_sharma_traders.jpg  - printed GST tax invoice from the shop's supplier (stock in)
2. cash_memo_handwritten.jpg            - handwritten kachcha cash memo to a customer (sale)
3. thermal_receipt_upi.jpg              - narrow POS receipt paid by UPI (sale)

Items match the sample shop's catalog, plus one product the shop does not stock yet,
so the demo shows auto-matching, a new product, and the qty x rate / total checks.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).parent
SUP = "/System/Library/Fonts/Supplemental/"
FONTS = {
    "mono": SUP + "Courier New.ttf", "mono_b": SUP + "Courier New Bold.ttf",
    "hand": SUP + "Bradley Hand Bold.ttf", "hand2": SUP + "Noteworthy.ttc",
    "sans": SUP + "Andale Mono.ttf",
}


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONTS[name], size)
    except OSError:
        return ImageFont.load_default(size)


def photo_finish(img: Image.Image, angle: float, seed: int) -> Image.Image:
    """Make a flat render look like a phone photo: slight tilt, uneven light, soft focus, noise."""
    rnd = random.Random(seed)
    w, h = img.size
    shade = Image.new("L", (w, h))
    sd = ImageDraw.Draw(shade)
    for y in range(h):
        sd.line([(0, y), (w, y)], fill=int(235 + 20 * math.sin(y / h * math.pi)))
    img = Image.composite(img, Image.new("RGB", (w, h), (205, 200, 188)), shade.point(lambda v: 255 if v > 0 else 0))
    px = img.load()
    for _ in range(w * h // 60):
        x, y = rnd.randrange(w), rnd.randrange(h)
        r, g, b = px[x, y]
        d = rnd.randint(-18, 18)
        px[x, y] = (max(0, min(255, r + d)), max(0, min(255, g + d)), max(0, min(255, b + d)))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    bg = Image.new("RGB", (int(w * 1.12), int(h * 1.08)), (92, 74, 60))  # wooden counter
    bg.paste(img, ((bg.width - w) // 2, (bg.height - h) // 2))
    return bg.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(92, 74, 60))


def purchase_invoice() -> Image.Image:
    W, H = 1240, 1650
    im = Image.new("RGB", (W, H), (250, 249, 244))
    d = ImageDraw.Draw(im)
    b, r, s = font("mono_b", 40), font("mono", 28), font("mono", 24)
    d.text((W // 2, 70), "SHARMA TRADERS", font=font("mono_b", 54), fill="black", anchor="mm")
    d.text((W // 2, 120), "Wholesale Kirana & Provisions, Begum Bridge Road, Meerut", font=s, fill="black", anchor="mm")
    d.text((W // 2, 152), "GSTIN: 09ABCDE1234F1Z5   Ph: 98XXXXXX01", font=s, fill="black", anchor="mm")
    d.text((W // 2, 210), "TAX INVOICE", font=b, fill="black", anchor="mm")
    d.line([(60, 245), (W - 60, 245)], fill="black", width=3)
    d.text((70, 265), "Invoice No: ST/2026/1187", font=r, fill="black")
    d.text((780, 265), "Date: 12/11/2026", font=r, fill="black")
    d.text((70, 305), "Bill To: Muneem Kirana Store, Shastri Nagar", font=r, fill="black")
    d.text((70, 345), "Payment: Credit (15 days)", font=r, fill="black")
    d.line([(60, 395), (W - 60, 395)], fill="black", width=2)
    cols = [70, 130, 640, 760, 860, 1010]
    for x, t in zip(cols, ["#", "Item", "Qty", "GST%", "Rate", "Amount"]):
        d.text((x, 410), t, font=font("mono_b", 28), fill="black")
    d.line([(60, 455), (W - 60, 455)], fill="black", width=2)
    rows = [("Chakki Atta 5kg", 30, 5, 229.67), ("Toor Dal 1kg", 40, 5, 148.34),
            ("Sugar 1kg", 50, 5, 41.90), ("Moong Dal 1kg", 20, 5, 126.67),
            ("Refined Sunflower Oil 1L", 24, 5, 159.05), ("Kesar Badam Cookies 200g", 12, 18, 31.36)]
    y, taxable, tax = 475, 0.0, 0.0
    for i, (name, q, g, rate) in enumerate(rows, 1):
        amt = round(q * rate, 2)
        taxable += amt
        tax += amt * g / 100
        for x, t in zip(cols, [str(i), name, str(q), str(g), f"{rate:.2f}", f"{amt:,.2f}"]):
            d.text((x, y), t, font=r, fill="black")
        y += 52
    d.line([(60, y + 10), (W - 60, y + 10)], fill="black", width=2)
    y += 30
    total = round(taxable + tax)
    for label, val in [("Taxable Value", taxable), ("CGST + SGST", tax), ("Round off", total - taxable - tax),
                       ("GRAND TOTAL", total)]:
        f = font("mono_b", 32) if label == "GRAND TOTAL" else r
        d.text((620, y), label, font=f, fill="black")
        d.text((W - 70, y), f"{val:,.2f}", font=f, fill="black", anchor="ra")
        y += 46
    d.text((70, y + 40), "Rs. " + f"{total:,}" + " only. Goods once sold will not be taken back.", font=s, fill="black")
    d.text((W - 80, H - 120), "For SHARMA TRADERS", font=r, fill="black", anchor="ra")
    d.text((W - 120, H - 70), "Auth. Signatory", font=font("hand", 30), fill=(30, 40, 120), anchor="ra")
    return photo_finish(im, angle=-1.6, seed=1)


def cash_memo() -> Image.Image:
    W, H = 1100, 1400
    im = Image.new("RGB", (W, H), (255, 252, 235))
    d = ImageDraw.Draw(im)
    for y in range(260, H - 80, 62):  # ruled register paper
        d.line([(40, y), (W - 40, y)], fill=(170, 200, 230), width=2)
    d.line([(120, 200), (120, H - 60)], fill=(230, 120, 120), width=2)
    d.text((W // 2, 60), "MUNEEM KIRANA STORE", font=font("mono_b", 44), fill=(150, 20, 30), anchor="mm")
    d.text((W // 2, 110), "Cash Memo  -  Shastri Nagar, Meerut", font=font("mono", 26), fill=(150, 20, 30), anchor="mm")
    d.text((70, 150), "No. 0457", font=font("mono_b", 28), fill=(150, 20, 30))
    ink, hand = (25, 35, 110), font("hand", 40)
    d.text((620, 150), "Date 13/11/26", font=hand, fill=ink)
    d.text((140, 205), "Sharma ji (udhaar)", font=hand, fill=ink)
    lines = [("Aata 5 kg", "2", "265", "530"), ("Toor dal 1kg", "1", "175", "175"),
             ("Cheeni 1kg", "3", "45", "135"), ("Sarson tel 1L", "1", "195", "195"),
             ("Parle-G 200g", "4", "25", "100")]
    y = 270
    for name, q, r, a in lines:
        d.text((140, y), name, font=hand, fill=ink)
        d.text((600, y), f"{q} x {r}", font=hand, fill=ink)
        d.text((W - 90, y), a, font=hand, fill=ink, anchor="ra")
        y += 62
    d.line([(560, y + 10), (W - 70, y + 10)], fill=ink, width=3)
    d.text((560, y + 25), "Total", font=hand, fill=ink)
    d.text((W - 90, y + 25), "1135", font=font("hand", 48), fill=ink, anchor="ra")
    d.text((140, y + 110), "khate me likha", font=font("hand2", 34), fill=ink)
    return photo_finish(im, angle=2.4, seed=2)


def thermal_receipt() -> Image.Image:
    W, H = 640, 1350
    im = Image.new("RGB", (W, H), (247, 247, 247))
    d = ImageDraw.Draw(im)
    f, fb = font("mono", 24), font("mono_b", 26)
    d.text((W // 2, 50), "MUNEEM KIRANA STORE", font=font("mono_b", 32), fill="black", anchor="mm")
    d.text((W // 2, 88), "Shastri Nagar, Meerut", font=f, fill="black", anchor="mm")
    d.text((W // 2, 118), "GSTIN 09PQRSX6789K1Z2", font=f, fill="black", anchor="mm")
    d.text((30, 160), "Bill: POS-88213   13-11-2026 18:42", font=f, fill="black")
    d.text((30, 195), "-" * 42, font=f, fill="black")
    d.text((30, 225), "Item              Qty   Rate    Amt", font=fb, fill="black")
    d.text((30, 255), "-" * 42, font=f, fill="black")
    items = [("Toned Milk 500ml", 4, 30.0), ("White Bread 400g", 2, 45.0), ("Eggs (Tray of 6)", 1, 48.0),
             ("Maggi Noodles 70g", 6, 15.0), ("Cola 750ml", 2, 40.0), ("Dahi 400g", 1, 55.0)]
    y, tot = 290, 0.0
    for name, q, r in items:
        amt = q * r
        tot += amt
        d.text((30, y), f"{name[:17]:<17}{q:>4}{r:>8.2f}{amt:>8.2f}", font=f, fill="black")
        y += 36
    d.text((30, y), "-" * 42, font=f, fill="black")
    d.text((30, y + 35), f"{'TOTAL':<29}{tot:>9.2f}", font=fb, fill="black")
    d.text((30, y + 80), "Paid by UPI (Paytm)  Ref 6342XXXX91", font=f, fill="black")
    d.text((W // 2, y + 150), "Thank you! Visit again", font=f, fill="black", anchor="mm")
    return photo_finish(im, angle=-0.8, seed=3)


if __name__ == "__main__":
    for name, fn in [("purchase_invoice_sharma_traders.jpg", purchase_invoice),
                     ("cash_memo_handwritten.jpg", cash_memo), ("thermal_receipt_upi.jpg", thermal_receipt)]:
        fn().save(OUT / name, "JPEG", quality=88)
        print("wrote", OUT / name)
