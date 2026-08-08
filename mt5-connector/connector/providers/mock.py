"""Deterministic synthetic data so the whole analysis pipeline works without a live MT5.

Seeded by account number -> stable results across runs. Generates a realistic mix
of scalping/burst/reversal trades and 2–4 source IPs (some accounts get a
datacenter/VPS IP so VPS detection is demonstrable end-to-end).
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from connector.schemas import AccountData, Credentials, IPRecord, LastLogin, Position

_SYMBOLS = ["EURUSD", "GBPUSD", "XAUUSD", "USDJPY", "BTCUSD"]

# A few well-known IPs spanning residential vs hosting so classification is visible.
_RESIDENTIAL_IPS = ["49.36.220.10", "86.120.45.7", "73.162.12.200"]
_HOSTING_IPS = ["165.227.9.45", "104.248.1.10", "45.76.33.21"]  # DigitalOcean / Vultr ranges


class MockProvider:
    mode = "mock"

    def test(self, creds: Credentials) -> tuple[bool, str, int | None]:
        return True, f"[mock] would connect to {creds.server} as manager {creds.login}", 4260

    def fetch_account(
        self, creds: Credentials, account: int, days: int,
        date_from: str | None = None, date_to: str | None = None,
    ) -> AccountData:
        from connector.providers.base import resolve_window

        rng = random.Random(account)
        n = rng.randint(60, 220)
        start, _end = resolve_window(days, date_from, date_to)
        positions: list[Position] = []
        t = start
        for _ in range(n):
            t += timedelta(seconds=rng.randint(5, 4 * 3600))
            sym = rng.choice(_SYMBOLS)
            side = rng.choice(["buy", "sell"])
            # bias hold time so some accounts look scalpy
            hold = rng.choice([1, 2, 5, 30, 120, 600, 3600, 4 * 3600])
            close = t + timedelta(seconds=hold)
            vol = round(rng.choice([0.01, 0.05, 0.1, 0.5, 1.0]) * rng.randint(1, 5), 2)
            profit = round(rng.uniform(-300, 320), 2)
            positions.append(
                Position(
                    symbol=sym,
                    type=side,
                    open_time=t.strftime("%Y.%m.%d %H:%M:%S"),
                    close_time=close.strftime("%Y.%m.%d %H:%M:%S"),
                    volume=vol,
                    profit=profit,
                )
            )

        # IP records: 2–4 IPs; ~40% of accounts include a hosting/VPS IP.
        ips: list[IPRecord] = []
        res_ip = _RESIDENTIAL_IPS[account % len(_RESIDENTIAL_IPS)]
        ips.append(IPRecord(ip=res_ip, count=rng.randint(40, 200),
                            last_seen=(datetime.utcnow() - timedelta(days=rng.randint(0, 3))).isoformat()))
        ips.append(IPRecord(ip=_RESIDENTIAL_IPS[(account + 1) % len(_RESIDENTIAL_IPS)],
                            count=rng.randint(5, 40),
                            last_seen=(datetime.utcnow() - timedelta(days=rng.randint(4, 20))).isoformat()))
        if account % 5 in (0, 2):
            ips.append(IPRecord(ip=_HOSTING_IPS[account % len(_HOSTING_IPS)],
                                count=rng.randint(10, 90),
                                last_seen=(datetime.utcnow() - timedelta(hours=rng.randint(1, 48))).isoformat()))

        last_login = LastLogin(ip=ips[0].ip, date=ips[0].last_seen) if ips else None
        return AccountData(
            account=account,
            name=f"Trader {account}",
            positions=positions,
            ips=ips,
            last_login=last_login,
            mode=self.mode,
        )
