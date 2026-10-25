import { useMemo, useState } from "react";
import { api, invalidate, qs, useQuery } from "../api";
import { useMe } from "../auth";
import { Stepper, toast } from "../components/ui";
import { CURRENCY_SIGN, MONTHS, MONTHS_TICK, money, parseDate, today } from "../lib/format";
import type { Budget as BudgetRow, Currency, Occurrence } from "../types";
import { CURRENCIES } from "../types";

interface Cell {
  paid: number;
  planned: number;
}

type Usage = Record<Currency, Cell[]>; // index 0 — the whole year, 1..12 — months

function emptyUsage(): Usage {
  const make = () => Array.from({ length: 13 }, () => ({ paid: 0, planned: 0 }));
  return { RUB: make(), USD: make(), EUR: make() };
}

function BudgetValue({ year, month, currency, amount, editable }: { year: number; month: number; currency: Currency; amount: number | null; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const save = async () => {
    setEditing(false);
    const v = value.replace(/\s/g, "").replace(",", ".");
    if ((v === "" && amount === null) || Number(v) === amount) return;
    try {
      await api("/budgets", { method: "PUT", json: { year, month, currency, amount: v === "" ? null : v } });
      invalidate();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (editing) {
    return (
      <span className="budget-input">
        <input
          className="input compact"
          autoFocus
          inputMode="decimal"
          value={value}
          placeholder={`0 ${CURRENCY_SIGN[currency]}`}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </span>
    );
  }
  const text = amount === null ? "Бюджет не задан" : money(amount, currency);
  if (!editable) return <span className={amount === null ? "muted" : ""}>{text}</span>;
  return (
    <button
      type="button"
      className="link-btn"
      style={{ color: amount === null ? undefined : "#000", fontWeight: 600 }}
      data-tip="Нажмите, чтобы изменить бюджет"
      onClick={() => {
        setValue(amount === null ? "" : String(amount));
        setEditing(true);
      }}
    >
      {amount === null ? "Задать бюджет" : text} ✎
    </button>
  );
}

function MoneyLine({ currency, budget, cell, year, month, editable, big }: { currency: Currency; budget: number | null; cell: Cell; year: number; month: number; editable: boolean; big?: boolean }) {
  const used = cell.paid + cell.planned;
  const base = Math.max(budget ?? 0, used, 1);
  const left = budget === null ? null : budget - used;
  const over = left !== null && left < 0;
  return (
    <div className="money-line">
      <div className="money-head">
        <span className={big ? "money-big" : ""} style={{ fontWeight: 600 }}>
          <BudgetValue year={year} month={month} currency={currency} amount={budget} editable={editable} />
        </span>
        {left !== null && (
          <span
            style={{ color: over ? "var(--orange-ink)" : "var(--muted)", fontWeight: over ? 600 : 400, whiteSpace: "nowrap" }}
            data-tip="Бюджет минус оплаченные и запланированные платежи"
          >
            {over ? "Перерасход " : "Осталось "}
            {money(Math.abs(left), currency)}
          </span>
        )}
      </div>
      <div className={`bar ${over ? "over" : ""}`} data-tip={`Оплачено ${money(cell.paid, currency)} · запланировано ${money(cell.planned, currency)}`}>
        <span className="spent" style={{ width: `${(cell.paid / base) * 100}%` }} />
        <span className="planned" style={{ width: `${(cell.planned / base) * 100}%` }} />
      </div>
      <small>
        <span className="legend-dot" style={{ background: "#000" }} />
        {money(cell.paid, currency)}
        <span className="legend-dot" style={{ background: "var(--accent)", marginLeft: 10 }} />
        {money(cell.planned, currency)}
      </small>
    </div>
  );
}

export default function Budget() {
  const me = useMe();
  const now = today();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const { data: budgets } = useQuery<BudgetRow[]>(`/budgets${qs({ year })}`);
  const { data: occurrences } = useQuery<Occurrence[]>(`/payment-occurrences${qs({ date_from: `${year}-01-01`, date_to: `${year}-12-31` })}`);

  const usage = useMemo(() => {
    const u = emptyUsage();
    for (const o of occurrences ?? []) {
      const amount = o.amount ?? (o.invoice.amount_type === "fixed" ? o.invoice.amount : null);
      if (amount === null) continue;
      const m = parseDate(o.due_date).getMonth() + 1;
      const key = o.is_paid ? "paid" : "planned";
      u[o.invoice.currency][m][key] += Number(amount);
      u[o.invoice.currency][0][key] += Number(amount);
    }
    return u;
  }, [occurrences]);

  const budgetOf = (month: number, currency: Currency) => {
    const b = budgets?.find((x) => x.month === month && x.currency === currency);
    return b ? Number(b.amount) : null;
  };

  const stepQuarter = (dir: number) => {
    const q = quarter + dir;
    if (q < 1) {
      setQuarter(4);
      setYear(year - 1);
    } else if (q > 4) {
      setQuarter(1);
      setYear(year + 1);
    } else setQuarter(q);
  };

  const editable = me.is_admin;
  const quarterMonths = [0, 1, 2].map((i) => (quarter - 1) * 3 + i + 1);

  return (
    <div className="page">
      <h1>Бюджет</h1>
      <div className="card budget-overview">
        <div className="budget-grid">
          <span />
          {MONTHS_TICK.map((m, i) => (
            <span
              key={m}
              className={`head ${year === now.getFullYear() && i === now.getMonth() ? "current" : ""}`}
              onClick={() => setQuarter(Math.floor(i / 3) + 1)}
            >
              {m}
            </span>
          ))}
          {CURRENCIES.map((c) => (
            <Row key={c} currency={c} usage={usage[c]} budgetOf={(m) => budgetOf(m, c)} onPick={(m) => setQuarter(Math.floor((m - 1) / 3) + 1)} />
          ))}
        </div>
      </div>

      <div className="col" style={{ gap: 10 }}>
        <Stepper value={year} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} tip="Бюджет на год" />
        <div className="budget-row">
          {CURRENCIES.map((c) => (
            <div className="card budget-card" key={c}>
              <MoneyLine currency={c} budget={budgetOf(0, c)} cell={usage[c][0]} year={year} month={0} editable={editable} big />
            </div>
          ))}
        </div>
      </div>

      <div className="col" style={{ gap: 10 }}>
        <Stepper value={`Q${quarter}`} onPrev={() => stepQuarter(-1)} onNext={() => stepQuarter(1)} tip={`Бюджет на квартал, ${year}`} />
        <div className="budget-row">
          {quarterMonths.map((m) => (
            <div className="card budget-card" key={m}>
              <h2>{MONTHS[m - 1]}</h2>
              {CURRENCIES.map((c) => (
                <MoneyLine key={c} currency={c} budget={budgetOf(m, c)} cell={usage[c][m]} year={year} month={m} editable={editable} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One currency across the 12 months: how much of each monthly budget is used. */
function Row({ currency, usage, budgetOf, onPick }: { currency: Currency; usage: Cell[]; budgetOf: (m: number) => number | null; onPick: (m: number) => void }) {
  return (
    <>
      <span className="cur">{CURRENCY_SIGN[currency]}</span>
      {Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const budget = budgetOf(m);
        const cell = usage[m];
        const used = cell.paid + cell.planned;
        const tip = `${MONTHS[i]}: бюджет ${budget === null ? "не задан" : money(budget, currency)}, оплачено ${money(cell.paid, currency)}, запланировано ${money(cell.planned, currency)}`;
        if (budget === null || budget === 0) {
          return (
            <div key={m} className="heat none" data-tip={tip} onClick={() => onPick(m)}>
              <span className="pct muted">{used ? money(used, currency).replace(/\s?[₽$€]/, "") : "—"}</span>
            </div>
          );
        }
        const paidPct = Math.min(100, (cell.paid / budget) * 100);
        const plannedPct = Math.min(100 - paidPct, (cell.planned / budget) * 100);
        const pct = Math.round((used / budget) * 100);
        return (
          <div key={m} className={`heat ${pct > 100 ? "over" : ""}`} data-tip={tip} onClick={() => onPick(m)}>
            <span className="fill" style={{ height: `${paidPct}%` }} />
            <span className="fill planned" style={{ height: `${plannedPct}%`, bottom: `${paidPct}%` }} />
            <span className="pct">{pct}%</span>
          </div>
        );
      })}
    </>
  );
}
