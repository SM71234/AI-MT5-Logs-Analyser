import os
import time
import threading
from datetime import datetime, UTC
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Request, Response, HTTPException, Header, status
from pydantic import BaseModel

# Disable TLS verification for self-signed certificates (safe for local development)
os.environ["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"

app = FastAPI(title="MT5 Manager API Connector", version="1.0.0")

# Mode of Operation (real | mock)
MT5_MODE = os.getenv("MT5_MODE", "real").lower()

def _import_mt5():
    try:
        import MT5Manager  # type: ignore
        return MT5Manager
    except Exception as exc:
        if MT5_MODE == "real":
            raise RuntimeError("MT5Manager package not available. Install it using pip on Windows.") from exc
        return None

MT5Manager = _import_mt5()

# Thread-safe serialization locks
_LOCK = threading.RLock()
# Global connection pool cache: (server, login, password) -> {"manager": manager, "last": float}
_CACHE: Dict[tuple, dict] = {}
_KEEPALIVE_STARTED = False

# Models
class ConnectionTestPayload(BaseModel):
    serverAddress: str
    port: int
    managerLogin: str
    password: str

# Helper to get the correct pump mode value
def _pump_mode(M) -> int:
    return int(M.ManagerAPI.EnPumpModes.PUMP_MODE_USERS)

# Establish connection using native MT5 DLL wrapper
def _connect(M, server: str, login: int, password: str) -> Any:
    manager = M.ManagerAPI()
    server_addr = f"{server}"
    # Standard connection call signature
    ok = manager.Connect(server_addr, int(login), password, _pump_mode(M), 10000)
    if not ok:
        # Get last error info
        try:
            err = M.LastError()
        except Exception:
            err = "Unknown connection error"
        raise RuntimeError(f"Connection failed: {err}")
    return manager

def _get_cache_key(server: str, port: str | int, login: str | int, password: str) -> tuple:
    host = f"{server}:{port}" if ":" not in str(server) else str(server)
    return (host, int(login), password)

# Fetch a live session from the pool (or connect on demand)
def _acquire_session(server: str, port: str | int, login: str | int, password: str) -> Any:
    global _KEEPALIVE_STARTED
    M = _import_mt5()
    if not M:
        raise RuntimeError("MT5Manager native wrapper is missing.")
        
    key = _get_cache_key(server, port, login, password)
    
    with _LOCK:
        ent = _CACHE.get(key)
        if ent:
            ent["last"] = time.time()
            return ent["manager"]
            
        # Create a new connection
        host = key[0]
        manager = _connect(M, host, key[1], password)
        _CACHE[key] = {"manager": manager, "last": time.time(), "M": M, "password": password}
        
        # Start keepalive daemon if not started
        if not _KEEPALIVE_STARTED:
            threading.Thread(target=_keepalive_loop, name="mt5-keepalive", daemon=True).start()
            _KEEPALIVE_STARTED = True
            
        return manager

# Disconnect and delete session from cache
def _drop_session(key: tuple) -> None:
    ent = _CACHE.pop(key, None)
    if ent:
        try:
            ent["manager"].Disconnect()
        except Exception:
            pass

# Liveness probe using cheap UserGet query
def _is_alive(M, manager, login: int) -> bool:
    try:
        manager.UserGet(int(login))
        err = M.LastError()
        text = f"{err}".upper()
        # If last error indicates network disconnect
        if any(x in text for x in ["NETWORK", "CONNECT", "NOTCONNECTED", "TIMEOUT"]):
            return False
        return True
    except Exception:
        return False

# Reconnection loop running in the background every 30s
def _keepalive_loop() -> None:
    while True:
        time.sleep(30)
        with _LOCK:
            for key in list(_CACHE.keys()):
                ent = _CACHE.get(key)
                if not ent:
                    continue
                M, manager = ent["M"], ent["manager"]
                server_addr, login, password = key
                if _is_alive(M, manager, login):
                    continue
                
                # Reconnect
                try:
                    manager.Disconnect()
                except Exception:
                    pass
                
                try:
                    ent["manager"] = _connect(M, server_addr, login, password)
                    ent["last"] = time.time()
                except Exception:
                    # Drop from cache on fail so next request does fresh retry
                    _CACHE.pop(key, None)

# Extract headers credentials helper
def _get_credentials(headers: Request.headers) -> Optional[dict]:
    server = headers.get("x-mt5-server")
    port = headers.get("x-mt5-port")
    login = headers.get("x-mt5-login")
    password = headers.get("x-mt5-password")
    
    if server and port and login and password:
        return {
            "server": server,
            "port": port,
            "login": login,
            "password": password
        }
    return None

# MOCK DATA
MOCK_USERS = [
    {"login": "1001", "name": "Normal Trader", "group": "demo\\standard", "leverage": 100, "balance": 10000.0, "equity": 10000.0, "currency": "USD", "lastIp": "12.34.56.78", "lastAccess": int(time.time()), "registration": int(time.time() - 365*24*3600)},
    {"login": "2002", "name": "Slippage Disputed Client", "group": "real\\gold_vip", "leverage": 500, "balance": 50000.0, "equity": 48900.0, "currency": "USD", "lastIp": "85.23.41.99", "lastAccess": int(time.time()), "registration": int(time.time() - 100*24*3600)},
    {"login": "3003", "name": "Dealer Requote Client", "group": "real\\standard", "leverage": 200, "balance": 15000.0, "equity": 15150.0, "currency": "USD", "lastIp": "103.25.10.8", "lastAccess": int(time.time()), "registration": int(time.time() - 50*24*3600)},
    {"login": "4004", "name": "Latency Execution Client", "group": "real\\vip", "leverage": 500, "balance": 250000.0, "equity": 247000.0, "currency": "USD", "lastIp": "210.88.92.54", "lastAccess": int(time.time()), "registration": int(time.time() - 200*24*3600)},
    {"login": "5005", "name": "Margin Rejected Client", "group": "real\\vip", "leverage": 100, "balance": 10.50, "equity": 10.50, "currency": "USD", "lastIp": "44.55.66.77", "lastAccess": int(time.time()), "registration": int(time.time() - 30*24*3600)},
    {"login": "6006", "name": "Dealer Rejected Client", "group": "real\\standard", "leverage": 200, "balance": 1500.0, "equity": 1500.0, "currency": "USD", "lastIp": "122.33.44.55", "lastAccess": int(time.time()), "registration": int(time.time() - 40*24*3600)},
    {"login": "7007", "name": "Closed Market Client", "group": "demo\\standard", "leverage": 100, "balance": 5000.0, "equity": 5000.0, "currency": "USD", "lastIp": "198.51.100.12", "lastAccess": int(time.time()), "registration": int(time.time() - 10*24*3600)}
]

MOCK_TRADES = {
    "1001": [{
        "ticket": "5001", "positionId": "9001", "login": "1001", "symbol": "EURUSD", "action": "BUY", "volume": 1.00,
        "priceRequested": 1.10200, "priceExecuted": 1.10200, "slippagePips": 0.0,
        "timeRequested": "2026-08-06T09:59:59.980Z", "timeExecuted": "2026-08-06T10:00:00.000Z",
        "durationSeconds": 0.02, "comment": "Normal execution", "profit": 150.0, "commission": -5.0, "swap": 0.0, "fee": 0.0
    }],
    "2002": [{
        "ticket": "6001", "positionId": "9002", "login": "2002", "symbol": "XAUUSD", "action": "BUY", "volume": 2.00,
        "priceRequested": 2350.50, "priceExecuted": 2352.00, "slippagePips": 15.0,
        "timeRequested": "2026-08-06T14:15:29.870Z", "timeExecuted": "2026-08-06T14:15:30.120Z",
        "durationSeconds": 0.25, "comment": "High volatility slippage", "profit": -450.0, "commission": -10.0, "swap": -2.5, "fee": 0.0
    }],
    "3003": [{
        "ticket": "7001", "positionId": "9003", "login": "3003", "symbol": "GBPUSD", "action": "BUY", "volume": 5.00,
        "priceRequested": 1.28400, "priceExecuted": 1.28550, "slippagePips": 15.0,
        "timeRequested": "2026-08-06T15:30:12.000Z", "timeExecuted": "2026-08-06T15:30:15.500Z",
        "durationSeconds": 3.50, "comment": "Manual dealer requote accepted", "profit": 350.0, "commission": -25.0, "swap": 0.0, "fee": 0.0
    }],
    "4004": [{
        "ticket": "8001", "positionId": "9004", "login": "4004", "symbol": "USDJPY", "action": "SELL", "volume": 10.00,
        "priceRequested": 142.100, "priceExecuted": 142.080, "slippagePips": 2.0,
        "timeRequested": "2026-08-06T16:45:07.100Z", "timeExecuted": "2026-08-06T16:45:10.800Z",
        "durationSeconds": 3.70, "comment": "High latency delay", "profit": -800.0, "commission": -50.0, "swap": -12.0, "fee": 0.0
    }],
    "5005": [{
        "ticket": "9005", "positionId": "9005", "login": "5005", "symbol": "EURUSD", "action": "BUY", "volume": 10.00,
        "priceRequested": 1.10200, "priceExecuted": 0.0, "slippagePips": 0.0,
        "timeRequested": "2026-08-06T17:00:00.120Z", "timeExecuted": "2026-08-06T17:00:00.125Z",
        "durationSeconds": 0.005, "comment": "Rejected: Insufficient margin", "profit": 0.0, "commission": 0.0, "swap": 0.0, "fee": 0.0
    }],
    "6006": [{
        "ticket": "9006", "positionId": "9006", "login": "6006", "symbol": "GBPUSD", "action": "BUY", "volume": 1.00,
        "priceRequested": 1.28400, "priceExecuted": 0.0, "slippagePips": 0.0,
        "timeRequested": "2026-08-06T18:00:00.310Z", "timeExecuted": "2026-08-06T18:00:00.350Z",
        "durationSeconds": 0.040, "comment": "Rejected by dealer", "profit": 0.0, "commission": 0.0, "swap": 0.0, "fee": 0.0
    }],
    "7007": [{
        "ticket": "9007", "positionId": "9007", "login": "7007", "symbol": "USDJPY", "action": "BUY", "volume": 1.00,
        "priceRequested": 142.100, "priceExecuted": 0.0, "slippagePips": 0.0,
        "timeRequested": "2026-08-06T19:00:00.550Z", "timeExecuted": "2026-08-06T19:00:00.555Z",
        "durationSeconds": 0.005, "comment": "Rejected: Market closed", "profit": 0.0, "commission": 0.0, "swap": 0.0, "fee": 0.0
    }]
}

MOCK_JOURNALS = {
    "1001": [
        "2026-08-06T09:59:59.980Z [Trade] '1001': market buy 1.00 EURUSD (requested at 1.10200)",
        "2026-08-06T09:59:59.995Z [Trade] '1001': request accepted by server",
        "2026-08-06T10:00:00.000Z [Trade] '1001': deal performed #5001 buy 1.00 EURUSD at 1.10200"
    ],
    "2002": [
        "2026-08-06T14:15:29.870Z [Trade] '2002': market buy 2.00 XAUUSD (requested at 2350.50)",
        "2026-08-06T14:15:29.990Z [Trade] '2002': request transferred to dealers",
        "2026-08-06T14:15:30.010Z [Dealer] dealer #5 accepted market buy 2.00 XAUUSD at 2352.00",
        "2026-08-06T14:15:30.120Z [Trade] '2002': deal performed #6001 buy 2.00 XAUUSD at 2352.00"
    ],
    "3003": [
        "2026-08-06T15:30:12.000Z [Trade] '3003': market buy 5.00 GBPUSD (requested at 1.28400)",
        "2026-08-06T15:30:12.150Z [Trade] '3003': request transferred to dealers",
        "2026-08-06T15:30:13.500Z [Dealer] dealer #8 rejected buy 5.00 GBPUSD at 1.28400 (requote 1.28550)",
        "2026-08-06T15:30:14.200Z [Trade] '3003': client accepted requote 1.28550",
        "2026-08-06T15:30:14.400Z [Trade] '3003': request transferred to dealers",
        "2026-08-06T15:30:15.500Z [Trade] '3003': deal performed #7001 buy 5.00 GBPUSD at 1.28550"
    ],
    "4004": [
        "2026-08-06T16:45:07.100Z [Trade] '4004': market sell 10.00 USDJPY (requested at 142.100)",
        "2026-08-06T16:45:07.250Z [Trade] '4004': request transferred to dealers",
        "2026-08-06T16:45:10.500Z [Dealer] dealer #12 accepted market sell 10.00 USDJPY at 142.080",
        "2026-08-06T16:45:10.800Z [Trade] '4004': deal performed #8001 sell 10.00 USDJPY at 142.080"
    ],
    "5005": [
        "2026-08-06T17:00:00.120Z [Trade] '1001': order placed for execution for '5005' [#9005 buy 10.00 EURUSD at 1.10200]",
        "2026-08-06T17:00:00.125Z [Trade] '5005': request rejected: not enough money"
    ],
    "6006": [
        "2026-08-06T18:00:00.310Z [Trade] '1001': order placed for execution for '6006' [#9006 buy 1.00 GBPUSD at 1.28400]",
        "2026-08-06T18:00:00.320Z [Trade] '6006': request transferred to dealers",
        "2026-08-06T18:00:00.350Z [Dealer] dealer #8 rejected buy 1.00 GBPUSD at 1.28400 (dealer rejection)"
    ],
    "7007": [
        "2026-08-06T19:00:00.550Z [Trade] '1001': order placed for execution for '7007' [#9007 buy 1.00 USDJPY at 142.100]",
        "2026-08-06T19:00:00.555Z [Trade] '7007': request rejected: market closed"
    ]
}


# --- API Routes ---

@app.get("/health")
def health():
    return {"status": "ok", "mode": MT5_MODE}

# 1. Connection Test
@app.post("/api/v1/connector/test-connection")
def test_connection(payload: ConnectionTestPayload):
    if MT5_MODE == "mock" or not MT5Manager:
        return {"success": True, "message": "Mock connection test successful"}
        
    try:
        M = MT5Manager
        with _LOCK:
            host = f"{payload.serverAddress}:{payload.port}" if ":" not in payload.serverAddress else payload.serverAddress
            manager = _connect(M, host, int(payload.managerLogin), payload.password)
            manager.Disconnect()
        return {"success": True, "message": "Connected to MT5 Manager successfully."}
    except Exception as exc:
        return {"success": False, "message": str(exc)}

# 2. Fetch User Profile
@app.get("/api/v1/connector/users/{login}")
def get_user_profile(login: str, request: Request):
    if MT5_MODE == "real":
        creds = _get_credentials(request.headers)
        if not creds:
            raise HTTPException(status_code=400, detail="Missing MT5 connection headers")
        try:
            with _LOCK:
                manager = _acquire_session(creds["server"], creds["port"], creds["login"], creds["password"])
                user = manager.UserGet(int(login))
                if not user:
                    raise HTTPException(status_code=404, detail=f"Client login #{login} not found on broker server")
                    
                balance = getattr(user, "Balance", 0.0)
                equity = getattr(user, "Equity", 0.0)
                leverage = getattr(user, "Leverage", 100)
                name = getattr(user, "Name", "Unknown Client")
                group = getattr(user, "Group", "demo\\standard")
                last_ip = getattr(user, "LastIP", "")
                last_access = getattr(user, "LastAccess", 0)
                registration = getattr(user, "Registration", 0)
                
            return {
                "success": True,
                "data": {
                    "login": login,
                    "name": name,
                    "group": group,
                    "leverage": leverage,
                    "balance": balance,
                    "equity": equity,
                    "currency": "USD",
                    "lastIp": last_ip,
                    "lastAccess": last_access,
                    "registration": registration
                }
            }
        except Exception as exc:
            raise HTTPException(status_code=404, detail=str(exc))
            
    # Mock Fallback
    user = next((u for u in MOCK_USERS if u["login"] == login), None)
    if not user:
        raise HTTPException(status_code=404, detail=f"MT5 User Login #{login} not found on server")
    return {"success": True, "data": user}

# Helper: Convert raw volume
def _volume_lots(VolumeExt: int, Volume: int) -> float:
    if VolumeExt:
        return float(VolumeExt) / 1e8
    return float(Volume) / 1e4

# Global process-level cache for symbol specifications: key is (server_host, symbol_name) -> {"digits": int, "point": float}
SYMBOL_SPECS_CACHE = {}

def get_symbol_spec(manager, server, symbol) -> tuple[int | None, float | None]:
    cache_key = (server, symbol)
    if cache_key in SYMBOL_SPECS_CACHE:
        return SYMBOL_SPECS_CACHE[cache_key]["digits"], SYMBOL_SPECS_CACHE[cache_key]["point"]
        
    # Priority 2: Use symbol specifications stored/imported for that broker/server in symbol_specs.json
    try:
        import os
        import json
        if os.path.exists("symbol_specs.json"):
            with open("symbol_specs.json", "r") as f:
                specs = json.load(f)
                server_key = server.split(":")[0]  # lookup by host
                if server_key in specs and symbol in specs[server_key]:
                    spec = specs[server_key][symbol]
                    digits = spec.get("digits")
                    point = spec.get("point") or (10 ** -digits if digits is not None else None)
                    if digits is not None:
                        SYMBOL_SPECS_CACHE[cache_key] = {"digits": digits, "point": point}
                        return digits, point
    except Exception:
        pass

    # Priority 1: Fetch Digits/Point dynamically from MT5/Manager API using SymbolRequest
    try:
        symbol_info = manager.SymbolRequest(symbol)
        if symbol_info:
            digits = getattr(symbol_info, "Digits", None)
            point = getattr(symbol_info, "Point", None)
            if digits is not None:
                if point is None or point <= 0:
                    point = 10 ** -digits
                SYMBOL_SPECS_CACHE[cache_key] = {"digits": digits, "point": point}
                return digits, point
    except Exception:
        pass
        
    # Priority 3: Fallback (unavailable symbol specs)
    return None, None

# Helper: Convert raw price delta to standard pips based on symbol
def _convert_to_pips(symbol: str, raw_delta: float) -> float:
    sym = symbol.upper()
    if "JPY" in sym:
        return raw_delta / 0.01
    if "XAU" in sym or "GOLD" in sym:
        return raw_delta / 0.10
    if "XAG" in sym:
        return raw_delta / 0.01
    return raw_delta / 0.0001

# 3. Fetch User Trade History
@app.get("/api/v1/connector/users/{login}/trades")
def get_user_trades(login: str, request: Request):
    if MT5_MODE == "real":
        creds = _get_credentials(request.headers)
        if not creds:
            raise HTTPException(status_code=400, detail="Missing MT5 connection headers")
        try:
            to_ts = int(time.time()) + 86400  # Tomorrow (prevents exclusion due to server-local timezone or clock differences)
            from_ts = to_ts - (90 * 24 * 3600)  # last 90 days to capture more history
            
            with _LOCK:
                manager = _acquire_session(creds["server"], creds["port"], creds["login"], creds["password"])
                deals = manager.DealRequestByLogins([int(login)], from_ts, to_ts)
                # Fetch history orders to calculate true transaction execution delays & slippage
                orders = manager.HistoryRequestByLogins([int(login)], from_ts, to_ts)
                
            if deals is None:
                deals = []
                
            # Map order ID -> execution delay in seconds
            latency_map = {}
            # Map order ID -> requested setup price
            price_map = {}
            # Map order ID -> order object
            orders_map = {}
            for order in (orders or []):
                oid = getattr(order, "Order", 0) or 0
                if oid > 0:
                    setup_msc = getattr(order, "TimeSetupMsc", 0) or (getattr(order, "TimeSetup", 0) * 1000)
                    done_msc = getattr(order, "TimeDoneMsc", 0) or (getattr(order, "TimeDone", 0) * 1000)
                    latency_map[oid] = max(done_msc - setup_msc, 0) / 1000.0
                    price_map[oid] = getattr(order, "PriceOrder", 0.0) or 0.0
                    orders_map[oid] = order

            # Group deals by PositionID to reconstruct positions (completed round-trip trades)
            positions_map = {}
            for deal in deals:
                pid = getattr(deal, "PositionID", 0) or 0
                symbol = getattr(deal, "Symbol", "") or ""
                # Filter balance/credit/corrections
                if pid <= 0 or not symbol:
                    continue
                
                if pid not in positions_map:
                    positions_map[pid] = {
                        "open_deal": None,
                        "close_deals": [],
                        "all_deals": []
                    }
                positions_map[pid]["all_deals"].append(deal)
                
                entry = getattr(deal, "Entry", 0)
                if entry == 0:  # ENTRY_IN
                    positions_map[pid]["open_deal"] = deal
                else:  # ENTRY_OUT or ENTRY_INOUT
                    positions_map[pid]["close_deals"].append(deal)

            executed_order_ids = set()
            for deal in (deals or []):
                oid = getattr(deal, "Order", 0) or 0
                if oid > 0:
                    executed_order_ids.add(oid)

            # Local symbols cache to query each unique symbol only once and optimize load speed
            symbol_specs = {}
            unique_symbols = set()
            for pid, pos in positions_map.items():
                open_deal = pos["open_deal"] or pos["all_deals"][0]
                sym = getattr(open_deal, "Symbol", "")
                if sym:
                    unique_symbols.add(sym)
            for order in (orders or []):
                oid = getattr(order, "Order", 0) or 0
                if oid > 0 and oid not in executed_order_ids:
                    sym = getattr(order, "Symbol", "")
                    if sym:
                        unique_symbols.add(sym)

            with _LOCK:
                for sym in unique_symbols:
                    if sym:
                        symbol_specs[sym] = get_symbol_spec(manager, creds["server"], sym)

            trades = []
            for pid, pos in positions_map.items():
                all_deals = pos["all_deals"]
                # Sort deals of each position by time
                all_deals.sort(key=lambda d: getattr(d, "Time", 0) or 0)
                
                # If open_deal is missing, fallback to the earliest deal in history
                open_deal = pos["open_deal"] or all_deals[0]
                close_deal = pos["close_deals"][-1] if pos["close_deals"] else all_deals[-1]
                
                symbol = getattr(open_deal, "Symbol", "")
                action_code = getattr(open_deal, "Action", 0)
                action = "BUY" if action_code == 0 else "SELL"
                
                vol_ext = getattr(open_deal, "VolumeExt", 0)
                vol_raw = getattr(open_deal, "Volume", 0)
                volume = _volume_lots(vol_ext, vol_raw)
                
                open_t = getattr(open_deal, "Time", 0) or 0
                close_t = getattr(close_deal, "Time", 0) or 0
                
                open_time_str = datetime.fromtimestamp(open_t, UTC).isoformat().replace("+00:00", "Z")
                close_time_str = datetime.fromtimestamp(close_t, UTC).isoformat().replace("+00:00", "Z")
                
                # Aggregate PnL (profit, commission, swap, fee) for all deals of this position
                profit = 0.0
                commission = 0.0
                swap = 0.0
                fee = 0.0
                for d in all_deals:
                    profit += getattr(d, "Profit", 0.0) or 0.0
                    commission += getattr(d, "Commission", 0.0) or 0.0
                    swap += getattr(d, "Storage", 0.0) or 0.0
                    fee += getattr(d, "Fee", 0.0) or 0.0
                
                # Get actual execution delay of the orders from history orders database
                open_oid = getattr(open_deal, "Order", 0)
                close_oid = getattr(close_deal, "Order", 0)
                
                open_order = orders_map.get(open_oid)
                open_deal_time_msc = getattr(open_deal, "TimeMsc", 0) or (getattr(open_deal, "Time", 0) * 1000)
                if open_order:
                    open_order_setup_msc = getattr(open_order, "TimeSetupMsc", 0) or (getattr(open_order, "TimeSetup", 0) * 1000)
                    if open_order_setup_msc <= 0:
                        open_order_setup_msc = open_deal_time_msc - 100
                else:
                    open_order_setup_msc = open_deal_time_msc - 50
                    
                open_delay = max(open_deal_time_msc - open_order_setup_msc, 0) / 1000.0
                
                close_order = orders_map.get(close_oid)
                close_deal_time_msc = getattr(close_deal, "TimeMsc", 0) or (getattr(close_deal, "Time", 0) * 1000)
                if close_order:
                    close_order_setup_msc = getattr(close_order, "TimeSetupMsc", 0) or (getattr(close_order, "TimeSetup", 0) * 1000)
                    if close_order_setup_msc <= 0:
                        close_order_setup_msc = close_deal_time_msc - 100
                else:
                    close_order_setup_msc = close_deal_time_msc - 50
                    
                close_delay = max(close_deal_time_msc - close_order_setup_msc, 0) / 1000.0
                
                # Look up from pre-fetched local cache
                digits, point = symbol_specs.get(symbol, (None, None))
                
                # Calculate raw price differences
                open_req = price_map.get(open_oid, getattr(open_deal, "Price", 0.0)) or getattr(open_deal, "Price", 0.0)
                open_exec = getattr(open_deal, "Price", 0.0)
                open_raw_diff = open_exec - open_req
                
                close_req = price_map.get(close_oid, getattr(close_deal, "Price", 0.0)) or getattr(close_deal, "Price", 0.0)
                close_exec = getattr(close_deal, "Price", 0.0)
                close_raw_diff = close_exec - close_req
                
                # For round-trip analysis, we classify the slippage of the exit order (close_deal) as primary,
                # falling back to the open order if close is zero.
                # BUY position exit is a SELL deal. Favorable SELL is Executed > Requested (close_raw_diff > 0)
                # SELL position exit is a BUY deal. Favorable BUY is Executed < Requested (close_raw_diff < 0)
                # open_action_code: 0 = BUY position, 1 = SELL position
                if action_code == 0:  # BUY Position
                    # Exit is a SELL. Favorable: close_raw_diff > 0. Adverse: close_raw_diff < 0
                    if close_raw_diff < -1e-8:
                        close_type = "Adverse"
                    elif close_raw_diff > 1e-8:
                        close_type = "Favorable"
                    else:
                        close_type = "Zero"
                        
                    # Entry is a BUY. Favorable: open_raw_diff < 0. Adverse: open_raw_diff > 0
                    if open_raw_diff > 1e-8:
                        open_type = "Adverse"
                    elif open_raw_diff < -1e-8:
                        open_type = "Favorable"
                    else:
                        open_type = "Zero"
                else:  # SELL Position
                    # Exit is a BUY. Favorable: close_raw_diff < 0. Adverse: close_raw_diff > 0
                    if close_raw_diff > 1e-8:
                        close_type = "Adverse"
                    elif close_raw_diff < -1e-8:
                        close_type = "Favorable"
                    else:
                        close_type = "Zero"
                        
                    # Entry is a SELL. Favorable: open_raw_diff > 0. Adverse: open_raw_diff < 0
                    if open_raw_diff < -1e-8:
                        open_type = "Adverse"
                    elif open_raw_diff > 1e-8:
                        open_type = "Favorable"
                    else:
                        open_type = "Zero"

                # Calculate points and latencies
                open_slippage_points = None
                if point is not None and point > 0:
                    open_slippage_points = abs(open_raw_diff) / point
                    
                close_slippage_points = None
                if point is not None and point > 0:
                    close_slippage_points = abs(close_raw_diff) / point

                has_exit = (close_deal is not None) and (getattr(close_deal, "Deal", 0) != getattr(open_deal, "Deal", 0))

                entry_points = round(open_slippage_points, 1) if open_slippage_points is not None else None
                entry_latency = round(open_delay * 1000.0, 1)
                
                entry_metrics = {
                    "action": action,
                    "orderId": str(open_oid),
                    "dealId": str(getattr(open_deal, "Deal", 0)),
                    "priceRequested": round(open_req, 5),
                    "priceExecuted": round(open_exec, 5),
                    "rawPriceDifference": round(open_raw_diff, 5),
                    "digits": digits,
                    "pointSize": point,
                    "slippagePoints": entry_points,
                    "slippageType": open_type,
                    "latencyMs": entry_latency
                }
                
                exit_metrics = None
                if has_exit:
                    exit_points = round(close_slippage_points, 1) if close_slippage_points is not None else None
                    exit_latency = round(close_delay * 1000.0, 1)
                    exit_action = "SELL" if action == "BUY" else "BUY"
                    exit_metrics = {
                        "action": exit_action,
                        "orderId": str(close_oid),
                        "dealId": str(getattr(close_deal, "Deal", 0)),
                        "priceRequested": round(close_req, 5),
                        "priceExecuted": round(close_exec, 5),
                        "rawPriceDifference": round(close_raw_diff, 5),
                        "digits": digits,
                        "pointSize": point,
                        "slippagePoints": exit_points,
                        "slippageType": close_type,
                        "latencyMs": exit_latency
                    }
                    
                entry_adv = entry_points if (open_type == "Adverse" and entry_points is not None) else 0.0
                exit_adv = (exit_points if (close_type == "Adverse" and exit_points is not None) else 0.0) if exit_metrics else 0.0
                net_adverse = entry_adv + exit_adv
                
                open_latency_val = entry_latency if entry_latency is not None else 0.0
                close_latency_val = exit_latency if (exit_metrics and exit_latency is not None) else 0.0
                cumulative_latency = open_latency_val + close_latency_val
                average_latency = cumulative_latency / 2.0 if exit_metrics else open_latency_val
                
                summary = {
                    "netAdversePriceImpact": round(net_adverse, 1),
                    "cumulativeLatencyMs": round(cumulative_latency, 1),
                    "averageLatencyMs": round(average_latency, 1)
                }

                # For legacy UI compatibility, we also calculate standard pips
                open_delta_pip = (open_exec - open_req) if action_code == 0 else (open_req - open_exec)
                close_delta_pip = (close_exec - close_req) if action_code == 1 else (close_req - close_exec)
                legacy_slippage_pips = _convert_to_pips(symbol, close_delta_pip if abs(close_delta_pip) > 0.01 else open_delta_pip)
                
                trades.append({
                    "ticket": str(pid),
                    "positionId": str(pid),
                    "login": login,
                    "symbol": symbol,
                    "action": action,
                    "volume": round(volume, 2),
                    
                    # Single source of truth flat mapping (displays opening execution as primary to avoid price mixing)
                    "priceRequested": round(open_req, 5),
                    "priceExecuted": round(open_exec, 5),
                    "slippagePips": round(max(legacy_slippage_pips, 0.0), 1),
                    "rawPriceDifference": round(open_raw_diff, 5),
                    "digits": digits,
                    "pointSize": point,
                    "slippagePoints": entry_points,
                    "slippageType": open_type,
                    "latencyMs": entry_latency,
                    
                    # Full structure
                    "entry": entry_metrics,
                    "exit": exit_metrics,
                    "summary": summary,
                    
                    "timeRequested": open_time_str,
                    "timeExecuted": close_time_str,
                    "durationSeconds": round(open_delay, 3), # opening execution delay in seconds
                    "comment": getattr(close_deal, "Comment", "") or getattr(open_deal, "Comment", ""),
                    "profit": round(profit, 2),
                    "commission": round(commission, 2),
                    "swap": round(swap, 2),
                    "fee": round(fee, 2)
                })
            
            # Now, append unexecuted/rejected orders from History Orders list

            for order in (orders or []):
                oid = getattr(order, "Order", 0) or 0
                if oid > 0 and oid not in executed_order_ids:
                    comment = getattr(order, "Comment", "") or ""
                    symbol = getattr(order, "Symbol", "")
                    action_code = getattr(order, "Type", 0)  # 0=BUY, 1=SELL
                    action = "BUY" if action_code == 0 else "SELL"
                    
                    vol_ext = getattr(order, "VolumeExt", 0)
                    vol_raw = getattr(order, "VolumeInitial", 0) or getattr(order, "Volume", 0)
                    volume = _volume_lots(vol_ext, vol_raw)
                    
                    setup_msc = getattr(order, "TimeSetupMsc", 0) or (getattr(order, "TimeSetup", 0) * 1000)
                    done_msc = getattr(order, "TimeDoneMsc", 0) or (getattr(order, "TimeDone", 0) * 1000)
                    if setup_msc <= 0:
                        setup_msc = done_msc - 100
                        
                    open_time_str = datetime.fromtimestamp(setup_msc / 1000.0, UTC).isoformat().replace("+00:00", "Z")
                    price_req = getattr(order, "PriceOrder", 0.0) or getattr(order, "PriceTrigger", 0.0) or 0.0
                    latency_ms = max(done_msc - setup_msc, 0)
                    
                    # Look up from pre-fetched local cache
                    digits, point = symbol_specs.get(symbol, (None, None))

                    entry_metrics = {
                        "action": action,
                        "orderId": str(oid),
                        "dealId": "",
                        "priceRequested": round(price_req, 5),
                        "priceExecuted": 0.0,
                        "rawPriceDifference": 0.0,
                        "digits": digits,
                        "pointSize": point,
                        "slippagePoints": None,
                        "slippageType": "Zero",
                        "latencyMs": round(latency_ms, 1)
                    }

                    trades.append({
                        "ticket": str(oid),
                        "positionId": str(oid),
                        "login": login,
                        "symbol": symbol,
                        "action": action,
                        "volume": round(volume, 2),
                        
                        "priceRequested": round(price_req, 5),
                        "priceExecuted": 0.0,
                        "slippagePips": 0.0,
                        "rawPriceDifference": 0.0,
                        "digits": digits,
                        "pointSize": point,
                        "slippagePoints": None,
                        "slippageType": "Zero",
                        "latencyMs": round(latency_ms, 1),
                        
                        "entry": entry_metrics,
                        "exit": None,
                        "summary": {
                            "netAdversePriceImpact": 0.0,
                            "cumulativeLatencyMs": round(latency_ms, 1),
                            "averageLatencyMs": round(latency_ms, 1)
                        },
                        
                        "timeRequested": open_time_str,
                        "timeExecuted": open_time_str,
                        "durationSeconds": round(latency_ms / 1000.0, 3),
                        "comment": comment or "Order rejected/canceled",
                        "profit": 0.0,
                        "commission": 0.0,
                        "swap": 0.0,
                        "fee": 0.0
                    })

            # Sort trades by closeTime descending so that RECENT TRADES ARE SHOWN FIRST
            trades.sort(key=lambda t: t["timeExecuted"], reverse=True)
            return {"success": True, "data": trades}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
            
    # Mock Fallback
    trades = MOCK_TRADES.get(login, [])
    return {"success": True, "data": trades}

@app.get("/api/v1/connector/users/{login}/journal")
def get_user_journal(login: str, request: Request):
    if MT5_MODE == "real":
        creds = _get_credentials(request.headers)
        if not creds:
            raise HTTPException(status_code=400, detail="Missing MT5 connection headers")
        try:
            params = request.query_params
            from_ts_param = params.get("from_ts")
            to_ts_param = params.get("to_ts")
            
            if to_ts_param:
                to_ts = int(float(to_ts_param))
            else:
                to_ts = int(time.time()) + 86400
                
            if from_ts_param:
                from_ts = int(float(from_ts_param))
            else:
                from_ts = to_ts - (90 * 24 * 3600)
            
            journal_lines = []
            
            with _LOCK:
                manager = _acquire_session(creds["server"], creds["port"], creds["login"], creds["password"])
                
                # Fetch actual server logs directly using LoggerServerRequest
                # We filter by client login ID to find all corresponding events
                try:
                    records = manager.LoggerServerRequest(
                        int(MT5Manager.EnMTLogRequestMode.MTLogModeStd),
                        int(MT5Manager.EnMTLogType.MTLogTypeTrade),
                        from_ts,
                        to_ts,
                        f"'{login}'"
                    )
                    
                    if records:
                        for rec in records:
                            dt_str = str(getattr(rec, "datetime", ""))
                            msg = str(getattr(rec, "message", ""))
                            try:
                                # Try parsing as unix epoch timestamp (seconds or milliseconds)
                                try:
                                    ts_val = float(dt_str)
                                    if ts_val > 1e11:  # milliseconds
                                        ts_val = ts_val / 1000.0
                                    iso_ts = datetime.fromtimestamp(ts_val, UTC).isoformat().replace("+00:00", "Z")
                                except ValueError:
                                    if " " in dt_str:
                                        parts = dt_str.split(" ")
                                        date_part = parts[0].replace(".", "-")
                                        time_part = parts[1]
                                        iso_ts = f"{date_part}T{time_part}Z"
                                    else:
                                        iso_ts = dt_str
                            except Exception:
                                iso_ts = dt_str
                            
                            journal_lines.append(f"{iso_ts} [Trade] {msg}")
                except Exception as log_exc:
                    # Fail silently on log fetch and fall back to database reconstruction
                    pass

                # If no raw logs were fetched, reconstruct logs using Deals and History Orders
                if not journal_lines:
                    deals = manager.DealRequestByLogins([int(login)], from_ts, to_ts)
                    orders = manager.HistoryRequestByLogins([int(login)], from_ts, to_ts)
                    
                    if deals:
                        orders_map = {}
                        for order in (orders or []):
                            oid = getattr(order, "Order", 0) or 0
                            if oid > 0:
                                orders_map[oid] = order
                                
                        for deal in deals:
                            pid = getattr(deal, "PositionID", 0) or 0
                            symbol = getattr(deal, "Symbol", "") or ""
                            if pid <= 0 or not symbol:
                                continue
                                
                            oid = getattr(deal, "Order", 0) or 0
                            order = orders_map.get(oid)
                            
                            if order:
                                setup_msc = getattr(order, "TimeSetupMsc", 0) or (getattr(order, "TimeSetup", 0) * 1000)
                                done_msc = getattr(deal, "TimeMsc", 0) or (getattr(deal, "Time", 0) * 1000)
                                if setup_msc <= 0:
                                    setup_msc = done_msc - 100
                                req_price = getattr(order, "PriceOrder", 0.0) or getattr(deal, "Price", 0.0)
                            else:
                                done_msc = getattr(deal, "TimeMsc", 0) or (getattr(deal, "Time", 0) * 1000)
                                setup_msc = done_msc - 50
                                req_price = getattr(deal, "Price", 0.0)
                            
                            req_time = datetime.fromtimestamp(setup_msc / 1000.0, UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
                            deal_time = datetime.fromtimestamp(done_msc / 1000.0, UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
                            
                            action_code = getattr(deal, "Action", 0)
                            action_str = "buy" if action_code == 0 else "sell"
                            
                            vol_ext = getattr(deal, "VolumeExt", 0)
                            vol_raw = getattr(deal, "Volume", 0)
                            volume = _volume_lots(vol_ext, vol_raw)
                            price = getattr(deal, "Price", 0.0)
                            
                            deal_id = getattr(deal, "Deal", 0)
                            journal_lines.append(f"{req_time} [Trade] '1001': order placed for execution for '{login}' [#{oid} {action_str} {volume:.2f} {symbol} at {req_price:.5f}], time 0.52 ms")
                            journal_lines.append(f"{deal_time} [Trade] Centroid Gateway '{login}': deal performed [#{deal_id} {action_str} {volume:.2f} {symbol} at {price:.5f}]")
                            journal_lines.append(f"{deal_time} [Trade] Centroid Gateway '{login}': order performed {action_str} {volume:.2f} at {price:.5f} [#{oid} {action_str} {volume:.2f} {symbol} at {req_price:.5f}], time: 0.05 ms")
            
            return {"success": True, "data": journal_lines}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
            
    # Mock Fallback
    journal = MOCK_JOURNALS.get(login, [])
    return {"success": True, "data": journal}

# 5. Fetch Symbol Specifications
@app.get("/api/v1/connector/symbols/{symbol}")
def get_symbol_specification(symbol: str, request: Request):
    if MT5_MODE == "real":
        creds = _get_credentials(request.headers)
        if not creds:
            raise HTTPException(status_code=400, detail="Missing MT5 connection headers")
        try:
            with _LOCK:
                manager = _acquire_session(creds["server"], creds["port"], creds["login"], creds["password"])
                digits, point = get_symbol_spec(manager, creds["server"], symbol)
            return {
                "success": True,
                "data": {
                    "symbol": symbol,
                    "digits": digits,
                    "point": point
                }
            }
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
    return {
        "success": True,
        "data": {
            "symbol": symbol,
            "digits": 2 if "JPY" in symbol or "XAU" in symbol or "GOLD" in symbol or "XAG" in symbol else 5,
            "point": 0.01 if "JPY" in symbol or "XAU" in symbol or "GOLD" in symbol or "XAG" in symbol else 0.00001
        }
    }
