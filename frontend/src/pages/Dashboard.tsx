import type { ChartOptions } from "chart.js";
import { useCallback, useMemo, useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import { Link, useNavigate } from "react-router-dom";
import { qs, useQuery } from "../api";
import { useMe } from "../auth";
import { CURRENCY_COLOR, CURRENCY_FILL, legendBottom, tooltipStyle } from "../components/charts";
import InvoiceCard from "../components/InvoiceCard";
import { Emoji, Seg, Stepper } from "../components/ui";
import { MONTHS, MONTHS_TICK, addDays, iso, money, parseDate, today } from "../lib/format";
import type { Currency, Occurrence, Rates } from "../types";
import { CURRENCIES } from "../types";

const UPCOMING_LIMIT = 6;

type Raw = Record<Currency, number[]>;

function useRange(mode: "year" | "quarter", year: number, quarter: number) {
  const firstMonth = mode === "year" ? 0 : (quarter - 1) * 3;
  const months = mode === "year" ? 12 : 3;
  return {
    firstMonth,
    months,
    from: iso(new Date(year, firstMonth, 1)),
    to: iso(new Date(year, firstMonth + months, 0)),
  };
}

function Charts({
  occurrences,
  rates,
  firstMonth,
  months,
}: {
  occurrences: Occurrence[];
  rates: Rates | undefined;
  firstMonth: number;
  months: number;
}) {
  const rate = useCallback((c: Currency) => rates?.rub_per_unit[c] ?? 1, [rates]);

  const monthly = useMemo(() => {
    const raw: Raw = {
      RUB: Array(months).fill(0),
      USD: Array(months).fill(0),
      EUR: Array(months).fill(0),
    };
    for (const o of occurrences) {
      if (o.amount === null) continue;
      const m = parseDate(o.due_date).getMonth() - firstMonth;
      if (m >= 0 && m < months) raw[o.invoice.currency][m] += Number(o.amount);
    }
    return raw;
  }, [occurrences, firstMonth, months]);

  const byCategory = useMemo(() => {
    const map = new Map<string, Record<Currency, number>>();
    for (const o of occurrences) {
      if (o.amount === null) continue;
      const name = o.invoice.category?.name ?? "Без категории";
      const row = map.get(name) ?? { RUB: 0, USD: 0, EUR: 0 };
      row[o.invoice.currency] += Number(o.amount);
      map.set(name, row);
    }
    const total = (r: Record<Currency, number>) =>
      CURRENCIES.reduce((s, c) => s + r[c] * rate(c), 0);
    return [...map.entries()].sort((a, b) => total(b[1]) - total(a[1]));
  }, [occurrences, rate]);

  const originalLabel =
    (raw: (c: Currency, i: number) => number) =>
    (item: { datasetIndex: number; dataIndex: number }) => {
      const c = CURRENCIES[item.datasetIndex];
      return ` ${c}: ${money(raw(c, item.dataIndex), c)}`;
    };

  const lineData = {
    labels: Array.from({ length: months }, (_, i) =>
      months === 12 ? MONTHS_TICK[firstMonth + i] : MONTHS[firstMonth + i],
    ),
    datasets: CURRENCIES.map((c) => ({
      label: c,
      data: monthly[c].map((v) => v * rate(c)),
      borderColor: CURRENCY_COLOR[c],
      backgroundColor: CURRENCY_FILL[c],
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2,
    })),
  };

  const lineOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: legendBottom,
      tooltip: {
        ...tooltipStyle,
        callbacks: { label: originalLabel((c, i) => monthly[c][i]) },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        stacked: true,
        beginAtZero: true,
        border: { display: false },
        ticks: { callback: (v) => money(Number(v), "RUB") },
      },
    },
  };

  const barData = {
    labels: byCategory.map(([name]) => name),
    datasets: CURRENCIES.map((c) => ({
      label: c,
      data: byCategory.map(([, row]) => (row[c] ? row[c] * rate(c) : null)),
      backgroundColor: CURRENCY_COLOR[c],
      borderRadius: 4,
      maxBarThickness: 44,
    })),
  };

  const barOptions: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: legendBottom,
      tooltip: {
        ...tooltipStyle,
        filter: (item) => item.raw !== null,
        callbacks: { label: originalLabel((c, i) => byCategory[i][1][c]) },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: {
        type: "logarithmic",
        stacked: true,
        border: { display: false },
        ticks: {
          callback: (v) => {
            const n = Number(v);
            return /^(1|2|5)0*$/.test(String(Math.round(n))) ? money(n, "RUB") : "";
          },
        },
      },
    },
  };

  return (
    <div className="charts">
      <div className="card col" style={{ gap: 12 }}>
        <h2 data-tip="Суммы платежей по сроку оплаты; валюты приведены к рублю по курсу ЦБ РФ только для масштаба">
          Расходы по месяцам
        </h2>
        <div className="chart-box">
          <Line data={lineData} options={lineOptions} />
        </div>
      </div>
      <div className="card col" style={{ gap: 12 }}>
        <h2 data-tip="Логарифмическая шкала; в подсказке — исходная сумма и валюта">
          Расходы по категориям
        </h2>
        <div className="chart-box">
          {byCategory.length ? (
            <Bar data={barData} options={barOptions} />
          ) : (
            <div className="empty">Нет данных за период</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const me = useMe();
  const navigate = useNavigate();
  const now = today();
  const [mode, setMode] = useState<"year" | "quarter">("year");
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [scope, setScope] = useState<"all" | "mine">(me.is_admin ? "all" : "mine");
  const range = useRange(mode, year, quarter);

  const { data: occurrences } = useQuery<Occurrence[]>(
    `/payment-occurrences${qs({ date_from: range.from, date_to: range.to })}`,
  );
  const { data: rates } = useQuery<Rates>("/rates");
  const { data: upcoming } = useQuery<Occurrence[]>(
    `/payment-occurrences${qs({ status: ["overdue", "soon", "upcoming"], date_to: iso(addDays(now, 30)), mine: scope === "mine" })}`,
  );

  const step = (dir: number) => {
    if (mode === "year") return setYear(year + dir);
    const q = quarter + dir;
    if (q < 1) {
      setQuarter(4);
      setYear(year - 1);
    } else if (q > 4) {
      setQuarter(1);
      setYear(year + 1);
    } else setQuarter(q);
  };

  const list = (upcoming ?? []).slice(0, UPCOMING_LIMIT);

  return (
    <div className="page">
      <h1>Главная</h1>
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <Stepper
            value={mode === "year" ? year : `Q${quarter} ${year}`}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
          />
          <Seg
            value={mode}
            onChange={setMode}
            options={[
              ["year", "Год"],
              ["quarter", "Квартал"],
            ]}
          />
        </div>
        <Charts
          occurrences={occurrences ?? []}
          rates={rates}
          firstMonth={range.firstMonth}
          months={range.months}
        />
      </div>
      <div className="col upcoming" style={{ gap: 12 }}>
        <div
          className="row"
          data-tip="Просроченные и неоплаченные платежи со сроком в ближайшие 30 дней"
          style={{ width: "fit-content" }}
        >
          <Seg
            value={scope}
            onChange={setScope}
            options={[
              ["all", "Все"],
              ["mine", "Мои"],
            ]}
          />
        </div>
        <div className="cards two">
          {list.map((o) => (
            <InvoiceCard
              key={o.id}
              invoice={o.invoice}
              occurrence={o}
              onClick={() => navigate(`/invoices?invoice=${o.invoice_id}&occurrence=${o.id}`)}
            />
          ))}
        </div>
        {upcoming && list.length === 0 && (
          <div className="card empty">
            Ближайших платежей нет <Emoji e="🎉" />
          </div>
        )}
        <Link to="/calendar" className="link-btn">
          Открыть календарь →
        </Link>
      </div>
    </div>
  );
}
