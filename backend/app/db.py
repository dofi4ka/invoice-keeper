from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def create_schema() -> None:
    from . import models  # noqa: F401  (registers tables)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Columns added after the first release: create_all does not alter existing tables.
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT"))
        await conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_key ON users (telegram_id)")
        )
