from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import select

from .. import audit, events, scheduler, schemas, services
from ..deps import DB, AdminUser, CurrentUser, client_ip
from ..models import Category, Invoice, Occurrence, User
from ..texts import money

router = APIRouter(prefix="/recurring-payments", tags=["Регулярные платежи"])


async def get_invoice(db: DB, invoice_id: int, user: User) -> Invoice:
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None or (invoice.archived_at is not None and not user.is_admin):
        raise HTTPException(404, "Платёж не найден")
    return invoice


async def load_responsibles(db: DB, ids: list[int]) -> list[User]:
    users = list(await db.scalars(select(User).where(User.id.in_(set(ids)))))
    if len(users) != len(set(ids)):
        raise HTTPException(422, "Ответственный пользователь не найден")
    return users


async def check_category(db: DB, category_id: int | None) -> None:
    if category_id is not None and await db.get(Category, category_id) is None:
        raise HTTPException(422, "Категория не найдена")


@router.get("", response_model=list[schemas.InvoiceListItem], summary="Список регулярных платежей")
async def list_invoices(
    db: DB,
    user: CurrentUser,
    include_archived: bool = Query(False, description="Только для администратора"),
):
    stmt = select(Invoice).order_by(Invoice.name)
    if not (include_archived and user.is_admin):
        stmt = stmt.where(Invoice.archived_at.is_(None))
    invoices = list(await db.scalars(stmt))
    nexts = await services.next_occurrences(db, [i.id for i in invoices])
    return [
        schemas.InvoiceListItem(
            **services.invoice_out(i).model_dump(),
            next_occurrence=services.brief_out(nexts[i.id]) if i.id in nexts else None,
        )
        for i in invoices
    ]


@router.post("", response_model=schemas.InvoiceOut, status_code=201, summary="Создание регулярного платежа")
async def create_invoice(body: schemas.InvoiceCreate, request: Request, db: DB, admin: AdminUser):
    if body.amount_type == "fixed" and body.amount is None:
        raise HTTPException(422, "Укажите сумму")
    await check_category(db, body.category_id)
    invoice = Invoice(
        name=body.name.strip(),
        currency=body.currency,
        amount_type=body.amount_type,
        amount=body.amount if body.amount_type == "fixed" else None,
        category_id=body.category_id,
        recurrence=body.recurrence,
        start_date=body.start_date,
        link=str(body.link) if body.link else None,
    )
    invoice.responsibles = await load_responsibles(db, body.responsible_ids)
    db.add(invoice)
    await db.flush()
    past = await services.ensure_occurrences(db, invoice, mark_past_paid=True)
    await db.flush()
    await db.refresh(invoice, ["category"])
    summary = f"Создан платёж «{invoice.name}» ({money(invoice.amount, invoice.currency)})"
    if past:
        summary += f", {past} прошедших периодов отмечены оплаченными"
    audit.log(db, "invoice.create", summary, actor=admin, entity_type="invoice", entity_id=invoice.id, ip=client_ip(request))
    await events.emit(db, "invoice.created", invoice, actor=admin)
    events.notify_assigned(db, invoice, {u.id for u in invoice.responsibles}, admin)
    await db.commit()
    scheduler.wake()  # a payment added closer than 3 days to its due date is reminded right away
    return services.invoice_out(invoice)


@router.get("/{invoice_id}", response_model=schemas.InvoiceOut, summary="Регулярный платёж")
async def get_one(invoice_id: int, db: DB, user: CurrentUser):
    return services.invoice_out(await get_invoice(db, invoice_id, user))


@router.get(
    "/{invoice_id}/occurrences",
    response_model=list[schemas.OccurrenceOut],
    summary="Все периоды платежа (история и будущие)",
)
async def invoice_occurrences(invoice_id: int, db: DB, user: CurrentUser):
    invoice = await get_invoice(db, invoice_id, user)
    stmt = select(Occurrence).where(Occurrence.invoice_id == invoice.id).order_by(Occurrence.due_date)
    return await services.occurrences_out(db, list(await db.scalars(services.visible(stmt))))


@router.patch("/{invoice_id}", response_model=schemas.InvoiceOut, summary="Изменение регулярного платежа")
async def update_invoice(invoice_id: int, body: schemas.InvoiceUpdate, request: Request, db: DB, admin: AdminUser):
    invoice = await get_invoice(db, invoice_id, admin)
    if invoice.archived_at is not None:
        raise HTTPException(409, "Архивный платёж нельзя изменить")
    fields = body.model_fields_set
    changes: list[str] = []
    if "name" in fields and body.name:
        invoice.name = body.name.strip()
        changes.append("название")
    if "amount" in fields and body.amount is not None and invoice.amount_type == "fixed":
        if body.amount != invoice.amount:
            changes.append(f"сумма {money(invoice.amount, invoice.currency)} → {money(body.amount, invoice.currency)}")
            invoice.amount = body.amount
            await services.apply_price_change(db, invoice, body.amount)
    if "category_id" in fields:
        await check_category(db, body.category_id)
        invoice.category_id = body.category_id
        changes.append("категория")
    if "link" in fields:
        invoice.link = str(body.link) if body.link else None
        changes.append("ссылка")
    if "responsible_ids" in fields and body.responsible_ids is not None:
        before = {u.id for u in invoice.responsibles}
        invoice.responsibles = await load_responsibles(db, body.responsible_ids)
        added = [u for u in invoice.responsibles if u.id not in before]
        events.notify_assigned(db, invoice, {u.id for u in added}, admin)
        await events.remind_new_responsibles(db, invoice, added, admin)
        changes.append("ответственные")
    if changes:
        audit.log(
            db,
            "invoice.update",
            f"«{invoice.name}»: {', '.join(changes)}",
            actor=admin,
            entity_type="invoice",
            entity_id=invoice.id,
            ip=client_ip(request),
        )
    await db.commit()
    await db.refresh(invoice)
    return services.invoice_out(invoice)


@router.delete(
    "/{invoice_id}",
    status_code=204,
    summary="Прекращение регулярного платежа и его напоминаний с сохранением истории",
)
async def archive_invoice(invoice_id: int, request: Request, db: DB, admin: AdminUser):
    invoice = await get_invoice(db, invoice_id, admin)
    if invoice.archived_at is not None:
        return
    await services.archive(db, invoice)
    audit.log(db, "invoice.archive", f"Архивирован «{invoice.name}»", actor=admin, entity_type="invoice", entity_id=invoice.id, ip=client_ip(request))
    await events.emit(db, "invoice.archived", invoice, actor=admin)
    await db.commit()


@router.post(
    "/{invoice_id}/unarchive",
    response_model=schemas.InvoiceOut,
    summary="Возобновление архивного платежа; периоды за время архива не восстанавливаются",
)
async def unarchive_invoice(invoice_id: int, request: Request, db: DB, admin: AdminUser):
    invoice = await get_invoice(db, invoice_id, admin)
    if invoice.archived_at is not None:
        await services.unarchive(db, invoice)
        audit.log(db, "invoice.unarchive", f"Разархивирован «{invoice.name}»", actor=admin, entity_type="invoice", entity_id=invoice.id, ip=client_ip(request))
        await events.emit(db, "invoice.unarchived", invoice, actor=admin)
        await db.commit()
        scheduler.wake()
    return services.invoice_out(invoice)
