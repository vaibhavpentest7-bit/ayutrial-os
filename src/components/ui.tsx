import React from "react";

// ─── Shared UI primitives ───────────────────────────────────────────────────

export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
  pad = true,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {right && <div className="card-right">{right}</div>}
        </header>
      )}
      <div className={pad ? "card-body" : ""}>{children}</div>
    </section>
  );
}

const BADGE_KINDS = [
  "neutral", "green", "amber", "red", "blue", "purple", "teal", "slate",
] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

export function Badge({
  kind = "neutral",
  children,
  title,
}: {
  kind?: BadgeKind;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge badge-${kind}`} title={title}>
      {children}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  unit,
  hint,
  accent,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  accent?: "green" | "amber" | "red" | "blue" | "teal" | "purple";
  icon?: React.ReactNode;
}) {
  return (
    <div className={`kpi kpi-${accent ?? "green"}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon && <span className="kpi-icon">{icon}</span>}
      </div>
      <div className="kpi-value">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  title,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "amber" | "outline";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function Select({
  value,
  onChange,
  children,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <select
      className="select"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

export function Table({
  head,
  children,
  empty,
}: {
  head: React.ReactNode[];
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <div className="table-empty">No records match.</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: React.ReactNode }[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          className={`tab ${active === t.key ? "tab-active" : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <pre className="codeblock" data-lang={lang}>
      <code>{code}</code>
    </pre>
  );
}

export function EmptyState({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? "◌"}</div>
      <div>
        <div className="empty-title">{title}</div>
        <div className="empty-body">{body}</div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeKind> = {
    ACTIVE: "green",
    RECRUITING: "amber",
    ACTIVE_NOT_RECRUITING: "blue",
    ANALYSIS: "purple",
    SCREENING: "blue",
    COMPLETED: "teal",
    WITHDRAWN: "slate",
    LOCKED: "red",
    DRAFT: "amber",
    QUEUED: "blue",
    SUBMITTED: "green",
    MILD: "teal",
    MODERATE: "amber",
    SEVERE: "red",
  };
  return <Badge kind={map[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function RelTime({ iso }: { iso: string }) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  let text: string;
  if (mins < 1) text = "just now";
  else if (mins < 60) text = `${mins}m ago`;
  else if (mins < 1440) text = `${Math.floor(mins / 60)}h ago`;
  else text = `${Math.floor(mins / 1440)}d ago`;
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {text}
    </time>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
