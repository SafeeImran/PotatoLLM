"""Model Download Manager (spec section 35) — real implementation.

Resumable (HTTP Range), pausable, cancellable, size-verified downloads of
GGUF artifacts. See `service.py` for the worker; this module is the public
surface the API layer calls.
"""
from potato_core.engines.downloads.service import (
    cancel_download,
    get_download,
    list_downloads,
    pause_download,
    resume_download,
    retry_download,
    start_download,
)

__all__ = [
    "cancel_download",
    "get_download",
    "list_downloads",
    "pause_download",
    "resume_download",
    "retry_download",
    "start_download",
]
