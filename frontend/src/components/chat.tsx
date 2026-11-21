import { FormEvent, KeyboardEvent, useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, Envelope, Source, streamChat } from "../lib/api";
import { RUNNABLE, useActionRunner } from "../lib/actions";
import EvidencePanel from "./EvidencePanel";
import Icon from "./Icon";
import { Badge } from "./ui";
import VisualView from "./VisualView";

export type Msg = { role: "user" | "assistant"; text: string; steps?: string[]; env?: Envelope;
  streaming?: boolean; error?: string };

const TOOL_LABEL: Record<string, string> = {
  get_kpis: "business summary", stock_status: "checking stock", reorder_plan: "working out the order",
  dead_stock: "finding dead stock", slow_movers: "finding slow items", margin_report: "margins after GST",
  payment_mix: "payments", sales_trend: "sales trend", top_items: "ranking items", expense_report: "expenses",
  supplier_priority: "ranking suppliers (graph)", supplier_risk: "supplier delay (graph)",
  supplier_dependency: "supplier dependence (graph)", bought_together: "bought together (graph)",
  substitutes: "substitutes (graph)", supply_path: "supply path (graph)", supply_flow: "supply flow (graph)",
  money_flow: "money flow", restock_draft: "drafting purchase orders", morning_brief: "morning brief",
  find_item: "looking up names", query_metric: "calculating", customer_segments: "customer segments",
  at_risk_customers: "customers at risk", udhaar_report: "udhaar ledger", cohort_retention: "cohorts",
  lifecycle_funnel: "customer funnel", customer_profile: "customer profile", top_insights: "what matters today",
  explain_change: "explaining the change", make_chart: "drawing chart", draft_campaign: "drafting messages",
  campaign_results: "measuring campaign",
};

