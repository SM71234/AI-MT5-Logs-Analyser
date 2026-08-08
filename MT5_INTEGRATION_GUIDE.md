# Trade Intelligence: MetaTrader 5 (MT5) Manager API & Integration Guide

This guide serves as a general-purpose, reusable cookbook and architecture reference for integrating applications with MetaTrader 5 (MT5) broker servers. It covers Python and C++ native interfaces, SDK dynamic link libraries (DLLs), API class structures, network protocols, connection caching patterns, and security best practices for any MT5 Manager API project.

---

## 1. Core Architecture & Environment Requirements

MetaQuotes distributes the MT5 Manager API exclusively as compiled native C++ binaries. When designing any software stack interfacing with MT5, adhere to the following baseline requirements:

```
[Main Application / Frontend]  ──REST/JSON/gRPC──►  [MT5 Connector (Windows-only Service)]
                                                              │
                                                        (TCP/IP Sockets)
                                                              ▼
                                                     [MetaTrader 5 Server]
```

### A. Windows OS Dependency
- **Platform Limitation**: The underlying native libraries (`MT5APIManager64.dll`) only run on **Windows** (Windows Server 2019/2022, Windows 10/11 x64).
- **Architecture Design**: For cross-platform software (e.g., Linux web backends), always isolate the MT5 connection logic into a standalone Windows microservice ("Connector") and communicate via HTTP REST, WebSockets, or gRPC.

### B. Python Compatibility
- **Support**: Python 64-bit builds from version **3.10 to 3.13**.
- **Limitation**: The pre-compiled binary wheel wrapper (`MT5Manager`) is not available for Python 3.14+ yet. Ensure your runtime environment uses a supported version.

---

## 2. API Dynamic Link Libraries (DLLs) Structure

The MetaQuotes MT5 SDK includes several DLL files depending on the access type (Manager vs. Client):

1. **`MT5APIManager64.dll`**: Used for broker-level administrative, manager, or dealer operations. It is placed in the project root or system path so the application can load it.
2. **`MT5APIManager.dll`**: The 32-bit compiled variant of the Manager API.
3. **`MT5APIClient64.dll` / `MT5APIClient.dll`**: Used for client-terminal automation (trading robots/EAs), which is a separate interface from the Manager SDK.

---

## 3. General SDK Classes & Features Reference

Below is a detailed reference of the core interfaces, parameters, and capabilities of the MT5 Manager SDK.

### A. Session Management & Sockets: `MT5Manager.ManagerAPI`
This is the primary interface used to establish connections, query broker status, and interact with the server database.

| Method / Property | Return Type | Description |
| :--- | :--- | :--- |
| **`manager = MT5Manager.ManagerAPI()`** | `Object` | Creates a new instance of the Manager API. |
| **`manager.Connect(server, login, password, pumpmode, timeout)`** | `bool` | Connects to the MT5 Server over TCP. |
| **`manager.Disconnect()`** | `None` | Closes the connection and releases socket handles. |
| **`manager.LastError()`** | `tuple` | Returns `(code, retcode, message)` for debugging. |

#### Connection Parameters:
- **`server`**: Hostname or IP with port (e.g. `broker.example.com:443`). Port `443` is the standard SSL/TCP wrapper port for MT5 Manager connections.
- **`login`**: Numeric Manager account ID.
- **`password`**: Security password string.
- **`pumpmode`**: Determines which data streams are synchronized in real-time:
  - `PUMP_MODE_USERS`: Synchronizes client accounts and configurations.
  - `PUMP_MODE_GROUPS`: Synchronizes user groups.
  - `PUMP_MODE_SYMBOLS`: Synchronizes financial symbols and price feeds.
  - `PUMP_MODE_TRADES`: Synchronizes active trades, orders, and positions.
  - `PUMP_MODE_FULL`: Synchronizes everything (can cause high server load and network timeouts).
- **`timeout`**: Network communication timeout in milliseconds.

---

### B. Client Profiles: `MTUser`
Represents client account records on the MT5 Server.

*Retrieved via:* `user = manager.UserGet(int(login_id))`

| Parameter Name | Data Type | Description |
| :--- | :--- | :--- |
| **`.Name`** | `str` | Registered full name of the client. |
| **`.LastIP`** | `str` | IP address of the client's last terminal session login. |
| **`.LastAccess`** | `int` | Unix timestamp of the client's last server request. |
| **`.Registration`** | `int` | Unix timestamp of account creation. |
| **`.Group`** | `str` | The configuration group the user belongs to (e.g. `real\standard-usd`). |
| **`.Balance`** | `float` | Current cash balance in the account. |
| **`.Equity`** | `float` | Floating account equity (balance + open profits/losses). |
| **`.Leverage`** | `int` | Account leverage (e.g., `100` for 1:100). |

---

### C. Execution Transaction Records: `MTDeal`
Represents individual transactions (closed trades, balance modifications, deposit/withdrawal logs) in the history database.

*Retrieved via:* `deals = manager.DealRequestByLogins([logins], start_timestamp, end_timestamp)`

