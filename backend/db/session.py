from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.config import get_settings

settings = get_settings()

# SQLite's own connections are single-thread by default, which breaks under
# FastAPI (a sync request handler can run on a different thread than the one
# that opened its connection) unless this is turned off — irrelevant for
# Postgres, so only passed for a sqlite:// URL (e.g. local dev without a
# Postgres install available; see backend/.env).
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
