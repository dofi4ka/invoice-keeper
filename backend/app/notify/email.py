import logging
from email.message import EmailMessage
from html import escape
from typing import Any

import aiosmtplib

from ..config import settings

log = logging.getLogger(__name__)


def enabled() -> bool:
    return bool(settings.smtp_host and (settings.smtp_from or settings.smtp_user))


def compose(event: str, data: dict[str, Any]) -> tuple[str, str, str]:
    inv, occ = data["invoice"], data["occurrence"]
    if event == "occurrence.reminder":
        subject = f"Срок оплаты через {occ['days_left']} дн.: {inv['name']}"
        lead = f"До наступления срока оплаты регулярного счета осталось {occ['days_left']} дн."
    else:
        subject = f"Просрочен платёж: {inv['name']}"
        lead = "Срок оплаты регулярного счета прошёл, а оплата не отмечена."
    lines = [
        lead,
        "",
        f"Услуга: {inv['name']}",
        f"Сумма к оплате: {occ['amount_text']}",
        f"Крайний срок: {occ['due_date_text']}",
    ]
    if inv["link"]:
        lines.append(f"Ссылка для оплаты: {inv['link']}")
    lines += ["", f"Карточка платежа: {occ['url']}"]
    text = "\n".join(lines)
    html = (
        '<div style="font-family:Inter,Arial,sans-serif;font-size:15px;color:#000">'
        + "".join(f"<p style='margin:0 0 6px'>{escape(line)}</p>" if line else "<br>" for line in lines[:-1])
        + f'<p><a href="{escape(occ["url"])}" style="display:inline-block;background:#000;color:#fff;'
        'padding:10px 18px;border-radius:10px;text-decoration:none">Открыть платёж</a></p></div>'
    )
    return subject, text, html


async def send(to: list[str], subject: str, text: str, html: str | None = None) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user or None,
        password=settings.smtp_password or None,
        start_tls=settings.smtp_starttls and not settings.smtp_ssl,
        use_tls=settings.smtp_ssl,
        timeout=20,
    )


async def send_event(event: str, data: dict[str, Any], recipients: list[str]) -> None:
    if not enabled():
        return
    subject, text, html = compose(event, data)
    try:
        await send(recipients, subject, text, html)
    except Exception:
        log.exception("Failed to send e-mail for %s", event)
