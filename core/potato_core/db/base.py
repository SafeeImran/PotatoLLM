"""SQLAlchemy engine/session plumbing. Only Potato Core touches the DB directly."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from potato_core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    # check_same_thread=False: background job workers (e.g. downloads) write
    # from their own thread. timeout=15: sqlite3's busy_timeout, so a writer
    # briefly waits out a lock instead of immediately raising "database is
    # locked" when the event loop and a job thread touch the DB at once.
    connect_args={"check_same_thread": False, "timeout": 15},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@contextmanager
def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
