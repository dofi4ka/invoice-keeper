import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { qs, useQuery } from "../api";
import { useMe } from "../auth";
import InvoiceCard from "../components/InvoiceCard";
import InvoicePanel from "../components/InvoicePanel";
import Popover from "../components/Popover";
import { CategoryIcon, Emoji, Seg, toast } from "../components/ui";
import { MONTHS, WEEKDAYS, addDays, addTo, complex, iso, longDate, money, rangeTitle, today, type Totals } from "../lib/format";
import type { Occurrence } from "../types";

const ROW_HEIGHT = 20;

function ExportButton({ scope }: { scope: "all" | "mine" }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const httpUrl = `${window.location.origin}/api/v1/calendar/${me.ics_token}/${scope}.ics`;
  const webcal = httpUrl.replace(/^https?:/, "webcal:");
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  return (
    <>
      <button ref={ref} type="button" className="btn" onClick={() => setOpen(!open)}>
        Экспорт
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" className="export-pop">
        <p>Экспортируйте данные по {scope === "mine" ? "своим" : "всем"} инвойсам в любой удобный вам календарь</p>
        <div className="row">
          <a className="btn btn-primary grow" href={google} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            Google Calendar
          </a>
          <button
            type="button"
            className="btn grow"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(httpUrl);
                toast("Ссылка на .ics скопирована");
              } catch {
                window.prompt("Скопируйте ссылку", httpUrl);
              }
              setOpen(false);
            }}
          >
            .ics ссылка
          </button>
        </div>
      </Popover>
    </>
  );
}

export default function CalendarPage() {
  const me = useMe();
  const now = today();
  const [view, setView] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [scope, setScope] = useState<"all" | "mine">(me.is_admin ? "all" : "mine");
  const [range, setRange] = useState<[Date, Date]>([now, now]);
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [selected, setSelected] = useState<{ id: number; invoice_id: number } | null>(null);
  const [capacity, setCapacity] = useState(3);
  const gridRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => {
    const start = addDays(view, -((view.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view]);

  const [from, to] = range[0] <= range[1] ? range : [range[1], range[0]];
  const fetchFrom = days[0] < from ? days[0] : from;
  const fetchTo = days[41] > to ? days[41] : to;
  const { data } = useQuery<Occurrence[]>(
    `/payment-occurrences${qs({ date_from: iso(fetchFrom), date_to: iso(fetchTo), mine: scope === "mine" })}`,
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of data ?? []) {
      const list = map.get(o.due_date) ?? [];
      list.push(o);
      map.set(o.due_date, list);
    }
    return map;
  }, [data]);

  const inRange = (data ?? []).filter((o) => o.due_date >= iso(from) && o.due_date <= iso(to));
  const totals: Totals = {};
  inRange.forEach((o) => addTo(totals, o.invoice.currency, o.amount ?? (o.invoice.amount_type === "fixed" ? o.invoice.amount : null)));

  // how many payments fit into a cell (the rest is shown as "+N")
  useLayoutEffect(() => {
    const el = gridRef.current?.querySelector<HTMLElement>(".cal-cell");
    if (!el) return;
    const measure = () => setCapacity(Math.max(1, Math.floor((el.clientHeight - 30) / ROW_HEIGHT)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const up = () => setAnchor(null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const single = iso(from) === iso(to);
  const title = single ? longDate(from) : rangeTitle(from, to);

  return (
    <div className="page">
      <h1>Календарь</h1>
      <div className="cal-layout">
        <div className="cal-main">
          <div className="cal-controls">
            <button type="button" className="icon-btn" aria-label="Предыдущий месяц" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>
              <Emoji e="⬅️" />
            </button>
            <span className="cal-title">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </span>
            <button type="button" className="icon-btn" aria-label="Следующий месяц" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>
              <Emoji e="➡️" />
            </button>
            <span className="grow" />
            <Seg
              value={scope}
              onChange={setScope}
              options={[
                ["all", "Все"],
                ["mine", "Мои"],
              ]}
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                setView(new Date(now.getFullYear(), now.getMonth(), 1));
                setRange([now, now]);
                setSelected(null);
              }}
            >
              Сегодня
            </button>
            <ExportButton scope={scope} />
          </div>
          <div className="cal-grid" ref={gridRef}>
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-wd">
                {w}
              </div>
            ))}
            {days.map((d) => {
              const key = iso(d);
              const items = byDay.get(key) ?? [];
              const fits = items.length > capacity ? capacity - 1 : capacity;
              const cls = [
                "cal-cell",
                d.getMonth() !== view.getMonth() && "out",
                key === iso(now) && "today",
                key >= iso(from) && key <= iso(to) && "in-range",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={key}
                  className={cls}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setAnchor(d);
                    setRange([d, d]);
                    setSelected(null);
                  }}
                  onPointerEnter={() => anchor && setRange([anchor, d])}
                >
                  <span className="cal-day">{d.getDate()}</span>
                  {items.slice(0, fits).map((o) => (
                    <span key={o.id} className={`cal-pay ${o.status}`} title={`${o.invoice.name} — ${money(o.amount ?? o.invoice.amount, o.invoice.currency)}`}>
                      <CategoryIcon icon={o.invoice.category?.icon} size={13} />
                      <span className="amt">{money(o.amount ?? o.invoice.amount, o.invoice.currency)}</span>
                    </span>
                  ))}
                  {items.length > fits && <span className="cal-more">+{items.length - fits}</span>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="card cal-side">
          {selected ? (
            <>
              <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => setSelected(null)}>
                <Emoji e="⬅️" /> Назад к платежам
              </button>
              <InvoicePanel invoiceId={selected.invoice_id} occurrenceId={selected.id} onArchived={() => setSelected(null)} />
            </>
          ) : (
            <>
              <p className="section-label" style={{ color: "#000", margin: 0 }}>
                {title}
              </p>
              <p className="big-sum">{complex(totals)}</p>
              <div className="cards one">
                {inRange.map((o) => (
                  <InvoiceCard key={o.id} invoice={o.invoice} occurrence={o} onClick={() => setSelected(o)} />
                ))}
              </div>
              {data && inRange.length === 0 && <div className="empty">Инвойсов нет</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