| Parameter | Type | Description |
| :--- | :--- | :--- |
| **`.Login`** | `int` | Account ID associated with the deal. |
| **`.PositionID`** | `int` | Unique ID of the position (used to match opening and closing deals). |
| **`.Action`** | `int` | Deal direction: `0` for Buy, `1` for Sell, `2` for Balance/Correction. |
| **`.Entry`** | `int` | Entry type: `0` (`ENTRY_IN` - entry), `1` (`ENTRY_OUT` - exit), `2` (`ENTRY_INOUT` - reversal). |
| **`.Symbol`** | `str` | The financial instrument (e.g. `EURUSD`, `XAUUSD`). |
| **`.Time`** | `int` | Execution timestamp (Unix epoch seconds). |
| **`.VolumeExt`** | `int` | Volume in high-precision (lots multiplied by $10^8$). |
| **`.Volume`** | `int` | Volume in standard-precision (lots multiplied by $10^4$). |
| **`.Profit`** | `float` | Raw trade profit/loss (excluding interest and commissions). |
| **`.Storage`** | `float` | Swaps / Rollover interest charges accumulated. |
| **`.Commission`** | `float` | Broker commission charged. |
| **`.Fee`** | `float` | Clearing/Exchange fees charged. |

---

### D. Active Orders & Positions (Real-Time Trades)
To fetch active pending orders or open positions, you must connect using `PUMP_MODE_TRADES` or `PUMP_MODE_FULL`.

- **Active Positions**:
  ```python
  positions = manager.PositionGet(login_id) # Returns a list of active open trades
  ```
  Properties on each position include `.Symbol`, `.Volume`, `.PriceOpen`, `.Profit`, `.PriceCurrent`, and `.PositionID`.
- **Pending Orders**:
  ```python
  orders = manager.OrderGet(login_id) # Returns active pending orders (limit/stop)
  ```

---

### E. Dealer Operations
The Manager API can act as a dealer to automatically process client requests or place market orders:

```python
# Create a trade request structure
request = manager.DealerRequestCreate()
request.Login = login_id
request.Action = 0  # BUY
request.Symbol = "EURUSD"
request.Volume = 10000  # 1.00 Lot
request.Price = 1.0850

# Send to execution
result = manager.DealerRequestSend(request)
```

---

## 4. Reconstructing Positions from Flat MT5 Deals

MetaTrader 5 stores histories as raw, flat transaction transactions (*deals*). To reconstruct standard round-trip trades, use the following algorithm:

1. **Group by Position ID**: Group all transactions where `PositionID > 0` into a dictionary.
2. **Filter Administrative Actions**: Exclude transactions where the symbol is empty or `Action` matches balance adjustments.
3. **Parse Entry and Exit**:
   - A transaction with `Entry == 0` (`ENTRY_IN`) is the trade's open record.
   - A transaction with `Entry == 1` (`ENTRY_OUT`) is the trade's close record.
4. **Aggregate Net Returns**:
   Compute the net profit by summing raw profit, swaps (storage), commissions, and other fees:
   $$\text{Net Profit} = \text{Profit} + \text{Storage} + \text{Commission} + \text{Fee}$$

---

## 5. Session Pooling & Reconnection Blueprint

Because establishing an MT5 socket connection takes **~9 seconds** due to SSL handshakes and network routing, never open and close a connection on every request. Implement a session manager pool:

```python
import threading
import time

class MT5SessionPool:
    def __init__(self):
        self._cache = {}
        self._lock = threading.RLock() # MT5 DLL is NOT thread-safe; serialize calls

    def get_session(self, server, login, password):
        with self._lock:
            key = (server, login, password)
            if key in self._cache:
                return self._cache[key]["manager"]
            
            # Connect on demand
            import MT5Manager
            manager = MT5Manager.ManagerAPI()
            ok = manager.Connect(server, login, password, 
                                 int(manager.ManagerAPI.EnPumpModes.PUMP_MODE_USERS), 10000)
            if not ok:
                raise RuntimeError("Connect failed")
            
            self._cache[key] = {"manager": manager, "last_active": time.time()}
            return manager
```

---

## 6. Security & Infrastructure Best Practices

1. **Credential Storage**: Never store broker passwords in plain text. Use symmetric encryption (e.g., `cryptography.fernet`) with a master secret key stored in the server's environment variables (`.env`).
2. **IP Access Control**: Restrict MT5 Manager logins to specific IP addresses. Configure your broker firewall to only accept connections from your VPS/connector host IP address.
3. **Thread Safety**: The native `MT5APIManager64.dll` client instance is not thread-safe. All calls to the DLL must be serialized using a lock (such as Python’s `threading.RLock()`) to prevent race conditions and memory access crashes.
4. **Rate Limiting**: Querying large transaction ranges can overload the MT5 server. Enforce rate-limits (e.g. max 1 request per second per account) and cache reports on the database to prevent duplicate queries.
5. **Failover / Mock Mode**: Implement a mock data provider (similar to the one in [mock.py](file:///b:/Trade%20Analyzer%20-%20Ritvik/mt5-connector/connector/providers/mock.py)) to allow local testing and client demos without querying live broker ports.
