from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Shared secret the backend must send in X-Connector-Secret.
    connector_secret: str = "dev-connector-secret"
    # "real" (default; Windows + MT5Manager package) or "mock" (opt-in offline dev only).
    mt5_mode: str = "real"
    # Connect timeout (ms) for real mode.
    mt5_timeout_ms: int = 30000
    # Keep a live broker session warm: a background heartbeat pings each connected
    # manager every N seconds and transparently reconnects if the socket dropped, so
    # the app never sees a disconnect. 0 disables the heartbeat.
    mt5_keepalive_sec: int = 60
    # Drop a session only after this many seconds idle. 0 = never expire on idle
    # (persistent) — the keepalive heartbeat is what proves/repairs liveness instead.
    mt5_session_ttl: int = 0


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
