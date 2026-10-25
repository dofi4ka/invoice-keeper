import base64
import json
import logging
from datetime import UTC, datetime
from typing import Any

import httpx
from jinja2 import StrictUndefined, TemplateError
from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import select

from ..db import SessionLocal
from ..models import Webhook

log = logging.getLogger(__name__)

DEFAULT_TEMPLATE = "{{ payload | tojson }}"

_env = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False)
_env.policies["json.dumps_kwargs"] = {"ensure_ascii": False, "sort_keys": False}


def render(template: str, data: dict[str, Any]) -> str:
    """Body templates are Jinja2 (sandboxed). Context: the payload keys at top level
    plus `payload` itself, e.g. `{"text": "{{ invoice.name }}: {{ occurrence.amount_text }}"}`."""
    source = template.strip() or DEFAULT_TEMPLATE
    return _env.from_string(source).render(**data, payload=data)


def build_request(hook: Webhook, data: dict[str, Any]) -> httpx.Request:
    headers: dict[str, str] = {"User-Agent": "InvoiceKeeper-Webhook/1.0"}
    for h in hook.headers or []:
        headers[h["name"]] = render(h["value"], data) if "{{" in h["value"] else h["value"]
    auth = hook.auth or {}
    match hook.auth_type:
        case "basic":
            raw = f"{auth.get('username', '')}:{auth.get('password', '')}".encode()
            headers["Authorization"] = "Basic " + base64.b64encode(raw).decode()
        case "bearer":
            headers["Authorization"] = f"Bearer {auth.get('token', '')}"
        case "header" if auth.get("name"):
            headers[auth["name"]] = auth.get("value", "")
    if hook.method == "GET":
        return httpx.Request("GET", hook.url, headers=headers, params={"event": data["event"]})
    body = render(hook.body_template, data)
    headers.setdefault("Content-Type", hook.content_type or "application/json")
    return httpx.Request(hook.method, hook.url, headers=headers, content=body.encode())


async def send(hook: Webhook, data: dict[str, Any]) -> tuple[int | None, str | None, str]:
    """Returns (status, error, response excerpt)."""
    try:
        request = build_request(hook, data)
    except TemplateError as e:
        return None, f"Ошибка шаблона: {e}", ""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            response = await client.send(request)
    except httpx.HTTPError as e:
        return None, f"{type(e).__name__}: {e}", ""
    error = None if response.is_success else f"HTTP {response.status_code}"
    return response.status_code, error, response.text[:2000]


async def dispatch(event: str, data: dict[str, Any]) -> None:
    async with SessionLocal() as db:
        hooks = [h for h in await db.scalars(select(Webhook).where(Webhook.enabled.is_(True))) if event in h.events]
        for hook in hooks:
            status, error, _ = await send(hook, data)
            hook.last_status, hook.last_error, hook.last_sent_at = status, error, datetime.now(UTC)
            if error:
                log.warning("Webhook %s (%s) failed: %s", hook.name, event, error)
        await db.commit()


def sample_payload() -> dict[str, Any]:
    now = datetime.now(UTC)
    return {
        "event": "occurrence.reminder",
        "event_title": "Напоминание о сроке оплаты",
        "timestamp": now.isoformat(),
        "actor": None,
        "invoice": {
            "id": 0,
            "name": "Тестовый платёж",
            "currency": "RUB",
            "amount": "65000.00",
            "amount_type": "fixed",
            "recurrence": "monthly",
            "category": "Аренда",
            "link": "https://bank.ru/invoice/hq-office",
            "url": "",
            "responsibles": [],
        },
        "occurrence": {
            "id": 0,
            "due_date": now.date().isoformat(),
            "due_date_text": now.strftime("%d.%m.%Y"),
            "amount": "65000.00",
            "amount_text": "65 000 ₽",
            "is_paid": False,
            "paid_at": None,
            "status": "soon",
            "days_left": 3,
            "url": "",
        },
    }


def preview(template: str) -> str:
    try:
        body = render(template, sample_payload())
    except TemplateError as e:
        return f"Ошибка шаблона: {e}"
    try:
        return json.dumps(json.loads(body), ensure_ascii=False, indent=2)
    except ValueError:
        return body
