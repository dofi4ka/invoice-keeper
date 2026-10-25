import mimetypes
import re
import secrets
from pathlib import Path

import aiofiles

from .config import settings
from .models import Occurrence

MAX_SIZE = 20 * 1024 * 1024


def receipts_dir() -> Path:
    path = Path(settings.data_dir) / "receipts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def safe_name(name: str) -> str:
    name = Path(name or "receipt").name
    name = re.sub(r"[\x00-\x1f/\\]", "_", name).strip() or "receipt"
    return name[:200]


async def store(occ: Occurrence, filename: str, content: bytes, mime: str | None) -> None:
    """Saves the receipt for a period, replacing the previous one."""
    remove(occ)
    name = safe_name(filename)
    suffix = Path(name).suffix[:10]
    stored = f"{occ.id}-{secrets.token_hex(8)}{suffix}"
    async with aiofiles.open(receipts_dir() / stored, "wb") as f:
        await f.write(content)
    occ.receipt_name = name
    occ.receipt_path = stored
    occ.receipt_mime = mime or mimetypes.guess_type(name)[0] or "application/octet-stream"


def remove(occ: Occurrence) -> None:
    if occ.receipt_path:
        (receipts_dir() / occ.receipt_path).unlink(missing_ok=True)
    occ.receipt_name = occ.receipt_path = occ.receipt_mime = None


def path_of(occ: Occurrence) -> Path | None:
    if not occ.receipt_path:
        return None
    path = receipts_dir() / occ.receipt_path
    return path if path.exists() else None
