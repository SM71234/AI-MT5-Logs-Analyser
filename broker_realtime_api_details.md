# MetaTrader 5 Broker Connection API Reference

This document details the exact APIs, DLLs, classes, and connection types used by the MT5 Connector microservice in `real` mode to establish connections and fetch data from the broker.

---

## 1. Network & Protocol Layer

- **Connection Type**: TCP/IP socket connection.
- **Port**: Typically **`443`** (standard MT5 Manager port) or a custom TCP port designated by the broker.
- **Protocol**: MetaQuotes proprietary encrypted protocol wrapper.
- **Microservice API**: HTTP REST API (JSON) via FastAPI, secured with a shared secret header (`X-Connector-Secret`).

---

## 2. Dynamic Link Libraries (DLLs) & Packaging

The connection is driven by native code compiled by MetaQuotes:

1. **`MT5APIManager64.dll`**: 
   The core 64-bit Windows dynamic link library written in C++ by MetaQuotes. It contains the low-level functions for parsing MT5 server packets, managing sockets, encrypting/decrypting streams, and communicating with the broker database.
2. **`MT5Manager` (Python Wrapper)**:
   A python package installed via pip. It is compiled as a CPython extension (`.pyd` binary on Windows). This extension dynamically loads `MT5APIManager64.dll` into the Python process address space and exposes Python bindings (classes and methods) corresponding to the underlying C++ SDK functions.

---

## 3. C++ / Python API Classes and Methods

Below are the primary classes and methods instantiated in [`real.py`](file:///b:/Trade%20Analyzer%20-%20Ritvik/mt5-connector/connector/providers/real.py):

### A. `MT5Manager.ManagerAPI`
The main class representing the connection to the broker server.

* **`.Connect(server: str, login: int, password: str, pumpmode: int, timeout: int) -> bool`**
  - **Purpose**: Establishes a persistent TCP socket session with the MT5 Server.
  - **Arguments**:
    - `server`: IP Address or Hostname (e.g. `12.34.56.78:443`).
    - `login`: Broker Manager ID.
    - `password`: Password for the Manager account.
    - `pumpmode`: Subscriptions to activate. The system uses `PUMP_MODE_USERS` (minimal metadata streaming) to fetch account structures.
    - `timeout`: Network timeout limit in milliseconds.
* **`.Disconnect() -> None`**
  - **Purpose**: Closes the TCP socket and destroys the session.
* **`.LastError() -> tuple[int, int, str]`**
  - **Purpose**: Returns the error code and string message if any socket call fails (e.g., `Connect failed: Network error`).
* **`.UserGet(login: int) -> MTUser`**
  - **Purpose**: Queries the broker database for metadata about a specific trading account.
* **`.DealRequestByLogins(logins: list[int], from_ts: int, to_ts: int) -> list[MTDeal]`**
  - **Purpose**: Requests a batch of trade transaction histories for specific accounts between two Unix timestamps.

---

### B. `MT5Manager.MTUser`
A data structure representing a client trading account.

* **`.Name`**: String containing the trader's full name.
* **`.LastIP`**: String containing the client terminal's last login IP address.
* **`.LastAccess`**: Unix timestamp representing the client terminal's last login activity.

---

### C. `MT5Manager.MTDeal`
A data structure representing an individual financial transaction (deal) stored in the MT5 history database.

* **`.Login`**: Account ID associated with the deal.
* **`.PositionID`**: Unique ID of the position (used to tie the entry transaction and exit transaction together).
* **`.Action`**: Deal direction (`0` = buy deal, `1` = sell deal).
* **`.Entry`**: The execution entry type:
  - `0` (`ENTRY_IN`): Opened a new position.
  - `1` (`ENTRY_OUT`): Closed a position.
  - `2` (`ENTRY_INOUT`): Reversed a position.
* **`.Symbol`**: Financial instrument name (e.g., `USDJPY`).
* **`.Time`**: Execution timestamp (Unix epoch seconds).
* **`.Volume`**: Raw trade volume.
* **`.VolumeExt`**: Extended-precision volume (divided by $10^8$ to get standard lot size).
* **`.Profit`**: Profit/Loss (excluding interest/swaps and commissions).
* **`.Storage`**: Swaps/Interest charged.
* **`.Commission`**: Broker commission.
* **`.Fee`**: Transaction/clearing fees.
