"""MT5 Connector microservice.

The ONLY component that talks to MT5 servers. Runs in:
  * mock mode  (default) — anywhere, synthetic data; lets the platform run on Linux.
  * real mode  (Windows) — uses the MT5Manager package + native DLLs.

All endpoints require the shared secret header `X-Connector-Secret`.
"""
from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, status

from connector.config import settings
from connector.providers.base import AccountNotFound
from connector.providers.factory import get_provider
from connector.schemas import AccountData, AccountRequest, Credentials, TestResponse

app = FastAPI(title="MT5 Connector", version="0.1.0")


def require_secret(x_connector_secret: str = Header(default="")) -> None:
    if x_connector_secret != settings.connector_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad connector secret")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": settings.mt5_mode}


@app.post("/v1/test", response_model=TestResponse, dependencies=[Depends(require_secret)])
def test(creds: Credentials) -> TestResponse:
    provider = get_provider()
    try:
        ok, message, build = provider.test(creds)
    except Exception as exc:
        return TestResponse(ok=False, message=str(exc), mode=provider.mode)
    return TestResponse(ok=ok, message=message, mode=provider.mode, build=build)


@app.post("/v1/account/analyze", response_model=AccountData, dependencies=[Depends(require_secret)])
def account_analyze(req: AccountRequest) -> AccountData:
    provider = get_provider()
    creds = Credentials(server=req.server, login=req.login, password=req.password)
    try:
        return provider.fetch_account(creds, req.account, req.days, req.date_from, req.date_to)
    except AccountNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
