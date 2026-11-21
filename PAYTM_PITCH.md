# Muneem AI — Paytm Hackathon Pitch & Demo Playbook

**Track:** Merchant Growth AI · **One line:** *Muneem turns a kirana owner's bills, payments and khata into the three things to do today: what to reorder, whom to remind, what to clear, with every number checked against the shop's own records.*

> All shop numbers below come from the built-in **synthetic sample shop** ("Muneem Kirana Store", data as of 13 Nov 2026). Say so on stage. They are reproducible: Data → *Load sample data*.

---

## 1. The 3-minute pitch

**[0:00–0:30] The shop**
"Ek kirana dukaan ka din: 80–90 bills, aadhe UPI pe, baaki cash aur udhaar. Payment apps batate hain *kitna paisa aaya*. Par dukaandaar ko teen sawaal poochne hote hain: *kya khatam hone wala hai, kisse paisa lena hai, aur kaunsa maal pada pada sad raha hai.* Wo jawab abhi bhi kaagaz ke bill aur khate mein band hain."

**[0:30–1:00] Why existing tools stop short**
"Billing apps and payment dashboards record what happened. They don't read the supplier's paper invoice, don't know shelf stock, and can't tell the owner what to do next. And typing every bill into an app after a 14-hour day doesn't happen."

**[1:00–2:15] Muneem — live demo** (see §2; show 3 beats only)
1. **Photo → ledger.** "Supplier ka bill aaya. Photo kheencho." → 6 lines read in ~3 s, 5 auto-matched to the shop's products, 1 new product. Owner checks, taps Save, stock updates.
2. **What to do today.** Insights: 2 items run out before the next delivery; 9 khata customers owe ₹27,637 for 30+ days; ₹16,537 stuck in 3 unsold items. One tap drafts the supplier order or the polite udhaar reminder (owner sends it from WhatsApp).
3. **Ask in Hinglish/Hindi.** "Is hafte bikri kyun kam hui?" → answer with a breakdown table and a **"✓ numbers verified"** badge.

**[2:15–2:45] Why trust it**
"Every rupee is computed in code (GST backed out, stock cover, udhaar ageing). Gemini only reads bills, routes questions and writes the sentence; a checker matches every number in the answer to the computed data before the owner sees it. Nothing is sent or saved without the owner's tap. Campaigns keep a hold-out group, so we measure real extra sales instead of guessing."

**[2:45–3:00] Why Paytm**
"Paytm already sits at the counter: QR, Soundbox, settlements. Muneem is the layer that turns those payments plus the paper bills into daily actions. Next step: plug in the merchant's UPI settlement feed and speak the morning brief on the Soundbox."

---

## 2. Live demo script (5–6 minutes, exact clicks)

Start state: sample data loaded, backend on, scanner badge says **Gemini vision** (not "test mode").

| # | Where | Do | What judges see (sample shop) |
|---|---|---|---|
| 1 | **Home** | Point at the briefing | 5 findings: 2 items running out, 14 regulars stopped coming, ₹27,637 overdue udhaar (9 customers), ₹16,537 dead stock, 2 best-sellers with thin margin |
| 2 | **Business** | Scroll top | 30-day sales ₹9,78,950 (+7.1%), margin after GST ₹1,08,344 (11.66% of taxable sales), GST collected ₹50,091, 2,502 bills · avg ₹391. UPI share rose 51% → 66% in 8 weeks |
| 3 | **Data → Scan a bill** | Upload `data/demo-bills/purchase_invoice_sharma_traders.jpg` → *Read bill* | Purchase, ST/2026/1187, 12 Nov, credit; 6 lines; 5 "100% match"; *Kesar Badam Cookies* flagged as new; lines ₹21,646 vs bill ₹22,777 (= + GST) |
| 4 | same | Pick a category + MRP for the new item → *Save bill* | "Purchase bill ST/2026/1187 saved"; Chakki Atta stock 18 → 48, Toor Dal 11 → 51 |
| 5 | same | Upload `cash_memo_handwritten.jpg` → *Read bill* | **Handwritten** Hinglish memo: "Aata 5 kg → Chakki Atta 5kg", "Cheeni → Sugar", "Sarson tel → Mustard Oil"; total ₹1,135 matches. Switch Parle-G to *Glucose Biscuits 200g* → Save as **Sale** |
| 5b | **Inventory** | Open *All items & quantity*, sort by *In stock*; then *Recent transactions* | 64 products, 5,175 units, stock value ₹3.4L at cost; every bill in and out, click a row for its lines; the bill you just scanned is on top |
| 6 | **Stock & orders** | Open today's draft, then pick *Clean Home Supplies · sent* in the order picker | Draft for Sharma Traders (₹20,736, 4 items) with WhatsApp text; order history: 3 received, 1 **Late** delivery flagged, 1 cancelled. *I have sent it ✓* → *Goods received* → stock updated, 4/4 steps |
| 7 | **Insights** | *Draft polite reminders* | 9 personalised Hinglish WhatsApp reminders with each customer's exact balance |
| 8 | **Home** | Ask *"Is hafte bikri kyun kam hui? Aur aaj kya order karna chahiye?"* | Gemini answer + "✓ 5 numbers verified" + bills × average-bill breakdown, category moves |
| 9 | **Home** | Ask in Hindi: *"किन ग्राहकों का उधार सबसे ज़्यादा बाकी है?"* | Hindi answer, "✓ 9 numbers verified", udhaar table |
| 10 | **Campaigns** | Open *Diwali win-back (sample, already sent)* | Measured against hold-out: +29.2 points return rate, +₹29,208 extra sales, p = 0.0002 (sample data) |

