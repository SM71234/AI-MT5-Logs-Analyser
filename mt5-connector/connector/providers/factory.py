from __future__ import annotations

from connector.config import settings
from connector.providers.base import Provider


def get_provider() -> Provider:
    # Live by default. Mock is now strictly opt-in (MT5_MODE=mock) for offline dev;
    # any other value — including the default — uses the real MT5 Manager API.
    if settings.mt5_mode.lower() == "mock":
        from connector.providers.mock import MockProvider

        return MockProvider()
    from connector.providers.real import RealProvider

    return RealProvider()
