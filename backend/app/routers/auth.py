from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import delete, func, select

from .. import audit, schemas
from ..config import settings
from ..deps import COOKIE_NAME, DB, CurrentUser, bearer, client_ip, request_token
from ..models import Session, User
from ..security import new_token, token_hash, verify_password

router = APIRouter(prefix="/auth", tags=["Авторизация"])


@router.post("/login", response_model=schemas.LoginOut, summary="Вход по логину и паролю")
async def login(body: schemas.LoginIn, request: Request, response: Response, db: DB):
    email = body.email.strip().lower()
    user = await db.scalar(select(User).where(func.lower(User.email) == email))
    if user is None or not verify_password(body.password, user.password_hash):
        audit.log(db, "auth.login_failed", f"Неудачный вход: {email}", actor_name=email, ip=client_ip(request))
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверная почта или пароль")
    token = new_token()
    expires = datetime.now(UTC) + timedelta(days=settings.session_days)
    db.add(Session(token_hash=token_hash(token), user_id=user.id, expires_at=expires))
    audit.log(db, "auth.login", "Вход в панель", actor=user, entity_type="user", entity_id=user.id, ip=client_ip(request))
    await db.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return schemas.LoginOut(token=token, user=schemas.MeOut.model_validate(user))


@router.get("/me", response_model=schemas.MeOut, summary="Текущий пользователь")
async def me(user: CurrentUser):
    return user


@router.post("/logout", status_code=204, summary="Завершение текущей сессии")
async def logout(
    request: Request,
    response: Response,
    db: DB,
    user: CurrentUser,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    token = request_token(request, creds)
    if token:
        await db.execute(delete(Session).where(Session.token_hash == token_hash(token)))
    audit.log(db, "auth.logout", "Выход из панели", actor=user, ip=client_ip(request))
    await db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = 204
    return response
