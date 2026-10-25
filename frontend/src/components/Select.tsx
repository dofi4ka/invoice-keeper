import { useRef, useState, type ReactNode } from "react";
import Popover from "./Popover";

export interface Option<T> {
  value: T;
  label: ReactNode;
  text?: string;
  sub?: ReactNode;
}

const Chevron = () => (
  <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

interface SelectProps<T> {
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  onClear?: () => void;
}

/** Single choice dropdown (native <select> is intentionally not used). */
export function Select<T extends string | number>({ value, options, onChange, placeholder = "Не выбрано", compact, disabled, clearable, onClear }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        type="button"
        ref={ref}
        disabled={disabled}
        className={`select-trigger ${compact ? "compact" : ""} ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`value ${current ? "" : "placeholder"}`}>{current ? current.label : placeholder}</span>
        {!disabled && <Chevron />}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} matchWidth>
        {clearable && (
          <button
            type="button"
            className="option muted"
            onClick={() => {
              onClear?.();
              setOpen(false);
            }}
          >
            {placeholder}
          </button>
        )}
        {options.map((o) => (
          <button
            type="button"
            key={String(o.value)}
            className={`option ${o.value === value ? "selected" : ""}`}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            <span className="grow">{o.label}</span>
            {o.sub && <span className="option-sub">{o.sub}</span>}
          </button>
        ))}
      </Popover>
    </>
  );
}

interface MultiProps<T> {
  label: string;
  values: T[];
  options: Option<T>[];
  onChange: (values: T[]) => void;
  searchable?: boolean;
}

/** Filter dropdown with several selectable items. */
export function MultiSelect<T extends string | number>({ label, values, options, onChange, searchable }: MultiProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const toggle = (v: T) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  const shown = query
    ? options.filter((o) => (o.text ?? String(o.label)).toLowerCase().includes(query.toLowerCase()))
    : options;
  return (
    <>
      <button
        type="button"
        ref={ref}
        className={`select-trigger filter ${open ? "open" : ""} ${values.length ? "active" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="value">{label}</span>
        {values.length > 0 && <span className="badge">{values.length}</span>}
        <Chevron />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)}>
        {searchable && (
          <input className="input compact" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus style={{ marginBottom: 4 }} />
        )}
        {shown.map((o) => (
          <button type="button" key={String(o.value)} className={`option ${values.includes(o.value) ? "selected" : ""}`} onClick={() => toggle(o.value)}>
            <span className="check">{values.includes(o.value) ? "✓" : ""}</span>
            <span className="grow">{o.label}</span>
          </button>
        ))}
        {shown.length === 0 && <div className="option muted">Ничего не найдено</div>}
        {values.length > 0 && (
          <div className="popover-footer">
            <button type="button" className="link-btn" onClick={() => onChange([])}>
              Сбросить
            </button>
            <button type="button" className="link-btn" onClick={() => setOpen(false)}>
              Готово
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}
