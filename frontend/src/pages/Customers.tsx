import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ChartView from "../components/ChartView";
import { bucketOf, RECENCY_BUCKETS, RecencyBars, SEG_COLOR, SegmentDonut } from "../components/SegmentCharts";
import Icon from "../components/Icon";
import { Badge, Card, ErrorBox, PageHeader, Spinner, Stat, useAsync } from "../components/ui";
import { api, Insight } from "../lib/api";
import { useActionRunner } from "../lib/actions";
import { inr, num, paise } from "../lib/format";
import { usePrefs } from "../lib/prefs";

const SEG_TONE: Record<string, string> = {
  Champions: "green", Loyal: "blue", New: "violet", Promising: "blue", "At risk": "red",
  Hibernating: "gray", "Needs attention": "amber",
};
const SEG_GOAL: Record<string, string> = {
  Champions: "reward_champions", Loyal: "reward_champions", New: "welcome_new", "At risk": "win_back",
};

export default function Customers() {
  const navigate = useNavigate();
  const { lang } = usePrefs();
  const run = useActionRunner(lang);
  const [segment, setSegment] = useState("");
  const [bucket, setBucket] = useState("");
  const [q, setQ] = useState("");
  const segs = useAsync(() => api.get<Insight>("/customers/segments"), []);
  const all = useAsync(() => api.get<{ total: number; customers: any[] }>("/customers", { limit: 1000 }), []);

  const inSeg = useMemo(() => (all.data?.customers ?? []).filter((c) => !segment || c.segment === segment),
    [all.data, segment]);
  const list = useMemo(() => inSeg.filter((c) =>
    (!bucket || bucketOf(c.recency_days) === bucket) &&
    (!q || `${c.name} ${c.phone} ${c.customer_id}`.toLowerCase().includes(q.toLowerCase()))), [inSeg, bucket, q]);

  if (segs.loading || all.loading) return <div className="p-8"><Spinner /></div>;
  if (segs.error || all.error) return <div className="p-8"><ErrorBox error={segs.error ?? all.error} /></div>;
  const h = segs.data!.headline;
  const segRow = segs.data!.rows.find((r) => r.segment === segment);
  const bucketLabel = RECENCY_BUCKETS.find((b) => b.key === bucket)?.label;
  const cs = all.data?.customers ?? [];
  const top = segs.data!.rows.filter((r) => r.segment === "Champions" || r.segment === "Loyal");
  const kpi = {
    topShare: top.reduce((a, r) => a + (r.revenue_share_pct ?? 0), 0),
    topCount: top.reduce((a, r) => a + (r.customers ?? 0), 0),
    atRisk: cs.filter((c) => c.at_risk).length,
    atRiskSpend: cs.filter((c) => c.at_risk).reduce((a, c) => a + (c.monthly_value_rs || 0), 0),
    udhaar: cs.reduce((a, c) => a + (c.udhaar_outstanding_paise || 0), 0),
    overdue: cs.filter((c) => c.udhaar_overdue).length,
  };
  const maxSpend = Math.max(1, ...list.map((c) => c.monthly_value_rs || 0));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <PageHeader title="Customers"
        sub={`${h.customers} customers on ${h.bills_linked_pct}% of bills (the rest are anonymous counter sales).`} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat color="blue" icon={<Icon name="users" size={20} />} label="Known customers" value={num(h.customers)}
          sub={`on ${num(h.bills_linked_pct)}% of bills`} />
        <Stat color="green" icon={<span className="text-xl font-semibold">₹</span>} label="Champions + Loyal" value={`${num(kpi.topShare)}%`}
          sub={`of sales from ${num(kpi.topCount)} customers`} />
        <Stat color="red" icon={<Icon name="arrowRight" size={20} />} label="Stopped coming?" value={num(kpi.atRisk)}
          sub={`${inr(kpi.atRiskSpend)}/month at risk`} />
        <Stat color="orange" icon={<Icon name="whatsapp" size={20} />} label="Udhaar outstanding" value={paise(kpi.udhaar)}
          sub={`${num(kpi.overdue)} customers overdue`} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card title="Who brings the sales" right={<span className="text-xs text-muted">share of last 90 days · click to filter</span>}>
          <SegmentDonut rows={segs.data!.rows as any} total={all.data?.total ?? 0} active={segment}
            onPick={(s) => { setSegment(s); setBucket(""); }} />
        </Card>
        <Card title={`When did ${segment ? segment.toLowerCase() + " customers" : "customers"} last come?`}
          right={<span className="text-xs text-muted">click a bar to filter</span>}>
          <RecencyBars customers={inSeg} color={SEG_COLOR[segment] ?? "rgb(var(--accent))"} active={bucket} onPick={setBucket} />
          <p className="text-xs text-muted">Faded bars = not seen for over 2 weeks: message these first.</p>
        </Card>
      </div>

      {segment && segRow && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-card"
          style={{ borderLeft: `4px solid ${SEG_COLOR[segment]}` }}>
          <span className="text-ink">
            <b>{segment}</b>: {segRow.description}.{" "}
            <span className="text-muted">Suggested: {segRow.suggested_action}.</span>
          </span>
          {SEG_GOAL[segment] && (
            <button className="btn btn-dark" onClick={() => run({ type: "campaign_draft", label: "", payload: {
              goal: SEG_GOAL[segment], segment: segment === "At risk" ? null : { type: "segment", name: segment } } })}>
              Draft messages to {segment}
            </button>
          )}
        </div>
      )}

      <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold text-ink">All customers</h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{list.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {segment && <button className="rounded-full bg-slate-900 px-2.5 py-1 font-medium text-white" onClick={() => setSegment("")}>{segment} ✕</button>}
            {bucket && <button className="rounded-full bg-slate-900 px-2.5 py-1 font-medium text-white" onClick={() => setBucket("")}>Last came: {bucketLabel} ✕</button>}
            <input className="input w-56 !py-1.5" placeholder="Search name, phone, id…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-muted shadow-[0_1px_0_rgb(var(--line))]">
              <tr>
                <th className="px-4 py-2 font-semibold">Customer</th><th className="px-3 py-2 font-semibold">Segment</th>
                <th className="px-3 py-2 text-right font-semibold">Last bill</th>
                <th className="px-3 py-2 text-right font-semibold">Usually every</th>
                <th className="px-3 py-2 font-semibold">Spend / month</th>
                <th className="px-4 py-2 text-right font-semibold">Udhaar</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 300).map((c) => {
                const late = c.usual_gap_days != null && c.recency_days > 2 * c.usual_gap_days;
                const initials = (c.name || c.customer_id).split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
                return (
                  <tr key={c.customer_id} onClick={() => navigate(`/customers/${c.customer_id}`)}
                    className="cursor-pointer border-t border-line/60 hover:bg-blue-50/40">
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                          style={{ background: SEG_COLOR[c.segment] ?? "#94a3b8" }}>{initials}</span>
                        <div className="min-w-0"><div className="truncate font-medium text-ink">{c.name || c.customer_id}</div>
                          <div className="truncate text-[11px] text-muted">{c.customer_id} · {c.area}</div></div>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: `${SEG_COLOR[c.segment] ?? "#94a3b8"}1f`, color: SEG_COLOR[c.segment] ?? "#475569" }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: SEG_COLOR[c.segment] }} />{c.segment}
                      </span>
                      {c.at_risk && <span className="ml-1.5 text-[11px] font-medium text-red-600">stopped?</span>}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${late ? "font-semibold text-red-600" : "text-ink"}`}>{c.recency_days} d ago</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{c.usual_gap_days != null ? `${num(c.usual_gap_days)} d` : "–"}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round(100 * (c.monthly_value_rs || 0) / maxSpend)}%` }} />
                        </div>
                        <span className="font-mono tabular-nums text-ink">{inr(c.monthly_value_rs)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {c.udhaar_outstanding_paise > 0
                        ? <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${c.udhaar_overdue ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{paise(c.udhaar_outstanding_paise)}</span>
                        : <span className="text-muted">–</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.length > 300 && <p className="border-t border-line px-4 py-2 text-xs text-muted">Showing 300 of {list.length} - search or filter to narrow down.</p>}
      </section>
    </div>
  );
}

