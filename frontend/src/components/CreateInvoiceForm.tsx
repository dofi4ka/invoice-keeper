import { useState } from "react";
import { api, invalidate, useQuery } from "../api";
import { CURRENCY_LABEL, CURRENCY_SIGN, RECURRENCE_HINT, RECURRENCE_LABEL, parseDate, pastPeriods, plural } from "../lib/format";
import type { AmountType, CategoryWithSpend, Currency, Invoice, Recurrence } from "../types";
import { CURRENCIES } from "../types";
import DateInput from "./DateInput";
import { Select } from "./Select";
import { CategoryIcon, Kv, toast } from "./ui";

const RECURRENCES: Recurrence[] = ["monthly", "days30", "quarterly", "yearly", "once"];

/** CreateInvoiceForm.html */
export default function CreateInvoiceForm({ onCreated, onCancel }: { onCreated: (invoice: Invoice) => void; onCancel: () => void }) {
  const { data: categories } = useQuery<CategoryWithSpend[]>("/categories");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("RUB");
  const [amountType, setAmountType] = useState<AmountType>("fixed");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<Recurrence>("monthly");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const past = startDate ? pastPeriods(parseDate(startDate), recurrence) : 0;
  const normalizedAmount = amount.replace(/\s/g, "").replace(",", ".");

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Укажите название");
    if (amountType === "fixed" && !(Number(normalizedAmount) > 0)) return setError("Укажите сумму");
    if (!startDate) return setError("Укажите дату следующей оплаты");
    setBusy(true);
    try {
      const invoice = await api<Invoice>("/recurring-payments", {
        method: "POST",
        json: {
          name: name.trim(),
          currency,
          amount_type: amountType,
          amount: amountType === "fixed" ? normalizedAmount : null,
          category_id: categoryId,
          start_date: startDate,
          recurrence,
          link: link.trim() || null,
        },
      });
      toast("Платёж создан");
      invalidate();
      onCreated(invoice);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Kv label="Название">
        <input className="input" placeholder="Аренда Офиса" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Kv>
      <Kv label="Валюта">
        <Select value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: CURRENCY_LABEL[c], sub: CURRENCY_SIGN[c] }))} />
      </Kv>
      <Kv label="Тип суммы" tip="«По факту» — сумму вводят за каждый период отдельно">
        <Select
          value={amountType}
          onChange={setAmountType}
          options={[
            { value: "fixed", label: "Фиксированная" },
            { value: "actual", label: "По факту" },
          ]}
        />
      </Kv>
      {amountType === "fixed" && (
        <Kv label="Сумма">
          <input
            className="input"
            placeholder={`65 000 ${CURRENCY_SIGN[currency]}`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Kv>
      )}
      <Kv label="Категория">
        <Select
          clearable
          placeholder="Без категории"
          value={categoryId}
          onChange={setCategoryId}
          onClear={() => setCategoryId(null)}
          options={(categories ?? []).map((c) => ({ value: c.id, label: <span className="row"><CategoryIcon icon={c.icon} size={16} />{c.name}</span> }))}
        />
      </Kv>
      <Kv label="Дата следующей оплаты">
        <DateInput value={startDate} onChange={setStartDate} placeholder="26.10.2026" />
      </Kv>
      {past > 0 && (
        <small>
          Прошедшие {past} {plural(past, "срок", "срока", "сроков")} оплаты будут добавлены как оплаченные
        </small>
      )}
      <Kv label="Регулярность">
        <Select value={recurrence} onChange={setRecurrence} options={RECURRENCES.map((r) => ({ value: r, label: RECURRENCE_LABEL[r] }))} />
      </Kv>
      <small>{RECURRENCE_HINT[recurrence]}</small>
      <Kv label="Ссылка на оплату">
        <input className="input" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
      </Kv>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Создать
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
