"""Telegram bot: reminders with a «pay» button, lists of payments, invoice cards and receipts.

The bot only talks in TELEGRAM_CHAT_ID. Navigation edits the message in place.
"""

import io
import logging
from datetime import timedelta
from html import escape

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.filters.callback_data import CallbackData
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    BotCommand,
    BufferedInputFile,
    CallbackQuery,
    ForceReply,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    User as TgUser,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit, periods, receipts, services
from ..config import settings
from ..db import SessionLocal
from ..models import Invoice, Occurrence
from ..texts import (
    STATUS_LINE,
    d,
    due_hint,
    money,
    month_title,
    plural,
    recurrence_text,
    status_of,
)

log = logging.getLogger(__name__)

ARCHIVE_PAGE = 6

bot: Bot | None = None
router = Router()


def enabled() -> bool:
    return bot is not None and bool(settings.telegram_chat_id)


# --- callback data ------------------------------------------------------------------


class Menu(CallbackData, prefix="m"):
    screen: str  # main | due | list


class Card(CallbackData, prefix="c"):
    occ: int
    src: str  # due | list | notif


class Pay(CallbackData, prefix="p"):
    occ: int
    src: str
    paid: bool


class Attach(CallbackData, prefix="a"):
    occ: int
    src: str


class Archive(CallbackData, prefix="r"):
    occ: int
    src: str
    page: int


class ArchiveMonth(CallbackData, prefix="rm"):
    occ: int  # the period to send the receipt of
    back: int  # the card to return to


class RemindPay(CallbackData, prefix="rp"):
    occ: int


class ReceiptUpload(StatesGroup):
    waiting = State()


def btn(text: str, data: CallbackData | str, style: str | None = None) -> InlineKeyboardButton:
    cb = data if isinstance(data, str) else data.pack()
    return InlineKeyboardButton(text=text, callback_data=cb, style=style)


def actor_label(user: TgUser | None) -> str:
    if user is None:
        return "Telegram"
    name = f"@{user.username}" if user.username else user.full_name
    return f"{name} (Telegram)"


def in_chat(chat_id: int) -> bool:
    return str(chat_id) == str(settings.telegram_chat_id).strip()


# --- data ---------------------------------------------------------------------------


def active(stmt):
    return stmt.join(Occurrence.invoice).where(Invoice.archived_at.is_(None))


async def due_list(db: AsyncSession) -> list[Occurrence]:
    """Overdue periods and those due within the reminder window."""
    limit = periods.today() + timedelta(days=settings.reminder_days)
    stmt = active(select(Occurrence)).where(Occurrence.is_paid.is_(False), Occurrence.due_date <= limit)
    return list(await db.scalars(stmt.order_by(Occurrence.due_date, Invoice.name)))


async def load(db: AsyncSession, occ_id: int) -> Occurrence | None:
    return await db.scalar(services.visible(select(Occurrence).where(Occurrence.id == occ_id)))


def occ_amount(occ: Occurrence) -> str:
    return money(occ.amount if occ.amount is not None else occ.invoice.amount, occ.invoice.currency)


# --- screens ------------------------------------------------------------------------


async def main_screen(db: AsyncSession) -> tuple[str, InlineKeyboardMarkup]:
    count = len(await due_list(db))
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [btn(f"Требуют оплаты ({count})", Menu(screen="due"), "danger")],
            [btn("Инвойсы", Menu(screen="list"))],
        ]
    )
    return "<b>Invoice Keeper</b>", kb


async def due_screen(db: AsyncSession) -> tuple[str, InlineKeyboardMarkup]:
    items = await due_list(db)
    today = periods.today()
    lines = ["<b>Требуют оплаты:</b>"]
    rows = []
    for i, occ in enumerate(items, 1):
        lines.append(
            f"\n{i}. <b>{escape(occ.invoice.name)}</b>\n"
            f"Сумма: {occ_amount(occ)}\n"
            f"Срок: {d(occ.due_date)} ({due_hint(False, occ.due_date, today)})"
        )
        overdue = occ.due_date < today
        rows.append([btn(f"К оплате {occ.invoice.name}", Card(occ=occ.id, src="due"), "danger" if overdue else None)])
    if not items:
        lines.append("\nВсё оплачено вовремя ✨")
    rows.append([btn("Назад в главное меню", Menu(screen="main"))])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=rows)


