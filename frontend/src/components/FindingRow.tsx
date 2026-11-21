import { useState } from "react";
import { api } from "../lib/api";
import { useActionRunner } from "../lib/actions";
import { paise } from "../lib/format";
import { Lang, pick, usePrefs } from "../lib/prefs";
import Icon from "./Icon";

export type Finding = {
  id: string; kind: string; category: "risk" | "opportunity" | "info"; severity: "high" | "medium" | "low";
  what: string; why: string; what_hi: string; why_hi: string; impact_paise: number | null; impact_label: string;
  confidence: string; action: { type: string; label: string; payload: Record<string, any> };
  evidence: { tool: string; args: Record<string, any> }; status: string; urgent: boolean;
};

const DOT: Record<string, string> = { high: "bg-red-500", medium: "bg-amber-400", low: "bg-slate-300" };
const CAT: Record<string, string> = { risk: "Risk", opportunity: "Opportunity", info: "Good to know" };

/** what happened · why it matters · ₹ impact · one action. compact = briefing row. */
export default function FindingRow({ f, compact = false, onStatus }: {
  f: Finding; compact?: boolean; onStatus?: (id: string, status: string) => void;
}) {
  const { lang } = usePrefs();
  const run = useActionRunner(lang);
  const [busy, setBusy] = useState(false);
  const act = async () => {
    setBusy(true);
    try {
      await run(f.action);
      api.post(`/findings/${encodeURIComponent(f.id)}/status`, { status: "acted" }).catch(() => {});
    } finally { setBusy(false); }
  };
  const setStatus = async (status: string) => {
    await api.post(`/findings/${encodeURIComponent(f.id)}/status`, { status });
    onStatus?.(f.id, status);
  };
  const askWhy = () => run({ type: "ask", label: "", payload: {
    question: lang === "en" ? `Explain: ${f.what}` : `Samjhaiye: ${f.what_hi}` } });

  if (!compact) return <FindingCard f={f} lang={lang} busy={busy} act={act} askWhy={askWhy} setStatus={setStatus} />;

  return (
    <div className="group flex gap-3 py-3">
      <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`} title={`${f.severity} priority`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-ink">{pick(lang, f.what, f.what_hi)}</span>
          {f.urgent && <span className="text-[11px] font-semibold uppercase tracking-wide text-red-600">today</span>}
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-ink/80">{pick(lang, f.why, f.why_hi)}</p>
        {f.action?.label && (
          <div className="mt-2">
            <button className="btn btn-dark" disabled={busy} onClick={act}>
              {busy ? "…" : f.action.label} <Icon name="arrowRight" size={14} />
            </button>
          </div>
        )}
      </div>
      {f.impact_paise != null && (
        <div className="shrink-0 text-right">
          <div className="font-semibold tabular-nums text-ink">{paise(f.impact_paise)}</div>
          <div className="text-[11px] text-muted">{f.impact_label}</div>
        </div>
      )}
    </div>
  );
}

const ACCENT: Record<string, string> = { risk: "border-l-rose-500", opportunity: "border-l-emerald-500", info: "border-l-blue-500" };
const CAT_PILL: Record<string, string> = {
  risk: "bg-rose-50 text-rose-700 ring-rose-200", opportunity: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
};
const SEV: Record<string, string> = { high: "High priority", medium: "Medium", low: "Low" };

/** Insights page card: accent by category, ₹ impact on the right, actions in a footer row. */
function FindingCard({ f, lang, busy, act, askWhy, setStatus }: {
  f: Finding; lang: Lang; busy: boolean; act: () => void; askWhy: () => void; setStatus: (s: string) => void;
}) {
  return (
    <div className={`flex h-full flex-col rounded-xl border border-l-4 border-line bg-surface shadow-card ${ACCENT[f.category] ?? ""}`}>
      <div className="flex gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CAT_PILL[f.category] ?? CAT_PILL.info}`}>{CAT[f.category]}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[f.severity]}`} />{SEV[f.severity]}
            </span>
            {f.urgent && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Today</span>}
          </div>
          <h3 className="text-[15px] font-semibold leading-snug text-ink">{pick(lang, f.what, f.what_hi)}</h3>
          <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-slate-600">{pick(lang, f.why, f.why_hi)}</p>
        </div>
        {f.impact_paise != null && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-lg font-semibold tabular-nums text-ink">{paise(f.impact_paise)}</div>
            <div className="max-w-[96px] text-[11px] leading-tight text-muted">{f.impact_label}</div>
          </div>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-line bg-slate-50/70 px-4 py-2.5">
        {f.action?.label && (
          <button className="btn btn-primary !px-3 !py-1.5 !text-xs" disabled={busy} onClick={act}>
            {busy ? "…" : f.action.label} <Icon name="arrowRight" size={13} />
          </button>
        )}
        <button className="btn !px-2.5 !py-1.5 !text-xs" onClick={askWhy}>Ask Muneem</button>
        <span className="ml-auto flex gap-1">
          <button className="rounded-md p-1.5 text-muted hover:bg-white hover:text-emerald-700" title="Mark done" aria-label="Mark done"
            onClick={() => setStatus("acted")}><Icon name="check" size={15} /></button>
          <button className="rounded-md p-1.5 text-muted hover:bg-white hover:text-rose-600" title="Dismiss" aria-label="Dismiss"
            onClick={() => setStatus("dismissed")}><Icon name="x" size={15} /></button>
        </span>
      </div>
    </div>
  );
}
