const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.1a3.5 3.5 0 0 1 0 6.8",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1ZM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14",
  box: "M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowRight: "M5 12h14M13 5l7 7-7 7",
  x: "M18 6 6 18M6 6l12 12",
  check: "M5 12l5 5L20 7",
  whatsapp: "M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12ZM9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2L9 9.5Z",
  download: "M12 4v12M6 10l6 6 6-6M4 20h16",
  sidebar: "M3 4h18v16H3zM9 4v16",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
};

export default function Icon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

/** Red ledger-book mark (VyaparMitra style). */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="muneem-logo-bg" x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="100%" stopColor="#B91C1C" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#muneem-logo-bg)" />
      <rect x="2.5" y="2.5" width="35" height="35" rx="9.5" stroke="white" strokeOpacity="0.18" />
      <path d="M9.5 11.5C9.5 10.67 10.17 10 11 10H18.5C19.33 10 20 10.67 20 11.5V29.5C20 28.67 19.33 28 18.5 28H11C10.17 28 9.5 27.33 9.5 26.5V11.5Z" fill="#FFFFFF" />
      <path d="M30.5 11.5C30.5 10.67 29.83 10 29 10H21.5C20.67 10 20 10.67 20 11.5V29.5C20 28.67 20.67 28 21.5 28H29C29.83 28 30.5 27.33 30.5 26.5V11.5Z" fill="#FEE2E2" />
      <rect x="19.3" y="10.2" width="1.4" height="19.3" rx="0.7" fill="#DC2626" />
      <rect x="12" y="14" width="5.5" height="1.6" rx="0.8" fill="#DC2626" fillOpacity="0.85" />
      <rect x="12" y="17.8" width="4.5" height="1.6" rx="0.8" fill="#DC2626" fillOpacity="0.55" />
      <rect x="12" y="21.6" width="5.5" height="1.6" rx="0.8" fill="#DC2626" fillOpacity="0.55" />
      <rect x="22.5" y="14" width="5.5" height="1.6" rx="0.8" fill="#B91C1C" fillOpacity="0.8" />
      <rect x="22.5" y="17.8" width="4.5" height="1.6" rx="0.8" fill="#B91C1C" fillOpacity="0.5" />
      <rect x="22.5" y="21.6" width="5.5" height="1.6" rx="0.8" fill="#B91C1C" fillOpacity="0.5" />
      <path d="M25.5 27.5V32.5L27.25 31.1L29 32.5V27.5H25.5Z" fill="#FCD34D" />
    </svg>
  );
}
