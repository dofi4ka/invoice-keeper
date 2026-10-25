import type { Currency, Recurrence, Status } from "../types";
import { CURRENCIES } from "../types";

const moneyFormat = new Map<Currency, Intl.NumberFormat>();

export function money(amount: string | number | null | undefined, currency: Currency): string {
  if (amount === null || amount === undefined || amount === "") return "по факту";
  let f = moneyFormat.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    moneyFormat.set(currency, f);
  }
  return f.format(Number(amount));
}

export const CURRENCY_LABEL: Record<Currency, string> = {
  RUB: "Рубли",
  USD: "Доллары",
  EUR: "Евро",
};
export const CURRENCY_SIGN: Record<Currency, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
};

export type Totals = Partial<Record<Currency, number>>;

export function addTo(
  totals: Totals,
  currency: Currency,
  amount: string | number | null | undefined,
) {
  if (amount === null || amount === undefined) return;
  totals[currency] = (totals[currency] ?? 0) + Number(amount);
}

/** Sums in different currencies are never mixed: "47 $ + 85 ₽", like a complex number. */
export function complex(totals: Totals, empty = "0 ₽"): string {
  const parts = CURRENCIES.filter((c) => totals[c]).map((c) => money(totals[c]!, c));
  return parts.length ? parts.join(" + ") : empty;
}

// --- dates (ISO yyyy-mm-dd strings are treated as plain calendar dates) ---

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function iso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function addMonths(anchor: Date, months: number): Date {
  const total = anchor.getFullYear() * 12 + anchor.getMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  return new Date(year, month, Math.min(anchor.getDate(), daysInMonth(year, month)));
}

export function dmy(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? parseDate(value) : value;
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

export const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
export const MONTHS_GEN = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
export const MONTHS_SHORT = [
  "янв.",
  "фев.",
  "мар.",
  "апр.",
  "мая",
  "июн.",
  "июл.",
  "авг.",
  "сен.",
  "окт.",
  "нояб.",
  "дек.",
];
export const MONTHS_TICK = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];
export const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** "26 окт." */
export function shortDate(value: string | Date): string {
  const date = typeof value === "string" ? parseDate(value) : value;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** "23 октября" */
export function longDate(value: Date): string {
  return `${value.getDate()} ${MONTHS_GEN[value.getMonth()]}`;
}

/** "с 23 по 30 октября" / "с 28 октября по 3 ноября" */
export function rangeTitle(a: Date, b: Date): string {
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `с ${a.getDate()} по ${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`;
  }
  return `с ${longDate(a)} по ${longDate(b)}`;
}

export function dateTime(value: string): string {
  const d = new Date(value);
  return `${dmy(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a % 10 === 1 && a % 100 !== 11) return one;
  if (a % 10 >= 2 && a % 10 <= 4 && !(a % 100 >= 12 && a % 100 <= 14)) return few;
  return many;
}

export function relativeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  return dmy(new Date(value));
}

// --- recurrence (same rules as the backend: every period is counted from the anchor) ---

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  monthly: "Каждый месяц",
  days30: "Каждые 30 дней",
  quarterly: "Каждый квартал",
  yearly: "Каждый год",
  once: "Один раз",
};

export const RECURRENCE_HINT: Record<Recurrence, string> = {
  monthly: "Следующая оплата выпадает на этот же или последний день следующего месяца",
  days30: "Следующая оплата через 30 дней, независимо от того, сколько дней в месяце",
  quarterly: "Следующая оплата через три месяца в тот же или последний день месяца",
  yearly: "Следующая оплата через год в тот же или последний день месяца",
  once: "Разовый платёж без повторений",
};

const MONTH_STEP: Partial<Record<Recurrence, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

export function dueDate(anchor: Date, recurrence: Recurrence, seq: number): Date {
  if (recurrence === "days30") return addDays(anchor, 30 * seq);
  if (recurrence === "once") return anchor;
  return addMonths(anchor, MONTH_STEP[recurrence]! * seq);
}

/** How many periods are already due before today (they are stored as paid on creation). */
export function pastPeriods(anchor: Date, recurrence: Recurrence): number {
  const t = today();
  let n = 0;
  while (dueDate(anchor, recurrence, n) < t) {
    n += 1;
    if (recurrence === "once" || n > 1000) break;
  }
  return n;
}

// --- statuses ---

export const REMINDER_DAYS = 3;

export function statusOf(isPaid: boolean, due: string): Status {
  if (isPaid) return "paid";
  const delta = diffDays(parseDate(due), today());
  if (delta < 0) return "overdue";
  if (delta <= REMINDER_DAYS) return "soon";
  return "upcoming";
}

export const STATUS_LABEL: Record<Status, string> = {
  paid: "Оплачен",
  overdue: "Просрочен",
  soon: "Скоро срок",
  upcoming: "Не оплачен",
};

/** Right-hand hint of an invoice card. */
export function dueHint(isPaid: boolean, due: string, paidAt: string | null): string {
  if (isPaid) return paidAt ? `Оплачен ${shortDate(paidAt)}` : "Оплачен";
  const delta = diffDays(parseDate(due), today());
  if (delta < 0) return `Просрочен на ${-delta} д.`;
  if (delta === 0) return "Сегодня";
  if (delta === 1) return "Завтра";
  return `Через ${delta} ${plural(delta, "день", "дня", "дней")}`;
}

export function periodTitle(recurrence: Recurrence, due: string): string {
  const d = parseDate(due);
  switch (recurrence) {
    case "monthly":
      return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    case "quarterly":
      return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    case "yearly":
      return `${d.getFullYear()} год`;
    case "days30":
      return `${longDate(d)} ${d.getFullYear()}`;
    case "once":
      return "Единственный платёж";
  }
}
