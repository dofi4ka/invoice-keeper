import secrets

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select

from .. import audit, schemas
from ..deps import DB, AdminUser, CurrentUser, client_ip
from ..models import User
from ..security import hash_password

router = APIRouter(prefix="/users", tags=["Пользователи"])


async def get_regular_user(db: DB, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    if user.is_admin:
        raise HTTPException(403, "Учётная запись администратора задаётся в .env и не изменяется через панель")
    return user


async def ensure_email_free(db: DB, email: str, exclude_id: int | None = None) -> None:
    stmt = select(User.id).where(func.lower(User.email) == email.lower())
    if exclude_id:
        stmt = stmt.where(User.id != exclude_id)
    if await db.scalar(stmt):
        raise HTTPException(409, "Пользователь с такой почтой уже существует")


async def ensure_telegram_free(db: DB, telegram_id: int | None, exclude_id: int | None = None) -> None:
    if telegram_id is None:
        return
    stmt = select(User.id).where(User.telegram_id == telegram_id)
    if exclude_id:
        stmt = stmt.where(User.id != exclude_id)
    if await db.scalar(stmt):
        raise HTTPException(409, "Пользователь с таким Telegram ID уже существует")


@router.get("", response_model=list[schemas.UserOut], summary="Получение списка пользователей")
async def list_users(db: DB, user: CurrentUser):
    """Все пользователи (включая администратора) — нужен, чтобы назначать ответственных."""
    return list(await db.scalars(select(User).order_by(User.is_admin.desc(), User.name)))


@router.post("", response_model=schemas.UserOut, status_code=201, summary="Создание обычного пользователя")
async def create_user(body: schemas.UserCreate, request: Request, db: DB, admin: AdminUser):
    email = body.email.lower()
    await ensure_email_free(db, email)
    await ensure_telegram_free(db, body.telegram_id)
    user = User(
        name=body.name.strip(),
        role=(body.role or "").strip() or None,
        email=email,
        telegram_id=body.telegram_id,
        password_hash=hash_password(body.password),
        is_admin=False,
        ics_token=secrets.token_urlsafe(32),
    )
    db.add(user)
    await db.flush()
    audit.log(db, "user.create", f"Создан пользователь {user.name} <{user.email}>", actor=admin, entity_type="user", entity_id=user.id, ip=client_ip(request))
    await db.commit()
    return user


@router.patch("/{user_id}", response_model=schemas.UserOut, summary="Изменение пользователя")
async def update_user(user_id: int, body: schemas.UserUpdate, request: Request, db: DB, admin: AdminUser):
    user = await get_regular_user(db, user_id)
    fields = body.model_fields_set
    changes = []
    if "name" in fields and body.name:
        user.name = body.name.strip()
        changes.append("имя")
    if "role" in fields:
        user.role = (body.role or "").strip() or None
        changes.append("роль")
    if "email" in fields and body.email and body.email.lower() != user.email:
        await ensure_email_free(db, body.email, user.id)
        user.email = body.email.lower()
        changes.append("почта")
    if "telegram_id" in fields and body.telegram_id != user.telegram_id:
        await ensure_telegram_free(db, body.telegram_id, user.id)
        user.telegram_id = body.telegram_id
        changes.append("Telegram ID")
    if body.password:
        user.password_hash = hash_password(body.password)
        changes.append("пароль")
    if changes:
        audit.log(db, "user.update", f"{user.name}: {', '.join(changes)}", actor=admin, entity_type="user", entity_id=user.id, ip=client_ip(request))
    await db.commit()
    return user


@router.delete("/{user_id}", status_code=204, summary="Удаление пользователя")
async def delete_user(user_id: int, request: Request, db: DB, admin: AdminUser):
    user = await get_regular_user(db, user_id)
    audit.log(db, "user.delete", f"Удалён пользователь {user.name} <{user.email}>", actor=admin, entity_type="user", entity_id=user.id, ip=client_ip(request))
    await db.delete(user)
    await db.commit()
