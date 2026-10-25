"""Fan-out of domain events to in-app notifications, Telegram, e-mail and webhooks."""

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import periods
from .config import settings
from .models import Invoice, Notification, Occurrence, User
from .texts import d, due_hint, invoice_url, money, status_of

log = logging.getLogger(__name__)

EVENTS = {
    "occurrence.reminder": "Напоминание о сроке оплаты",
    "occurrence.overdue": "Платёж просрочен",
    "occurrence.paid": "Оплата подтверждена",
    "occurrence.unpaid": "Оплата отменена",
    "invoice.created": "Новый платёж",
    "invoice.archived": "Платёж архивирован",
    "invoice.unarchived": "Платёж разархивирован",
}

_tasks: set[asyncio.Task] = set()


def spawn(coro: Coroutine[Any, Any, Any]) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def payload(event: str, invoice: Invoice, occ: Occurrence | None, actor: User | None) -> dict[str, Any]:
    today = periods.today()
    data: dict[str, Any] = {
        "event": event,
        "event_title": EVENTS[event],
        "timestamp": periods.now().isoformat(),
        "actor": {"id": actor.id, "name": actor.name, "email": actor.email} if actor else None,
        "invoice": {
            "id": invoice.id,
            "name": invoice.name,
            "currency": invoice.currency,
            "amount": str(invoice.amount) if invoice.amount is not None else None,
            "amount_type": invoice.amount_type,
            "recurrence": invoice.recurrence,
            "category": invoice.category.name if invoice.category else None,
            "link": invoice.link,
            "url": invoice_url(invoice.id),
            "responsibles": [{"id": u.id, "name": u.name, "email": u.email} for u in invoice.responsibles],
        },
        "occurrence": None,
    }
    if occ is not None:
        data["occurrence"] = {
            "id": occ.id,
            "due_date": occ.due_date.isoformat(),
            "due_date_text": d(occ.due_date),
            "amount": str(occ.amount) if occ.amount is not None else None,
            "amount_text": money(occ.amount if occ.amount is not None else invoice.amount, invoice.currency),
            "is_paid": occ.is_paid,
            "paid_at": occ.paid_at.isoformat() if occ.paid_at else None,
            "status": status_of(occ.is_paid, occ.due_date, today),
            "days_left": (occ.due_date - today).days,
            "url": invoice_url(invoice.id, occ.id),
        }
    return data


def notification_text(event: str, invoice: Invoice, occ: Occurrence | None, who: str) -> str:
    amount = money(occ.amount if occ and occ.amount is not None else invoice.amount, invoice.currency)
    match event:
        case "occurrence.reminder" if occ:
            return f"{invoice.name}: {amount} до {d(occ.due_date)} ({due_hint(False, occ.due_date, periods.today())})"
        case "occurrence.overdue" if occ:
            return f"{invoice.name}: просрочен срок {d(occ.due_date)}, {amount}"
        case "occurrence.paid" if occ:
            return f"{who} отметил оплату «{invoice.name}» за {d(occ.due_date)}"
        case "occurrence.unpaid" if occ:
            return f"{who} отменил оплату «{invoice.name}» за {d(occ.due_date)}"
        case "invoice.created":
            return f"Новый платёж «{invoice.name}», {amount}"
        case "invoice.archived":
            return f"Платёж «{invoice.name}» архивирован"
        case "invoice.unarchived":
            return f"Платёж «{invoice.name}» снова активен"
    return f"{EVENTS[event]}: {invoice.name}"


async def emit(
    db: AsyncSession,
    event: str,
    invoice: Invoice,
    occ: Occurrence | None = None,
    actor: User | None = None,
    actor_label: str | None = None,
) -> None:
    """Stores in-app notifications in the current transaction and schedules external
    deliveries; call it right before `db.commit()`."""
    users = list(await db.scalars(select(User)))
    text = notification_text(event, invoice, occ, actor.name if actor else actor_label or "Telegram")
    for user in users:
        if actor is not None and user.id == actor.id:
            continue
        db.add(
            Notification(
                user_id=user.id,
                kind=event,
                text=text,
                invoice_id=invoice.id,
                occurrence_id=occ.id if occ else None,
            )
        )

    data = payload(event, invoice, occ, actor)
    from .notify import email, webhooks

    spawn(webhooks.dispatch(event, data))
    if event in ("occurrence.reminder", "occurrence.overdue") and occ is not None:
        recipients = [u.email for u in invoice.responsibles]
        if recipients:
            spawn(email.send_event(event, data, recipients))


async def remind_new_responsibles(db: AsyncSession, invoice: Invoice, users: list[User], actor: User) -> None:
    """People added to a payment get, right away, the Telegram DM and e-mail they would have
    missed: for overdue periods and for those whose reminder already went out. Periods still
    waiting for their reminder are left to the scheduler, which includes the new people."""
    users = [u for u in users if u.id != actor.id]
    if not users or invoice.archived_at is not None:
        return
    today = periods.today()
    stmt = (
        select(Occurrence)
        .where(
            Occurrence.invoice_id == invoice.id,
            Occurrence.is_paid.is_(False),
            Occurrence.due_date <= today + timedelta(days=settings.reminder_days),
        )
        .order_by(Occurrence.due_date)
    )
    from .notify import bot, email

    for occ in await db.scalars(stmt):
        overdue = occ.due_date < today
        if not overdue and occ.reminder_sent_at is None:
            continue
        event = "occurrence.overdue" if overdue else "occurrence.reminder"
        data = payload(event, invoice, occ, actor)
        spawn(email.send_event(event, data, [u.email for u in users]))
        for user in users:
            spawn(bot.send_assigned(occ, user))


def notify_assigned(db: AsyncSession, invoice: Invoice, user_ids: set[int], actor: User) -> None:
    for uid in user_ids:
        if uid == actor.id:
            continue
        db.add(
            Notification(
                user_id=uid,
                kind="invoice.assigned",
                text=f"Вас назначили ответственным за «{invoice.name}»",
                invoice_id=invoice.id,
            )
        )
