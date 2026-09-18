from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/core/config.py -> two levels up is backend/, where .env lives.
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(PROJECT_ROOT / ".env"), extra="ignore")

    environment: str = "development"
    port: int = 8001

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/smart_picker"

    jwt_secret: str = "replace-with-a-long-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    # Comma-separated — the phone (via a QR code) and the PC dashboard are
    # very often on two different origins at once (an ngrok https:// URL
    # for the phone's camera requirement, localhost or a LAN IP for the
    # PC), and CORS only allows what's listed here. A single hardcoded
    # origin silently breaks every fetch from any other origin — the
    # browser just blocks the response, which looks exactly like "the
    # backend isn't responding" with no error message to explain why.
    client_origin: str = "http://localhost:5173"
    cookie_name: str = "picker_session"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def client_origins(self) -> list[str]:
        return [o.strip() for o in self.client_origin.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