export function CustomerDetail() {
  const { cid } = useParams();
  const { lang } = usePrefs();
  const run = useActionRunner(lang);
  const q = useAsync(() => api.get<Insight>(`/customers/${cid}`), [cid]);
  if (q.loading) return <div className="p-8"><Spinner /></div>;
  if (q.error) return <div className="p-8"><ErrorBox error={q.error} /></div>;
  const h = q.data!.headline;
  const u = h.udhaar;
  const goal = u?.overdue ? "udhaar_reminder" : h.at_risk ? "win_back" : h.segment === "New" ? "welcome_new" : "reward_champions";
  const label = { udhaar_reminder: "Draft udhaar reminder", win_back: "Draft win-back message",
    welcome_new: "Draft welcome message", reward_champions: "Draft thank-you message" }[goal];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      <Link to="/customers" className="text-sm text-muted hover:text-ink">← Customers</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{h.name || h.customer_id}</h1>
          <p className="text-sm text-muted">{h.phone} · {h.area} {h.khata && "· khata customer"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={SEG_TONE[h.segment]}>{h.segment}</Badge>
          <button className="btn btn-dark" onClick={() => run({ type: "campaign_draft", label: "", payload: {
            goal, segment: { type: "customer_ids", ids: [h.customer_id] }, holdout_pct: 0 } })}>{label}</button>
        </div>
      </div>

      {h.at_risk && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Usually comes every {num(h.usual_gap_days)} days - last bill was {h.recency_days} days ago. Spends about {inr(h.monthly_value_rs)} a month.
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        {[["Bills", num(h.bills)], ["Total spend", inr(h.revenue_rs)], ["Average bill", inr(h.avg_bill_rs)],
          ["Last bill", `${h.recency_days} days ago`], ["Usually every", h.usual_gap_days != null ? `${num(h.usual_gap_days)} days` : "–"],
          ["Spend / month", inr(h.monthly_value_rs)], ["Udhaar owed", u ? inr(u.outstanding_rs) : "–"],
          ["Oldest unpaid", u?.outstanding_rs > 0 ? `${u.days_overdue} days` : "–"]].map(([k, v]) => (
          <div key={k} className="bg-surface p-3"><div className="text-[11px] text-muted">{k}</div>
            <div className="font-semibold tabular-nums text-ink">{v}</div></div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Card title="Monthly spend">
          <ChartView height={200} spec={{ kind: "bar", x: "month", unit: "₹", series: [{ key: "revenue_rs", label: "₹" }], data: q.data!.rows }} />
        </Card>
        <Card title="What they buy">
          <ul className="divide-y divide-line/60 text-sm">
            {(h.top_items ?? []).map((t: any) => (
              <li key={t.name} className="flex justify-between py-1.5"><span>{t.name}</span>
                <span className="tabular-nums text-muted">{num(t.bills)} bills · {inr(t.revenue_rs)}</span></li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted/80">{q.data!.formula}</p>
    </div>
  );
}
