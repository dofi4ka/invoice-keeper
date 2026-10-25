export type Currency = "RUB" | "USD" | "EUR";
export type Recurrence = "monthly" | "days30" | "quarterly" | "yearly" | "once";
export type AmountType = "fixed" | "actual";
export type Status = "paid" | "overdue" | "soon" | "upcoming";

export const CURRENCIES: Currency[] = ["RUB", "USD", "EUR"];

export interface User {
  id: number;
  name: string;
  role: string | null;
  email: string;
  telegram_id: number | null;
  is_admin: boolean;
}

export interface Me extends User {
  ics_token: string;
}

export interface Category {
  id: number;
  name: string;
  icon: string | null;
}

export interface CategoryWithSpend extends Category {
  last_month: Partial<Record<Currency, string>>;
}

export interface Invoice {
  id: number;
  name: string;
  currency: Currency;
  amount_type: AmountType;
  amount: string | null;
  recurrence: Recurrence;
  start_date: string;
  link: string | null;
  archived: boolean;
  category: Category | null;
  responsibles: User[];
}

export interface OccurrenceBrief {
  id: number;
  due_date: string;
  amount: string | null;
  is_paid: boolean;
  paid_at: string | null;
  status: Status;
}

export interface InvoiceListItem extends Invoice {
  next_occurrence: OccurrenceBrief | null;
}

export interface Occurrence extends OccurrenceBrief {
  invoice_id: number;
  invoice: Invoice;
  receipt_name: string | null;
  receipt_comment: string | null;
  reminder_sent_at: string | null;
  reminder_at: string;
  paid_by: string | null;
}

export interface Notification {
  id: number;
  kind: string;
  text: string;
  invoice_id: number | null;
  occurrence_id: number | null;
  created_at: string;
  read: boolean;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  method: string;
  events: string[];
  headers: { name: string; value: string }[];
  auth_type: "none" | "basic" | "bearer" | "header";
  auth: Record<string, string>;
  content_type: string;
  body_template: string;
  enabled: boolean;
  last_status: number | null;
  last_error: string | null;
  last_sent_at: string | null;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  actor_id: number | null;
  actor_name: string;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  summary: string;
  ip: string | null;
}

export interface Budget {
  year: number;
  month: number;
  currency: Currency;
  amount: string;
}

export interface Rates {
  date: string | null;
  source: string;
  rub_per_unit: Record<Currency, number>;
}
