"""Structured logging setup (spec section 41: DEBUG/INFO/WARNING/ERROR/CRITICAL, stored locally)."""
from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler

from potato_core.config import settings

_LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"


class _SafeStreamHandler(logging.StreamHandler):
    """A StreamHandler whose flush() tolerates a broken pipe.

    When Tauri spawns this process, stdout runs through several layers of
    piping (uvicorn -> Rust Stdio::piped() -> println! -> cargo -> npm ->
    the terminal/log redirect). On Windows that chain can make
    `sys.stdout.flush()` raise `OSError: [Errno 22] Invalid argument` even
    though the write itself succeeded — logging's default error handling
    would print a full traceback for every single log line. The write still
    happens; only the flush is unreliable, so it's safe to swallow.
    """

    def flush(self) -> None:
        try:
            super().flush()
        except OSError:
            pass


def configure_logging() -> None:
    root = logging.getLogger("potato_core")
    if root.handlers:
        return  # already configured (avoid duplicate handlers on reload)

    root.setLevel(settings.log_level)
    # Alembic's fileConfig (run on every startup, see db/migrations/env.py)
    # attaches its own handler to the root logger. Without this, every
    # potato_core log record would print twice — once via our handler,
    # once via alembic's after propagating up.
    root.propagate = False
    formatter = logging.Formatter(_LOG_FORMAT)

    console = _SafeStreamHandler(sys.stdout)
    console.setFormatter(formatter)
    root.addHandler(console)

    file_handler = RotatingFileHandler(
        settings.logs_dir / "potato-core.log",
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"potato_core.{name}")
