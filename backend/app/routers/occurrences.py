from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, periods, receipts, schemas, services
from ..config import settings
from ..deps import DB, CurrentUser, client_ip
from ..models import Invoice, InvoiceResponsible, Occurrence, User
from ..texts import d, money

router = APIRouter(tags=["Платежи (периоды)"])


async def get_occurrence(db: AsyncSession, occurrence_id: int) -> Occurrence:
    stmt = services.visible(select(Occurrence).where(Occurrence.id == occurrence_id))
    occ = await db.scalar(stmt)
    if occ is None:
        raise HTTPException(404, "Платёж не найден")
    return occ


def filter_occurrences(
    stmt,
    user: User,
    date_from: date | None,
    date_to: date | None,
    status: list[str] | None,
    currency: list[str] | None,
    category_id: list[int] | None,
    invoice_id: int | None,
    mine: bool,
):
    today = periods.today()
    if date_from:
        stmt = stmt.where(Occurrence.due_date >= date_from)
    if date_to:
        stmt = stmt.where(Occurrence.due_date <= date_to)
    if invoice_id:
        stmt = stmt.where(Occurrence.invoice_id == invoice_id)
    if currency:
        stmt = stmt.where(Invoice.currency.in_(currency))
    if category_id:
        stmt = stmt.where(Invoice.category_id.in_(category_id))
    if mine:
        stmt = stmt.where(
            Occurrence.invoice_id.in_(select(InvoiceResponsible.invoice_id).where(InvoiceResponsible.user_id == user.id))
        )
    if status:
        conds = []
        if "paid" in status:
            conds.append(Occurrence.is_paid.is_(True))
        if "overdue" in status:
            conds.append(Occurrence.is_paid.is_(False) & (Occurrence.due_date < today))
        if "soon" in status:
            conds.append(
                Occurrence.is_paid.is_(False)
                & (Occurrence.due_date >= today)
                & (Occurrence.due_date <= today + timedelta(days=settings.reminder_days))
            )
        if "upcoming" in status:
            conds.append(
                Occurrence.is_paid.is_(False) & (Occurrence.due_date > today + timedelta(days=settings.reminder_days))
            )
        if conds:
            stmt = stmt.where(or_(*conds))
    return stmt


@router.get(
    "/payment-occurrences",
    response_model=list[schemas.OccurrenceOut],
    summary="Получение списка платежей, оплаченные и просроченные",
)
async def list_occurrences(
    db: DB,
    user: CurrentUser,
    date_from: date | None = None,
    date_to: date | None = None,
    status: Annotated[list[schemas.OccurrenceStatus] | None, Query()] = None,
    currency: Annotated[list[schemas.Currency] | None, Query()] = None,
    category_id: Annotated[list[int] | None, Query()] = None,
    invoice_id: int | None = None,
    mine: bool = Query(False, description="Только платежи, где я ответственный"),
    limit: int = Query(2000, le=5000),
):
    stmt = services.visible(select(Occurrence))
    stmt = filter_occurrences(stmt, user, date_from, date_to, status, currency, category_id, invoice_id, mine)
    stmt = stmt.order_by(Occurrence.due_date, Invoice.name).limit(limit)
    return await services.occurrences_out(db, list(await db.scalars(stmt)))


@router.get("/payment-occurrences/{occurrence_id}", response_model=schemas.OccurrenceOut, summary="Получение конкретного платежа")
async def get_one(occurrence_id: int, db: DB, user: CurrentUser):
    occ = await get_occurrence(db, occurrence_id)
    return (await services.occurrences_out(db, [occ]))[0]


