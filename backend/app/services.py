from datetime import date
from decimal import Decimal

from sqlalchemy import Select, and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import events, periods, schemas
from .models import Invoice, Occurrence, User
from .texts import status_of


class DomainError(Exception):
    pass


async def ensure_occurrences(db: AsyncSession, invoice: Invoice, *, mark_past_paid: bool = False) -> int:
    """Materializes the invoice's periods up to the horizon.

    With `mark_past_paid` (invoice creation with a past first date) periods that are
    already due before today are stored as paid without an actual payment date.
    Returns how many periods were marked as paid that way. Periods that fell due while the
    invoice was archived (missing ones before `resumed_on`) are not restored.
    """
    if invoice.archived_at is not None:
        return 0
    existing = set(await db.scalars(select(Occurrence.seq).where(Occurrence.invoice_id == invoice.id)))
    today = periods.today()
    past_paid = 0
    for seq, due in periods.iter_due_dates(invoice.start_date, invoice.recurrence, periods.horizon()):
        if seq in existing or (invoice.resumed_on is not None and due < invoice.resumed_on):
            continue
        paid = mark_past_paid and due < today
        past_paid += paid
        db.add(
            Occurrence(
                invoice_id=invoice.id,
                seq=seq,
                due_date=due,
                amount=invoice.amount if invoice.amount_type == "fixed" else None,
                is_paid=paid,
            )
        )
    return past_paid


async def extend_all(db: AsyncSession) -> None:
    for invoice in await db.scalars(select(Invoice).where(Invoice.archived_at.is_(None))):
        await ensure_occurrences(db, invoice)
    await db.commit()


def visible(stmt: Select) -> Select:
    """Archived invoices keep only their paid history."""
    return stmt.join(Occurrence.invoice).where(or_(Invoice.archived_at.is_(None), Occurrence.is_paid.is_(True)))


def occurrence_status(occ: Occurrence, today: date | None = None) -> str:
    return status_of(occ.is_paid, occ.due_date, today or periods.today())


async def users_by_id(db: AsyncSession, ids: set[int]) -> dict[int, User]:
    if not ids:
        return {}
    return {u.id: u for u in await db.scalars(select(User).where(User.id.in_(ids)))}


def invoice_out(invoice: Invoice) -> schemas.InvoiceOut:
    return schemas.InvoiceOut(
        id=invoice.id,
        name=invoice.name,
        currency=invoice.currency,
        amount_type=invoice.amount_type,
        amount=invoice.amount,
        recurrence=invoice.recurrence,
        start_date=invoice.start_date,
        link=invoice.link,
        archived=invoice.archived_at is not None,
        category=schemas.CategoryOut.model_validate(invoice.category) if invoice.category else None,
        responsibles=[schemas.UserOut.model_validate(u) for u in invoice.responsibles],
    )


def brief_out(occ: Occurrence, today: date | None = None) -> schemas.OccurrenceBrief:
    return schemas.OccurrenceBrief(
        id=occ.id,
        due_date=occ.due_date,
        amount=occ.amount,
        is_paid=occ.is_paid,
        paid_at=occ.paid_at,
        status=occurrence_status(occ, today),
    )


def occurrence_out(occ: Occurrence, paid_by: User | None = None, today: date | None = None) -> schemas.OccurrenceOut:
    return schemas.OccurrenceOut(
        **brief_out(occ, today).model_dump(),
        invoice_id=occ.invoice_id,
        invoice=invoice_out(occ.invoice),
        receipt_name=occ.receipt_name,
        receipt_comment=occ.receipt_comment,
        reminder_sent_at=occ.reminder_sent_at,
        reminder_at=periods.reminder_moment(occ.due_date),
        paid_by=paid_by.name if paid_by else None,
    )


async def occurrences_out(db: AsyncSession, items: list[Occurrence]) -> list[schemas.OccurrenceOut]:
    payers = await users_by_id(db, {o.paid_by_id for o in items if o.paid_by_id})
    today = periods.today()
    return [occurrence_out(o, payers.get(o.paid_by_id), today) for o in items]


async def next_occurrences(db: AsyncSession, invoice_ids: list[int]) -> dict[int, Occurrence]:
    """Earliest unpaid period per invoice; one-off invoices fall back to their only period."""
    result: dict[int, Occurrence] = {}
    if not invoice_ids:
        return result
    rows = await db.scalars(
        select(Occurrence)
        .where(Occurrence.invoice_id.in_(invoice_ids), Occurrence.is_paid.is_(False))
        .distinct(Occurrence.invoice_id)
        .order_by(Occurrence.invoice_id, Occurrence.due_date)
    )
    for occ in rows:
        result[occ.invoice_id] = occ
    missing = [i for i in invoice_ids if i not in result]
    if missing:
        rows = await db.scalars(
            select(Occurrence)
            .where(Occurrence.invoice_id.in_(missing))
            .distinct(Occurrence.invoice_id)
            .order_by(Occurrence.invoice_id, Occurrence.due_date.desc())
        )
        for occ in rows:
            result[occ.invoice_id] = occ
    return result


async def apply_price_change(db: AsyncSession, invoice: Invoice, amount: Decimal) -> None:
    """A new price applies to unpaid periods only; paid ones keep the old price in history."""
    for occ in await db.scalars(
        select(Occurrence).where(Occurrence.invoice_id == invoice.id, Occurrence.is_paid.is_(False))
    ):
        occ.amount = amount


async def archive(db: AsyncSession, invoice: Invoice) -> None:
    """Stops the invoice: future unpaid periods (and their reminders) go away, history stays."""
    invoice.archived_at = periods.now()
    await db.execute(
        delete(Occurrence).where(
            and_(
                Occurrence.invoice_id == invoice.id,
                Occurrence.is_paid.is_(False),
                Occurrence.due_date >= periods.today(),
            )
        )
    )


async def unarchive(db: AsyncSession, invoice: Invoice) -> None:
    """Resumes the invoice from today: periods due while it was archived are skipped for good."""
    invoice.archived_at = None
    invoice.resumed_on = periods.today()
    await ensure_occurrences(db, invoice)


async def mark_paid(
    db: AsyncSession, occ: Occurrence, paid_at: date, actor: User | None, actor_label: str | None = None
) -> None:
    if occ.invoice.amount_type == "actual" and occ.amount is None:
        raise DomainError("Сначала укажите фактическую сумму за период")
    occ.is_paid = True
    occ.paid_at = paid_at
    occ.paid_by_id = actor.id if actor else None
    await events.emit(db, "occurrence.paid", occ.invoice, occ, actor, actor_label)


async def mark_unpaid(db: AsyncSession, occ: Occurrence, actor: User | None, actor_label: str | None = None) -> None:
    occ.is_paid = False
    occ.paid_at = None
    occ.paid_by_id = None
    await events.emit(db, "occurrence.unpaid", occ.invoice, occ, actor, actor_label)
