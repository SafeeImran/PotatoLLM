"""Test-wide setup: redirect Potato Core at an isolated temp data dir *before*
any potato_core module is imported, since config/db wiring happens at import
time. This must stay the first thing conftest does.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="potatollm-test-"))
os.environ["POTATOLLM_DATA_DIR"] = str(_TEST_DATA_DIR)
os.environ.setdefault("POTATOLLM_MOCK_HARDWARE", "true")

import pytest  # noqa: E402

from potato_core.db.base import Base, engine  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    Base.metadata.create_all(engine)
    yield
    # Several real-file test fixtures (test_inference.py, test_quantization.py,
    # test_benchmark.py, test_make_it_potato.py) copy actual multi-hundred-MB
    # GGUF files into settings.models_dir for integration testing. Without
    # this, every pytest run leaked its entire _TEST_DATA_DIR (tempfile.mkdtemp
    # never auto-deletes) — repeated runs across a long session silently
    # filled the disk to 0 bytes free. engine.dispose() first so SQLite
    # releases its file handle before Windows will let us remove the tree.
    engine.dispose()
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)
