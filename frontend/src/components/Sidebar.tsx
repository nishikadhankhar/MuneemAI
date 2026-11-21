import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { usePrefs } from "../lib/prefs";
import Icon, { Logo } from "./Icon";

const WORKSPACE = [
  { to: "/", label: "Home", icon: "chat", end: true },
  { to: "/insights", label: "Insights", icon: "spark" },
  { to: "/customers", label: "Customers", icon: "users" },
  { to: "/campaigns", label: "Campaigns", icon: "megaphone" },
  { to: "/inventory", label: "Inventory", icon: "list" },
  { to: "/orders", label: "Stock & orders", icon: "box" },
  { to: "/business", label: "Business", icon: "chart" },
  { to: "/data", label: "Data", icon: "database" },
];

type Chat = { conversation_id: string; title: string };

export default function Sidebar({ chats, status, insightCount, onNavigate }: {
  chats: Chat[]; status: any; insightCount?: number; onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const loc = useLocation();
  const { lang, setLang } = usePrefs();
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all ${isActive
      ? "bg-gradient-to-r from-[#2ED890] to-[#1EB97B] font-semibold text-[#0F172A] shadow-sm [&_svg]:text-[#0F172A]"
      : "font-medium text-slate-300 hover:bg-white/10 hover:text-white"}`;

  return (
    <div className="flex h-full flex-col bg-nav text-white">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <Logo />
        <div className="leading-tight">
          <div className="font-display text-[17px] font-bold tracking-tight text-white">Muneem</div>
          <div className="text-[11px] font-medium text-slate-300">hisaab bhi, salaah bhi</div>
        </div>
      </div>

      <div className="px-3 pt-5">
        <button onClick={() => { navigate("/", { state: { fresh: Date.now() } }); onNavigate?.(); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
          <Icon name="plus" /> New chat
        </button>
      </div>

      <div className="mt-6 px-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Workspace</div>
      <nav className="mt-2 space-y-1 px-3">
        {WORKSPACE.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={item} onClick={onNavigate}>
            <Icon name={n.icon} className="text-slate-400" />
            <span className="flex-1">{n.label}</span>
            {n.to === "/insights" && insightCount ? (
              <span className="font-mono text-xs font-semibold text-rose-300">{insightCount} new</span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="mx-5 my-4 border-t border-white/10" />
      <div className="px-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Recent chats</div>
      <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
        {chats.length === 0 && <p className="px-2 text-sm text-slate-400">No chats yet</p>}
        {chats.map((c) => {
          const active = loc.pathname === `/c/${c.conversation_id}`;
          return (
            <NavLink key={c.conversation_id} to={`/c/${c.conversation_id}`} onClick={onNavigate}
              className={`block truncate rounded-lg px-3 py-1.5 text-sm ${active ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
              {c.title}
            </NavLink>
          );
        })}
      </div>

      <div className="space-y-3 border-t border-white/10 px-5 py-4">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>Language</span>
          <div className="flex overflow-hidden rounded-lg bg-white/10 p-0.5">
            {(["en", "hinglish", "hi"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)}
                className={`rounded-md px-2 py-1 ${lang === l ? "bg-white font-semibold text-[#0F172A]" : "text-slate-300 hover:text-white"}`}>
                {l === "en" ? "EN" : l === "hinglish" ? "Hinglish" : "हिं"}
              </button>
            ))}
          </div>
        </div>
        {status && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span>Data as of {status.dataset?.as_of ?? "–"}</span>
            <Dot ok={status.postgres?.status === "connected"} label="Postgres" />
            <Dot ok={status.arango?.status === "connected"} label="ArangoDB" />
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-slate-500"}`} />{label}
    </span>
  );
}
