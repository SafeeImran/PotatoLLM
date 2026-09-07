"""Tests for the llama.cpp runtime resolver (engines/inference/runtime.py).

Two things matter here and nothing else does: that "Auto" resolves to something
real rather than being dropped, and that a resolved runtime only ever produces
command-line flags the vendored binary actually understands — an unknown flag
makes llama-server exit during startup, which surfaces to the user as a bare
"did not become ready".
"""
from __future__ import annotations

import pytest

from potato_core.engines import settings as app_settings
from potato_core.engines.inference import runtime

# Trimmed from a current `llama-server --help`; enough for the flag probe.
MODERN_HELP = """
-t,    --threads N                      number of CPU threads to use during generation
-b,    --batch-size N                   logical maximum batch size (default: 2048)
-fa,   --flash-attn [on|off|auto]       set Flash Attention use ('on', 'off', or 'auto')
-ctk,  --cache-type-k TYPE              KV cache data type for K
-ctv,  --cache-type-v TYPE              KV cache data type for V
-ngl,  --gpu-layers, --n-gpu-layers N   max. number of layers to store in VRAM, either an exact number,
                                        'auto', or 'all' (default: auto)
"""

# A pre-2025 build: -fa is a bare switch and -ngl only takes a number.
LEGACY_HELP = """
-t,    --threads N                      number of threads to use during generation
-b,    --batch-size N                   logical maximum batch size (default: 2048)
-fa,   --flash-attn                     enable Flash Attention (default: disabled)
-ngl,  --n-gpu-layers N                 number of layers to store in VRAM
"""


@pytest.fixture(autouse=True)
def _clean_settings():
    app_settings.reset()
    yield
    app_settings.reset()


def test_detect_reports_a_usable_thread_count():
    detected = runtime.detect(refresh=True)
    assert detected["threads"] >= 1
    assert detected["threads"] <= runtime._MAX_AUTO_THREADS
    assert detected["flash_attention"] == "auto"
    # Batch size stays None on Auto rather than guessing llama.cpp's default.
    assert detected["batch_size"] is None


def test_detect_offers_gpu_offload_only_when_a_gpu_backend_is_present():
    detected = runtime.detect(refresh=True)
    assert detected["gpu_layers"] == ("auto" if detected["gpu_available"] else 0)


def test_offload_follows_the_binary_not_just_the_machine(monkeypatch):
    """A CPU-only llama.cpp build on a machine with a GPU offloads nothing, and
    Auto must say so rather than promising layers on a card it cannot reach."""
    monkeypatch.setattr(runtime, "_detect_gpu", lambda: ("CUDA", "NVIDIA GeForce RTX 5060", 8151))

    monkeypatch.setattr(runtime, "backend_devices", lambda refresh=False: [])
    cpu_only = runtime.detect(refresh=True)
    assert cpu_only["gpu_detected"] is True
    assert cpu_only["gpu_available"] is False
    assert cpu_only["gpu_layers"] == 0

    monkeypatch.setattr(runtime, "backend_devices", lambda refresh=False: ["CUDA0"])
    with_gpu = runtime.detect(refresh=True)
    assert with_gpu["gpu_available"] is True
    assert with_gpu["gpu_layers"] == "auto"


def test_detect_falls_back_to_the_machine_when_the_binary_cannot_be_asked(monkeypatch):
    monkeypatch.setattr(runtime, "_detect_gpu", lambda: ("CUDA", "NVIDIA GeForce RTX 5060", 8151))
    monkeypatch.setattr(runtime, "backend_devices", lambda refresh=False: None)

    detected = runtime.detect(refresh=True)
    assert detected["gpu_available"] is True
    assert detected["backend_devices"] is None


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        ("Available devices:\n  (none)\n", []),
        (
            "Available devices:\n  CUDA0: NVIDIA GeForce RTX 5060 (8151 MiB, 7900 MiB free)\n",
            ["CUDA0"],
        ),
        ("ggml_cuda_init: found 1 device\nAvailable devices:\n  CUDA0: RTX 5060\n", ["CUDA0"]),
    ],
)
def test_backend_devices_parses_the_binarys_own_listing(monkeypatch, output, expected):
    monkeypatch.setattr(runtime, "_run_server", lambda args, timeout=20.0: output)
    assert runtime.backend_devices(refresh=True) == expected


