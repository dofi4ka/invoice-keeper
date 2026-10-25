"""Russian wording shared by the Telegram bot, e-mails, notifications and webhooks."""

from datetime import date
from decimal import Decimal

from .config import settings

CURRENCY_SIGN = {"RUB": "₽", "USD": "$", "EUR": "€"}

RECURRENCE_LABEL = {
    "monthly": "Ежемесячно",
    "days30": "Каждые 30 дней",
    "quarterly": "Ежеквартально",
    "yearly": "Ежегодно",
    "once": "Один раз",
}

MONTHS_NOM = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
]
MONTHS_GEN = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
]


def money(amount: Decimal | None, currency: str) -> str:
    if amount is None:
        return "по факту"
    q = Decimal(amount).quantize(Decimal("0.01"))
    whole = int(q)
    cents = abs(q - whole)
    text = f"{whole:,}".replace(",", " ")
    if cents:
        text += "," + f"{cents:.2f}"[2:]
    return f"{text} {CURRENCY_SIGN[currency]}"


def plural(n: int, one: str, few: str, many: str) -> str:
    n = abs(n)
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def days(n: int) -> str:
    return f"{n} {plural(n, 'день', 'дня', 'дней')}"


def d(value: date | None) -> str:
    return value.strftime("%d.%m.%Y") if value else "—"


def recurrence_text(recurrence: str, anchor: date) -> str:
    label = RECURRENCE_LABEL[recurrence]
    if recurrence == "monthly":
        return f"{label} ({anchor.day}-е число)"
    if recurrence in ("quarterly", "yearly"):
        return f"{label} ({anchor.day} {MONTHS_GEN[anchor.month - 1]})"
    return label


def status_of(is_paid: bool, due: date, today: date) -> str:
    if is_paid:
        return "paid"
    if today > due:
        return "overdue"
    if (due - today).days <= settings.reminder_days:
        return "soon"
    return "upcoming"


def due_hint(is_paid: bool, due: date, today: date) -> str:
    """'Просрочен на 2 дня' / 'осталось 3 дня' / 'сегодня'."""
    if is_paid:
        return "оплачен"
    delta = (due - today).days
    if delta < 0:
        return f"Просрочен на {days(-delta)}"
    if delta == 0:
        return "срок сегодня"
    return f"{plural(delta, 'остался', 'осталось', 'осталось')} {days(delta)}"


STATUS_LINE = {
    "overdue": "🔴 Просрочен",
    "soon": "🟡 Требует оплаты",
    "upcoming": "⚪️ Ожидает оплаты",
    "paid": "🟢 Оплачен",
}


def month_title(year: int, month: int) -> str:
    return f"{MONTHS_NOM[month - 1]} {year}"


def invoice_url(invoice_id: int, occurrence_id: int | None = None) -> str:
    url = f"{settings.public_base}/invoices?invoice={invoice_id}"
    if occurrence_id:
        url += f"&occurrence={occurrence_id}"
    return url
