import { useEffect, useState } from "react";

export function Button({ variant = "default", size = "md", className = "", ...p }) {
  const v = {
    default: "border border-jm-line bg-white text-jm-ink hover:bg-jm-sky",
    primary: "bg-jm-orange text-white hover:brightness-105 shadow-sm",
    navy: "bg-jm-navy text-white hover:bg-jm-navy2",
    green: "bg-green-50 text-jm-green border border-green-200 hover:bg-green-100",
    red: "bg-red-50 text-jm-red border border-red-200 hover:bg-red-100",
    ghost: "text-jm-muted hover:text-jm-ink hover:bg-jm-sky",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return <button type="button" {...p} className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-jm-blue ${v} ${s} ${className}`} />;
}

const PILL = {
  gray: "bg-slate-100 text-slate-600", blue: "bg-blue-50 text-jm-blue", orange: "bg-orange-50 text-jm-amber",
  green: "bg-green-50 text-jm-green", red: "bg-red-50 text-jm-red", amber: "bg-amber-50 text-jm-amber",
};
export function Pill({ tone = "gray", children }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[tone]}`}>{children}</span>;
}
const STATUS_TONE = {
  Queued: "blue", Running: "blue", "Needs Review": "orange", Approved: "green", Rejected: "red", Failed: "red", Interrupted: "amber",
  Open: "blue", "Supplement in review": "orange", "Supplement sent": "amber", "Approved by carrier": "green", Closed: "gray",
};
export const StatusPill = ({ status }) => <Pill tone={STATUS_TONE[status] || "gray"}>{status}</Pill>;
export const SupportPill = ({ support }) =>
  support === "supported" ? <Pill tone="green">Supported</Pill> : support === "needs_verification" ? <Pill tone="amber">Verify source</Pill> : <Pill tone="red">No support</Pill>;

export function Card({ title, actions, children, className = "" }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-jm-line bg-white p-4 shadow-jm sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold text-jm-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, className = "" }) {
  return (
    <label className={`grid min-w-0 gap-1 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-jm-muted">{label}</span>
      {children}
    </label>
  );
}
export const inputCls = "w-full min-w-0 rounded-lg border border-jm-line bg-white px-2.5 py-2 text-sm text-jm-ink outline-none focus:border-jm-blue focus:ring-2 focus:ring-jm-blue/15";

export const Empty = ({ children }) => <div className="rounded-xl border border-dashed border-jm-line p-6 text-center text-sm text-jm-muted">{children}</div>;

export function Confirm({ text, confirmLabel, tone = "red", onConfirm, onCancel, children }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-3 rounded-xl border border-jm-line bg-jm-sky p-3 text-sm">
      <div>{text}</div>
      {children}
      <div className="flex gap-2">
        <Button variant={tone} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

let pushToast = () => {};
export const toast = (msg) => pushToast(msg);
export function Toaster() {
  const [msg, setMsg] = useState(null);
  useEffect(() => { let t; pushToast = (m) => { setMsg(m); clearTimeout(t); t = setTimeout(() => setMsg(null), 3800); }; }, []);
  if (!msg) return null;
  return <div role="status" className="fixed bottom-5 left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl bg-jm-navy px-4 py-2.5 text-sm text-white shadow-jm">{msg}</div>;
}

export function Logo({ small }) {
  return (
    <svg width={small ? 26 : 34} height={small ? 20 : 26} viewBox="0 0 34 26" aria-hidden="true">
      <path d="M2 16 L17 4 L32 16" fill="none" stroke="#FF7900" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M8 17 V24 H26 V17" fill="none" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}
