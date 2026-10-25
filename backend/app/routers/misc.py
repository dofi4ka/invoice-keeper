from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from sqlalchemy import func, or_, select, update

from .. import audit, periods, schemas, services
from ..config import settings
from ..deps import DB, AdminUser, CurrentUser, client_ip
from ..models import AuditLog, Budget, InvoiceResponsible, Notification, Occurrence, User
from ..rates import get_rates
from ..texts import RECURRENCE_LABEL, money, status_of

router = APIRouter(tags=["Прочее"])


# --- notifications --------------------------------------------------------------


@router.get("/notifications", response_model=schemas.NotificationsOut, summary="Последние уведомления")
async def notifications(db: DB, user: CurrentUser, limit: int = Query(30, le=100)):
    rows = await db.scalars(
        select(Notification).where(Notification.user_id == user.id).order_by(Notification.id.desc()).limit(limit)
    )
    unread = await db.scalar(
        select(func.count()).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return schemas.NotificationsOut(
        unread=unread or 0,
        items=[
            schemas.NotificationOut(
                id=n.id,
                kind=n.kind,
                text=n.text,
                invoice_id=n.invoice_id,
                occurrence_id=n.occurrence_id,
                created_at=n.created_at,
                read=n.read_at is not None,
            )
            for n in rows
        ],
    )


@router.post("/notifications/read", status_code=204, summary="Отметить все уведомления прочитанными")
async def read_all(db: DB, user: CurrentUser):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()


# --- audit ------------------------------------------------------------------------


@router.get("/audit", response_model=schemas.AuditPage, summary="Журнал действий")
async def audit_log(
    db: DB,
    admin: AdminUser,
    action: Annotated[list[str] | None, Query()] = None,
    actor: Annotated[list[str] | None, Query(description="Имена исполнителей")] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    offset: int = 0,
    limit: int = Query(50, le=500),
):
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action.in_(action))
    if actor:
        stmt = stmt.where(AuditLog.actor_name.in_(actor))
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, datetime.min.time(), settings.tz))
    if date_to:
        stmt = stmt.where(
            AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), settings.tz)
        )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(AuditLog.summary.ilike(like), AuditLog.actor_name.ilike(like), AuditLog.ip.ilike(like)))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = await db.scalars(stmt.order_by(AuditLog.id.desc()).offset(offset).limit(limit))
    actors = await db.scalars(select(AuditLog.actor_name).distinct().order_by(AuditLog.actor_name))
    return schemas.AuditPage(
        total=total or 0,
        items=[schemas.AuditOut.model_validate(i) for i in items],
        actions=audit.ACTIONS,
        actors=list(actors),
    )


# --- budgets ------------------------------------------------------------------------


@router.get("/budgets", response_model=list[schemas.BudgetOut], summary="Бюджеты за год (month=0 — на год)")
async def budgets(db: DB, user: CurrentUser, year: int = Query(ge=2000, le=2100)):
    return list(await db.scalars(select(Budget).where(Budget.year == year).order_by(Budget.month, Budget.currency)))


@router.put("/budgets", response_model=schemas.BudgetOut | None, summary="Задать бюджет на месяц или год")
async def set_budget(body: schemas.BudgetIn, request: Request, db: DB, admin: AdminUser):
    existing = await db.scalar(
        select(Budget).where(Budget.year == body.year, Budget.month == body.month, Budget.currency == body.currency)
    )
    period = f"{body.month:02d}.{body.year}" if body.month else f"{body.year} год"
    if body.amount is None:
        if existing:
            await db.delete(existing)
        audit.log(db, "budget.update", f"Бюджет {body.currency} на {period} удалён", actor=admin, ip=client_ip(request))
        await db.commit()
        return None
    if existing is None:
        existing = Budget(year=body.year, month=body.month, currency=body.currency, amount=body.amount)
        db.add(existing)
    else:
        existing.amount = body.amount
    audit.log(db, "budget.update", f"Бюджет на {period}: {money(body.amount, body.currency)}", actor=admin, ip=client_ip(request))
    await db.commit()
    return existing


# --- rates ---------------------------------------------------------------------------


@router.get("/rates", response_model=schemas.RatesOut, summary="Курсы ЦБ РФ (только для масштабирования графиков)")
async def rates(user: CurrentUser):
    data = await get_rates()
    return schemas.RatesOut(date=data["date"], source=data["source"], rub_per_unit=data["rates"])


# --- calendar feed -------------------------------------------------------------------


def ics_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def ics_fold(line: str) -> str:
    raw = line.encode()
    if len(raw) <= 75:
        return line
    parts, current = [], b""
    for ch in line:
        b = ch.encode()
        if len(current) + len(b) > (75 if not parts else 74):
            parts.append(current.decode())
            current = b""
        current += b
    parts.append(current.decode())
    return "\r\n ".join(parts)


STATUS_TEXT = {"paid": "Оплачен", "overdue": "Просрочен", "soon": "Скоро срок", "upcoming": "Ожидает оплаты"}


@router.get(
    "/calendar/{token}/{scope}.ics",
    summary="Публичная ICS-лента платежей",
    response_class=Response,
    responses={200: {"content": {"text/calendar": {}}}},
)
async def calendar_feed(token: str, scope: Literal["all", "mine"], db: DB):
    user = await db.scalar(select(User).where(User.ics_token == token))
    if user is None:
        raise HTTPException(404, "Лента не найдена")
    today = periods.today()
    stmt = services.visible(select(Occurrence)).where(
        Occurrence.due_date >= today - timedelta(days=365), Occurrence.due_date <= today + timedelta(days=400)
    )
    if scope == "mine":
        stmt = stmt.where(
            Occurrence.invoice_id.in_(select(InvoiceResponsible.invoice_id).where(InvoiceResponsible.user_id == user.id))
        )
    host = settings.public_base.split("://")[-1].split("/")[0]
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    name = "Invoice Keeper — мои платежи" if scope == "mine" else "Invoice Keeper — все платежи"
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Invoice Keeper//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{ics_escape(name)}",
        f"X-WR-TIMEZONE:{settings.timezone}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for occ in await db.scalars(stmt.order_by(Occurrence.due_date)):
        inv = occ.invoice
        status = status_of(occ.is_paid, occ.due_date, today)
        amount = money(occ.amount if occ.amount is not None else inv.amount, inv.currency)
        mark = "✓ " if occ.is_paid else ""
        desc = [f"Сумма: {amount}", f"Статус: {STATUS_TEXT[status]}", f"Регулярность: {RECURRENCE_LABEL[inv.recurrence]}"]
        if inv.link:
            desc.append(f"Оплата: {inv.link}")
        desc.append(f"{settings.public_base}/invoices?invoice={inv.id}&occurrence={occ.id}")
        lines += [
            "BEGIN:VEVENT",
            f"UID:occurrence-{occ.id}@{host}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{occ.due_date.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{(occ.due_date + timedelta(days=1)).strftime('%Y%m%d')}",
            f"SUMMARY:{ics_escape(f'{mark}{inv.name} — {amount}')}",
            f"DESCRIPTION:{ics_escape(chr(10).join(desc))}",
            "TRANSP:TRANSPARENT",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    body = "\r\n".join(ics_fold(line) for line in lines) + "\r\n"
    return Response(body, media_type="text/calendar; charset=utf-8")
