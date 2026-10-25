from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select

from .. import audit, periods, schemas, services
from ..deps import DB, AdminUser, CurrentUser, client_ip
from ..models import Category, Invoice, Occurrence

router = APIRouter(prefix="/categories", tags=["Категории"])


@router.get("", response_model=list[schemas.CategoryWithSpend], summary="Категории с тратами за последний месяц")
async def list_categories(db: DB, user: CurrentUser):
    today = periods.today()
    since = today - timedelta(days=30)
    stmt = (
        services.visible(select(Invoice.category_id, Invoice.currency, func.sum(Occurrence.amount)).select_from(Occurrence))
        .where(Occurrence.due_date > since, Occurrence.due_date <= today)
        .group_by(Invoice.category_id, Invoice.currency)
    )
    spend: dict[int, dict[str, Decimal]] = defaultdict(dict)
    for category_id, currency, total in await db.execute(stmt):
        if category_id is not None and total:
            spend[category_id][currency] = total
    return [
        schemas.CategoryWithSpend(id=c.id, name=c.name, icon=c.icon, last_month=spend.get(c.id, {}))
        for c in await db.scalars(select(Category).order_by(Category.name))
    ]


@router.post("", response_model=schemas.CategoryOut, status_code=201, summary="Создание категории")
async def create_category(body: schemas.CategoryIn, request: Request, db: DB, admin: AdminUser):
    category = Category(name=body.name.strip(), icon=body.icon or None)
    db.add(category)
    await db.flush()
    audit.log(db, "category.create", f"Создана категория «{category.name}»", actor=admin, entity_type="category", entity_id=category.id, ip=client_ip(request))
    await db.commit()
    return category


@router.patch("/{category_id}", response_model=schemas.CategoryOut, summary="Изменение категории")
async def update_category(category_id: int, body: schemas.CategoryIn, request: Request, db: DB, admin: AdminUser):
    category = await db.get(Category, category_id)
    if category is None:
        raise HTTPException(404, "Категория не найдена")
    category.name = body.name.strip()
    category.icon = body.icon or None
    audit.log(db, "category.update", f"Изменена категория «{category.name}»", actor=admin, entity_type="category", entity_id=category.id, ip=client_ip(request))
    await db.commit()
    return category


@router.delete("/{category_id}", status_code=204, summary="Удаление категории (платежи остаются без категории)")
async def delete_category(category_id: int, request: Request, db: DB, admin: AdminUser):
    category = await db.get(Category, category_id)
    if category is None:
        raise HTTPException(404, "Категория не найдена")
    audit.log(db, "category.delete", f"Удалена категория «{category.name}»", actor=admin, entity_type="category", entity_id=category.id, ip=client_ip(request))
    await db.delete(category)
    await db.commit()
