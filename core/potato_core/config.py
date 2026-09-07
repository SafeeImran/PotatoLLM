"""Central runtime configuration for Potato Core.

All paths and settings that other modules need flow through here so nothing
hardcodes a path or a magic value directly.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


def _core_dir() -> Path:
    """The directory containing alembic.ini, db/migrations, and vendor/ —
    the repo's `core/` dir in dev, or the PyInstaller-built exe's own
    directory in a packaged build (see core/packaging/potato-core.spec,
    which sets --contents-directory . so bundled data sits directly
    alongside the exe rather than under a nested _internal/)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


_CORE_DIR = _core_dir()

if getattr(sys, "frozen", False):
    # tiktoken.get_encoding() otherwise fetches cl100k_base.tiktoken over the
    # network on first use — a packaged, offline-capable app can't rely on
    # that. core/packaging/potato-core.spec bundles the BPE file at this
    # relative path if it's present in the build machine's own tiktoken
    # cache; setdefault so an operator override still wins.
    os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(_CORE_DIR / "tiktoken-cache"))


def _default_data_dir() -> Path:
    appdata = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    if appdata:
        return Path(appdata) / "PotatoLLM"
    return Path.home() / ".potatollm"


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 47823
    mock_hardware: bool = False
    log_level: str = "INFO"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "potato.db"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"

    @property
    def datasets_dir(self) -> Path:
        return self.data_dir / "datasets"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def attachments_dir(self) -> Path:
        return self.data_dir / "attachments"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.models_dir, self.datasets_dir, self.cache_dir, self.logs_dir, self.attachments_dir):
            d.mkdir(parents=True, exist_ok=True)

    @property
    def llama_server_executable(self) -> Path:
        """A vendored official llama.cpp release binary — fetched into
        core/vendor/ in dev (see DEVELOPMENT.md), bundled as PyInstaller
        data at the same relative path in a packaged build."""
        if sys.platform != "win32":
            raise RuntimeError(f"No vendored llama.cpp binary for platform '{sys.platform}' yet")
        return _CORE_DIR / "vendor" / "llama-cpu" / "llama-server.exe"


def load_settings() -> Settings:
    data_dir = Path(os.environ.get("POTATOLLM_DATA_DIR", _default_data_dir()))
    port = int(os.environ.get("POTATOLLM_CORE_PORT", "47823"))
    mock = os.environ.get("POTATOLLM_MOCK_HARDWARE", "").lower() in ("1", "true", "yes")
    log_level = os.environ.get("POTATOLLM_LOG_LEVEL", "INFO")
    settings = Settings(data_dir=data_dir, port=port, mock_hardware=mock, log_level=log_level)
    settings.ensure_dirs()
    return settings


settings = load_settings()
