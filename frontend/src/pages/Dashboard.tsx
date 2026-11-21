import { useState } from "react";
import { Link } from "react-router-dom";
import ChartView from "../components/ChartView";
import Icon from "../components/Icon";
import TableView from "../components/TableView";
import { Badge, Card, ErrorBox, Spinner, Stat, useAsync } from "../components/ui";
import { api, Insight } from "../lib/api";
import { useActionRunner } from "../lib/actions";
import { inr, num, pct } from "../lib/format";

type Alerts = {
  as_of: string;
  stock: { critical: any[]; soon: any[] };
  supplier_priority: Insight;
  dead_stock: Insight;
  margin_flags: any[];
  expenses: Insight;
  festival_adjustments: { items: any[]; avoided_overorder_rs: number };
  insufficient_data: any[];
};

function Delta({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span>vs previous 30 days: –</span>;
  return <span>{pct(v, true)} vs previous 30 days</span>;
}

export default function Dashboard() {
  const run = useActionRunner();
  const q = useAsync(() => Promise.all([
    api.get<Insight>("/kpis", { period_days: 30 }),
    api.get<Alerts>("/alerts"),
    api.get<Insight>("/trends", { grain: "week", period_days: 120 }),
    api.get<Insight>("/payments", { period_days: 90 }),
    api.get<Insight>("/margin", { group_by: "category", period_days: 30 }),
  ]), []);

  if (q.loading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const [k, alerts, trend, pay, margin] = q.data!;
  const h = k.headline;
  const pri = alerts.supplier_priority.rows[0];
  const atRisk = [...alerts.stock.critical, ...alerts.stock.soon];
  const spikes = alerts.expenses.rows.filter((r) => r.spike);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Dashboard</h1>
          <p className="text-sm text-muted">Last 30 days · data as of {alerts.as_of}</p>
        </div>
        <Link to="/" className="btn btn-dark">Ask Muneem</Link>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat color="green" icon={<span className="text-xl font-semibold">₹</span>} label="Sales" value={inr(h.revenue_rs)} sub={<Delta v={h.revenue_change_pct} />}
          tone={h.revenue_change_pct >= 0 ? "up" : "down"} />
        <Stat color="orange" icon={<Icon name="chart" size={20} />} label="Margin after GST" value={inr(h.gross_margin_rs)} sub={`${pct(h.gross_margin_pct)} of taxable sales`} />
        <Stat color="red" icon={<Icon name="spark" size={20} />} label="Net estimate" value={inr(h.net_profit_estimate_rs)} sub="margin − overheads" />
        <Stat color="blue" icon={<Icon name="box" size={20} />} label="GST collected" value={inr(h.gst_collected_rs)} sub={`${num(h.bills)} bills · avg ${inr(h.avg_bill_rs)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="🚨 Running out"
          right={atRisk.length > 0 && <button className="btn btn-primary" onClick={() => run({ type: "restock_draft", label: "", payload: {} })}>Make restock list</button>}>
          {atRisk.length ? (
            <TableView rows={atRisk} columns={[
              { key: "name", label: "Item" }, { key: "tier", label: "Status" },
              { key: "stock", label: "Stock" }, { key: "days_left", label: "Days left" },
              { key: "lead_time_days", label: "Supplier needs (days)" }, { key: "order_qty", label: "Order qty" },
            ]} />
          ) : <p className="text-sm text-muted">Nothing is running out. 🎉</p>}
        </Card>

        <Card title="📞 Call first">
          {pri ? (
            <div className="space-y-2 text-sm">
              <div className="text-lg font-semibold">{pri.supplier}</div>
              <div className="flex gap-2">
                <Badge tone="red">{pri.critical} critical</Badge>
                <Badge tone="amber">{pri.soon} soon</Badge>
              </div>
              <p className="text-ink/80">
                First item runs out in <b>{num(pri.first_stockout_days)} days</b>; delivery takes {pri.lead_time_days}.
                Order ≈ <b>{inr(pri.cash_needed_rs)}</b> incl. GST.
              </p>
              <button className="btn btn-green w-full justify-center"
                onClick={() => run({ type: "restock_draft", label: "", payload: { supplier_id: pri.supplier_id } })}>
                Draft order for {pri.supplier}
              </button>
              <p className="text-[11px] text-muted/80">via {alerts.supplier_priority.engine}</p>
            </div>
          ) : <p className="text-sm text-muted">No supplier needs an urgent call.</p>}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="🪙 Money stuck in dead stock">
          <div className="text-2xl font-semibold">{inr(alerts.dead_stock.headline.money_trapped_rs)}</div>
          <p className="mb-2 text-xs text-muted">{alerts.dead_stock.headline.items} items, no sale in 30 days</p>
          <ul className="space-y-1 text-sm">
            {alerts.dead_stock.rows.slice(0, 4).map((r) => (
              <li key={r.item_id} className="flex justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span className="whitespace-nowrap text-ink/80" title={`Up to ${r.max_discount_pct}% discount still breaks even`}>
                  {inr(r.money_trapped_rs)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="📉 High sales, low profit">
          {alerts.margin_flags.length ? (
            <ul className="space-y-1.5 text-sm">
              {alerts.margin_flags.map((r) => (
                <li key={r.item_id} className="flex justify-between gap-2">
                  <span className="truncate">{r.name}</span>
                  <span className="whitespace-nowrap"><b>{pct(r.margin_pct)}</b> on {inr(r.revenue_rs)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No item flagged.</p>}
          <p className="mt-2 text-[11px] text-muted/80">Margin after backing GST out of MRP</p>
        </Card>
        <Card title="🧾 Watch out">
          <ul className="space-y-2 text-sm">
            {spikes.map((r) => (
              <li key={r.category}>
                <b className="capitalize">{r.category}</b> bill {inr(r.current_rs)} — usually {inr(r.prior_mean_rs)}{" "}
                <Badge tone="red">{pct(r.change_pct, true)}</Badge>
              </li>
            ))}
            {alerts.festival_adjustments.items.length > 0 && (
              <li>
                Festival over for {alerts.festival_adjustments.items.length} items — smaller orders avoid{" "}
                <b>{inr(alerts.festival_adjustments.avoided_overorder_rs)}</b> of over-stocking.
              </li>
            )}
            {alerts.insufficient_data.map((r) => (
              <li key={r.item_id} className="text-ink/80">{r.name}: only {r.history_days} days of history — no forecast yet.</li>
            ))}
            {!spikes.length && !alerts.festival_adjustments.items.length && !alerts.insufficient_data.length &&
              <li className="text-muted">All quiet.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Sales per day, by week (₹)">
          <ChartView spec={{ kind: "line", x: "period", unit: "₹", series: [{ key: "revenue_per_day_rs", label: "₹ per day" }],
            data: trend.rows, annotations: trend.meta.festivals }} />
        </Card>
        <Card title="How customers pay (90 days)">
          <ChartView spec={{ kind: "pie", x: "payment_mode", unit: "₹", series: [{ key: "value_rs", label: "Value" }], data: pay.rows }} />
          {pay.headline.upi_trend && (
            <p className="text-center text-xs text-muted">
              UPI share {pct(pay.headline.upi_trend.first_4_weeks_pct)} → {pct(pay.headline.upi_trend.last_4_weeks_pct)}
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Margin by category (30 days)">
          <ChartView spec={{ kind: "bar", x: "category", unit: "₹", series: [{ key: "margin_rs", label: "Margin ₹" }],
            data: margin.rows }} />
        </Card>
        <BriefCard />
      </div>
    </div>
  );
}

function BriefCard() {
  const [lang, setLang] = useState("hinglish");
  const q = useAsync(() => api.get("/brief", { lang }), [lang]);
  return (
    <Card title="☀️ Morning brief" right={
      <select className="input py-0.5 text-xs" value={lang} onChange={(e) => setLang(e.target.value)}>
        <option value="hinglish">Hinglish</option><option value="en">English</option><option value="hi">हिंदी</option>
      </select>}>
      {q.loading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : (
        <>
          <ol className="list-decimal space-y-1.5 pl-4 text-sm">
            {q.data.lines.map((l: any, i: number) => <li key={i}>{l.text}</li>)}
          </ol>
          <a className="btn btn-green mt-3 w-full justify-center" href={q.data.whatsapp_url} target="_blank" rel="noreferrer">
            Share on WhatsApp
          </a>
          <p className="mt-1 text-center text-[11px] text-muted/80">{q.data.note}</p>
        </>
      )}
    </Card>
  );
}
