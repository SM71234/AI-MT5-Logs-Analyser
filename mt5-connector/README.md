# MT5 Connector

The only component that talks to MT5 servers. Decouples the Windows-only native
Manager API from the rest of the (portable) platform.

## Modes
- **mock**: synthetic but realistic data. Runs anywhere. Lets you demo the full
  platform without a live MT5 server (`MT5_MODE=mock`).
- **real** (default): uses MetaQuotes' `MT5Manager` Python package + native DLLs. **Windows only.**

## Run (mock, for offline dev)
`run-local.ps1` starts the connector for you. To run it standalone in mock mode:
```powershell
py -3.12 -m venv .venv ; .\.venv\Scripts\activate
pip install -r requirements.txt
$env:MT5_MODE = "mock"
uvicorn connector.main:app --host 127.0.0.1 --port 8100
```
The backend reaches it at `http://127.0.0.1:8100`.

## Run (real, on a Windows host/VPS)
```powershell
py -3.12 -m venv .venv ; .\.venv\Scripts\activate
pip install -r requirements.txt
pip install MT5Manager           # ships the native Manager API (Windows x64)
$env:MT5_MODE = "real"
$env:CONNECTOR_SECRET = "<same secret the backend uses>"
uvicorn connector.main:app --host 0.0.0.0 --port 8100
```
Then point the backend at it: `MT5_CONNECTOR_URL=http://<windows-host>:8100` and
`MT5_CONNECTOR_SECRET=<secret>`.

## API (all require header `X-Connector-Secret`)
- `GET  /health`
- `POST /v1/test`            `{server, login, password}` → `{ok, message, build}`
- `POST /v1/account/analyze` `{server, login, password, account, days}` →
  `{account, name, positions:[...], ips:[{ip,count,last_seen}], mode}`

## Real-mode notes
`connector/providers/real.py` pairs MT5 deals (entry IN/OUT) into positions and reads
`LastIP`. Method names can vary by MT5Manager build — lines marked `ADJUST` may need
tuning to your installed version. MT5 deals carry no per-trade IP, so rich IP history
(“frequently used IPs”) is best built by a periodic poller recording `LastIP` over time.
