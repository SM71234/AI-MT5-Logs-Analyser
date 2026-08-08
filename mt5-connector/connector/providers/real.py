"""Real MT5 Manager provider (WINDOWS ONLY).

Uses MetaQuotes' `MT5Manager` package (native Manager API). Verified against the
installed build's API surface (MT5Manager 5.0.5735):
  * ManagerAPI.Connect(server, login, password, pumpmode, timeout) -> bool
  * MT5Manager.LastError() -> (code, retcode, message)
  * ManagerAPI.UserGet(login) -> MTUser  (.Name, .LastIP, .Registration, .LastAccess)
  * ManagerAPI.DealRequestByLogins([login], from_ts, to_ts) -> list[MTDeal]
  * MTDeal: .Login .PositionID .Action(0=buy,1=sell) .Entry(0=IN,1=OUT,2=INOUT)
            .Symbol .Time(unix s) .Volume(lots*1e4) .VolumeExt(lots*1e8)
            .Profit .Storage .Commission .Fee

Notes for THIS build (differs from the generic sample the code shipped with):
  * There is NO usable `PUMP_MODE_FULL`: its value is an all-bits mask and the
    server rejects it with a NETWORK error after the full timeout. We connect with
    the minimal `PUMP_MODE_USERS` flag, which is enough for UserGet + deal requests.
  * Connecting costs ~9s, so we CACHE the live manager session per (server, login)
    and reuse it across requests (bulk analysis of N accounts pays the connect once).
"""
from __future__ import annotations

import threading
import time
from datetime import datetime

from connector.config import settings
from connector.providers.base import AccountNotFound
from connector.schemas import AccountData, Credentials, IPRecord, LastLogin, Position


class ConnectorError(RuntimeError):
    pass


def _import_mt5():
    try:
        import MT5Manager  # type: ignore
        return MT5Manager
    except Exception as exc:  # pragma: no cover
        raise ConnectorError("MT5Manager not available (Windows + pip install MT5Manager).") from exc


def _last_error(M) -> str:
    try:
        return f"{M.LastError()}"
    except Exception:
        return "unknown error"


def _is_network_error(M) -> bool:
    """True when the last error looks like a dropped/again-needed connection."""
    try:
        err = M.LastError()
        text = f"{err}".upper()
        return "NETWORK" in text or "CONNECT" in text or "NOTCONNECTED" in text or "TIMEOUT" in text
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# Connection cache (one warm manager per server+login, reused across requests).
# A background keepalive heartbeat pings each session and transparently
# reconnects dropped ones, so a connected broker stays connected.
# --------------------------------------------------------------------------- #
_LOCK = threading.RLock()          # serialize all Manager API access (not thread-safe)
_CACHE: dict[tuple, dict] = {}     # (server, login, password) -> {manager, last, M}
_KEEPALIVE_STARTED = False


def _pump_mode(M) -> int:
    # Minimal subscription that still allows UserGet + deal requests on this build.
    return int(M.ManagerAPI.EnPumpModes.PUMP_MODE_USERS)


def _connect(M, creds: Credentials):
    manager = M.ManagerAPI()
    ok = manager.Connect(
        creds.server, int(creds.login), creds.password,
        _pump_mode(M), settings.mt5_timeout_ms,
    )
    if not ok:
        raise ConnectorError(f"Connect failed: {_last_error(M)}")
    return manager


def _key(creds: Credentials) -> tuple:
    return (creds.server, int(creds.login), creds.password)


def _acquire(M, creds: Credentials):
    """Return a live, cached manager for these creds (connecting on demand)."""
    key = _key(creds)
    ent = _CACHE.get(key)
    ttl = settings.mt5_session_ttl
    if ent and (ttl <= 0 or (time.time() - ent["last"]) < ttl):
        ent["last"] = time.time()
        return ent["manager"]
    if ent:  # idle past a positive TTL — drop it before reconnecting
        _drop(key)
    manager = _connect(M, creds)
    _CACHE[key] = {"manager": manager, "last": time.time(), "M": M}
    _ensure_keepalive()
    return manager


def _drop(key: tuple) -> None:
    ent = _CACHE.pop(key, None)
    if ent:
        try:
            ent["manager"].Disconnect()
        except Exception:
            pass


def _is_alive(M, manager, login: int) -> bool:
    """Cheap liveness probe reusing a known-good call (UserGet). A missing user is
    fine (still connected); only a network-class error means the socket dropped."""
    try:
        manager.UserGet(int(login))
    except Exception:
        pass
    return not _is_network_error(M)


def _keepalive_once() -> None:
    """One heartbeat pass: probe every cached session and reconnect any that dropped.
    Never raises — a bad pass must not kill the daemon thread."""
    with _LOCK:
        for key in list(_CACHE.keys()):
            ent = _CACHE.get(key)
            if not ent:
                continue
            M, manager = ent["M"], ent["manager"]
            server, login, password = key
            try:
                if _is_alive(M, manager, login):
                    continue
                # Dropped — reconnect in place so callers keep using the same key.
                try:
                    manager.Disconnect()
                except Exception:
                    pass
                creds = Credentials(server=server, login=login, password=password)
                ent["manager"] = _connect(M, creds)
                ent["last"] = time.time()
            except Exception:
                # Reconnect failed (e.g. server unreachable now); drop so the next
                # real request retries with a fresh connect + proper error surfacing.
                _CACHE.pop(key, None)