@router.patch(
    "/payment-occurrences/{occurrence_id}",
    response_model=schemas.OccurrenceOut,
    summary="Подтверждение или отмена оплаты, исправление фактической даты оплаты",
)
async def patch_occurrence(occurrence_id: int, body: schemas.OccurrencePatch, request: Request, db: DB, user: CurrentUser):
    occ = await get_occurrence(db, occurrence_id)
    if occ.invoice.archived_at is not None:
        raise HTTPException(409, "Платёж архивирован")
    fields = body.model_fields_set
    name = f"«{occ.invoice.name}» за {d(occ.due_date)}"
    ip = client_ip(request)

    if "amount" in fields:
        if occ.invoice.amount_type != "actual":
            raise HTTPException(422, "Сумма фиксированного платежа меняется в карточке платежа")
        if body.amount is None:
            raise HTTPException(422, "Укажите сумму")
        occ.amount = body.amount
        audit.log(db, "occurrence.update", f"{name}: сумма {money(body.amount, occ.invoice.currency)}", actor=user, entity_type="occurrence", entity_id=occ.id, ip=ip)

    if "receipt_comment" in fields:
        occ.receipt_comment = (body.receipt_comment or "").strip() or None
        audit.log(db, "occurrence.update", f"{name}: комментарий к чеку", actor=user, entity_type="occurrence", entity_id=occ.id, ip=ip)

    if "paid_at" in fields and body.paid_at and body.paid_at > periods.today():
        raise HTTPException(422, "Дата оплаты не может быть в будущем")

    if body.is_paid is False or ("paid_at" in fields and body.paid_at is None and body.is_paid is not True):
        if occ.is_paid:
            await services.mark_unpaid(db, occ, user)
            audit.log(db, "occurrence.unpay", f"Отменена оплата {name}", actor=user, entity_type="occurrence", entity_id=occ.id, ip=ip)
    elif body.is_paid is True or ("paid_at" in fields and body.paid_at):
        paid_at = body.paid_at or occ.paid_at
        if paid_at is None:
            raise HTTPException(422, "Укажите дату оплаты")
        if not occ.is_paid:
            try:
                await services.mark_paid(db, occ, paid_at, user)
            except services.DomainError as e:
                raise HTTPException(422, str(e)) from e
            audit.log(db, "occurrence.pay", f"Оплачен {name}, дата оплаты {d(paid_at)}", actor=user, entity_type="occurrence", entity_id=occ.id, ip=ip)
        elif paid_at != occ.paid_at:
            audit.log(db, "occurrence.update", f"{name}: дата оплаты {d(occ.paid_at)} → {d(paid_at)}", actor=user, entity_type="occurrence", entity_id=occ.id, ip=ip)
            occ.paid_at = paid_at

    await db.commit()
    return await get_one(occurrence_id, db, user)


@router.post("/payment-occurrences/{occurrence_id}/receipt", response_model=schemas.OccurrenceOut, summary="Загрузка чека")
async def upload_receipt(
    occurrence_id: int,
    request: Request,
    db: DB,
    user: CurrentUser,
    file: Annotated[UploadFile, File()],
    comment: Annotated[str | None, Form()] = None,
):
    occ = await get_occurrence(db, occurrence_id)
    content = await file.read(receipts.MAX_SIZE + 1)
    if len(content) > receipts.MAX_SIZE:
        raise HTTPException(413, "Файл больше 20 МБ")
    await receipts.store(occ, file.filename or "receipt", content, file.content_type)
    if comment is not None:
        occ.receipt_comment = comment.strip() or None
    audit.log(db, "occurrence.receipt", f"Чек «{occ.receipt_name}» к «{occ.invoice.name}» за {d(occ.due_date)}", actor=user, entity_type="occurrence", entity_id=occ.id, ip=client_ip(request))
    await db.commit()
    return await get_one(occurrence_id, db, user)


@router.delete("/payment-occurrences/{occurrence_id}/receipt", response_model=schemas.OccurrenceOut, summary="Удаление чека")
async def delete_receipt(occurrence_id: int, request: Request, db: DB, user: CurrentUser):
    occ = await get_occurrence(db, occurrence_id)
    if occ.receipt_path:
        audit.log(db, "occurrence.receipt", f"Удалён чек к «{occ.invoice.name}» за {d(occ.due_date)}", actor=user, entity_type="occurrence", entity_id=occ.id, ip=client_ip(request))
        receipts.remove(occ)
        await db.commit()
    return await get_one(occurrence_id, db, user)


@router.get("/payment-occurrences/{occurrence_id}/receipt", summary="Скачать чек", response_class=FileResponse)
async def download_receipt(occurrence_id: int, db: DB, user: CurrentUser):
    occ = await get_occurrence(db, occurrence_id)
    path = receipts.path_of(occ)
    if path is None:
        raise HTTPException(404, "Чек не прикреплён")
    return FileResponse(
        path,
        media_type=occ.receipt_mime,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(occ.receipt_name or 'receipt')}"},
    )


@router.get("/payments/summary", response_model=schemas.SummaryOut, summary="Получение итоговых сумм платежей по валютам")
async def summary(
    db: DB,
    user: CurrentUser,
    date_from: date | None = Query(None, description="Срок оплаты с (включительно)"),
    date_to: date | None = Query(None, description="Срок оплаты по (включительно); по умолчанию — сегодня"),
    mine: bool = False,
):
    date_to = date_to or periods.today()
    stmt = services.visible(select(Occurrence))
    stmt = filter_occurrences(stmt, user, date_from, date_to, None, None, None, None, mine)
    today = periods.today()
    zero = Decimal(0)
    result = {c: schemas.CurrencyTotals(total=zero, paid=zero, unpaid=zero, overdue=zero, count=0) for c in ("RUB", "USD", "EUR")}
    for occ in await db.scalars(stmt):
        totals = result[occ.invoice.currency]
        amount = occ.amount or zero
        totals.count += 1
        totals.total += amount
        if occ.is_paid:
            totals.paid += amount
        else:
            totals.unpaid += amount
            if occ.due_date < today:
                totals.overdue += amount
    return schemas.SummaryOut(date_from=date_from, date_to=date_to, currencies=result)
