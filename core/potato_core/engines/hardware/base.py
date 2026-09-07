"""The interface every hardware provider (real or mock) implements.

Nothing outside this package should care which one is behind the interface.
"""
from __future__ import annotations

from typing import Protocol

from potato_core.schemas.hardware import HardwareSnapshot


class HardwareProvider(Protocol):
    def detect(self) -> HardwareSnapshot:
        """Return a full hardware snapshot. Never fabricate a value — use "Unknown"/None."""
        ...

    def poll_live(self) -> HardwareSnapshot:
        """Cheap, frequent read for live monitoring (utilization/temp), not a full re-detect."""
        ...
