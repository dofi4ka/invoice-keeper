import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from . import scheduler, seed, services
from .config import settings
from .db import SessionLocal, create_schema
from .notify import bot
from .routers import auth, categories, invoices, misc, occurrences, users, webhooks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("invoice_keeper")

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_schema()
    async with SessionLocal() as db:
        await seed.sync_admin(db)
        if settings.seed_demo:
            await seed.seed_demo(db)
        await services.extend_all(db)

    tasks = [asyncio.create_task(scheduler.run(), name="scheduler")]
    dp = bot.create()
    if dp is not None:
        tasks.append(asyncio.create_task(bot.run(dp), name="telegram-bot"))
    log.info("Invoice Keeper started (timezone %s)", settings.timezone)
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
    await bot.close()


app = FastAPI(
    title="Invoice Keeper API",
    version="1.0.0",
    description=(
        "Напоминания о регулярных платежах.\n\n"
        "Авторизация: `POST /api/v1/auth/login` возвращает токен и выставляет cookie. "
        "Для запросов из Swagger нажмите **Authorize** и вставьте токен.\n\n"
        "Права: обычный пользователь смотрит платежи, отмечает оплату и исправляет дату оплаты; "
        "создание/архивация платежей, пользователи, категории, вебхуки, бюджеты и аудит — только администратор."
    ),
    docs_url=f"{API_PREFIX}/docs",
    redoc_url=None,
    openapi_url=f"{API_PREFIX}/openapi.json",
    lifespan=lifespan,
)

api = APIRouter(prefix=API_PREFIX)
for module in (auth, invoices, occurrences, users, categories, webhooks, misc):
    api.include_router(module.router)


@api.get("/health", tags=["Прочее"], summary="Проверка работоспособности")
async def health():
    return {"status": "ok"}


app.include_router(api)
