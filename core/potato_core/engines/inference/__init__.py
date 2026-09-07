"""Inference Engine (spec section 22) — real implementation.

Wraps the vendored llama-server binary; see llama_cpp_backend.py for the slot
manager (several models resident at once) and orchestrator.py for the turn
pipeline that routes one chat turn across them. The UI must never call
llama.cpp internals directly — only these functions, via api/inference.py — so
a future backend (vLLM, Ollama, ...) can be swapped in without touching
callers.
"""
from potato_core.engines.inference import orchestrator, runtime
from potato_core.engines.inference.llama_cpp_backend import (
    ROLES,
    InferenceError,
    agenerate,
    benchmark,
    generate,
    get_stats,
    get_status,
    load_model,
    loaded_slots,
    set_primary,
    slot_for_role,
    stream,
    unload_model,
)
from potato_core.engines.inference.orchestrator import run_turn

__all__ = [
    "InferenceError",
    "ROLES",
    "agenerate",
    "benchmark",
    "generate",
    "get_stats",
    "get_status",
    "load_model",
    "loaded_slots",
    "orchestrator",
    "run_turn",
    "runtime",
    "set_primary",
    "slot_for_role",
    "stream",
    "unload_model",
]
