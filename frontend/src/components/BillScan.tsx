import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { inr } from "../lib/format";
import { Badge, Card, ErrorBox, Spinner, useAsync } from "./ui";

// Scan a paper bill (photo / PDF) -> review every line -> save as a purchase (stock in) or a sale.
// Backend: GET /bills/status, POST /bills/scan, POST /bills/{id}/commit.

const NEW = "__new__";
const SKIP = "__skip__";
const MAX_EDGE = 2000;

type Line = {
  key: number; description: string; choice: string; qty: string; rate: string;
  newName: string; newCategory: string; newMrp: string; flags: string[]; score: number | null;
  suggestions: { item_id: string; name: string }[];
};

/** Shrink big phone photos before upload (JPEG/PNG/WebP only). */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

const n = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** Bill descriptions carry HSN codes and repeated model names; keep a short product name (max 80). */
function productName(desc: string): string {
  const clean = desc
    .replace(/\(?\s*HSN[\s:-]*\d+\s*\)?/gi, "")   // (HSN-85183011)
    .replace(/\[[^\]]*\]/g, "")                     // [Airdopes 311 Pro]
    .replace(/\(\s*(box|pack|pc|pcs)\s*\)/gi, "")    // (Box)
    .replace(/\s+/g, " ").trim();
  return (clean || desc).slice(0, 80).trim();
}

