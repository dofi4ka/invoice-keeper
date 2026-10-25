import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { qs, useQuery } from "../api";
import { useMe } from "../auth";
import CreateInvoiceForm from "../components/CreateInvoiceForm";
import InvoiceCard from "../components/InvoiceCard";
import InvoicePanel from "../components/InvoicePanel";
import { MultiSelect } from "../components/Select";
import { CategoryIcon, Emoji, Side } from "../components/ui";
import { CURRENCY_LABEL, CURRENCY_SIGN } from "../lib/format";
import type { CategoryWithSpend, Currency, InvoiceListItem } from "../types";
import { CURRENCIES } from "../types";

type StatusFilter = "upcoming" | "soon" | "overdue" | "paid" | "archived";

function statusKey(i: InvoiceListItem): StatusFilter {
  if (i.archived) return "archived";
  return i.next_occurrence?.status ?? "upcoming";
}

/** Next unpaid period first; paid one-off payments go to the end, archived after them. */
function sortKey(i: InvoiceListItem): string {
  const group = i.archived ? "2" : i.next_occurrence?.is_paid ? "1" : "0";
  return `${group}${i.next_occurrence?.due_date ?? "9999"}${i.name}`;
}

export default function Invoices() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<StatusFilter[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const { data: invoices } = useQuery<InvoiceListItem[]>(`/recurring-payments${qs({ include_archived: me.is_admin })}`);
  const { data: categories } = useQuery<CategoryWithSpend[]>("/categories");

  const selectedId = Number(params.get("invoice")) || null;
  const occurrenceId = Number(params.get("occurrence")) || null;
  const creating = params.get("new") === "1";

  const select = (id: number | null, occ?: number | null) => {
    const next = new URLSearchParams();
    if (id) next.set("invoice", String(id));
    if (id && occ) next.set("occurrence", String(occ));
    setParams(next);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (invoices ?? [])
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.category?.name.toLowerCase().includes(q))
      .filter((i) => !statuses.length || statuses.includes(statusKey(i)))
      .filter((i) => !(statuses.length === 0 && i.archived) || statuses.includes("archived"))
      .filter((i) => !currencies.length || currencies.includes(i.currency))
      .filter((i) => !categoryIds.length || (i.category && categoryIds.includes(i.category.id)))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }, [invoices, query, statuses, currencies, categoryIds]);

  const mine = filtered.filter((i) => i.responsibles.some((u) => u.id === me.id));
  const others = filtered.filter((i) => !i.responsibles.some((u) => u.id === me.id));

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "upcoming", label: "Не оплачен" },
    { value: "soon", label: "Скоро срок" },
    { value: "overdue", label: "Просрочен" },
    { value: "paid", label: "Оплачен" },
  ];
  if (me.is_admin) statusOptions.push({ value: "archived", label: "Заархивирован" });

  const grid = (items: InvoiceListItem[]) => (
    <div className="cards">
      {items.map((i) => (
        <InvoiceCard key={i.id} invoice={i} occurrence={i.next_occurrence} selected={i.id === selectedId} onClick={() => select(i.id, i.next_occurrence?.id)} />
      ))}
    </div>
  );

  return (
    <div className="page">
      <h1>Платежи</h1>
      <div className="split">
        <div className="split-main">
          <div className="toolbar">
            <input className="input search" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
            <MultiSelect label="Статус" values={statuses} onChange={setStatuses} options={statusOptions} />
            <MultiSelect
              label="Валюта"
              values={currencies}
              onChange={setCurrencies}
              options={CURRENCIES.map((c) => ({ value: c, label: `${CURRENCY_SIGN[c]} ${CURRENCY_LABEL[c]}` }))}
            />
            <MultiSelect
              label="Категория"
              values={categoryIds}
              onChange={setCategoryIds}
              searchable
              options={(categories ?? []).map((c) => ({ value: c.id, text: c.name, label: <span className="row"><CategoryIcon icon={c.icon} size={16} />{c.name}</span> }))}
            />
            {me.is_admin && (
              <button type="button" className="btn btn-primary" onClick={() => setParams({ new: "1" })}>
                Добавить
              </button>
            )}
          </div>
          {mine.length > 0 && (
            <>
              <p className="section-label">Мои</p>
              {grid(mine)}
            </>
          )}
          {others.length > 0 && (
            <>
              {mine.length > 0 && <p className="section-label">Все</p>}
              {grid(others)}
            </>
          )}
          {invoices && filtered.length === 0 && <div className="card empty">Платежей не найдено</div>}
        </div>
        <Side open={!!selectedId || creating} onClose={() => select(null)}>
          {creating && me.is_admin ? (
            <CreateInvoiceForm onCreated={(inv) => select(inv.id)} onCancel={() => select(null)} />
          ) : selectedId ? (
            <InvoicePanel invoiceId={selectedId} occurrenceId={occurrenceId} onArchived={() => select(selectedId)} />
          ) : (
            <div className="side-empty"><span><Emoji e="👆" /> Выберите платёж</span></div>
          )}
        </Side>
      </div>
    </div>
  );
}
