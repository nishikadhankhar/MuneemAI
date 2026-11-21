import { useCallback, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Icon, { Logo } from "./components/Icon";
import Sidebar from "./components/Sidebar";
import { useAsync } from "./components/ui";
import { api } from "./lib/api";
import Campaigns, { CampaignDetail } from "./pages/Campaigns";
import Customers, { CustomerDetail } from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import Data from "./pages/Data";
import Home from "./pages/Home";
import Insights from "./pages/Insights";
import Inventory from "./pages/Inventory";
import Restock from "./pages/Restock";

export default function App() {
  const status = useAsync(() => api.get("/status"), []);
  const chats = useAsync(() => api.get<any[]>("/chats"), []);
  const findings = useAsync(() => api.get<any[]>("/findings", { limit: 50 }), []);
  const [open, setOpen] = useState(false);
  const refreshChats = useCallback(() => chats.reload(), [chats.reload]);
  const newCount = (findings.data ?? []).filter((f) => f.status === "new").length;

  const sidebar = (
    <Sidebar chats={chats.data ?? []} status={status.data} insightCount={newCount} onNavigate={() => setOpen(false)} />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside className="hidden w-64 shrink-0 md:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-1.5 text-ink/80 hover:bg-surface-2 md:hidden" onClick={() => setOpen(true)} aria-label="Menu">
              <Icon name="sidebar" />
            </button>
            <span className="md:hidden"><Logo size={28} /></span>
            <span className="whitespace-nowrap font-display text-lg font-semibold tracking-tight text-ink">Muneem AI</span>
            <span className="hidden text-xs text-muted sm:inline">· Business copilot for your dukaan</span>
          </div>
          <span className="truncate rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-slate-600">
            {status.data?.dataset?.source === "sample" ? <>Sample shop<span className="hidden sm:inline"> · synthetic data</span></> : "Private workspace"}
          </span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Home onChatsChanged={refreshChats} />} />
            <Route path="/c/:cid" element={<Home onChatsChanged={refreshChats} />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:cid" element={<CustomerDetail />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/orders" element={<div className="mx-auto max-w-6xl px-4 py-8 md:px-6"><Restock /></div>} />
            <Route path="/business" element={<div className="mx-auto max-w-6xl px-4 py-8 md:px-6"><Dashboard /></div>} />
            <Route path="/data" element={<div className="mx-auto max-w-5xl px-4 py-8 md:px-6"><Data onChange={status.reload} /></div>} />
            <Route path="/chat" element={<Navigate to="/" replace />} />
            <Route path="/restock" element={<Navigate to="/orders" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
