"""Real availability check for the heavy ML training stack (spec section 51:
never fake a feature — check honestly, don't assume). Deliberately does a
real `importlib.util.find_spec` rather than a version pin comparison or a
config flag, so this can never drift out of sync with what's actually
installed in the venv.
"""
from __future__ import annotations

import importlib.util

REQUIRED_PACKAGES = ("torch", "transformers", "peft", "trl")


def check_ml_dependencies() -> dict:
    missing = [pkg for pkg in REQUIRED_PACKAGES if importlib.util.find_spec(pkg) is None]
    return {
        "available": not missing,
        "missing": missing,
        "install_hint": 'pip install -e ".[train]" (run from the core/ directory)',
    }
