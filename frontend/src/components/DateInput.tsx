import { useEffect, useRef, useState } from "react";
import { MONTHS, WEEKDAYS, addDays, dmy, iso, parseDate, today } from "../lib/format";
import Popover from "./Popover";

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  compact?: boolean;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
}

function parseTyped(text: string): string | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return undefined;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getDate() !== Number(m[1])) return undefined;
  return iso(d);
}

/** dd.mm.yyyy text field with a month picker. */
export default function DateInput({ value, onChange, placeholder = "дд.мм.гггг", compact, max, disabled, clearable = true }: Props) {
  const [text, setText] = useState(value ? dmy(value) : "");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => (value ? parseDate(value) : today()));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value ? dmy(value) : "");
    if (value) setView(parseDate(value));
  }, [value]);

  const commit = (next: string | null) => {
    if (next && max && next > max) next = max;
    setText(next ? dmy(next) : "");
    if (next !== value) onChange(next);
  };

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const todayIso = iso(today());

  return (
    <>
      <input
        ref={ref}
        className={`input ${compact ? "compact" : ""}`}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="numeric"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseTyped(text);
          if (parsed === undefined) setText(value ? dmy(value) : "");
          else if (parsed !== value && (clearable || parsed)) commit(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
            setOpen(false);
          }
        }}
      />
      <Popover anchor={ref} open={open && !disabled} onClose={() => setOpen(false)} className="dp">
        <div className="dp-head">
          <button type="button" className="icon-btn" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>
            ‹
          </button>
          <span>
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </span>
          <button type="button" className="icon-btn" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>
            ›
          </button>
        </div>
        <div className="dp-grid">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
          {days.map((d) => {
            const v = iso(d);
            const cls = [d.getMonth() !== view.getMonth() && "out", v === todayIso && "today", v === value && "on"].filter(Boolean).join(" ");
            return (
              <button
                type="button"
                key={v}
                className={cls}
                disabled={!!max && v > max}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  commit(v);
                  setOpen(false);
                }}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
        <div className="popover-footer">
          <button type="button" className="link-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { commit(todayIso); setOpen(false); }}>
            Сегодня
          </button>
          {clearable && value && (
            <button type="button" className="link-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { commit(null); setOpen(false); }}>
              Очистить
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}
