import { useEffect, useState } from "react";
import BillScan, { SavedBills } from "../components/BillScan";
import { Badge, Card, ErrorBox, PageHeader, Spinner, useAsync } from "../components/ui";
import { api } from "../lib/api";

const ENTITIES: Record<string, string> = {
  items: "Products / item master", sales: "Bill lines (sales)", inventory: "Stock", expenses: "Expenses",
  suppliers: "Suppliers", customers: "Customers", repayments: "Udhaar repayments",
};
const STATUS: Record<string, [string, string]> = {
  auto: ["green", "sure"], check: ["amber", "please check"], missing: ["red", "needed"], unmapped: ["gray", "optional"],
};

export default function Data({ onChange }: { onChange: () => void }) {
  const status = useAsync(() => api.get("/status"), []);
  const agent = useAsync(() => api.get("/agent/status"), []);
  const [analysis, setAnalysis] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [sheetsKey, setSheetsKey] = useState(0);
  const [billSaved, setBillSaved] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState(0);

  const run = async (fn: () => Promise<any>, then: (r: any) => void) => {
    setBusy(true); setErr(null);
    try { then(await fn()); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const ds = status.data?.dataset;

  return (
    <div className="space-y-6">
      <PageHeader title="Data" sub="Bring records from any billing app, spreadsheet, database or a photo of a paper bill. Muneem works out what each column means and asks only when unsure." />

      <Card title="Current data" right={
        <button className="btn" disabled={busy} onClick={() => confirm("Replace current data with the synthetic sample?") &&
          run(() => api.post("/sample"), (r) => { setResult(r); status.reload(); onChange(); })}>Load sample data</button>}>
        {status.loading ? <Spinner /> : ds ? (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink">
            <span>Source: <b>{ds.source}</b></span><span>As of: <b>{ds.as_of}</b></span>
            <span>Sales: {ds.sales_from} → {ds.sales_to}</span>
            {Object.entries(ds.counts).map(([k, v]) => <span key={k}>{k.replace("_", " ")}: <b>{String(v)}</b></span>)}
            <Badge tone={status.data.postgres?.persisted ? "green" : "gray"}>Postgres {status.data.postgres?.status}{status.data.postgres?.persisted ? " · saved" : ""}</Badge>
            <Badge tone={status.data.arango?.persisted ? "green" : "gray"}>ArangoDB {status.data.arango?.status}{status.data.arango?.persisted ? " · graph synced" : ""}</Badge>
          </div>
        ) : <p className="text-sm text-muted">No data loaded.</p>}
      </Card>

      {!analysis && <SheetsLive onAnalyzed={(a) => { setAnalysis(a); setResult(null); }}
        onChanged={() => { status.reload(); onChange(); }} key={sheetsKey} />}

      {!analysis && <BillScan onSaved={(msg) => { setBillSaved(msg); setSavedKey((k) => k + 1); status.reload(); onChange(); }} />}
      {billSaved && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>✓ {billSaved}</span>
          <button className="btn" onClick={() => setBillSaved(null)}>OK</button>
        </div>
      )}

      {!analysis && <SavedBills refreshKey={savedKey} />}

      {!analysis && (
        <div className="grid gap-4 md:grid-cols-2">
          <FileImport busy={busy} aiAvailable={!!agent.data?.llm_configured}
            onAnalyze={(form) => run(() => api.upload("/ingest/analyze", form), (a) => { setAnalysis(a); setResult(null); })} />
          <SqlImport busy={busy} onAnalyze={(body) => run(() => api.post("/ingest/sql/analyze", body), (a) => { setAnalysis(a); setResult(null); })}
            onError={setErr} />
        </div>
      )}
      {err != null && <ErrorBox error={err} />}
      {analysis && (
        <Review a={analysis} busy={busy} onCancel={() => setAnalysis(null)}
          commitLabel={analysis.sheet ? "Link & keep in sync" : undefined}
          onCommit={(body) => analysis.sheet
            ? run(() => api.post("/sheets", { url: analysis.sheet.url, name: analysis.sheet.name,
                entity: body.tables[0].entity, mapping: body.tables[0].mapping }), () => {
                setAnalysis(null); setSheetsKey((k) => k + 1); status.reload(); onChange(); })
            : run(() => api.post(`/ingest/${analysis.ingest_id}/commit`, body), (r) => {
                setResult(r); if (r.report?.ok) { setAnalysis(null); status.reload(); onChange(); }
              })} />
      )}
      {result && <Report r={result} />}
      <Webhook />
    </div>
  );
}

function SheetsLive({ onAnalyzed, onChanged }: { onAnalyzed: (a: any) => void; onChanged: () => void }) {
  const list = useAsync(() => api.get<{ sheets: any[]; poll_minutes: number }>("/sheets"), []);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const act = async (id: string, fn: () => Promise<any>) => {
    setWorking(id); setErr(null);
    try { await fn(); list.reload(); onChanged(); } catch (e) { setErr(e); } finally { setWorking(null); }
  };
  const sheets = list.data?.sheets ?? [];
  const ago = (iso?: string) => {
    if (!iso) return "never";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  };
  useEffect(() => { const t = setInterval(list.reload, 60_000); return () => clearInterval(t); }, [list.reload]);

  return (
    <Card title={<span className="flex items-center gap-2">Google Sheets <Badge tone="green">live</Badge></span>}
      right={sheets.length > 0 && <button className="btn" disabled={working !== null} onClick={() => act("all", () => api.post("/sheets/sync"))}>
        {working === "all" ? "Syncing…" : "Sync all now"}</button>}>
      <p className="mb-3 text-sm text-muted">
        Keep products, bills, stock or expenses in a Google Sheet and Muneem re-reads it every {list.data?.poll_minutes ?? 2} minutes.
        In the sheet, click <b>Share → General access → Anyone with the link → Viewer</b>, then paste the link. Each sheet tab feeds one table and replaces it; a broken edit never wipes your data.
      </p>
      <div className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-[3]" placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input className="input min-w-0 flex-1" placeholder="Name, e.g. Daily bills" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-dark" disabled={working !== null || url.length < 20} onClick={async () => {
          setWorking("read"); setErr(null);
          try { onAnalyzed(await api.post("/sheets/analyze", { url, name: name || "Google Sheet" })); }
          catch (e) { setErr(e); } finally { setWorking(null); }
        }}>{working === "read" ? "Reading…" : "Read sheet"}</button>
      </div>
      {err != null && <div className="mt-3"><ErrorBox error={err} /></div>}
      {sheets.length > 0 && (
        <ul className="mt-4 divide-y divide-line/60 rounded-lg border border-line">
          {sheets.map((s) => (
            <li key={s.sheet_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <span className={`h-2 w-2 rounded-full ${s.status === "ok" ? "bg-accent" : s.status === "error" ? "bg-red-600" : "bg-amber-500"}`} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">{s.name} <span className="font-normal text-muted">→ {ENTITIES[s.entity] ?? s.entity}</span></div>
                <div className="text-xs text-muted">{s.rows} rows · checked {ago(s.last_checked)} · last change {ago(s.last_changed)}</div>
                {s.error && <div className="mt-0.5 text-xs text-red-700">{s.error}</div>}
              </div>
              <a className="text-xs text-accent hover:underline" href={s.url} target="_blank" rel="noopener noreferrer">Open sheet</a>
              <button className="btn" disabled={working !== null} onClick={() => act(s.sheet_id, () => api.post(`/sheets/${s.sheet_id}/sync`))}>
                {working === s.sheet_id ? "…" : "Sync"}</button>
              <button className="btn" disabled={working !== null} onClick={() => confirm(`Stop syncing "${s.name}"? Data already loaded stays.`) &&
                act(s.sheet_id, () => api.del(`/sheets/${s.sheet_id}`))}>Unlink</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FileImport({ busy, aiAvailable, onAnalyze }: { busy: boolean; aiAvailable: boolean; onAnalyze: (f: FormData) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [ai, setAi] = useState(false);
  return (
    <Card title="Upload files">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink/80 hover:bg-surface-2">
        <span className="font-medium text-ink">Choose CSV or Excel files</span>
        <span className="text-xs text-muted">Any column names - products, bills, stock, expenses, customers, udhaar…</span>
        <input type="file" multiple accept=".csv,.xlsx" className="hidden" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </label>
      {files.length > 0 && <ul className="mt-2 text-xs text-ink/80">{files.map((f) => <li key={f.name}>• {f.name}</li>)}</ul>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className={`flex items-center gap-1.5 text-xs ${aiAvailable ? "text-ink/80" : "text-muted/80"}`}
          title="Only for columns the rules can't place; you confirm every suggestion">
          <input type="checkbox" disabled={!aiAvailable} checked={ai} onChange={(e) => setAi(e.target.checked)} />
          Let AI suggest unclear columns
        </label>
        <button className="btn btn-dark" disabled={busy || !files.length} onClick={() => {
          const form = new FormData(); files.forEach((f) => form.append("files", f)); form.append("use_ai", String(ai)); onAnalyze(form);
        }}>{busy ? "Reading…" : "Analyze"}</button>
      </div>
    </Card>
  );
}

function SqlImport({ busy, onAnalyze, onError }: { busy: boolean; onAnalyze: (b: any) => void; onError: (e: unknown) => void }) {
  const [url, setUrl] = useState("");
  const [tables, setTables] = useState<any[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  return (
    <Card title="Connect a database (read-only)">
      <input className="input w-full" type="password" autoComplete="off" placeholder="postgresql://user:password@host/db"
        value={url} onChange={(e) => { setUrl(e.target.value); setTables(null); }} />
      <p className="mt-1 text-xs text-muted">PostgreSQL or MySQL. Muneem only reads; the address isn't saved.</p>
      {!tables ? (
        <button className="btn mt-3" disabled={busy || url.length < 10} onClick={async () => {
          try { setTables(await api.post("/ingest/sql/tables", { url })); setPick([]); } catch (e) { onError(e); }
        }}>List tables</button>
      ) : (
        <div className="mt-3 space-y-1 text-sm">
          {tables.map((t) => (
            <label key={t.table} className="flex items-center gap-2">
              <input type="checkbox" checked={pick.includes(t.table)}
                onChange={(e) => setPick(e.target.checked ? [...pick, t.table] : pick.filter((x) => x !== t.table))} />
              <span>{t.table}</span><span className="text-xs text-muted/80">{t.rows} rows</span>
            </label>
          ))}
          <button className="btn btn-dark mt-2" disabled={busy || !pick.length} onClick={() => onAnalyze({ url, tables: pick })}>Analyze tables</button>
        </div>
      )}
    </Card>
  );
}

function Review({ a, busy, onCancel, onCommit, commitLabel }: { a: any; busy: boolean; onCancel: () => void; onCommit: (b: any) => void; commitLabel?: string }) {
  const [choices, setChoices] = useState<Record<string, any>>(() => Object.fromEntries(a.tables.map((t: any) => [t.key, {
    include: true, entity: t.entity, mapping: Object.fromEntries(t.mapping.map((m: any) => [m.field, m.source ?? ""])),
  }])));
  const [name, setName] = useState("My billing export");
  const [remember, setRemember] = useState(true);
  const [partial, setPartial] = useState(false);
  const set = (key: string, patch: any) => setChoices({ ...choices, [key]: { ...choices[key], ...patch } });
  const toConfirm = a.summary.fields_to_confirm;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm">
        <span>Read <b>{a.tables.length}</b> table(s). <b>{a.summary.fields_auto}</b> fields matched automatically;{" "}
          {toConfirm ? <b className="text-amber-700">{toConfirm} need a look (highlighted)</b> : <b className="text-green-700">nothing needs checking</b>}.</span>
        <button className="btn" onClick={onCancel}>Start over</button>
      </div>

      {a.tables.map((t: any) => {
        const ch = choices[t.key];
        const changedEntity = ch.entity !== t.entity;
        return (
          <Card key={t.key} title={
            <span className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={ch.include} onChange={(e) => set(t.key, { include: e.target.checked })} />
              {t.name} <span className="font-normal text-muted/80">· {t.rows} rows</span>
              {t.remembered && <Badge tone="violet">remembered: {t.remembered}</Badge>}
            </span>}
            right={
              <label className="flex items-center gap-2 text-xs text-muted">This is
                <select className={`input py-1 text-sm ${t.entity_status === "check" ? "border-amber-400" : ""}`} value={ch.entity}
                  onChange={(e) => set(t.key, { entity: e.target.value, mapping: {} })}>
                  {Object.entries(ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <Badge tone={t.entity_confidence >= 0.6 ? "green" : "amber"}>{Math.round(t.entity_confidence * 100)}%</Badge>
              </label>}>
            {changedEntity ? (
              <p className="text-sm text-amber-700">Type changed - analyze again to get matching suggestions for {ENTITIES[ch.entity]}, or pick the columns below.</p>
            ) : null}
            {ch.include && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-1.5 pr-3 font-medium">Field</th><th className="pr-3 font-medium">Column in your file</th>
                    <th className="pr-3 font-medium">Example</th><th className="font-medium">Match</th></tr></thead>
                  <tbody>
                    {(changedEntity ? [] : t.mapping).filter((m: any) => m.required || m.source || m.candidates.length).map((m: any) => {
                      const [tone, label] = STATUS[m.status] ?? ["gray", m.status];
                      const src = ch.mapping[m.field] ?? "";
                      const prof = t.columns.find((c: any) => c.column === src);
                      const flag = m.status === "check" || (m.status === "missing" && m.required);
                      return (
                        <tr key={m.field} className={`border-t border-line/60 ${flag ? "bg-amber-50/60" : ""}`}>
                          <td className="py-1.5 pr-3">{m.label}{m.required && <span className="text-red-500"> *</span>}</td>
                          <td className="pr-3">
                            <select className="input w-full py-1 text-sm" value={src}
                              onChange={(e) => set(t.key, { mapping: { ...ch.mapping, [m.field]: e.target.value } })}>
                              <option value="">— not in this file —</option>
                              {t.columns.map((c: any) => <option key={c.column} value={c.column}>{c.column} ({c.type})</option>)}
                            </select>
                          </td>
                          <td className="max-w-[160px] truncate pr-3 text-xs text-muted">{prof?.examples?.slice(0, 2).join(", ")}</td>
                          <td><Badge tone={tone} title={m.reason}>{src === (m.source ?? "") ? `${label}${m.confidence ? ` ${Math.round(m.confidence * 100)}%` : ""}` : "your choice"}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {t.unmapped_columns.length > 0 && <p className="mt-2 text-xs text-muted/80">Not used: {t.unmapped_columns.join(", ")}</p>}
              </div>
            )}
          </Card>
        );
      })}

      {a.links.length > 0 && (
        <Card title="How your files connect">
          <ul className="space-y-1 text-sm">
            {a.links.map((l: any) => (
              <li key={l.from + l.to} className="flex flex-wrap items-center gap-2">
                <Badge tone={l.status === "ok" ? "green" : l.status === "partial" ? "amber" : "red"}>{l.coverage_pct}%</Badge>
                {l.meaning} <span className="text-xs text-muted/80">({l.from} → {l.to}{l.missing_values ? `, ${l.missing_values} codes not found` : ""})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line px-4 py-3 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this layout as</label>
        <input className="input w-56" value={name} onChange={(e) => setName(e.target.value)} disabled={!remember} maxLength={120} />
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
          Load valid rows even if some rows have errors</label>
        <button className="btn btn-dark ml-auto" disabled={busy} onClick={() => onCommit({
          tables: a.tables.map((t: any) => ({ key: t.key, include: choices[t.key].include, entity: choices[t.key].entity,
            mapping: Object.fromEntries(Object.entries(choices[t.key].mapping).filter(([, v]) => v)) })),
          remember, source_name: name, allow_partial: partial,
        })}>{busy ? "Working…" : commitLabel ?? "Import"}</button>
      </div>
    </div>
  );
}

function Webhook() {
  const [open, setOpen] = useState(false);
  return (
    <Card title="Live updates from your billing app (webhook)" right={<button className="btn" onClick={() => setOpen(!open)}>{open ? "Hide" : "How"}</button>}>
      {open ? (
        <div className="space-y-2 text-sm text-ink/80">
          <p>Set <code>WEBHOOK_SECRET</code> in <code>.env</code>, then POST new records as JSON to:</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2/60 p-3 text-xs">{`POST /api/ingest/webhook/{sales|expenses|repayments|items|inventory|customers|suppliers}
X-Muneem-Signature: sha256=<HMAC-SHA256(secret, raw body)>

{"records": [{"bill_no": "B1", "date": "2026-11-14", "item_id": "I001", "qty": 2, "rate": 265, "payment": "upi"}]}`}</pre>
          <p>Bills, expenses and repayments are added; products, stock, suppliers and customers are updated by their code. Everything is re-checked before it replaces the current data - a bad batch changes nothing.</p>
        </div>
      ) : <p className="text-sm text-muted">Send new bills or stock changes automatically, signed with a shared secret.</p>}
    </Card>
  );
}

function Report({ r }: { r: any }) {
  const rep = r.report;
  return (
    <Card title={<span className="flex items-center gap-2">Import report <Badge tone={rep.ok ? "green" : "red"}>{rep.ok ? "Loaded" : "Not loaded"}</Badge></span>}>
      <div className="space-y-3 text-sm">
        {rep.ok && <p className="text-green-700">Loaded {Object.entries(rep.rows_loaded).map(([k, v]) => `${v} ${k}`).join(", ")} · as of {rep.as_of}</p>}
        {r.remembered?.length > 0 && <p className="text-ink/80">Remembered for next time: {r.remembered.join(", ")}</p>}
        {rep.notes?.length > 0 && <ul className="list-disc pl-5 text-ink/80">{rep.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>}
        {rep.error_count > 0 && <Issues title={`${rep.error_count} error(s)`} tone="red" issues={rep.errors} summary={rep.error_summary} />}
        {rep.warning_count > 0 && <Issues title={`${rep.warning_count} warning(s)`} tone="amber" issues={rep.warnings} summary={rep.warning_summary} />}
      </div>
    </Card>
  );
}

function Issues({ title, tone, issues, summary }: { title: string; tone: string; issues: any[]; summary: Record<string, number> }) {
  return (
    <div>
      <Badge tone={tone}>{title}</Badge>
      <ul className="my-2 text-xs text-ink/80">{Object.entries(summary).map(([k, v]) => <li key={k}>{v}× {k}</li>)}</ul>
      <div className="max-h-64 overflow-auto rounded border border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2 text-left"><tr>
            <th className="px-2 py-1">Table</th><th className="px-2 py-1">Row</th><th className="px-2 py-1">Column</th>
            <th className="px-2 py-1">Value</th><th className="px-2 py-1">Problem</th></tr></thead>
          <tbody>{issues.map((i, k) => (
            <tr key={k} className="border-t border-line/60"><td className="px-2 py-1">{i.table}</td><td className="px-2 py-1">{i.row ?? "–"}</td>
              <td className="px-2 py-1">{i.column ?? "–"}</td><td className="px-2 py-1">{i.value ?? ""}</td><td className="px-2 py-1">{i.message}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
