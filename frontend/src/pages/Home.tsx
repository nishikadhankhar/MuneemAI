import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Composer, Thread, useChatSession } from "../components/chat";
import FindingRow, { Finding } from "../components/FindingRow";
import Icon from "../components/Icon";
import { ErrorBox, Spinner, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { inr, num, paise, pct } from "../lib/format";
import { usePrefs } from "../lib/prefs";

type HomeData = {
  shop_name: string; as_of: string; briefing: Finding[]; findings_total: number;
  health: any[]; suggestions: string[];
};

const GREETING = { en: "What should we look at today?", hinglish: "Aaj kya dekhna hai?", hi: "आज क्या देखना है?" };

export default function Home({ onChatsChanged }: { onChatsChanged: () => void }) {
  const { cid } = useParams();
  const loc = useLocation() as { state?: { ask?: string; fresh?: number } };
  const navigate = useNavigate();
  const { lang } = usePrefs();
  const [mode, setMode] = useState<"auto" | "rules">("auto");
  const home = useAsync(() => api.get<HomeData>("/home"), []);
  const chat = useChatSession((id) => { navigate(`/c/${id}`, { replace: true }); onChatsChanged(); });
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef<number | null>(null);

  useEffect(() => {
    if (cid && cid !== chat.conversationId) chat.load(cid).catch(() => navigate("/", { replace: true }));
    // A handed-over question resets the thread itself (below); resetting here too would wipe the
    // question it just sent when React re-runs effects (StrictMode) and crash the stream.
    if (!cid && !loc.state?.ask) chat.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, loc.state?.fresh]);

  useEffect(() => {  // a question handed over from an insight / button
    const q = loc.state?.ask;
    if (q && asked.current !== loc.state?.fresh) {
      asked.current = loc.state?.fresh ?? 0;
      chat.reset();
      chat.send(q, mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.state?.ask, loc.state?.fresh]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.msgs]);

  const empty = chat.msgs.length === 0;
  const send = (q: string) => chat.send(q, mode);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-8 md:px-6">
          {empty ? (
            home.loading ? <Spinner /> : home.error ? <ErrorBox error={home.error} onRetry={home.reload} /> : (
              <Welcome d={home.data!} lang={lang} onAsk={send} />
            )
          ) : (
            <Thread msgs={chat.msgs} onAsk={send} />
          )}
          <div ref={bottom} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:px-6">
        <Composer onSend={send} busy={chat.busy} mode={mode} setMode={setMode}
          placeholder={lang === "en" ? "Ask about sales, stock, customers…" : "Poochhiye - bikri, stock, customers…"} />
        <p className="mt-2 text-center text-[11px] text-muted/80">
          Numbers are calculated from your records and checked before you see them. Shift + Enter for a new line.
        </p>
      </div>
    </div>
  );
}

function Welcome({ d, lang, onAsk }: { d: HomeData; lang: string; onAsk: (q: string) => void }) {
  return (
    <div className="space-y-8">
      <div className="pt-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink md:text-[34px]">
          Namaste! {GREETING[lang as keyof typeof GREETING]}
        </h1>
        <p className="mt-2 text-sm text-muted">{d.shop_name} · records up to {d.as_of}</p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5">
        {d.health.map((h) => <HealthTile key={h.key} h={h} />)}
      </div>

      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">{lang === "en" ? "Today's briefing" : "Aaj ki report"}</h2>
          <Link to="/insights" className="text-xs text-muted hover:text-ink">
            All {d.findings_total} insights →
          </Link>
        </div>
        <div className="divide-y divide-line/60">
          {d.briefing.slice(0, 4).map((f) => <FindingRow key={f.id} f={f} compact />)}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {d.suggestions.map((s) => (
          <button key={s} onClick={() => onAsk(s)}
            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink hover:border-muted/40 hover:bg-surface-2">
            {s} <Icon name="arrowUp" size={16} className="shrink-0 text-muted/80" />
          </button>
        ))}
      </div>
    </div>
  );
}

function HealthTile({ h }: { h: any }) {
  const value = h.value_paise != null ? paise(h.value_paise) : h.unit === "%" ? pct(h.value) : num(h.value);
  const ch = h.change_pct;
  const sub = h.sub_paise != null ? `${inr(h.sub_rs)} ${h.sub_label}` : h.sub;
  return (
    <div className="bg-surface p-3">
      <div className="text-[11px] text-muted">{h.label}</div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
        {h.spark && <Spark data={h.spark} />}
      </div>
      <div className="text-[11px] text-muted">
        {ch != null && <span className={ch >= 0 ? "text-green-700" : "text-red-600"}>{pct(ch, true)} </span>}
        {sub}
      </div>
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), w = 56, h = 20;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return <svg width={w} height={h} className="text-muted/80"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}
