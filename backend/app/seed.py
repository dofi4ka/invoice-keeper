"""Administrator sync from .env and optional demo data (SEED_DEMO=true, empty database only)."""

import logging
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import periods, services
from .config import settings
from .models import Budget, Category, Invoice, Occurrence, User
from .security import hash_password, verify_password

log = logging.getLogger(__name__)


async def sync_admin(db: AsyncSession) -> None:
    """The administrator lives in .env; the panel cannot change this account."""
    email = settings.admin_email.strip().lower()
    admin = await db.scalar(select(User).where(User.is_admin.is_(True)))
    clash = await db.scalar(select(User).where(func.lower(User.email) == email, User.is_admin.is_(False)))
    if clash is not None:
        log.warning("Regular user %s had the administrator e-mail and was removed", email)
        await db.delete(clash)
        await db.flush()
    tg_id = settings.admin_telegram_id
    if tg_id is not None:
        taken = await db.scalar(select(User).where(User.telegram_id == tg_id, User.is_admin.is_(False)))
        if taken is not None:
            log.warning("Regular user %s had the administrator Telegram ID, it was cleared", taken.email)
            taken.telegram_id = None
            await db.flush()
    if admin is None:
        admin = User(
            name=settings.admin_name,
            email=email,
            password_hash=hash_password(settings.admin_password),
            is_admin=True,
            ics_token=secrets.token_urlsafe(32),
        )
        db.add(admin)
    else:
        admin.name = settings.admin_name
        admin.email = email
        if not verify_password(settings.admin_password, admin.password_hash):
            admin.password_hash = hash_password(settings.admin_password)
    admin.role = None
    admin.telegram_id = tg_id
    await db.commit()


DEMO_CATEGORIES = [
    ("Аренда", "mdi:office-building"),
    ("Серверы", "mdi:server"),
    ("Подписки", "mdi:credit-card-outline"),
    ("Связь", "mdi:phone"),
    ("Бухгалтерия", "mdi:calculator"),
]


async def seed_demo(db: AsyncSession) -> None:
    if await db.scalar(select(func.count()).select_from(Invoice)):
        return
    log.info("Seeding demo data")
    today = periods.today()
    users = {
        key: User(
            name=name,
            role=role,
            email=email,
            password_hash=hash_password("demo1234"),
            ics_token=secrets.token_urlsafe(32),
        )
        for key, name, role, email in [
            ("anna", "Анна Смирнова", "Бухгалтер", "anna@example.com"),
            ("ivan", "Иван Петров", "DevOps", "ivan@example.com"),
            ("olga", "Ольга Кузнецова", "Офис-менеджер", "olga@example.com"),
        ]
    }
    db.add_all(users.values())
    cats = {name: Category(name=name, icon=icon) for name, icon in DEMO_CATEGORIES}
    db.add_all(cats.values())
    await db.flush()

    def start(next_due, recurrence: str, back: int):
        if recurrence == "days30":
            return next_due - timedelta(days=30 * back)
        step = periods.MONTH_STEP.get(recurrence, 1)
        return periods.add_months(next_due, -step * back)

    # name, currency, amount, category, recurrence, next due offset, periods back, responsible, link, overdue_unpaid
    specs = [
        ("Аренда офиса", "RUB", "85000", "Аренда", "monthly", 2, 9, ["anna", "olga"], "https://bank.ru/invoice/hq-office", False),
        ("Сервер Aéza", "USD", "240", "Серверы", "monthly", -5, 7, ["ivan"], "https://aeza.net/billing", True),
        ("Figma", "EUR", "49", "Подписки", "monthly", 9, 10, ["anna"], "https://www.figma.com/billing", False),
        ("Домен invoice-keeper.ru", "RUB", "1500", "Серверы", "yearly", 40, 2, ["ivan"], None, False),
        ("Интернет в офисе", "RUB", "4500", "Связь", "days30", 12, 10, ["olga"], None, False),
        ("Бухгалтерское обслуживание", "RUB", "36000", "Бухгалтерия", "quarterly", 20, 3, ["anna"], None, False),
        ("Google Workspace", "USD", "72", "Подписки", "monthly", 0, 8, [], "https://admin.google.com/billing", False),
        ("Хостинг резервных копий", "EUR", "18", "Серверы", "monthly", 16, 6, ["ivan"], None, False),
    ]
    for name, cur, amount, cat, rec, offset, back, resp, link, overdue in specs:
        inv = Invoice(
            name=name,
            currency=cur,
            amount=Decimal(amount),
            amount_type="fixed",
            category_id=cats[cat].id,
            recurrence=rec,
            start_date=start(today + timedelta(days=offset), rec, back),
            link=link,
        )
        inv.responsibles = [users[r] for r in resp]
        db.add(inv)
        await db.flush()
        await services.ensure_occurrences(db, inv, mark_past_paid=True)
        await db.flush()
        past = list(
            await db.scalars(
                select(Occurrence)
                .where(Occurrence.invoice_id == inv.id, Occurrence.due_date < today)
                .order_by(Occurrence.due_date)
            )
        )
        for i, occ in enumerate(past):
            occ.reminder_sent_at = occ.overdue_notified_at = datetime.now(UTC)
            late = i % 4 == 3  # some payments were made after the due date
            occ.paid_at = occ.due_date + timedelta(days=2 if late else -(i % 3))
            occ.paid_by_id = users[resp[0]].id if resp else None
        if overdue and past:
            last = past[-1]
            last.is_paid, last.paid_at, last.paid_by_id, last.overdue_notified_at = False, None, None, None

    # A "pay as billed" invoice: everyone enters the actual amount for every period.
    aws = Invoice(
        name="AWS",
        currency="USD",
        amount=None,
        amount_type="actual",
        category_id=cats["Серверы"].id,
        recurrence="monthly",
        start_date=periods.add_months(today + timedelta(days=6), -6),
        link="https://console.aws.amazon.com/billing",
    )
    aws.responsibles = [users["ivan"]]
    db.add(aws)
    await db.flush()
    await services.ensure_occurrences(db, aws, mark_past_paid=True)
    await db.flush()
    for i, occ in enumerate(
        await db.scalars(select(Occurrence).where(Occurrence.invoice_id == aws.id, Occurrence.due_date < today))
    ):
        occ.amount = Decimal(310 + 37 * i)
        occ.paid_at = occ.due_date
        occ.reminder_sent_at = occ.overdue_notified_at = datetime.now(UTC)

    db.add(
        Invoice(
            name="Конференция HighLoad++",
            currency="EUR",
            amount=Decimal("890"),
            amount_type="fixed",
            category_id=cats["Подписки"].id,
            recurrence="once",
            start_date=today + timedelta(days=24),
        )
    )
    await db.flush()
    for inv in await db.scalars(select(Invoice).where(Invoice.recurrence == "once")):
        await services.ensure_occurrences(db, inv)

    year = today.year
    for cur, amount in (("RUB", 1_800_000), ("USD", 5_000), ("EUR", 1_500)):
        db.add(Budget(year=year, month=0, currency=cur, amount=Decimal(amount)))
        for month in range(1, 13):
            db.add(Budget(year=year, month=month, currency=cur, amount=Decimal(amount // 12)))
    await db.commit()
