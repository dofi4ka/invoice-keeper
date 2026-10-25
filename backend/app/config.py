from functools import cached_property
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "postgresql+asyncpg://invoice:invoice@localhost:5432/invoice"
    data_dir: str = "./data"

    admin_name: str = "Администратор"
    admin_email: str = "admin@example.com"
    admin_password: str = "admin"

    timezone: str = "Europe/Moscow"
    reminder_hour: int = 10
    reminder_days: int = 3
    public_url: str = "http://localhost:8080"

    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True
    smtp_ssl: bool = False

    seed_demo: bool = False
    session_days: int = 30
    cookie_secure: bool = False

    @cached_property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def public_base(self) -> str:
        return self.public_url.rstrip("/")


settings = Settings()
