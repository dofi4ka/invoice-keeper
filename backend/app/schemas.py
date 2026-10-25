from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, field_validator

Currency = Literal["RUB", "USD", "EUR"]
Recurrence = Literal["monthly", "days30", "quarterly", "yearly", "once"]
AmountType = Literal["fixed", "actual"]
OccurrenceStatus = Literal["paid", "overdue", "soon", "upcoming"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- auth / users ---------------------------------------------------------


class LoginIn(BaseModel):
    email: str = Field(examples=["admin@example.com"])
    password: str


class UserOut(ORM):
    id: int
    name: str
    role: str | None
    email: str
    telegram_id: int | None
    is_admin: bool


class MeOut(UserOut):
    ics_token: str


class TelegramLoginIn(BaseModel):
    init_data: str = Field(description="Telegram.WebApp.initData — строка запуска Mini App, подписанная ботом")


class LoginOut(BaseModel):
    token: str = Field(description="Также выставляется cookie; для API передавайте как Bearer")
    user: MeOut


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    email: EmailStr
    telegram_id: int | None = Field(default=None, gt=0, description="Числовой ID в Telegram: доступ к боту и личные напоминания")
    password: str = Field(min_length=6, max_length=200)


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    telegram_id: int | None = Field(default=None, gt=0, description="null — отвязать Telegram")
    password: str | None = Field(default=None, description="Пустая строка или null — пароль не меняется")

    @field_validator("password")
    @classmethod
    def _password(cls, v: str | None) -> str | None:
        if v and len(v) < 6:
            raise ValueError("Пароль должен быть не короче 6 символов")
        return v or None


# --- categories -------------------------------------------------------------


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    icon: str | None = Field(default=None, max_length=200, examples=["mdi:server"])


class CategoryOut(ORM):
    id: int
    name: str
    icon: str | None


class CategoryWithSpend(CategoryOut):
    last_month: dict[str, Decimal] = Field(description="Траты за последний месяц по валютам")


# --- invoices (recurring payments) ------------------------------------------


class InvoiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    currency: Currency
    amount_type: AmountType = "fixed"
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    category_id: int | None = None
    start_date: date = Field(description="Дата ближайшей (первой) оплаты; может быть в прошлом")
    recurrence: Recurrence = "monthly"
    link: HttpUrl | None = Field(default=None, description="Ссылка на биллинг / оплату")
    responsible_ids: list[int] = []


class InvoiceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    category_id: int | None = None
    link: HttpUrl | None = None
    responsible_ids: list[int] | None = None


class InvoiceOut(ORM):
    id: int
    name: str
    currency: Currency
    amount_type: AmountType
    amount: Decimal | None
    recurrence: Recurrence
    start_date: date
    link: str | None
    archived: bool
    category: CategoryOut | None
    responsibles: list[UserOut]


class InvoiceListItem(InvoiceOut):
    next_occurrence: "OccurrenceBrief | None" = Field(
        description="Ближайший неоплаченный период (для разового — единственный период)"
    )


# --- occurrences ------------------------------------------------------------


class OccurrenceBrief(ORM):
    id: int
    due_date: date
    amount: Decimal | None
    is_paid: bool
    paid_at: date | None
    status: OccurrenceStatus


class OccurrenceOut(OccurrenceBrief):
    invoice_id: int
    invoice: InvoiceOut
    receipt_name: str | None
    receipt_comment: str | None
    reminder_sent_at: datetime | None
    reminder_at: datetime = Field(description="Когда будет (или было) отправлено напоминание")
    paid_by: str | None


class OccurrencePatch(BaseModel):
    is_paid: bool | None = Field(default=None, description="Подтвердить (true) или отменить (false) оплату")
    paid_at: date | None = Field(default=None, description="Фактическая дата оплаты; меняется и у оплаченных")
    amount: Decimal | None = Field(
        default=None, gt=0, max_digits=14, decimal_places=2, description="Сумма периода для платежей «по факту»"
    )
    receipt_comment: str | None = Field(default=None, max_length=2000)


# --- summary ------------------------------------------------------------------


class CurrencyTotals(BaseModel):
    total: Decimal
    paid: Decimal
    unpaid: Decimal
    overdue: Decimal
    count: int


class SummaryOut(BaseModel):
    date_from: date | None
    date_to: date | None
    currencies: dict[str, CurrencyTotals]


# --- webhooks -----------------------------------------------------------------


class Header(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    value: str = Field(max_length=4000)


class WebhookIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    url: HttpUrl
    method: Literal["POST", "PUT", "PATCH", "GET", "DELETE"] = "POST"
    events: list[str] = []
    headers: list[Header] = []
    auth_type: Literal["none", "basic", "bearer", "header"] = "none"
    auth: dict[str, str] = {}
    content_type: str = "application/json"
    body_template: str = ""
    enabled: bool = True


class WebhookOut(ORM):
    id: int
    name: str
    url: str
    method: str
    events: list[str]
    headers: list[Header]
    auth_type: str
    auth: dict[str, str]
    content_type: str
    body_template: str
    enabled: bool
    last_status: int | None
    last_error: str | None
    last_sent_at: datetime | None


class WebhookTestOut(BaseModel):
    ok: bool
    status: int | None
    error: str | None
    body: str


# --- misc ---------------------------------------------------------------------


class NotificationOut(ORM):
    id: int
    kind: str
    text: str
    invoice_id: int | None
    occurrence_id: int | None
    created_at: datetime
    read: bool


class NotificationsOut(BaseModel):
    unread: int
    items: list[NotificationOut]


class AuditOut(ORM):
    id: int
    created_at: datetime
    actor_id: int | None
    actor_name: str
    action: str
    entity_type: str | None
    entity_id: int | None
    summary: str
    ip: str | None


class AuditPage(BaseModel):
    total: int
    items: list[AuditOut]
    actions: dict[str, str]
    actors: list[str]


class BudgetOut(ORM):
    year: int
    month: int = Field(description="0 — бюджет на год")
    currency: Currency
    amount: Decimal


class BudgetIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=0, le=12)
    currency: Currency
    amount: Decimal | None = Field(ge=0, max_digits=14, decimal_places=2, description="null — удалить бюджет")


class RatesOut(BaseModel):
    date: str | None
    source: str
    rub_per_unit: dict[str, float]


InvoiceListItem.model_rebuild()
