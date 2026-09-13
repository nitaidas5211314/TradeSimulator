import type { ReactNode } from "react";

export const inputClass =
  "h-8 w-full rounded border border-line bg-panel-2 px-2 text-sm text-fg outline-none transition-colors placeholder:text-muted/60 focus:border-accent disabled:opacity-50";

export function Card({
  title,
  extra,
  children,
  className = "",
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {(title || extra) && (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <div className="text-sm font-medium">{title}</div>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}

export function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3 border-b border-line px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{title}</h3>
        {extra}
      </div>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-snug text-muted/80">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex rounded border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 whitespace-nowrap rounded-sm px-3 transition-colors ${size === "sm" ? "h-6 text-xs" : "h-7 text-sm"} ${
            value === o.value ? "bg-line text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  suffix,
  step,
  min,
  max,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        className={`${inputClass} num ${suffix ? "pr-12" : ""}`}
        value={value}
        step={step ?? "any"}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted">{suffix}</span>
      )}
    </div>
  );
}

export function SmallButton({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
    >
      {children}
    </button>
  );
}