/** One chat conversation: send (streamed), load an old one, reset. */
export function useChatSession(onConversation?: (id: string) => void) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const conv = useRef<string | null>(null);
  // Stream events patch the last (assistant) message; ignore them if the thread was cleared meanwhile.
  const update = (fn: (m: Msg) => Msg) =>
    setMsgs((all) => (all.length && all[all.length - 1].role === "assistant" ? [...all.slice(0, -1), fn(all[all.length - 1])] : all));

  const reset = useCallback(() => { setMsgs([]); conv.current = null; }, []);

  const load = useCallback(async (id: string) => {
    const t = await api.get<{ turns: { question: string; envelope: Envelope }[] }>(`/chat/${id}`);
    conv.current = id;
    setMsgs(t.turns.flatMap((x) => [
      { role: "user" as const, text: x.question },
      { role: "assistant" as const, text: x.envelope.answer_md, env: x.envelope },
    ]));
  }, []);

  const send = useCallback(async (text: string, mode: "auto" | "rules" = "auto") => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "", steps: [], streaming: true }]);
    const isNew = conv.current === null;
    try {
      await streamChat({ message: q, conversation_id: conv.current, mode }, (ev, data) => {
        if (ev === "meta") conv.current = data.conversation_id;
        else if (ev === "tool_call") update((m) => ({ ...m, steps: [...(m.steps ?? []), TOOL_LABEL[data.tool] ?? data.tool] }));
        else if (ev === "token") update((m) => ({ ...m, text: m.text + data.text }));
        else if (ev === "final") update((m) => ({ ...m, text: data.answer_md, env: data, streaming: false }));
      });
      if (isNew && conv.current) onConversation?.(conv.current);
    } catch (e) {
      update((m) => ({ ...m, streaming: false, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [busy, onConversation]);

  return { msgs, busy, send, reset, load, conversationId: conv.current };
}

export function Thread({ msgs, onAsk }: { msgs: Msg[]; onAsk: (q: string) => void }) {
  return (
    <div className="space-y-6">
      {msgs.map((m, i) => m.role === "user"
        ? <div key={i} className="flex justify-end"><div className="max-w-[80%] rounded-2xl bg-surface-2 px-4 py-2.5 text-[15px] text-ink">{m.text}</div></div>
        : <AssistantMsg key={i} m={m} onAsk={onAsk} />)}
    </div>
  );
}

function AssistantMsg({ m, onAsk }: { m: Msg; onAsk: (q: string) => void }) {
  const env = m.env;
  const run = useActionRunner(env?.language ?? "hinglish");
  const [running, setRunning] = useState<string | null>(null);
  const actions = env?.actions.filter((a) => RUNNABLE.has(a.type)) ?? [];
  return (
    <div className="max-w-full">
      {m.steps && m.steps.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {m.steps.map((s, i) => <span key={i} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{s}</span>)}
        </div>
      )}
      {m.error ? (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Something went wrong: {m.error}</div>
      ) : (
        <div className="prose-chat text-[15px] leading-relaxed text-ink">
          {m.text ? <ReactMarkdown>{m.text}</ReactMarkdown> : m.streaming && <span className="text-muted/80">Working…</span>}
        </div>
      )}
      {env && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {env.grounding.checked > 0 && (env.grounding.ungrounded.length === 0
              ? ((env.grounding.verified ?? env.grounding.checked - (env.grounding.from_web ?? 0)) > 0 &&
                <Badge tone="green" title="Every shop number in the answer was found in the computed data">✓ {(env.grounding.verified ?? env.grounding.checked - (env.grounding.from_web ?? 0))} numbers verified</Badge>)
              : <Badge tone="amber" title={env.grounding.ungrounded.join(", ")}>⚠ {env.grounding.ungrounded.length} unverified number(s)</Badge>)}
            {(env.grounding.from_web ?? 0) > 0 && <Badge tone="amber" title="These figures come from the cited web sources, not your shop's data">{env.grounding.from_web} from the web</Badge>}
            {env.confidence === "insufficient_data" && <Badge tone="amber">not enough history</Badge>}
            <span className="text-[11px] text-muted/80">{env.mode === "llm" ? env.model : "built-in rules"} · {(env.latency_ms / 1000).toFixed(1)}s</span>
          </div>
          {env.warnings.map((w, i) => <p key={i} className="mt-1 text-xs text-amber-700">{w}</p>)}
          {env.visuals.length > 0 && (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {env.visuals.map((v, i) => (
                <div key={i} className={v.type !== "chart" || ["waterfall", "scatter", "cohort_heatmap", "line"].includes(v.spec?.kind) ? "lg:col-span-2" : ""}>
                  <VisualView v={v} />
                </div>
              ))}
            </div>
          )}
          {actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((a, i) => (
                <button key={i} disabled={running !== null}
                  className={`btn ${i === 0 ? "btn-dark" : ""} ${a.type === "open_whatsapp" ? "btn-green" : ""}`}
                  onClick={async () => { setRunning(a.label); try { await run(a); } finally { setRunning(null); } }}>
                  {running === a.label ? "…" : a.label}
                </button>
              ))}
            </div>
          )}
          {env.sources && env.sources.length > 0 && <WebSources sources={env.sources} />}
          <EvidencePanel evidence={env.evidence} />
          {env.suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {env.suggestions.map((s) => (
                <button key={s} className="rounded-full border border-line px-3 py-1 text-xs text-ink/80 hover:bg-surface-2" onClick={() => onAsk(s)}>{s}</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function shortDate(d: string | null) {
  if (!d) return "date unknown";
  const t = new Date(d);
  return isNaN(t.getTime()) ? d.slice(0, 16) : t.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function WebSources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? sources : sources.slice(0, 3);
  const providers = Array.from(new Set(sources.map((s) => s.provider).filter(Boolean))).join(" + ");
  const retrieved = sources.find((s) => s.retrieved_at)?.retrieved_at;
  return (
    <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-800">From the web</span>
        <span className="text-[11px] text-muted">
          Outside information, not your shop's data · not verified by Muneem
          {retrieved && <> · retrieved {new Date(retrieved).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</>}
          {providers && <> via {providers}</>}
        </span>
      </div>
      <ol className="space-y-2">
        {shown.map((s, i) => (
          <li key={s.url} className="flex gap-2 text-sm">
            <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-surface text-center text-[11px] leading-5 text-muted ring-1 ring-line">{i + 1}</span>
            <div className="min-w-0">
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-ink hover:underline">{s.title}</a>
              <div className="text-[11px] text-muted">{s.domain} · published {shortDate(s.published_date)}</div>
              {s.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-ink/80">{s.snippet}</p>}
            </div>
          </li>
        ))}
      </ol>
      {sources.length > 3 && (
        <button className="mt-2 text-xs text-sky-700 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Show fewer" : `Show all ${sources.length} sources`}
        </button>
      )}
    </div>
  );
}

export function Composer({ onSend, busy, mode, setMode, placeholder }: {
  onSend: (t: string) => void; busy: boolean; mode: "auto" | "rules"; setMode: (m: "auto" | "rules") => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const submit = (e?: FormEvent) => { e?.preventDefault(); if (text.trim() && !busy) { onSend(text); setText(""); } };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };
  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-surface px-4 pb-3 pt-3 shadow-sm focus-within:border-line">
      <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={2} maxLength={500}
        placeholder={placeholder ?? "Message Muneem…"} disabled={busy}
        className="w-full resize-none bg-transparent text-[15px] text-ink placeholder:text-muted/80 focus:outline-none" />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <select value={mode} onChange={(e) => setMode(e.target.value as any)}
            className="rounded-md border-0 bg-transparent py-0.5 text-xs text-muted focus:ring-0">
            <option value="auto">AI (Gemini)</option>
            <option value="rules">Built-in rules (offline)</option>
          </select>
          <span className="hidden sm:inline">· answers come from your records</span>
        </label>
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white disabled:bg-slate-300">
          <Icon name="arrowUp" />
        </button>
      </div>
    </form>
  );
}
