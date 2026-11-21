// Thin typed client for the Muneem FastAPI backend (proxied at /api in dev).

export type Insight = {
  kind: string;
  title: string;
  as_of?: string;
  headline: Record<string, any>;
  rows: Record<string, any>[];
  formula: string;
  assumptions: string[];
  confidence: string;
  engine: string;
  meta: Record<string, any>;
};

export type Visual = { type: "chart" | "table" | "mermaid" | "kpis"; title: string; spec: any };
export type Action = { type: string; label: string; payload: Record<string, any> };

export type Evidence = {
  tool: string;
  args: Record<string, any>;
  title: string;
  formula: string;
  headline: Record<string, any>;
  rows: Record<string, any>[];
  confidence: string;
  engine: string;
  assumptions: string[];
  resolved: Record<string, any>;
  error: string | null;
  external?: boolean;
};

export type Envelope = {
  conversation_id: string;
  question: string;
  answer_md: string;
  language: "en" | "hinglish" | "hi";
  mode: "llm" | "rules";
  model: string | null;
  confidence: string;
  evidence: Evidence[];
  visuals: Visual[];
  actions: Action[];
  suggestions: string[];
  grounding: { checked: number; from_web?: number; verified?: number; ungrounded: string[] };
  warnings: string[];
  sources?: Source[];
  latency_ms: number;
};

export type Source = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  published_date: string | null;
  retrieved_at: string | null;
  provider: string;
  tool: string;
};

export type POLine = {
  item_id: string;
  name: string;
  qty: number;
  suggested_qty: number;
  pack_size: number;
  packs: number;
  unit_cost_paise: number;
  gst_rate: number;
  value_paise: number;
  value_incl_gst_paise: number;
  tier: string;
  days_left: number | null;
  why: string;
  edited: boolean;
};

export type PurchaseOrder = {
  po_id: string;
  draft_id: string;
  created_at: string;
  status: "draft" | "sent" | "received" | "cancelled";
  supplier_id: string;
  supplier: string;
  language: "en" | "hinglish" | "hi";
  show_prices: boolean;
  lead_time_days: number;
  expected_delivery: string;
  lines: POLine[];
  total_paise: number;
  total_incl_gst_paise: number;
  message: string;
  whatsapp_url: string;
  history: { status: string; at: string; received_qty?: Record<string, number> }[];
};

export type RestockDraft = {
  draft_id: string;
  as_of: string;
  orders: PurchaseOrder[];
  deferred: { item_id: string; name: string; tier: string; wanted_qty: number }[];
  total_paise: number;
  total_incl_gst_paise: number;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** FastAPI validation errors arrive as a list; show "where: what" lines instead of raw JSON. */
function readableDetail(detail: unknown): string {
  if (Array.isArray(detail)) {
    return detail.map((d: any) => {
      const where = (d?.loc ?? []).filter((x: unknown) => x !== "body").join(" › ");
      return `${where ? where + ": " : ""}${d?.msg ?? "invalid value"}`;
    }).join("; ");
  }
  return JSON.stringify(detail);
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : readableDetail(body.detail ?? body);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

function qs(params?: Record<string, any>): string {
  if (!params) return "";
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  get: <T = any>(path: string, params?: Record<string, any>) =>
    fetch(`/api${path}${qs(params)}`).then((r) => handle<T>(r)),
  post: <T = any>(path: string, body?: unknown) =>
    fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  patch: <T = any>(path: string, body: unknown) =>
    fetch(`/api${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  del: <T = any>(path: string) => fetch(`/api${path}`, { method: "DELETE" }).then((r) => handle<T>(r)),
  upload: <T = any>(path: string, form: FormData) =>
    fetch(`/api${path}`, { method: "POST", body: form }).then((r) => handle<T>(r)),
};

/** POST /api/chat with stream=true and feed each SSE event to onEvent. */
export async function streamChat(
  body: { message: string; conversation_id?: string | null; mode?: string },
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) await handle(res);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}
