"""Build/Artifact Manager (spec section 18) — real implementation.

Wraps a verified ModelArtifact + runtime config into a named, persisted
Build the user can run, benchmark, rename, duplicate, and delete. See
service.py.
"""
from potato_core.engines.build.service import (
    BuildError,
    create_build,
    delete_build,
    duplicate_build,
    get_build,
    list_builds,
    rename_build,
)

__all__ = [
    "BuildError",
    "create_build",
    "delete_build",
    "duplicate_build",
    "get_build",
    "list_builds",
    "rename_build",
]
