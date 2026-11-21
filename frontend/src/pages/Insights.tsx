import { useState } from "react";
import FindingRow, { Finding } from "../components/FindingRow";
import Icon from "../components/Icon";
import { ErrorBox, PageHeader, Spinner, Stat, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { num, paise } from "../lib/format";

const TABS = [
  { key: "", label: "All" }, { key: "risk", label: "Risks" },
  { key: "opportunity", label: "Opportunities" }, { key: "info", label: "Good to know" },
];
const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export default function Insights() {
  const [tab, setTab] = useState("");
  const [showDone, setShowDone] = useState(false);
  const q = useAsync(() => api.get<Finding[]>("/findings", { status: showDone ? "all" : undefined, limit: 50 }), [showDone]);
  const onStatus = (id: string, status: string) =>
    q.setData((list) => (list ?? []).map((f) => (f.id === id ? { ...f, status } : f))
      .filter((f) => showDone || f.status !== "dismissed"));

  const all = q.data ?? [];
  const open = all.filter((f) => f.status !== "acted" && f.status !== "dismissed");
  const count = (cat: string) => open.filter((f) => !cat || f.category === cat).length;
  const atStake = open.filter((f) => f.category === "risk").reduce((s, f) => s + (f.impact_paise ?? 0), 0);
  const upside = open.filter((f) => f.category === "opportunity").reduce((s, f) => s + (f.impact_paise ?? 0), 0);
  const list = all.filter((f) => !tab || f.category === tab)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <PageHeader title="Insights" sub="What happened, why it matters, and what to do next - found by rules on your data, every rupee computed in code." />
      {q.loading ? <Spinner /> : q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat color="red" icon={<Icon name="spark" size={20} />} label="Money at risk" value={paise(atStake)}
              sub={`${num(count("risk"))} risks to act on`} />
            <Stat color="green" icon={<span className="text-xl font-semibold">₹</span>} label="Upside available" value={paise(upside)}
              sub={`${num(count("opportunity"))} opportunities`} />
            <Stat color="orange" icon={<Icon name="arrowUp" size={20} />} label="Do today" value={num(open.filter((f) => f.urgent).length)}
              sub="urgent findings" />
            <Stat color="blue" icon={<Icon name="check" size={20} />} label="Handled" value={num(all.filter((f) => f.status === "acted").length)}
              sub={`of ${num(all.length)} found`} />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg bg-slate-200/70 p-1">
              {TABS.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === t.key
                    ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"}`}>
                  {t.label}
                  <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${tab === t.key ? "bg-slate-900 text-white" : "bg-white/80 text-slate-600"}`}>
                    {count(t.key)}
                  </span>
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done & dismissed
            </label>
          </div>

          {list.length === 0 && <p className="rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">Nothing here.</p>}
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map((f) => (
              <div key={f.id} className={f.status === "acted" || f.status === "dismissed" ? "opacity-55" : ""}>
                <FindingRow f={f} onStatus={onStatus} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
