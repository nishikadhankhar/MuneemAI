import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, ErrorBox, PageHeader, Spinner, Stat, TierBadge, useAsync } from "../components/ui";
import Icon from "../components/Icon";
import { api } from "../lib/api";
import { inr, num } from "../lib/format";

type Item = {
  item_id: string; name: string; category: string; supplier: string; stock: number; pack_size: number;
  tier: string; days_left: number | null; daily_sales: number | null; reorder_point: number | null; order_qty: number;
  cost_rs: number; mrp_rs: number; value_cost_rs: number; last_sale: string | null;
};
type Txn = {
  id: string; kind: "sale" | "purchase"; date: string; counterparty: string; payment: string; total_rs: number;
  units: number; lines_n: number; source: string; lines: { name: string; qty: number; rate_rs: number; amount_rs: number }[];
};

const TIER_ORDER: Record<string, number> = { CRITICAL: 0, SOON: 1, UNKNOWN: 2, OK: 3 };
type SortKey = "name" | "stock" | "days_left" | "value" | "status";

export default function Inventory() {
  const [tab, setTab] = useState<"stock" | "txn">("stock");
  const inv = useAsync(() => api.get("/inventory"), []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <PageHeader title="Inventory" sub="Everything on the shelf, how long it lasts, and every bill that moved it." />
      {inv.loading ? <Spinner /> : inv.error ? <ErrorBox error={inv.error} onRetry={inv.reload} /> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat color="blue" icon={<Icon name="box" size={20} />} label="Products" value={num(inv.data.totals.skus)}
              sub={`${num(inv.data.categories.length)} categories`} />
            <Stat color="green" icon={<span className="text-xl font-semibold">#</span>} label="Units on hand" value={num(inv.data.totals.units)}
              sub={`${inv.data.totals.out_of_stock} out of stock`} />
            <Stat color="orange" icon={<span className="text-xl font-semibold">₹</span>} label="Stock value (cost)" value={inr(inv.data.totals.value_cost_rs)}
              sub={`${inr(inv.data.totals.value_mrp_rs)} at selling price`} />
            <Stat color="red" icon={<Icon name="spark" size={20} />} label="Need attention"
              value={num(inv.data.totals.tiers.CRITICAL + inv.data.totals.tiers.SOON)}
              sub={`${inv.data.totals.tiers.CRITICAL} critical · ${inv.data.totals.tiers.SOON} soon`} />
          </div>

          <div className="mb-4 flex rounded-lg bg-slate-200/70 p-1 sm:w-fit">
            {([["stock", "All items & quantity"], ["txn", "Recent transactions"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition sm:flex-none ${tab === k ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === "stock" ? <StockTable items={inv.data.items} categories={inv.data.categories} /> : <Transactions />}
        </>
      )}
    </div>
  );
}

function StockTable({ items, categories }: { items: Item[]; categories: string[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortKey>("status");
  const [desc, setDesc] = useState(false);
  const navigate = useNavigate();

  const rows = useMemo(() => {
    const f = items.filter((i) => (!cat || i.category === cat) && (!status || i.tier === status) &&
      (!q || `${i.name} ${i.item_id} ${i.supplier}`.toLowerCase().includes(q.toLowerCase())));
    const key = (i: Item): number | string => sort === "name" ? i.name : sort === "stock" ? i.stock :
      sort === "days_left" ? (i.days_left ?? 9999) : sort === "value" ? i.value_cost_rs : TIER_ORDER[i.tier] * 10000 + (i.days_left ?? 9999);
    return [...f].sort((a, b) => {
      const x = key(a), y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
  }, [items, q, cat, status, sort, desc]);

  const head = (k: SortKey, label: string, right = false) => (
    <th className={`px-3 py-2 font-semibold ${right ? "text-right" : ""}`}>
      <button onClick={() => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(k === "stock" || k === "value"); } }}
        className="uppercase tracking-wide hover:text-ink">{label}{sort === k ? (desc ? " ↓" : " ↑") : ""}</button>
    </th>
  );
  const maxStock = Math.max(1, ...items.map((i) => i.stock));

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="mr-1 font-display text-base font-semibold text-ink">All items</h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{rows.length}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="input !py-1.5 text-xs" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="input !py-1.5 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option><option value="CRITICAL">Critical</option><option value="SOON">Soon</option>
            <option value="OK">OK</option><option value="UNKNOWN">Not enough data</option>
          </select>
          <input className="input w-52 !py-1.5 text-xs" placeholder="Search item, id, supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="max-h-[600px] overflow-auto">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] text-muted shadow-[0_1px_0_rgb(var(--line))]">
            <tr>
              {head("name", "Item")}
              <th className="px-3 py-2 font-semibold uppercase tracking-wide">Supplier</th>
              {head("stock", "In stock", true)}
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide">Sells / day</th>
              {head("days_left", "Days left", true)}
              {head("status", "Status")}
              {head("value", "Value (cost)", true)}
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide">Last sold</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.item_id} className="border-t border-line/60 hover:bg-blue-50/40">
                <td className="px-3 py-1.5"><div className="font-medium text-ink">{i.name}</div>
                  <div className="text-[11px] text-muted">{i.item_id} · {i.category} · MRP {inr(i.mrp_rs)}</div></td>
                <td className="px-3 py-1.5 text-slate-600">{i.supplier}</td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${i.tier === "CRITICAL" ? "bg-rose-500" : i.tier === "SOON" ? "bg-amber-400" : "bg-emerald-500"}`}
                        style={{ width: `${Math.max(3, Math.round(100 * i.stock / maxStock))}%` }} />
                    </div>
                    <span className="w-12 text-right font-mono text-sm font-semibold tabular-nums text-ink">{num(i.stock)}</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{i.daily_sales != null ? num(i.daily_sales) : "–"}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${i.tier === "CRITICAL" ? "font-semibold text-red-600" : "text-ink"}`}>
                  {i.days_left != null ? num(i.days_left) : "–"}</td>
                <td className="px-3 py-1.5"><TierBadge tier={i.tier} />
                  {i.tier === "CRITICAL" || i.tier === "SOON" ? <span className="ml-1.5 text-[11px] text-muted">order {i.order_qty}</span> : null}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{inr(i.value_cost_rs)}</td>
                <td className="px-3 py-1.5 text-right text-xs text-muted">{i.last_sale ?? "never"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sm text-muted">No items match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted">
        <span>Quantities come from the stock ledger: opening stock + purchases and received orders − bills.</span>
        <button className="btn !py-1 !text-xs" onClick={() => navigate("/orders")}>Make restock list →</button>
      </div>
    </section>
  );
}

function Transactions() {
  const [kind, setKind] = useState<"all" | "sale" | "purchase">("all");
  const [open, setOpen] = useState<string | null>(null);
  const q = useAsync(() => api.get<{ transactions: Txn[]; totals: { sale_rs: number; purchase_rs: number } }>("/transactions", { kind, limit: 80 }), [kind]);
  const rows = q.data?.transactions ?? [];

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="mr-1 font-display text-base font-semibold text-ink">Recent transactions</h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{rows.length}</span>
        <div className="ml-auto flex rounded-lg bg-slate-200/70 p-1">
          {([["all", "All"], ["sale", "Sales out"], ["purchase", "Purchases in"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${kind === k ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"}`}>{label}</button>
          ))}
        </div>
      </div>
      {q.loading ? <div className="p-6"><Spinner /></div> : q.error ? <div className="p-4"><ErrorBox error={q.error} onRetry={q.reload} /></div> : (
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-muted shadow-[0_1px_0_rgb(var(--line))]">
              <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Bill</th><th className="px-3 py-2 font-semibold">Party</th>
                <th className="px-3 py-2 text-right font-semibold">Items</th><th className="px-3 py-2 text-right font-semibold">Units</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const k = `${t.kind}-${t.id}`;
                return (
                  <Fragment key={k}>
                    <tr onClick={() => setOpen(open === k ? null : k)} className="cursor-pointer border-t border-line/60 hover:bg-blue-50/40">
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600">{t.date}</td>
                      <td className="px-3 py-1.5"><span className="whitespace-nowrap"><Badge tone={t.kind === "sale" ? "blue" : "green"}>{t.kind === "sale" ? "Sale" : "Purchase"}</Badge></span></td>
                      <td className="px-3 py-1.5"><span className="font-medium text-ink">{open === k ? "▾" : "▸"} {t.id}</span>
                        <div className="text-[11px] text-muted">{t.source}</div></td>
                      <td className="px-3 py-1.5 text-ink">{t.counterparty}<div className="text-[11px] text-muted">{t.payment}</div></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{t.lines_n}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(t.units)}</td>
                      <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold tabular-nums ${t.kind === "sale" ? "text-ink" : "text-emerald-700"}`}>
                        {t.kind === "purchase" ? "−" : "+"}{inr(t.total_rs)}</td>
                    </tr>
                    {open === k && (
                      <tr className="bg-slate-50/70"><td colSpan={7} className="px-4 py-2">
                        <table className="w-full text-[12px]"><tbody>
                          {t.lines.map((l, i) => (
                            <tr key={i} className="border-t border-line/50 first:border-0">
                              <td className="py-1 pr-3 text-ink">{l.name}</td>
                              <td className="py-1 pr-3 text-right tabular-nums text-muted">{num(l.qty)} × {inr(l.rate_rs)}</td>
                              <td className="py-1 text-right font-mono tabular-nums">{inr(l.amount_rs)}</td>
                            </tr>
                          ))}
                        </tbody></table>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-sm text-muted">No transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">
        Sales = bills to customers (amounts include GST). Purchases = scanned supplier bills and received orders. Scanned bills you save on the Data page show up here too.
      </p>
    </section>
  );
}