export default function BillScan({ onSaved }: { onSaved: (summary: string) => void }) {
  const status = useAsync(() => api.get("/bills/status"), []);
  const items = useAsync(() => api.get<any[]>("/items"), []);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [scan, setScan] = useState<any>(null);
  const [billType, setBillType] = useState<"purchase" | "sale" | null>(null);
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [payment, setPayment] = useState("cash");
  const [updateCost, setUpdateCost] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);

  const st = status.data;
  const maxFiles = st?.max_files ?? 4;
  const catalog = items.data ?? [];
  const byId = useMemo(() => new Map(catalog.map((i) => [i.item_id, i])), [catalog]);
  const categories = useMemo(() => [...new Set(catalog.map((i) => i.category as string))].sort(), [catalog]);

  useEffect(() => {
    const urls = files.map((f) => (/^image\/(jpeg|png|webp)$/.test(f.type) ? URL.createObjectURL(f) : ""));
    setPreviews(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const ok = [...list].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf" || /\.(heic|heif)$/i.test(f.name));
    const small = await Promise.all(ok.map(shrink));
    setFiles((prev) => [...prev, ...small].slice(0, maxFiles));
  };

  const reset = () => { setFiles([]); setScan(null); setLines([]); setHint(""); setErr(null); setBillType(null); };

  const read = async () => {
    setBusy(true); setErr(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f, f.name));
      if (hint.trim()) form.append("hint", hint.trim());
      const r = await api.upload("/bills/scan", form);
      setScan(r);
      setBillType(r.bill_type === "unknown" ? null : r.bill_type);
      setBillNo(r.extraction.bill_number ?? "");
      setBillDate(r.bill_date ?? "");
      setPayment(r.extraction.payment_mode && r.extraction.payment_mode !== "unknown" ? r.extraction.payment_mode : "cash");
      setLines(r.lines.map((l: any) => ({
        key: l.line_no, description: l.description, choice: l.match?.item_id ?? NEW,
        qty: l.quantity != null ? String(l.quantity) : "", rate: l.unit_price != null ? String(l.unit_price) : "",
        newName: productName(l.description), newCategory: "Uncategorised",
        // a sale bill's rate is already the selling price; a purchase rate is the cost
        newMrp: l.unit_price != null ? String(r.bill_type === "sale" ? l.unit_price : Math.round(l.unit_price * 1.2)) : "",
        flags: l.flags, score: l.match?.score ?? null, suggestions: l.suggestions,
      })));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const set = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const kept = lines.filter((l) => l.choice !== SKIP);
  const total = kept.reduce((s, l) => s + (n(l.qty) || 0) * (n(l.rate) || 0), 0);
  const problem = !billType ? "Choose purchase or sale."
    : !kept.length ? "Keep at least one line."
    : kept.some((l) => !(n(l.qty) > 0) || !(n(l.rate) > 0)) ? "Every line needs a quantity and a rate."
    : kept.some((l) => l.choice === NEW && (!l.newName.trim() || !(n(l.newMrp) > 0))) ? "New products need a name and MRP."
    : null;

  const save = async () => {
    if (problem || !scan) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/bills/${scan.scan_id}/commit`, {
        bill_type: billType, bill_date: billDate || null, bill_number: billNo.trim() || null,
        payment_method: payment, update_cost: billType === "purchase" && updateCost,
        lines: kept.map((l) => l.choice === NEW
          ? { new_product: { name: l.newName.trim(), category: l.newCategory, selling_price: n(l.newMrp),
                cost_price: billType === "purchase" ? n(l.rate) : Math.round(n(l.newMrp) * 82) / 100 },
              quantity: n(l.qty), unit_price: n(l.rate) }
          : { product_id: l.choice, quantity: n(l.qty), unit_price: n(l.rate) }),
      });
      onSaved(`${r.bill_type === "purchase" ? "Purchase" : "Sale"} bill ${r.reference} saved · ${r.lines} lines · ${inr(r.total)}${r.new_products ? ` · ${r.new_products} new product(s)` : ""}`);
      reset(); items.reload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Card title={<span className="flex items-center gap-2">Scan a bill
      {st && <Badge tone={!st.available ? "red" : st.mode === "fake" ? "amber" : "blue"}>
        {!st.available ? "off" : st.mode === "fake" ? "test mode" : "Gemini vision"}</Badge>}</span>}
      right={scan && <button className="btn" onClick={reset}>Scan another</button>}>
      {st && !st.available && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {st.reason} Add <code>LLM_API_KEY</code> to <code>.env</code> and restart the backend.
        </p>
      )}
      {st?.mode === "fake" && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          BILL_SCAN_FAKE is on: the result is a built-in test bill, not read from your photo.
        </p>
      )}

      {!scan && (
        <>
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm">
            <span className="font-medium text-ink">Photo of a supplier invoice or a cash memo</span>
            <span className="text-xs text-muted">Printed or handwritten · up to {maxFiles} pages · JPG, PNG, WebP, HEIC or PDF. Nothing is saved until you confirm.</span>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <button className="btn btn-green" onClick={() => camRef.current?.click()}>Take photo</button>
              <button className="btn" onClick={() => pickRef.current?.click()}>Choose files</button>
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
            <input ref={pickRef} type="file" multiple accept="image/*,application/pdf,.heic,.heif" className="hidden"
              onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          </div>
          {files.length > 0 && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="relative h-24 w-20 overflow-hidden rounded-lg border border-line bg-surface-2 text-[10px] text-muted">
                    {previews[i] ? <img src={previews[i]} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
                      : <div className="flex h-full items-center justify-center break-all p-1 text-center">{f.name}</div>}
                    <button aria-label={`Remove page ${i + 1}`} onClick={() => setFiles((fs) => fs.filter((_, k) => k !== i))}
                      className="absolute right-1 top-1 rounded bg-white/90 px-1 text-ink">×</button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input className="input min-w-0 flex-1" maxLength={200} value={hint} onChange={(e) => setHint(e.target.value)}
                  placeholder='Optional note, e.g. "purchase bill from Sharma Traders"' />
                <button className="btn btn-dark" disabled={busy || !st?.available} onClick={read}>{busy ? "Reading…" : "Read bill"}</button>
              </div>
            </div>
          )}
        </>
      )}

      {scan && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {scan.extraction.vendor_name ?? "Unknown shop"} · {scan.lines.length} lines · {scan.matched} matched · {scan.unmatched} new
            · {scan.engine.mode === "fake" ? "test fixture" : scan.engine.model}
          </p>
          {scan.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {scan.warnings.map((w: string) => <li key={w}>• {w}</li>)}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="mb-1 text-xs font-medium text-muted">Bill type</div>
              <div className="flex overflow-hidden rounded-lg border border-line">
                {(["purchase", "sale"] as const).map((t) => (
                  <button key={t} onClick={() => setBillType(t)}
                    className={`flex-1 px-2 py-1.5 text-sm ${billType === t ? "bg-ink text-white" : "bg-surface text-ink/80 hover:bg-surface-2"}`}>
                    {t === "purchase" ? "Purchase (stock in)" : "Sale"}
                  </button>
                ))}
              </div>
            </div>
            <label className="text-xs font-medium text-muted">Bill number
              <input className="input mt-1 w-full" maxLength={40} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-muted">Bill date
              <input className="input mt-1 w-full" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-muted">Payment
              <select className="input mt-1 w-full" value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="cash">Cash</option><option value="UPI">UPI</option>
                <option value="card">Card</option><option value="credit">Udhaar / credit</option>
              </select>
            </label>
          </div>
          {billType === "purchase" && (
            <label className="flex items-center gap-1.5 text-xs text-ink/80">
              <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
              Update each product's cost to the billed rate
            </label>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">On the bill</th><th className="py-2 pr-3 font-medium">Your product</th>
                <th className="py-2 pr-3 text-right font-medium">Qty</th><th className="py-2 pr-3 text-right font-medium">Rate ₹</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr></thead>
              <tbody>
                {lines.map((l) => {
                  const it = byId.get(l.choice);
                  return (
                    <tr key={l.key} className={`border-b border-line/70 align-top ${l.choice === SKIP ? "opacity-40" : ""}`}>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-ink">{l.description}</div>
                        {l.flags.map((f) => <div key={f} className="text-xs text-amber-700">⚠ {f}</div>)}
                      </td>
                      <td className="py-2 pr-3">
                        <select className="input w-full" value={l.choice} onChange={(e) => set(l.key, { choice: e.target.value })}>
                          {l.suggestions.length > 0 && <optgroup label="Close matches">
                            {l.suggestions.map((s) => <option key={`s${s.item_id}`} value={s.item_id}>{s.name}</option>)}</optgroup>}
                          <option value={NEW}>+ New product</option>
                          <option value={SKIP}>Skip this line</option>
                          <optgroup label="All products">
                            {catalog.map((i) => <option key={i.item_id} value={i.item_id}>{i.name}</option>)}</optgroup>
                        </select>
                        {it && <div className="mt-1 text-xs text-muted">
                          {l.score != null && l.choice === scan.lines.find((x: any) => x.line_no === l.key)?.match?.item_id
                            && <Badge tone="green">{Math.round(l.score * 100)}% match</Badge>} stock {it.stock ?? "–"} · MRP {inr(it.mrp_rs ?? it.mrp_paise / 100)}
                        </div>}
                        {l.choice === NEW && (
                          <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                            <input aria-label="New product name" className="input sm:col-span-3" value={l.newName} maxLength={80}
                              onChange={(e) => set(l.key, { newName: e.target.value })} />
                            <select aria-label="New product category" className="input sm:col-span-2" value={l.newCategory}
                              onChange={(e) => set(l.key, { newCategory: e.target.value })}>
                              {["Uncategorised", ...categories.filter((c) => c !== "Uncategorised")].map((c) => <option key={c}>{c}</option>)}
                            </select>
                            <input aria-label="MRP" className="input" inputMode="decimal" placeholder="MRP ₹" value={l.newMrp}
                              onChange={(e) => set(l.key, { newMrp: e.target.value })} />
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right"><input aria-label={`Qty line ${l.key}`} className="input w-20 text-right" inputMode="decimal"
                        value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} /></td>
                      <td className="py-2 pr-3 text-right"><input aria-label={`Rate line ${l.key}`} className="input w-24 text-right" inputMode="decimal"
                        value={l.rate} onChange={(e) => set(l.key, { rate: e.target.value })} /></td>
                      <td className="py-2 text-right tabular-nums">{inr((n(l.qty) || 0) * (n(l.rate) || 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-ink/80">
              Lines total <b className="tabular-nums">{inr(total)}</b>
              {scan.totals.grand_total != null && <> · bill says <b className="tabular-nums">{inr(scan.totals.grand_total)}</b></>}
              {problem && <div className="text-xs text-red-600">{problem}</div>}
            </div>
            <button className="btn btn-primary" disabled={busy || !!problem} onClick={save}>{busy ? "Saving…" : "Save bill"}</button>
          </div>
        </div>
      )}
      {err != null && <div className="mt-3"><ErrorBox error={err} /></div>}
    </Card>
  );
}

/** Every bill saved through scanning: newest first, click a row to see its lines. */
export function SavedBills({ refreshKey }: { refreshKey: number }) {
  const [kind, setKind] = useState<"" | "purchase" | "sale">("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useAsync(() => api.get("/bills/saved", { bill_type: kind || undefined }), [kind, refreshKey]);
  const bills: any[] = q.data?.bills ?? [];
  const tabs: [typeof kind, string][] = [["", "All"], ["purchase", "Purchases"], ["sale", "Sales"]];

  return (
    <Card title={<span className="flex items-center gap-2">Saved bills
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{q.data?.count ?? 0}</span></span>}
      right={
        <div className="flex rounded-lg bg-slate-200/70 p-1">
          {tabs.map(([k, label]) => (
            <button key={label} onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${kind === k ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"}`}>{label}</button>
          ))}
        </div>}>
      {q.loading ? <Spinner /> : q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : bills.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
          No bills saved yet. Scan a bill above and press <b>Save bill</b> - it will appear here.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
              Purchases {inr(q.data.totals.purchase)}</span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-800 ring-1 ring-inset ring-blue-200">
              Sales {inr(q.data.totals.sale)}</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-muted">
                <tr><th className="px-3 py-2 font-semibold">Bill</th><th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">From / to</th><th className="px-3 py-2 font-semibold">Bill date</th>
                  <th className="px-3 py-2 text-right font-semibold">Lines</th><th className="px-3 py-2 text-right font-semibold">Total</th></tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <Fragment key={b.reference + b.scan_id}>
                    <tr onClick={() => setOpen(open === b.scan_id ? null : b.scan_id)}
                      className="cursor-pointer border-t border-line/60 hover:bg-blue-50/40">
                      <td className="px-3 py-2"><div className="font-medium text-ink">{open === b.scan_id ? "▾" : "▸"} {b.reference}</div>
                        <div className="text-[11px] text-muted">saved {new Date(b.saved_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div></td>
                      <td className="px-3 py-2"><Badge tone={b.bill_type === "purchase" ? "green" : "blue"}>
                        {b.bill_type === "purchase" ? "Purchase · stock in" : "Sale · stock out"}</Badge></td>
                      <td className="px-3 py-2 text-ink">{b.vendor ?? "–"}<div className="text-[11px] text-muted">{b.payment_method}</div></td>
                      <td className="px-3 py-2 tabular-nums">{b.bill_date ?? "–"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.lines.length}{b.new_products ? <span className="ml-1 text-[11px] text-violet-700">+{b.new_products} new</span> : null}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{inr(b.total)}</td>
                    </tr>
                    {open === b.scan_id && (
                      <tr className="bg-slate-50/70"><td colSpan={6} className="px-3 py-2">
                        <table className="w-full text-[12px]">
                          <tbody>
                            {b.lines.map((l: any, i: number) => (
                              <tr key={i} className="border-t border-line/50 first:border-0">
                                <td className="py-1 pr-3 text-ink">{l.name}{l.new_product && <span className="ml-1.5 text-[11px] text-violet-700">new product</span>}</td>
                                <td className="py-1 pr-3 text-right tabular-nums text-muted">{l.quantity} × {inr(l.unit_price)}</td>
                                <td className="py-1 text-right font-mono tabular-nums">{inr(l.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-1 text-[11px] text-muted">
                          {b.bill_type === "purchase" ? "Added to stock" : "Added to sales and taken out of stock"} ·
                          {b.printed_total != null ? ` bill printed ${inr(b.printed_total)} ·` : ""} file: {b.files.join(", ") || "–"}
                          {b.engine === "fake" ? " · test fixture" : ""}</p>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">Kept for this session (the app runs in memory). Sales bills also appear in Business and in chat answers.</p>
        </>
      )}
    </Card>
  );
}
