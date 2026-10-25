from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog, User

# Human-readable names, also served to the audit page filters.
ACTIONS = {
    "auth.login": "Вход",
    "auth.login_failed": "Неудачный вход",
    "auth.logout": "Выход",
    "invoice.create": "Создание платежа",
    "invoice.update": "Изменение платежа",
    "invoice.archive": "Архивация платежа",
    "occurrence.pay": "Отметка оплаты",
    "occurrence.unpay": "Отмена оплаты",
    "occurrence.update": "Изменение периода",
    "occurrence.receipt": "Чек",
    "user.create": "Создание пользователя",
    "user.update": "Изменение пользователя",
    "user.delete": "Удаление пользователя",
    "category.create": "Создание категории",
    "category.update": "Изменение категории",
    "category.delete": "Удаление категории",
    "webhook.create": "Создание вебхука",
    "webhook.update": "Изменение вебхука",
    "webhook.delete": "Удаление вебхука",
    "budget.update": "Изменение бюджета",
    "reminder.sent": "Напоминание",
}


def log(
    db: AsyncSession,
    action: str,
    summary: str,
    *,
    actor: User | None = None,
    actor_name: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    ip: str | None = None,
) -> None:
    """Adds an audit record to the session; it is committed together with the change it describes."""
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            actor_name=actor_name or (actor.name if actor else "Система"),
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
            ip=ip,
        )
    )
