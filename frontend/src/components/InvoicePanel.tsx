import { useEffect, useMemo, useRef, useState } from "react";
import { api, invalidate, useQuery } from "../api";
import { useMe } from "../auth";
import { CURRENCY_SIGN, RECURRENCE_LABEL, dmy, iso, money, periodTitle, plural, today } from "../lib/format";
import type { CategoryWithSpend, Invoice, Occurrence, User } from "../types";
import DateInput from "./DateInput";
import Popover from "./Popover";
import { Select } from "./Select";
import { CategoryIcon, Kv, toast } from "./ui";

const STATUS_TEXT = { paid: "Оплачено", overdue: "Просрочено", soon: "Не оплачено", upcoming: "Не оплачено" } as const;

function reminderText(occ: Occurrence): string {
  if (occ.reminder_sent_at) return "Отправлено";
  if (occ.is_paid) return "Не требуется";
  const at = new Date(occ.reminder_at);
  const ms = at.getTime() - Date.now();
  if (ms <= 0) return occ.status === "overdue" ? "Не отправлялось" : "Отправляется";
  const days = Math.floor(ms / 86400000);
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  if (days === 0) return `Сегодня в ${time}`;
  return `Через ${days} ${plural(days, "день", "дня", "дней")}`;
}

function AmountInput({ invoice }: { invoice: Invoice }) {
  const [value, setValue] = useState(invoice.amount ?? "");
  useEffect(() => setValue(invoice.amount ? String(Number(invoice.amount)) : ""), [invoice.amount]);
  const save = async () => {
    const amount = value.replace(/\s/g, "").replace(",", ".");
    if (!amount || Number(amount) === Number(invoice.amount)) return setValue(invoice.amount ? String(Number(invoice.amount)) : "");
    try {
      await api(`/recurring-payments/${invoice.id}`, { method: "PATCH", json: { amount } });
      toast("Цена обновлена для неоплаченных периодов");
      invalidate();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="row" data-tip="Новая цена применяется к неоплаченным периодам; оплаченные остаются в истории со старой ценой">
      <input
        className="input compact inv-price"
        style={{ height: 44, fontSize: 24 }}
        value={value}
        inputMode="decimal"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="inv-price">{CURRENCY_SIGN[invoice.currency]}</span>
    </div>
  );
}

function Responsibles({ invoice, isAdmin }: { invoice: Invoice; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { data: users } = useQuery<User[]>(isAdmin ? "/users" : null);
  const ids = invoice.responsibles.map((u) => u.id);
  const save = async (next: number[]) => {
    try {
      await api(`/recurring-payments/${invoice.id}`, { method: "PATCH", json: { responsible_ids: next } });
      invalidate();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const candidates = (users ?? []).filter((u) => !ids.includes(u.id));
  return (
    <div className="col">
      <div className="kv">
        <p data-tip="Ответственным дополнительно приходят уведомления на почту">Ответственные</p>
        {isAdmin && !invoice.archived ? (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button ref={ref} type="button" className="btn btn-sm" onClick={() => setOpen(!open)} disabled={!candidates.length && !!users}>
              Добавить
            </button>
            <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end">
              {candidates.map((u) => (
                <button
                  type="button"
                  key={u.id}
                  className="option"
                  onClick={() => {
                    setOpen(false);
                    save([...ids, u.id]);
                  }}
                >
                  <span className="grow">{u.name}</span>
                  <span className="option-sub">{u.is_admin ? "Админ" : u.role}</span>
                </button>
              ))}
            </Popover>
          </div>
        ) : (
          <span />
        )}
      </div>
      {invoice.responsibles.length > 0 && (
        <div className="people">
          {invoice.responsibles.map((u) => (
            <div className="person" key={u.id}>
              <div className="grow">
                <p>{u.name}</p>
                <p>{u.email}</p>
              </div>
              {isAdmin && !invoice.archived && (
                <button type="button" className="icon-btn" aria-label="Убрать" onClick={() => save(ids.filter((x) => x !== u.id))}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Period({ occ, archived }: { occ: Occurrence; archived: boolean }) {
  const [draftDate, setDraftDate] = useState<string | null>(occ.paid_at);
  const [amount, setAmount] = useState(occ.amount ? String(Number(occ.amount)) : "");
  const [comment, setComment] = useState(occ.receipt_comment ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftDate(occ.paid_at);
    setAmount(occ.amount ? String(Number(occ.amount)) : "");
    setComment(occ.receipt_comment ?? "");
  }, [occ]);

  const patch = async (body: Record<string, unknown>, message?: string) => {
    setBusy(true);
    try {
      await api(`/payment-occurrences/${occ.id}`, { method: "PATCH", json: body });
      if (message) toast(message);
      invalidate();
    } catch (e) {
      toast((e as Error).message);
      setDraftDate(occ.paid_at);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      await api(`/payment-occurrences/${occ.id}/receipt`, { method: "POST", body: form });
      toast("Чек загружен");
      invalidate();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const needsAmount = occ.invoice.amount_type === "actual" && !occ.amount;
  const confirmTip = needsAmount ? "Сначала укажите сумму за период" : undefined;
  const confirmPaid = () => {
    const paidAt = draftDate ?? iso(today());
    setDraftDate(paidAt);
    patch({ is_paid: true, paid_at: paidAt }, "Оплата подтверждена");
  };

  return (
    <>
      <Kv label="Срок оплаты">{dmy(occ.due_date)}</Kv>
      <Kv label="Статус">
        <span className={`pill ${occ.status}`}>
          {STATUS_TEXT[occ.status]}
          {occ.is_paid && occ.paid_at && occ.paid_at > occ.due_date ? " с опозданием" : ""}
        </span>
      </Kv>
      {occ.invoice.amount_type === "actual" && (
        <Kv label="Сумма" tip="Платёж «по факту»: сумма вводится за каждый период">
          <input
            className="input compact"
            value={amount}
            placeholder={`0 ${CURRENCY_SIGN[occ.invoice.currency]}`}
            inputMode="decimal"
            disabled={archived}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => {
              const v = amount.replace(/\s/g, "").replace(",", ".");
              if (v && Number(v) !== Number(occ.amount)) patch({ amount: v });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </Kv>
      )}
      <Kv label="Дата оплаты" tip="Дату можно исправить и после оплаты — просрочка пересчитается">
        <DateInput
          compact
          value={draftDate}
          placeholder="-"
          max={iso(today())}
          disabled={archived || busy}
          clearable={occ.is_paid}
          onChange={(v) => {
            setDraftDate(v);
            if (occ.is_paid) patch(v ? { paid_at: v } : { is_paid: false }, v ? "Дата оплаты исправлена" : "Оплата отменена");
          }}
        />
      </Kv>
      <Kv label="Загрузить чек">
        <div className="file-pick">
          {occ.receipt_name ? (
            <>
              <a href={`/api/v1/payment-occurrences/${occ.id}/receipt`} target="_blank" rel="noreferrer" title={occ.receipt_name}>
                {occ.receipt_name}
              </a>
              <button
                type="button"
                className="icon-btn"
                aria-label="Удалить чек"
                disabled={busy}
                onClick={() => api(`/payment-occurrences/${occ.id}/receipt`, { method: "DELETE" }).then(invalidate)}
              >
                ✕
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              Выбрать файл
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </div>
      </Kv>
      <Kv label="Комментарий к чеку">
        <input
          className="input compact"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onBlur={() => comment !== (occ.receipt_comment ?? "") && patch({ receipt_comment: comment })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </Kv>
      {!archived &&
        (occ.is_paid ? (
          <button type="button" className="btn btn-success btn-block" disabled={busy} onClick={() => patch({ is_paid: false }, "Оплата отменена")}>
            ✓ Оплачено · Отменить оплату
          </button>
        ) : (
          <span data-tip={confirmTip} style={{ display: "block" }}>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!!confirmTip || busy}
              onClick={confirmPaid}
            >
              Подтвердить оплату
            </button>
          </span>
        ))}
      <Kv label="Напоминание" tip="Напоминание приходит в Telegram за 3 дня до срока">
        {reminderText(occ)}
      </Kv>
    </>
  );
}

interface Props {
  invoiceId: number;
  occurrenceId?: number | null;
  onArchived?: () => void;
}

/** Invoice.html — details of a recurring payment and one of its periods. */
export default function InvoicePanel({ invoiceId, occurrenceId, onArchived }: Props) {
  const me = useMe();
  const isAdmin = me.is_admin;
  const { data: invoice, error } = useQuery<Invoice>(`/recurring-payments/${invoiceId}`);
  const { data: occurrences } = useQuery<Occurrence[]>(`/recurring-payments/${invoiceId}/occurrences`);
  const { data: categories } = useQuery<CategoryWithSpend[]>(isAdmin ? "/categories" : null);
  // the shown period is pinned by id, so paying it does not jump to the next unpaid one
  const [pinnedId, setPinnedId] = useState<number | null>(null);

  const initial = useMemo(() => {
    if (!occurrences?.length) return 0;
    const byId = occurrenceId ? occurrences.findIndex((o) => o.id === occurrenceId) : -1;
    if (byId >= 0) return byId;
    const unpaid = occurrences.findIndex((o) => !o.is_paid);
    return unpaid >= 0 ? unpaid : occurrences.length - 1;
  }, [occurrences, occurrenceId]);

  useEffect(() => setPinnedId(null), [invoiceId, occurrenceId]);
  useEffect(() => {
    if (pinnedId === null && occurrences?.length) setPinnedId(occurrences[initial].id);
  }, [pinnedId, occurrences, initial]);

  if (error) return <div className="side-empty">{error}</div>;
  if (!invoice) return <div className="side-empty"><div className="spinner" /></div>;

  const pinned = occurrences?.findIndex((o) => o.id === pinnedId) ?? -1;
  const i = pinned >= 0 ? pinned : initial;
  const occ = occurrences?.[i];
  const go = (j: number) => occurrences?.[j] && setPinnedId(occurrences[j].id);
  const editable = isAdmin && !invoice.archived;

  const patchInvoice = async (body: Record<string, unknown>) => {
    try {
      await api(`/recurring-payments/${invoice.id}`, { method: "PATCH", json: body });
      invalidate();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="form">
      <div className="inv-title">
        <CategoryIcon icon={invoice.category?.icon} size={26} />
        <p className="grow">{invoice.name}</p>
        {invoice.archived && <span className="pill archived">Заархивирован</span>}
      </div>
      {editable && invoice.amount_type === "fixed" ? (
        <AmountInput invoice={invoice} />
      ) : (
        <p className="inv-price">{money(invoice.amount, invoice.currency)}</p>
      )}
      <Kv label="Категория">
        {editable ? (
          <Select
            compact
            clearable
            placeholder="Без категории"
            value={invoice.category?.id ?? null}
            options={(categories ?? []).map((c) => ({ value: c.id, label: <span className="row"><CategoryIcon icon={c.icon} size={16} />{c.name}</span> }))}
            onChange={(v) => patchInvoice({ category_id: v })}
            onClear={() => patchInvoice({ category_id: null })}
          />
        ) : (
          invoice.category?.name ?? "Без категории"
        )}
      </Kv>
      <Kv label="Регулярность" tip="После создания регулярность не меняется">
        {RECURRENCE_LABEL[invoice.recurrence]}
      </Kv>
      {(invoice.link || editable) && (
        <Kv label="Ссылка на оплату">
          {editable ? (
            <LinkInput invoice={invoice} onSave={(link) => patchInvoice({ link })} />
          ) : (
            <a href={invoice.link!} target="_blank" rel="noreferrer" className="link-btn" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {invoice.link!.replace(/^https?:\/\//, "")}
            </a>
          )}
        </Kv>
      )}
      <Responsibles invoice={invoice} isAdmin={isAdmin} />

      {occ && (
        <div className="period-box">
          <div className="period-head">
            <button type="button" className="icon-btn" disabled={i <= 0} onClick={() => go(i - 1)} aria-label="Предыдущий период">
              ⬅️
            </button>
            <p>{periodTitle(invoice.recurrence, occ.due_date)}</p>
            <button
              type="button"
              className="icon-btn"
              disabled={i >= (occurrences?.length ?? 0) - 1}
              onClick={() => go(i + 1)}
              aria-label="Следующий период"
            >
              ➡️
            </button>
          </div>
          <Period occ={occ} archived={invoice.archived} />
        </div>
      )}

      {editable && (
        <button
          type="button"
          className="btn btn-danger"
          onClick={async () => {
            if (!window.confirm(`Архивировать «${invoice.name}»? Напоминания прекратятся, история оплат сохранится.`)) return;
            await api(`/recurring-payments/${invoice.id}`, { method: "DELETE" });
            toast("Платёж архивирован");
            invalidate();
            onArchived?.();
          }}
        >
          Архивировать
        </button>
      )}
    </div>
  );
}

function LinkInput({ invoice, onSave }: { invoice: Invoice; onSave: (link: string | null) => void }) {
  const [value, setValue] = useState(invoice.link ?? "");
  useEffect(() => setValue(invoice.link ?? ""), [invoice.link]);
  return (
    <input
      className="input compact"
      value={value}
      placeholder="https://"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() !== (invoice.link ?? "") && onSave(value.trim() || null)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
