"""Background loop: extends periods, sends reminders 3 days before due dates and
flags overdue payments. Every send is recorded on the period, so repeated checks
never produce duplicates."""

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from . import audit, events, periods, services
from .config import settings
from .db import SessionLocal
from .models import Invoice, Occurrence
from .texts import d

log = logging.getLogger(__name__)

INTERVAL = 60
_wake = asyncio.Event()
_extended_on: date | None = None


def wake() -> None:
    _wake.set()


async def send_reminders() -> None:
    from .notify import bot

    today = periods.today()
    now = periods.now()
    async with SessionLocal() as db:
        stmt = (
            select(Occurrence)
            .join(Occurrence.invoice)
            .where(
                Invoice.archived_at.is_(None),
                Occurrence.is_paid.is_(False),
                Occurrence.reminder_sent_at.is_(None),
                Occurrence.due_date >= today,
                Occurrence.due_date <= today + timedelta(days=settings.reminder_days),
            )
            .order_by(Occurrence.due_date)
            .with_for_update(of=Occurrence, skip_locked=True)
        )
        for occ in await db.scalars(stmt):
            if now < periods.reminder_moment(occ.due_date):
                continue
            if bot.enabled() and not await bot.send_reminder(occ):
                continue  # Telegram is unreachable: retry on the next tick
            occ.reminder_sent_at = datetime.now(UTC)
            audit.log(
                db,
                "reminder.sent",
                f"Напоминание: «{occ.invoice.name}», срок {d(occ.due_date)}",
                entity_type="occurrence",
                entity_id=occ.id,
            )
            await events.emit(db, "occurrence.reminder", occ.invoice, occ)
            await db.commit()
        await db.commit()


async def flag_overdue() -> None:
    today = periods.today()
    async with SessionLocal() as db:
        stmt = (
            select(Occurrence)
            .join(Occurrence.invoice)
            .where(
                Invoice.archived_at.is_(None),
                Occurrence.is_paid.is_(False),
                Occurrence.overdue_notified_at.is_(None),
                Occurrence.due_date < today,
                Occurrence.due_date >= today - timedelta(days=30),
            )
            .with_for_update(of=Occurrence, skip_locked=True)
        )
        for occ in await db.scalars(stmt):
            occ.overdue_notified_at = datetime.now(UTC)
            await events.emit(db, "occurrence.overdue", occ.invoice, occ)
        await db.commit()


async def tick() -> None:
    global _extended_on
    if _extended_on != periods.today():
        async with SessionLocal() as db:
            await services.extend_all(db)
        _extended_on = periods.today()
    await send_reminders()
    await flag_overdue()


async def run() -> None:
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Scheduler tick failed")
        _wake.clear()
        try:
            await asyncio.wait_for(_wake.wait(), timeout=INTERVAL)
        except TimeoutError:
            pass
