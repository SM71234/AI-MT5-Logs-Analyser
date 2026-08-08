from __future__ import annotations

from datetime import datetime, timedelta
from typing import Protocol

from connector.schemas import AccountData, Credentials


class AccountNotFound(Exception):
    """The login does not exist on the MT5 server (distinct from connect/network errors)."""


def resolve_window(days: int, date_from: str | None, date_to: str | None) -> tuple[datetime, datetime]:
    """Resolve an explicit ISO date range (inclusive) or fall back to `days`."""
    to = datetime.utcnow()
    if date_to:
        to = datetime.fromisoformat(date_to) + timedelta(days=1)  # inclusive end-of-day
    frm = (datetime.fromisoformat(date_from) if date_from else to - timedelta(days=max(int(days), 1)))
    return frm, to


class Provider(Protocol):
    mode: str

    def test(self, creds: Credentials) -> tuple[bool, str, int | None]:
        """Return (ok, message, build)."""
        ...

    def fetch_account(
        self, creds: Credentials, account: int, days: int,
        date_from: str | None = None, date_to: str | None = None,
    ) -> AccountData:
        """Return positions + IP records for one account over the resolved window."""
        ...