def _keepalive_loop(interval: int) -> None:
    while True:
        time.sleep(interval)
        _keepalive_once()


def _ensure_keepalive() -> None:
    """Start the heartbeat thread once, lazily on the first successful connect."""
    global _KEEPALIVE_STARTED
    if _KEEPALIVE_STARTED:
        return
    interval = settings.mt5_keepalive_sec
    if interval and interval > 0:
        threading.Thread(target=_keepalive_loop, args=(interval,),
                         name="mt5-keepalive", daemon=True).start()
    _KEEPALIVE_STARTED = True


class RealProvider:
    mode = "real"

    def test(self, creds: Credentials) -> tuple[bool, str, int | None]:
        M = _import_mt5()
        with _LOCK:
            _acquire(M, creds)  # raises ConnectorError on bad creds / unreachable server
            return True, f"Connected to {creds.server} as {creds.login}", None

    def fetch_account(
        self, creds: Credentials, account: int, days: int,
        date_from: str | None = None, date_to: str | None = None,
    ) -> AccountData:
        M = _import_mt5()
        with _LOCK:
            try:
                return self._fetch(M, creds, account, days, date_from, date_to)
            except ConnectorError:
                # Warm session likely dropped — reconnect once and retry.
                if _is_network_error(M):
                    _drop(_key(creds))
                    return self._fetch(M, creds, account, days, date_from, date_to)
                raise

    # -- internals ---------------------------------------------------------- #
    def _fetch(
        self, M, creds: Credentials, account: int, days: int,
        date_from: str | None, date_to: str | None,
    ) -> AccountData:
        from connector.providers.base import resolve_window

        manager = _acquire(M, creds)
        frm, to = resolve_window(days, date_from, date_to)

        user = manager.UserGet(int(account))
        if not user:
            # Distinguish "no such login" from a dropped connection.
            if _is_network_error(M):
                raise ConnectorError(f"UserGet dropped: {_last_error(M)}")
            raise AccountNotFound(f"Account {account} not found on {creds.server}")
        name = getattr(user, "Name", None)
        last_ip = getattr(user, "LastIP", None)
        last_access = getattr(user, "LastAccess", None)

        deals = manager.DealRequestByLogins([int(account)], int(frm.timestamp()), int(to.timestamp()))
        if deals is None:
            raise ConnectorError(f"DealRequestByLogins failed: {_last_error(M)}")
        positions = self._deals_to_positions(deals)

        ips: list[IPRecord] = []
        last_login = None
        if last_ip and str(last_ip) not in ("", "0.0.0.0"):
            seen = (datetime.utcfromtimestamp(last_access).isoformat()
                    if isinstance(last_access, (int, float)) and last_access else to.isoformat())
            ips.append(IPRecord(ip=str(last_ip), count=max(len(positions), 1), last_seen=seen))
            last_login = LastLogin(ip=str(last_ip), date=seen)

        return AccountData(account=account, name=name, positions=positions, ips=ips,
                           last_login=last_login, mode=self.mode)

    @staticmethod
    def _volume_lots(d) -> float:
        ext = getattr(d, "VolumeExt", 0) or 0
        if ext:
            return float(ext) / 1e8   # 8-decimal lots
        return float(getattr(d, "Volume", 0) or 0) / 1e4  # 4-decimal lots

    @classmethod
    def _deals_to_positions(cls, deals) -> list[Position]:
        opens: dict[int, dict] = {}
        closed: dict[int, dict] = {}
        for d in deals or []:
            pid = getattr(d, "PositionID", 0) or 0
            symbol = getattr(d, "Symbol", "") or ""
            if pid <= 0 or not symbol:
                continue  # balance/credit/correction deals — not trades
            entry = getattr(d, "Entry", None)
            t = getattr(d, "Time", 0) or 0
            ts = datetime.utcfromtimestamp(t) if t else datetime.utcnow()
            if entry == 0:  # ENTRY_IN -> opening
                opens[pid] = {
                    "symbol": symbol,
                    "type": "buy" if getattr(d, "Action", 0) == 0 else "sell",
                    "open_time": ts,
                    "volume": cls._volume_lots(d),
                }
            else:  # ENTRY_OUT / ENTRY_INOUT -> closing
                net = (float(getattr(d, "Profit", 0) or 0) + float(getattr(d, "Storage", 0) or 0)
                       + float(getattr(d, "Commission", 0) or 0) + float(getattr(d, "Fee", 0) or 0))
                c = closed.setdefault(pid, {"close_time": ts, "profit": 0.0})
                c["profit"] += net
                c["close_time"] = max(c["close_time"], ts)

        positions: list[Position] = []
        for pid, o in opens.items():
            c = closed.get(pid)
            if not c:
                continue  # still open -> no closed round-trip to analyze
            positions.append(Position(
                symbol=o["symbol"], type=o["type"],
                open_time=o["open_time"].strftime("%Y.%m.%d %H:%M:%S"),
                close_time=c["close_time"].strftime("%Y.%m.%d %H:%M:%S"),
                volume=round(o["volume"], 2), profit=round(c["profit"], 2),
            ))
        positions.sort(key=lambda p: p.open_time)
        return positions
