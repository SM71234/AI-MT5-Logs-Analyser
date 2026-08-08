from __future__ import annotations

from pydantic import BaseModel, Field


class Credentials(BaseModel):
    server: str = Field(description="MT5 manager server host:port")
    login: int = Field(description="Manager login")
    password: str


class TestResponse(BaseModel):
    ok: bool
    message: str
    mode: str
    build: int | None = None


class AccountRequest(Credentials):
    account: int
    days: int = 90  # history window (fallback when no explicit range given)
    date_from: str | None = None  # ISO "YYYY-MM-DD" (inclusive)
    date_to: str | None = None    # ISO "YYYY-MM-DD" (inclusive)


class Position(BaseModel):
    symbol: str
    type: str  # buy | sell
    open_time: str
    close_time: str
    volume: float
    profit: float


class IPRecord(BaseModel):
    ip: str
    count: int = 0
    last_seen: str | None = None


class LastLogin(BaseModel):
    ip: str
    date: str | None = None  # ISO datetime of last access


class AccountData(BaseModel):
    account: int
    name: str | None = None
    positions: list[Position]
    ips: list[IPRecord]
    last_login: LastLogin | None = None
    mode: str