async def list_screen(db: AsyncSession) -> tuple[str, InlineKeyboardMarkup]:
    invoices = list(await db.scalars(select(Invoice).where(Invoice.archived_at.is_(None)).order_by(Invoice.name)))
    nexts = await services.next_occurrences(db, [i.id for i in invoices])
    rows = []
    for inv in invoices:
        occ = nexts.get(inv.id)
        if occ is None:
            continue
        rows.append([btn(f"{inv.name} - {occ_amount(occ)}", Card(occ=occ.id, src="list"))])
    rows.append([btn("Назад в главное меню", Menu(screen="main"))])
    text = "<b>Список инвойсов:</b>" if invoices else "<b>Список инвойсов:</b>\n\nПлатежей пока нет"
    return text, InlineKeyboardMarkup(inline_keyboard=rows)


def card_text(occ: Occurrence) -> str:
    inv = occ.invoice
    today = periods.today()
    status = status_of(occ.is_paid, occ.due_date, today)
    due = d(occ.due_date)
    if occ.is_paid:
        due += f" (оплачен {d(occ.paid_at)})" if occ.paid_at else " (оплачен)"
    else:
        due += f" ({due_hint(False, occ.due_date, today)})"
    lines = [
        f"Название: <b>{escape(inv.name)}</b>",
        f"Сумма: {occ_amount(occ)}",
        f"Периодичность: {recurrence_text(inv.recurrence, inv.start_date)}",
        f"Срок оплаты: {due}",
    ]
    if inv.category:
        lines.append(f"Категория: {escape(inv.category.name)}")
    if inv.link:
        lines.append(f"🌐 Биллинг: {escape(inv.link)}")
    lines.append(f"Текущий статус: {STATUS_LINE[status]}")
    receipt = f"прикреплен: {escape(occ.receipt_name)}" if occ.receipt_name else "ожидается"
    lines.append(f"Чек: {receipt}")
    return "\n".join(lines)


def card_keyboard(occ: Occurrence, src: str) -> InlineKeyboardMarkup:
    if occ.is_paid:
        pay = btn("↩️ Отменить оплату", Pay(occ=occ.id, src=src, paid=False), "success")
    else:
        pay = btn("💳 Оплатить", Pay(occ=occ.id, src=src, paid=True), "primary")
    back = Menu(screen="due" if src == "due" else "list" if src == "list" else "main")
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [pay, btn("📎 Добавить чек", Attach(occ=occ.id, src=src))],
            [btn("◀️ Назад", back), btn("🧾 Просмотреть чек", Archive(occ=occ.id, src=src, page=0))],
        ]
    )


async def archive_screen(db: AsyncSession, occ: Occurrence, src: str, page: int):
    limit = periods.today() + timedelta(days=31)
    stmt = (
        select(Occurrence)
        .where(Occurrence.invoice_id == occ.invoice_id, Occurrence.due_date <= limit)
        .order_by(Occurrence.due_date.desc())
    )
    items = list(await db.scalars(stmt))
    chunk = items[page * ARCHIVE_PAGE : (page + 1) * ARCHIVE_PAGE]
    rows = []
    for o in chunk:
        label = month_title(o.due_date.year, o.due_date.month)
        if occ.invoice.recurrence == "days30":
            label = f"{o.due_date.day} {label}"
        if o.receipt_name:
            label += " · 📎"
        rows.append([btn(label, ArchiveMonth(occ=o.id, back=occ.id))])
    nav = []
    if page > 0:
        nav.append(btn("< Назад", Archive(occ=occ.id, src=src, page=page - 1)))
    if (page + 1) * ARCHIVE_PAGE < len(items):
        nav.append(btn("Далее >", Archive(occ=occ.id, src=src, page=page + 1)))
    if nav:
        rows.append(nav)
    rows.append([btn("Назад к карточке", Card(occ=occ.id, src=src))])
    text = (
        f"<b>Архив чеков и квитанций: {escape(occ.invoice.name)}</b>\n\nВыберите расчетный месяц:"
        if items
        else f"<b>Архив чеков и квитанций: {escape(occ.invoice.name)}</b>\n\nПериодов пока нет"
    )
    return text, InlineKeyboardMarkup(inline_keyboard=rows)


# --- handlers -----------------------------------------------------------------------


async def show(target: Message | CallbackQuery, text: str, kb: InlineKeyboardMarkup) -> None:
    if isinstance(target, CallbackQuery):
        try:
            await target.message.edit_text(text, reply_markup=kb)
        except Exception:
            await target.message.answer(text, reply_markup=kb)
        await target.answer()
    else:
        await target.answer(text, reply_markup=kb)


