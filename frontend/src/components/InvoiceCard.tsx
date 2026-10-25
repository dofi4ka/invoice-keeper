import { dueHint, money, shortDate } from "../lib/format";
import type { Invoice, OccurrenceBrief } from "../types";
import { CategoryIcon } from "./ui";

interface Props {
  invoice: Invoice;
  occurrence: OccurrenceBrief | null;
  selected?: boolean;
  onClick?: () => void;
}

/** Paid cards are not colored; overdue ones are orange, due within 3 days — yellow. */
export default function InvoiceCard({ invoice, occurrence: occ, selected, onClick }: Props) {
  const status = invoice.archived ? "archived" : occ?.status ?? "upcoming";
  const amount = occ?.amount ?? (invoice.amount_type === "fixed" ? invoice.amount : null);
  return (
    <button type="button" className={`inv-card ${status} ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="inv-amount">
        <CategoryIcon icon={invoice.category?.icon} />
        <span>{money(amount, invoice.currency)}</span>
      </div>
      <div className="inv-name" title={invoice.name}>
        {invoice.name}
      </div>
      <div className="inv-meta">
        <span>{occ ? `Срок ${shortDate(occ.due_date)}` : "—"}</span>
        {invoice.archived ? (
          <span className="inv-hint">Заархивирован</span>
        ) : (
          occ && <span className={`inv-hint ${occ.is_paid ? "paid" : ""}`}>{dueHint(occ.is_paid, occ.due_date, occ.paid_at)}</span>
        )}
      </div>
    </button>
  );
}
