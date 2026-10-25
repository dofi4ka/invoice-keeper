"""Bank of Russia exchange rates, used only to scale dashboard charts to one axis."""

import logging
import time
import xml.etree.ElementTree as ET

import httpx

log = logging.getLogger(__name__)

CBR_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
TTL = 6 * 3600
FALLBACK = {"RUB": 1.0, "USD": 80.0, "EUR": 93.0}

_cache: dict = {"at": 0.0, "date": None, "rates": None, "source": "fallback"}


async def get_rates() -> dict:
    if _cache["rates"] and time.time() - _cache["at"] < TTL:
        return _cache
    try:
        async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "Mozilla/5.0 InvoiceKeeper"}) as client:
            response = await client.get(CBR_URL)
            response.raise_for_status()
        root = ET.fromstring(response.content)
        rates = {"RUB": 1.0}
        for valute in root.findall("Valute"):
            code = valute.findtext("CharCode")
            if code in ("USD", "EUR"):
                value = float((valute.findtext("Value") or "0").replace(",", "."))
                nominal = float(valute.findtext("Nominal") or "1")
                rates[code] = value / nominal
        if len(rates) == 3:
            _cache.update(at=time.time(), date=root.get("Date"), rates=rates, source="cbr")
            return _cache
    except Exception as e:
        log.warning("CBR rates unavailable: %s", e)
    if not _cache["rates"]:
        _cache.update(rates=FALLBACK, source="fallback")
    _cache["at"] = time.time() - TTL + 600  # retry in 10 minutes
    return _cache