@router.message(CommandStart())
@router.message(Command("menu"))
async def on_start(message: Message, state: FSMContext):
    await state.clear()
    async with SessionLocal() as db:
        await show(message, *await main_screen(db))


@router.callback_query(Menu.filter())
async def on_menu(query: CallbackQuery, callback_data: Menu, state: FSMContext):
    await state.clear()
    async with SessionLocal() as db:
        screen = {"main": main_screen, "due": due_screen, "list": list_screen}[callback_data.screen]
        await show(query, *await screen(db))


@router.callback_query(Card.filter())
async def on_card(query: CallbackQuery, callback_data: Card):
    async with SessionLocal() as db:
        occ = await load(db, callback_data.occ)
        if occ is None:
            await query.answer("Платёж не найден", show_alert=True)
            return
        await show(query, card_text(occ), card_keyboard(occ, callback_data.src))


@router.callback_query(Pay.filter())
async def on_pay(query: CallbackQuery, callback_data: Pay):
    async with SessionLocal() as db:
        occ = await load(db, callback_data.occ)
        if occ is None or occ.invoice.archived_at is not None:
            await query.answer("Платёж не найден", show_alert=True)
            return
        label = actor_label(query.from_user)
        name = f"«{occ.invoice.name}» за {d(occ.due_date)}"
        if callback_data.paid and not occ.is_paid:
            try:
                await services.mark_paid(db, occ, periods.today(), None, label)
            except services.DomainError as e:
                await query.answer(f"{e} — это делается в панели", show_alert=True)
                return
            audit.log(db, "occurrence.pay", f"Оплачен {name} через Telegram", actor_name=label, entity_type="occurrence", entity_id=occ.id)
        elif not callback_data.paid and occ.is_paid:
            await services.mark_unpaid(db, occ, None, label)
            audit.log(db, "occurrence.unpay", f"Отменена оплата {name} через Telegram", actor_name=label, entity_type="occurrence", entity_id=occ.id)
        await db.commit()
        await show(query, card_text(occ), card_keyboard(occ, callback_data.src))


@router.callback_query(RemindPay.filter())
async def on_remind_pay(query: CallbackQuery, callback_data: RemindPay):
    async with SessionLocal() as db:
        occ = await load(db, callback_data.occ)
        if occ is None or occ.invoice.archived_at is not None:
            await query.answer("Платёж не найден", show_alert=True)
            return
        label = actor_label(query.from_user)
        if not occ.is_paid:
            try:
                await services.mark_paid(db, occ, periods.today(), None, label)
            except services.DomainError as e:
                await query.answer(f"{e} — это делается в панели", show_alert=True)
                return
            audit.log(db, "occurrence.pay", f"Оплачен «{occ.invoice.name}» за {d(occ.due_date)} через Telegram", actor_name=label, entity_type="occurrence", entity_id=occ.id)
            await db.commit()
        text = reminder_text(occ) + f"\n\n✅ Оплачено {d(occ.paid_at)} — {escape(label)}"
        kb = InlineKeyboardMarkup(inline_keyboard=[[btn("Открыть карточку инвойса", Card(occ=occ.id, src="notif"))]])
        await query.message.edit_text(text, reply_markup=kb)
        await query.answer("Оплата отмечена")


@router.callback_query(Archive.filter())
async def on_archive(query: CallbackQuery, callback_data: Archive):
    async with SessionLocal() as db:
        occ = await load(db, callback_data.occ)
        if occ is None:
            await query.answer("Платёж не найден", show_alert=True)
            return
        await show(query, *await archive_screen(db, occ, callback_data.src, callback_data.page))


@router.callback_query(ArchiveMonth.filter())
async def on_archive_month(query: CallbackQuery, callback_data: ArchiveMonth):
    async with SessionLocal() as db:
        occ = await load(db, callback_data.occ)
        if occ is None:
            await query.answer("Период не найден", show_alert=True)
            return
        period = month_title(occ.due_date.year, occ.due_date.month)
        path = receipts.path_of(occ)
        if path is None:
            await query.answer(f"За {period} чек не прикреплён", show_alert=True)
            return
        caption = f"🧾 {escape(occ.invoice.name)} — {period}\nСрок: {d(occ.due_date)}, {occ_amount(occ)}"
        if occ.receipt_comment:
            caption += f"\n💬 {escape(occ.receipt_comment)}"
        await query.message.answer_document(
            BufferedInputFile(path.read_bytes(), filename=occ.receipt_name or path.name), caption=caption
        )
        await query.answer()


