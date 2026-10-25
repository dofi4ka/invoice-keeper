import { Icon } from "@iconify/react";
import { useEffect, useState, type ReactNode } from "react";

// Apple emoji artwork (emoji-datasource-apple), so emoji look the same on every platform.
const EMOJI = import.meta.glob<string>("../assets/emoji/*.png", { eager: true, import: "default" });

export function Emoji({ e }: { e: string }) {
  const code = [...e].map((c) => c.codePointAt(0)!.toString(16)).join("-");
  const src = EMOJI[`../assets/emoji/${code}.png`];
  return src ? <img className="emoji" src={src} alt={e} draggable={false} /> : <>{e}</>;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** ⬅️ value ➡️ */
export function Stepper({ value, onPrev, onNext, tip }: { value: ReactNode; onPrev: () => void; onNext: () => void; tip?: string }) {
  return (
    <div className="stepper">
      <button type="button" className="icon-btn" onClick={onPrev} aria-label="Назад">
        <Emoji e="⬅️" />
      </button>
      <span className="value" data-tip={tip}>
        {value}
      </span>
      <button type="button" className="icon-btn" onClick={onNext} aria-label="Вперёд">
        <Emoji e="➡️" />
      </button>
    </div>
  );
}

export function CategoryIcon({ icon, size = 20 }: { icon: string | null | undefined; size?: number }) {
  return (
    <span className="cat-icon" style={{ width: size, height: size }}>
      <Icon icon={icon || "mdi:receipt-text-outline"} width={size} height={size} color="#000" />
    </span>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Kv({ label, children, tip }: { label: ReactNode; children: ReactNode; tip?: string }) {
  return (
    <div className="kv">
      <p data-tip={tip}>{label}</p>
      {typeof children === "string" || typeof children === "number" ? <p>{children}</p> : <div style={{ minWidth: 0, display: "flex", justifyContent: "flex-end" }}>{children}</div>}
    </div>
  );
}

/** Right-hand panel; on phones it opens as a full-screen sheet only while something is selected. */
export function Side({ open, onClose, children, className = "" }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <aside className={`side ${open ? "open" : ""} ${className}`}>
      {open && (
        <button type="button" className="btn btn-sm side-close" onClick={onClose}>
          ✕ Закрыть
        </button>
      )}
      {children}
    </aside>
  );
}

let pushToast: (text: string) => void = () => {};
export function toast(text: string) {
  pushToast(text);
}

export function Toaster() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let timer: number;
    pushToast = (t) => {
      setText(t);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setText(null), 3000);
    };
    return () => window.clearTimeout(timer);
  }, []);
  return text ? <div className="toast">{text}</div> : null;
}

export const EyeIcon = ({ off }: { off?: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);
