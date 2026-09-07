"""Runs the real `alembic upgrade head` CLI against a brand-new temp data dir
(in a subprocess, so it gets its own fresh `potato_core.config.settings`
rather than the one already imported by the rest of the test session) and
checks every expected table lands.
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

CORE_DIR = Path(__file__).resolve().parent.parent

EXPECTED_TABLES = {
    "adapters",
    "alembic_version",
    "application_settings",
    "attachments",
    "benchmarks",
    "builds",
    "datasets",
    "download_jobs",
    "hardware_profiles",
    "inference_sessions",
    "jobs",
    "model_artifacts",
    "models",
    "quantization_jobs",
    "training_jobs",
    "usage_records",
}

INITIAL_SCHEMA_REVISION = "4101e507f293"


def test_alembic_upgrade_head_creates_full_schema():
    with tempfile.TemporaryDirectory(prefix="potatollm-migration-test-") as tmp:
        env = {**os.environ, "POTATOLLM_DATA_DIR": tmp}
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=CORE_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stderr

        db_path = Path(tmp) / "potato.db"
        assert db_path.exists()

        con = sqlite3.connect(db_path)
        tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        con.close()
        assert EXPECTED_TABLES <= tables


def test_download_url_migration_succeeds_against_a_prepopulated_models_table():
    """Regression test: adding a NOT NULL column to `models` must not break
    a DB that already has seeded rows — this is exactly the scenario a
    real developer/user hits when a later migration adds a registry field."""
    with tempfile.TemporaryDirectory(prefix="potatollm-migration-test-") as tmp:
        env = {**os.environ, "POTATOLLM_DATA_DIR": tmp}

        upgrade_to_initial = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", INITIAL_SCHEMA_REVISION],
            cwd=CORE_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert upgrade_to_initial.returncode == 0, upgrade_to_initial.stderr

        db_path = Path(tmp) / "potato.db"
        con = sqlite3.connect(db_path)
        con.execute(
            "INSERT INTO models (id, name, family, parameter_count, architecture, context_length, "
            "license, source, model_url, supported_backends, supported_quant_formats, finetune_support, "
            "est_ram_mb, est_vram_mb, recommended_quantizations, description, tags, capabilities, created_at) "
            "VALUES ('x', 'X', 'X', '1B', 'Llama', 2048, 'MIT', 'Test', 'https://example.com', '[]', '[]', "
            "0, 1024, 512, '[]', '', '[]', '[]', datetime('now'))"
        )
        con.commit()
        con.close()

        upgrade_to_head = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=CORE_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert upgrade_to_head.returncode == 0, upgrade_to_head.stderr

        con = sqlite3.connect(db_path)
        row = con.execute("SELECT download_url FROM models WHERE id = 'x'").fetchone()
        con.close()
        assert row is not None
        assert row[0] == ""  # server_default applied to the pre-existing row
