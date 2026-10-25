from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from .. import audit, events, schemas
from ..deps import DB, AdminUser, client_ip
from ..models import Webhook
from ..notify import webhooks as delivery

router = APIRouter(prefix="/webhooks", tags=["Вебхуки"])


class WebhookMeta(BaseModel):
    events: dict[str, str]
    default_template: str
    sample_payload: dict


class PreviewIn(BaseModel):
    body_template: str


class PreviewOut(BaseModel):
    body: str


def apply(hook: Webhook, body: schemas.WebhookIn) -> None:
    unknown = set(body.events) - set(events.EVENTS)
    if unknown:
        raise HTTPException(422, f"Неизвестные события: {', '.join(sorted(unknown))}")
    hook.name = body.name.strip()
    hook.url = str(body.url)
    hook.method = body.method
    hook.events = body.events
    hook.headers = [h.model_dump() for h in body.headers]
    hook.auth_type = body.auth_type
    hook.auth = body.auth
    hook.content_type = body.content_type or "application/json"
    hook.body_template = body.body_template
    hook.enabled = body.enabled


async def get_hook(db: DB, webhook_id: int) -> Webhook:
    hook = await db.get(Webhook, webhook_id)
    if hook is None:
        raise HTTPException(404, "Вебхук не найден")
    return hook


@router.get("/meta", response_model=WebhookMeta, summary="События и пример данных для шаблонов")
async def meta(admin: AdminUser):
    return WebhookMeta(
        events=events.EVENTS,
        default_template=delivery.DEFAULT_TEMPLATE,
        sample_payload=delivery.sample_payload(),
    )


@router.post("/preview", response_model=PreviewOut, summary="Предпросмотр тела по шаблону")
async def preview(body: PreviewIn, admin: AdminUser):
    return PreviewOut(body=delivery.preview(body.body_template))


@router.get("", response_model=list[schemas.WebhookOut], summary="Список вебхуков")
async def list_hooks(db: DB, admin: AdminUser):
    return list(await db.scalars(select(Webhook).order_by(Webhook.name)))


@router.post("", response_model=schemas.WebhookOut, status_code=201, summary="Создание вебхука")
async def create_hook(body: schemas.WebhookIn, request: Request, db: DB, admin: AdminUser):
    hook = Webhook()
    apply(hook, body)
    db.add(hook)
    await db.flush()
    audit.log(db, "webhook.create", f"Создан вебхук «{hook.name}»", actor=admin, entity_type="webhook", entity_id=hook.id, ip=client_ip(request))
    await db.commit()
    return hook


@router.put("/{webhook_id}", response_model=schemas.WebhookOut, summary="Изменение вебхука")
async def update_hook(webhook_id: int, body: schemas.WebhookIn, request: Request, db: DB, admin: AdminUser):
    hook = await get_hook(db, webhook_id)
    apply(hook, body)
    audit.log(db, "webhook.update", f"Изменён вебхук «{hook.name}»", actor=admin, entity_type="webhook", entity_id=hook.id, ip=client_ip(request))
    await db.commit()
    return hook


@router.delete("/{webhook_id}", status_code=204, summary="Удаление вебхука")
async def delete_hook(webhook_id: int, request: Request, db: DB, admin: AdminUser):
    hook = await get_hook(db, webhook_id)
    audit.log(db, "webhook.delete", f"Удалён вебхук «{hook.name}»", actor=admin, entity_type="webhook", entity_id=hook.id, ip=client_ip(request))
    await db.delete(hook)
    await db.commit()


@router.post("/{webhook_id}/test", response_model=schemas.WebhookTestOut, summary="Отправить тестовое событие")
async def test_hook(webhook_id: int, db: DB, admin: AdminUser):
    hook = await get_hook(db, webhook_id)
    status, error, body = await delivery.send(hook, delivery.sample_payload())
    hook.last_status, hook.last_error, hook.last_sent_at = status, error, datetime.now(UTC)
    await db.commit()
    return schemas.WebhookTestOut(ok=error is None, status=status, error=error, body=body)
