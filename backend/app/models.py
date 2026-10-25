from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

CURRENCIES = ("RUB", "USD", "EUR")
RECURRENCES = ("monthly", "days30", "quarterly", "yearly", "once")
AMOUNT_TYPES = ("fixed", "actual")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, unique=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    ics_token: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Session(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(lazy="joined")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    icon: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InvoiceResponsible(Base):
    __tablename__ = "invoice_responsibles"

    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class Invoice(Base):
    """A recurring payment (регулярный платёж)."""

    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    currency: Mapped[str] = mapped_column(String(3))
    amount_type: Mapped[str] = mapped_column(String(10), default="fixed")
    amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    recurrence: Mapped[str] = mapped_column(String(10))
    start_date: Mapped[date] = mapped_column(Date)
    link: Mapped[str | None] = mapped_column(String(1000))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    category: Mapped[Category | None] = relationship(lazy="joined")
    responsibles: Mapped[list[User]] = relationship(
        secondary="invoice_responsibles", lazy="selectin", order_by=User.name
    )


class Occurrence(Base):
    """One billing period of an invoice: its own due date and its own paid mark."""

    __tablename__ = "occurrences"
    __table_args__ = (
        UniqueConstraint("invoice_id", "seq"),
        Index("ix_occurrences_due", "due_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    due_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    paid_at: Mapped[date | None] = mapped_column(Date)
    paid_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    receipt_name: Mapped[str | None] = mapped_column(String(300))
    receipt_path: Mapped[str | None] = mapped_column(String(300))
    receipt_mime: Mapped[str | None] = mapped_column(String(200))
    receipt_comment: Mapped[str | None] = mapped_column(Text)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    overdue_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    invoice: Mapped[Invoice] = relationship(lazy="joined")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(Text)
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"))
    occurrence_id: Mapped[int | None] = mapped_column(ForeignKey("occurrences.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_name: Mapped[str] = mapped_column(String(300))
    action: Mapped[str] = mapped_column(String(50), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(30))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    summary: Mapped[str] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(64))


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(String(2000))
    method: Mapped[str] = mapped_column(String(10), default="POST")
    events: Mapped[list[str]] = mapped_column(JSON, default=list)
    headers: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list)
    auth_type: Mapped[str] = mapped_column(String(10), default="none")
    auth: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    content_type: Mapped[str] = mapped_column(String(100), default="application/json")
    body_template: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_status: Mapped[int | None] = mapped_column(Integer)
    last_error: Mapped[str | None] = mapped_column(Text)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Budget(Base):
    """Planned spending per currency; month == 0 is the budget for the whole year."""

    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("year", "month", "currency"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
