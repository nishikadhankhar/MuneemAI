import { ReactNode, useCallback, useEffect, useState } from "react";

export function Card({ title, right, children, className = "" }: {
  title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-base font-semibold text-ink">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  green: "bg-green-50 text-green-700 ring-green-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  gray: "bg-surface-2 text-ink/80 ring-line",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ tone = "gray", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone] ?? TONES.gray}`}>
      {children}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  const tone = { CRITICAL: "red", SOON: "amber", OK: "green", UNKNOWN: "gray" }[tier] ?? "gray";
  const label = { CRITICAL: "Critical", SOON: "Soon", OK: "OK", UNKNOWN: "Not enough data" }[tier] ?? tier;
  return <Badge tone={tone}>{label}</Badge>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-blue-600" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {msg}
      {onRetry && <button className="btn ml-3" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    run().then(setData).catch(setError).finally(() => setLoading(false));
  }, [run]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** VyaparMitra KPI tile colours: pass `color` for the bold gradient card, omit it for a plain card. */
const GRADIENTS: Record<string, string> = {
  green: "from-emerald-400 to-emerald-600",
  orange: "from-amber-400 to-orange-500",
  red: "from-rose-400 to-red-500",
  blue: "from-blue-500 to-indigo-600",
  violet: "from-violet-500 to-purple-600",
};

export function Stat({ label, value, sub, tone, color, icon }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down";
  color?: keyof typeof GRADIENTS; icon?: ReactNode;
}) {
  if (color) {
    return (
      <div className={`relative min-w-0 overflow-hidden rounded-xl bg-gradient-to-br ${GRADIENTS[color]} p-3 text-white shadow-sm sm:p-4`}>
        <span className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute -bottom-8 right-6 h-20 w-20 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          {icon && <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 sm:flex">{icon}</span>}
          <div className="min-w-0">
            <div className="text-xs font-medium text-white/90">{label}</div>
            <div className="font-mono text-lg font-semibold tracking-tight sm:text-2xl">{value}</div>
            {sub && <div className="mt-0.5 text-xs text-white/85 sm:truncate">{sub}</div>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold text-ink">{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${tone === "up" ? "text-emerald-700" : tone === "down" ? "text-red-600" : "text-muted"}`}>{sub}</div>}
    </div>
  );
}