def test_backend_devices_is_unknown_rather_than_empty_when_the_probe_fails(monkeypatch):
    # None and [] mean different things: "could not ask" must not be read as
    # "asked, and there is no GPU".
    monkeypatch.setattr(runtime, "_run_server", lambda args, timeout=20.0: None)
    assert runtime.backend_devices(refresh=True) is None


def test_resolve_falls_back_to_detected_threads_when_the_setting_is_auto():
    app_settings.set_value("inference_threads", 0)  # 0 is the Auto sentinel
    assert runtime.resolve()["threads"] == runtime.detect()["threads"]


def test_resolve_prefers_an_explicit_override_over_the_setting():
    app_settings.set_value("inference_threads", 6)
    app_settings.set_value("default_context_length", 4096)
    resolved = runtime.resolve({"threads": 12, "context_length": 8192})
    assert resolved["threads"] == 12
    assert resolved["context_length"] == 8192


def test_resolve_uses_the_saved_setting_when_no_override_is_given():
    app_settings.set_value("inference_threads", 6)
    app_settings.set_value("kv_cache_type", "q8_0")
    app_settings.set_value("flash_attention", "on")
    resolved = runtime.resolve()
    assert resolved["threads"] == 6
    assert resolved["kv_cache_type"] == "q8_0"
    assert resolved["flash_attention"] == "on"


def test_resolve_treats_zero_batch_and_negative_layers_as_auto():
    app_settings.set_value("batch_size", 0)
    app_settings.set_value("gpu_layers", -1)
    resolved = runtime.resolve()
    assert resolved["batch_size"] is None
    assert resolved["gpu_layers"] == runtime.detect()["gpu_layers"]


def test_resolve_keeps_an_explicit_cpu_only_choice():
    # 0 layers is a real answer ("run on the CPU"), not a missing one.
    assert runtime.resolve({"gpu_layers": 0})["gpu_layers"] == 0


def test_build_args_emits_the_modern_flag_forms():
    args = runtime.build_args(
        {
            "context_length": 8192,
            "threads": 8,
            "gpu_layers": "auto",
            "batch_size": 1024,
            "flash_attention": "on",
            "kv_cache_type": "q8_0",
        },
        MODERN_HELP,
    )
    assert args[:2] == ["-c", "8192"]
    assert "-t" in args and args[args.index("-t") + 1] == "8"
    assert args[args.index("-ngl") + 1] == "auto"
    assert args[args.index("-b") + 1] == "1024"
    assert args[args.index("-fa") + 1] == "on"
    assert args[args.index("-ctk") + 1] == "q8_0"
    assert args[args.index("-ctv") + 1] == "q8_0"


def test_build_args_omits_flags_a_legacy_binary_would_reject():
    args = runtime.build_args(
        {
            "context_length": 4096,
            "threads": 4,
            "gpu_layers": "auto",
            "batch_size": None,
            "flash_attention": "on",
            "kv_cache_type": "q4_0",
        },
        LEGACY_HELP,
    )
    # No 'auto' keyword for -ngl on this build, so the flag is left off entirely
    # and llama.cpp applies its own default.
    assert "-ngl" not in args
    # -fa here is a bare switch, so it must not be given a value.
    assert "-fa" in args and "on" not in args
    # This build has no quantized KV cache support to ask for.
    assert "-ctk" not in args


def test_build_args_leaves_defaults_alone():
    args = runtime.build_args(
        {
            "context_length": 4096,
            "threads": 0,
            "gpu_layers": "auto",
            "batch_size": None,
            "flash_attention": "auto",
            "kv_cache_type": "f16",
        },
        MODERN_HELP,
    )
    # Auto everywhere: only the context size is pinned, plus -ngl auto, which is
    # what this build already defaults to but is worth stating explicitly.
    assert "-t" not in args
    assert "-b" not in args
    assert "-fa" not in args
    assert "-ctk" not in args
