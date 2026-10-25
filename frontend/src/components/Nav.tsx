import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { api, invalidate, useQuery } from "../api";
import { useAuth, useMe } from "../auth";
import { relativeAgo } from "../lib/format";
import type { Notification } from "../types";
import Popover from "./Popover";
import { Toaster } from "./ui";

const MAIN = [
  ["/", "🏠", "Главная"],
  ["/calendar", "📅", "Календарь"],
  ["/invoices", "🧾", "Платежи"],
  ["/budget", "💰", "Бюджет"],
];
const ADMIN = [
  ["/categories", "📂", "Категории"],
  ["/webhooks", "⚙️", "Вебхуки"],
  ["/team", "👥", "Команда"],
  ["/audit", "🔒", "Аудит"],
];

const Logo = () => (
  <Link to="/" className="logo">
    <h1 style={{ fontSize: "inherit" }}>
      Invoice K<span className="logo-accent">é</span>eper
    </h1>
  </Link>
);

function Notifications({ placement }: { placement: "right" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { data, mutate } = useQuery<{ unread: number; items: Notification[] }>(`/notifications?t=${tick}`);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      // unread items stay highlighted while the list is open; the counter resets
      api("/notifications/read", { method: "POST" }).then(() => mutate({ ...data, unread: 0 }));
    }
  };

  const close = () => {
    setOpen(false);
    if (data) mutate({ unread: 0, items: data.items.map((n) => ({ ...n, read: true })) });
  };

  return (
    <>
      <button ref={ref} type="button" className="icon-btn bell" onClick={toggle} data-tip={open ? undefined : "Уведомления"} aria-label="Уведомления">
        🔔
        {!!data?.unread && <span className="bell-count">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
      <Popover anchor={ref} open={open} onClose={close} className="notifs" placement={placement} align="end">
        <div className="notifs-head">
          <span>Уведомления</span>
        </div>
        {data?.items.length ? (
          data.items.map((n) => (
            <button
              type="button"
              key={n.id}
              className={`notif ${n.read ? "" : "unread"}`}
              onClick={() => {
                close();
                if (n.invoice_id) navigate(`/invoices?invoice=${n.invoice_id}${n.occurrence_id ? `&occurrence=${n.occurrence_id}` : ""}`);
              }}
            >
              <span className="grow">{n.text}</span>
              <span className="when">{relativeAgo(n.created_at)}</span>
            </button>
          ))
        ) : (
          <div className="empty">Уведомлений пока нет</div>
        )}
      </Popover>
    </>
  );
}

export default function Nav() {
  const me = useMe();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname, location.search]);

  const link = ([to, icon, label]: string[]) => (
    <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
      <span>{icon}</span>
      {label}
    </NavLink>
  );

  return (
    <>
      <div className="mobile-bar">
        <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Меню">
          ☰
        </button>
        <Logo />
        <Notifications placement="bottom" />
      </div>
      <div className={`backdrop ${open ? "show" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`nav ${open ? "open" : ""}`}>
        <div className="nav-top">
          <Logo />
          {MAIN.map(link)}
        </div>
        <div className="col" style={{ gap: 16 }}>
          {me.is_admin && <div className="nav-admin">{ADMIN.map(link)}</div>}
          <div className="nav-user">
            <div className="nav-user-info">
              <p>{me.name}</p>
              <p className="muted">{me.is_admin ? "Админ" : me.role || "Сотрудник"}</p>
            </div>
            <div className="nav-user-actions">
              <Notifications placement="right" />
              <button
                type="button"
                className="icon-btn"
                data-tip="Выйти"
                aria-label="Выйти"
                onClick={() => logout().then(invalidate)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>
      <Toaster />
    </>
  );
}
