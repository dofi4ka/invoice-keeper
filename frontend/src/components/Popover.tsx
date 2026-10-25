import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Props {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  matchWidth?: boolean;
  placement?: "bottom" | "top" | "right";
}

/** Floating layer rendered into <body>, so it is never clipped by overflow of a parent. */
export default function Popover({ anchor, open, onClose, children, className = "", align = "start", matchWidth, placement = "bottom" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left: number;
      let top: number;
      if (placement === "right") {
        left = a.right + 8;
        top = a.bottom - h;
        if (left + w > vw - 8) {
          left = Math.max(8, a.left);
          top = a.top - h - 6;
        }
      } else {
        left = align === "end" ? a.right - w : a.left;
        top = placement === "top" ? a.top - h - 6 : a.bottom + 6;
        if (top + h > vh - 8 && a.top - h - 6 > 8) top = a.top - h - 6;
      }
      left = Math.min(Math.max(8, left), vw - w - 8);
      top = Math.max(8, top);
      setStyle({ left, top, minWidth: matchWidth ? a.width : undefined, visibility: "visible" });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align, matchWidth, placement, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} className={`popover ${className}`} style={style}>
      {children}
    </div>,
    document.body,
  );
}
