"""Due date arithmetic for recurring payments.

Every period is computed from the anchor (first due date), not from the previous
period, so a payment anchored on the 31st lands on the 28th/29th in February and
returns to the 31st in March.
"""

import calendar
from datetime import date, datetime, timedelta

from .config import settings

MONTH_STEP = {"monthly": 1, "quarterly": 3, "yearly": 12}


def add_months(anchor: date, months: int) -> date:
    total = anchor.year * 12 + anchor.month - 1 + months
    year, month = divmod(total, 12)
    month += 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def due_date(anchor: date, recurrence: str, seq: int) -> date:
    if recurrence == "days30":
        return anchor + timedelta(days=30 * seq)
    if recurrence == "once":
        return anchor
    return add_months(anchor, MONTH_STEP[recurrence] * seq)


def iter_due_dates(anchor: date, recurrence: str, until: date):
    """Yields (seq, due_date) for every period due on or before `until`."""
    seq = 0
    while True:
        d = due_date(anchor, recurrence, seq)
        if d > until:
            return
        yield seq, d
        if recurrence == "once":
            return
        seq += 1


def today() -> date:
    return datetime.now(settings.tz).date()


def now() -> datetime:
    return datetime.now(settings.tz)


def reminder_moment(due: date) -> datetime:
    """When the reminder for a period becomes due: N days before, at REMINDER_HOUR local time."""
    d = due - timedelta(days=settings.reminder_days)
    return datetime(d.year, d.month, d.day, settings.reminder_hour, tzinfo=settings.tz)


def horizon() -> date:
    """Periods are materialized this far ahead so calendars and budgets can show them."""
    t = today()
    return date(t.year + 2, 12, 31)