Backup if the scanner or internet fails: the third bill (`thermal_receipt_upi.jpg`, UPI receipt, 6/6 matched incl. "Maggi → Instant Noodles") and the rules-mode chat still work offline. Restart the backend with `BILL_SCAN_FAKE=1` only as a last resort — the app then shows **test mode** and you must say it is a fixture.

---

## 3. Demo data

**Slide decks** (private until you share them):
- "Muneem AI — Paytm Demo Pitch" (10 slides, Hinglish notes): https://claude.ai/artifact/JBjryQcF4SPZCHocpuu2Zi
- "Muneem AI — Product Walkthrough" (14 slides, real screenshots of every screen, plus why shopkeepers use it): https://claude.ai/artifact/4fRuZn669iQM1NcUc9G93G

**Sample shop** — "Muneem Kirana Store", Meerut. Synthetic, generated by `backend/app/ingest/generator.py` with planted stories (stock-outs before Diwali, a slowing regular, overdue khata, dead stock, a win-back campaign with hold-out). 64 products, 8 suppliers, 420 customers, 9,469 bills / 23,394 lines (17 Jul – 13 Nov 2026), 40 expenses, 405 udhaar repayments. Stock & orders opens with a sample order history (a draft from today's plan, 2 sent - one late - 3 received, 1 cancelled); its dates are relative to today.

**Bill photos** — `data/demo-bills/` (regenerate with `backend/.venv/bin/python data/demo-bills/make_demo_bills.py`):

| File | Shows | Last real Gemini scan |
|---|---|---|
| `purchase_invoice_sharma_traders.jpg` | Printed GST tax invoice from the supplier, slight tilt, photo lighting | 6/6 lines exact, 5 matched + 1 new product, tax total read, ~3.3 s |
| `cash_memo_handwritten.jpg` | Handwritten Hinglish cash memo on ruled paper, udhaar sale | 5/5 lines exact; Hinglish names matched (aata, cheeni, sarson tel); total ₹1,135 |
| `thermal_receipt_upi.jpg` | Narrow POS receipt paid by Paytm UPI | 6/6 matched incl. brand → generic ("Maggi" → Instant Noodles), UPI detected |

Real phone photos of real bills work the same way (JPG/PNG/WebP/HEIC/PDF, up to 4 pages). Try one from a nearby shop before the round.

---

## 4. Judge Q&A — prepared answers

**"Have you used Paytm for Business?"** — Use it before the round (last time this was asked). Answer from experience: what it shows (payments, settlements) and what it doesn't (purchase bills, shelf stock, udhaar ageing), and where Muneem plugs in.

**"How do you know the merchant's profit?"** — We don't claim total profit. We show **margin after GST on the items we have a cost for** (cost from the item master or the scanned purchase bill), and a *net estimate* that subtracts only the expenses the owner recorded. Each figure shows its formula ("Show calculation").

**"Paytm is already building this."** — Then Muneem is the part that is hard: reading messy paper bills into a clean ledger, deterministic numbers with a verifier, and actions measured with a hold-out. These slot into Paytm's merchant surface.

**"Does the AI make up numbers?"** — No number in an answer comes from the model. Tools compute them; the grounding check compares every number in the reply with the tool output and shows "✓ n numbers verified" or flags the unverified ones.

**"What if the bill is misread?"** — Nothing is saved until the owner reviews. The scan flags qty × rate ≠ amount, lines ≠ bill total, odd dates, duplicate bill numbers, and prices far from the usual cost/MRP.

**"Privacy?"** — Photos are sent only to read the bill; Muneem stores the saved lines, not the images. Web search strips names, phone numbers, UPI ids, GSTINs and amounts before a query leaves the server.

**"Is this real data?"** — The shop is synthetic with planted scenarios so every feature can be shown in five minutes. Bill scanning runs live on Gemini on the photos in the demo.

---

## 5. Honest limits (don't over-claim)

- **No live Paytm integration yet.** UPI settlement import and Soundbox voice are roadmap, not built.
- **Scanned udhaar sales aren't linked to a customer yet**: a credit cash memo adds the sale and reduces stock, but the khata balance only changes for sales with a customer id.
- **The campaign result (+29.2 points, +₹29,208, p = 0.0002) is on synthetic data.** Present it as how measurement works, not as a real-world result.
- **Prior work.** Muneem was first built for the Infra Shift Hackathon 2026 (`github.com/nishikadhankhar/muneem`, forked from `AdityasagarR123/muneem`). Check the Paytm rules on reusing earlier projects and credit the team.

---

## 6. Pre-demo checklist

1. `.env`: `LLM_API_KEY` set; `BILL_SCAN_FAKE` off. If Postgres/ArangoDB aren't reachable, blank `DATABASE_URL` and `ARANGO_URL` for the demo — the app runs in memory and starts in ~3 s instead of ~25 s of retries.
2. Start: `PORT=8050 ./dev.sh` (port 8000 is used by another project on this laptop) → open http://localhost:5173.
3. Data → **Load sample data** (fresh state). Scanner badge must read **Gemini vision**.
4. Warm up: scan one bill and ask one question before judges arrive (first Gemini call is slower).
5. Keep `data/demo-bills/` open in Finder for drag-and-drop; keep a phone ready to photograph a real bill.
6. Language toggle in the sidebar: EN / Hinglish / हिं — answer in whichever the judge uses.