@router.callback_query(Attach.filter())
async def on_attach(query: CallbackQuery, callback_data: Attach, state: FSMContext):
    async with SessionLocal() as db:
        occ = await load(db, callback_data.occ)
        if occ is None:
            await query.answer("Платёж не найден", show_alert=True)
            return
        await state.set_state(ReceiptUpload.waiting)
        await state.update_data(occ=occ.id, src=callback_data.src)
        await query.message.answer(
            f"Ответьте на это сообщение файлом или фото чека для «{escape(occ.invoice.name)}» "
            f"за {d(occ.due_date)}. /menu — отмена.",
            reply_markup=ForceReply(selective=True, input_field_placeholder="Прикрепите чек"),
        )
        await query.answer()


@router.message(ReceiptUpload.waiting, F.document | F.photo)
async def on_receipt(message: Message, state: FSMContext):
    data = await state.get_data()
    await state.clear()
    if message.document:
        file_id, filename, mime = message.document.file_id, message.document.file_name or "receipt", message.document.mime_type
        size = message.document.file_size or 0
    else:
        photo = message.photo[-1]
        file_id, filename, mime, size = photo.file_id, f"receipt-{photo.file_unique_id}.jpg", "image/jpeg", photo.file_size or 0
    if size > receipts.MAX_SIZE:
        await message.answer("Файл больше 20 МБ")
        return
    buf = io.BytesIO()
    await message.bot.download(file_id, destination=buf)
    async with SessionLocal() as db:
        occ = await load(db, data["occ"])
        if occ is None:
            await message.answer("Платёж не найден")
            return
        await receipts.store(occ, filename, buf.getvalue(), mime)
        label = actor_label(message.from_user)
        audit.log(db, "occurrence.receipt", f"Чек «{occ.receipt_name}» к «{occ.invoice.name}» за {d(occ.due_date)} через Telegram", actor_name=label, entity_type="occurrence", entity_id=occ.id)
        await db.commit()
        await message.answer(card_text(occ), reply_markup=card_keyboard(occ, data.get("src", "list")))


@router.message(ReceiptUpload.waiting)
async def on_receipt_wrong(message: Message):
    await message.answer("Нужен файл или фото чека. /menu — отмена.")


# --- reminders ----------------------------------------------------------------------


def reminder_text(occ: Occurrence) -> str:
    left = (occ.due_date - periods.today()).days
    if left > 0:
        lead = f"До наступления срока оплаты регулярного счета {plural(left, 'остался', 'осталось', 'осталось')} {left} {plural(left, 'день', 'дня', 'дней')}."
    else:
        lead = "Сегодня наступает срок оплаты регулярного счета."
    lines = [
        lead,
        "",
        f"Услуга: <b>{escape(occ.invoice.name)}</b>",
        f"Сумма к оплате: {occ_amount(occ)}",
        f"Крайний срок: {d(occ.due_date)}",
    ]
    if occ.invoice.link:
        lines.append(f"Ссылка для оплаты: {escape(occ.invoice.link)}")
    return "\n".join(lines)


async def send_reminder(occ: Occurrence) -> bool:
    if bot is None:
        return False
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                btn("Оплатить", RemindPay(occ=occ.id), "success"),
                btn("Открыть карточку инвойса", Card(occ=occ.id, src="notif")),
            ]
        ]
    )
    try:
        await bot.send_message(settings.telegram_chat_id, reminder_text(occ), reply_markup=kb)
        return True
    except Exception:
        log.exception("Failed to send Telegram reminder for occurrence %s", occ.id)
        return False


# --- lifecycle ----------------------------------------------------------------------


def create() -> Dispatcher | None:
    global bot
    if not settings.telegram_bot_token:
        log.info("TELEGRAM_BOT_TOKEN is empty: the bot is disabled")
        return None
    bot = Bot(
        settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML, link_preview_is_disabled=True),
    )
    dp = Dispatcher()
    chat_filter_msg = F.chat.func(lambda chat: in_chat(chat.id))
    chat_filter_cb = F.message.chat.func(lambda chat: in_chat(chat.id))
    router.message.filter(chat_filter_msg)
    router.callback_query.filter(chat_filter_cb)
    dp.include_router(router)
    return dp


async def run(dp: Dispatcher) -> None:
    assert bot is not None
    await bot.set_my_commands([BotCommand(command="menu", description="Главное меню")])
    await dp.start_polling(bot, handle_signals=False, allowed_updates=["message", "callback_query"])


async def close() -> None:
    if bot is not None:
        await bot.session.close()
