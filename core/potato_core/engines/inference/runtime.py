"""Resolution of llama.cpp runtime options — the load-time knobs.

Two kinds of llama.cpp knob exist, and they are handled in different places:

* **Sampling** (temperature, top-p, min-p, repeat penalty, seed, ...) travels
  with each request and is applied in llama_cpp_backend._build_payload().
* **Runtime** (context size, threads, GPU offload, batch size, flash attention,
  KV cache type) is fixed when `llama-server` is spawned, so it lives here and
  is turned into command-line arguments at load time.

Every runtime knob has an "Auto" position. Auto means one of two things, and
the distinction matters for honesty in the UI:

* a value this module *detects* from the machine (threads), reported back as a
  concrete number, or
* a value we deliberately leave to llama.cpp itself (batch size, flash
  attention), reported back as None/"auto" rather than a number we guessed.

`detect()` is what the UI shows next to an Auto control ("Auto - 8 threads");
`resolve()` is what actually gets used for a load.
"""
from __future__ import annotations

import subprocess
import threading
import time
from typing import Any

import psutil

from potato_core.config import settings
from potato_core.engines import settings as app_settings
from potato_core.logging_config import get_logger

log = get_logger("inference.runtime")

# Beyond this, llama.cpp's own benchmarks stop gaining from more threads and
# start losing to scheduling overhead — an Auto default should not hand a
# 64-core workstation all 64 threads for a 7B model.
_MAX_AUTO_THREADS = 16
_HARDWARE_CACHE_TTL_S = 30.0
_GPU_BACKENDS = {"CUDA", "ROCm", "Metal"}

KV_CACHE_TYPES = ["f16", "q8_0", "q4_0"]
FLASH_ATTENTION_MODES = ["auto", "on", "off"]

# Wording from -ngl's own help entry, used to tell a build that accepts
# `-ngl auto` from one that only takes a layer count.
_NGL_AUTO_MARKER = "'auto', or 'all'"

_cache_lock = threading.Lock()
_cached_detection: tuple[float, dict] | None = None
_cached_help: str | None = None
_cached_devices: list[str] | None | tuple[()] = ()  # () = not asked yet, None = asked and failed


def _detect_cpu_threads() -> tuple[int | None, int | None]:
    """(physical cores, logical threads). Either may be None — psutil cannot
    always tell, and a fabricated count is worse than an honest unknown."""
    try:
        return psutil.cpu_count(logical=False), psutil.cpu_count(logical=True)
    except Exception:  # noqa: BLE001 — detection is best-effort by design
        log.warning("CPU count detection failed", exc_info=True)
        return None, None


def _detect_gpu() -> tuple[str, str | None, int | None]:
    """(compute backend, gpu model, vram MB) from the hardware engine's cheap
    live read — the same NVML path the status bar already uses."""
    try:
        # Imported here rather than at module scope to keep this module free of
        # a hard dependency on the hardware engine's import chain.
        from potato_core.engines.hardware import service as hardware_service

        snapshot = hardware_service.poll_live()
        return snapshot.compute_backend, snapshot.gpu.model, snapshot.gpu.vram_mb
    except Exception:  # noqa: BLE001
        log.warning("GPU detection for runtime defaults failed", exc_info=True)
        return "Unknown", None, None


def _run_server(args: list[str], timeout: float = 20.0) -> str | None:
    """One-shot `llama-server <args>`, or None if it could not be run."""
    try:
        exe = settings.llama_server_executable
        if not exe.exists():
            return None
        completed = subprocess.run(
            [str(exe), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(exe.parent),
        )
        return f"{completed.stdout}\n{completed.stderr}"
    except Exception:  # noqa: BLE001
        log.warning("llama-server %s failed", " ".join(args), exc_info=True)
        return None


def backend_devices(refresh: bool = False) -> list[str] | None:
    """Compute devices the *vendored binary* can actually use, or None if it
    could not be asked.

    This is a different question from "does this machine have a GPU", and the
    difference is the whole point: a CPU-only llama.cpp build on a machine with
    an RTX card offloads nothing, and an Auto control that promised otherwise
    would be lying about where the work is going to run.
    """
    global _cached_devices
    with _cache_lock:
        if not refresh and _cached_devices != ():
            return _cached_devices  # type: ignore[return-value]

    output = _run_server(["--list-devices"])
    devices: list[str] | None
    if output is None:
        devices = None
    else:
        devices = []
        listing = False
        for line in output.splitlines():
            if line.strip().lower().startswith("available devices"):
                listing = True
                continue
            if not listing:
                continue
            stripped = line.strip()
            if not stripped or stripped == "(none)":
                continue
            if ":" not in stripped:
                break  # past the list, into whatever the binary printed next
            devices.append(stripped.split(":", 1)[0].strip())

    with _cache_lock:
        _cached_devices = devices
    return devices


def detect(refresh: bool = False) -> dict:
    """Hardware-derived Auto values, cached briefly.

    Cached because the Playground asks for these every time its Performance
    section renders, and an NVML round trip per render would be wasteful for
    numbers that change only when someone swaps a GPU.
    """
    global _cached_detection
    with _cache_lock:
        if not refresh and _cached_detection is not None:
            cached_at, value = _cached_detection
            if time.monotonic() - cached_at < _HARDWARE_CACHE_TTL_S:
                return value

    cores, logical = _detect_cpu_threads()
    backend, gpu_model, vram_mb = _detect_gpu()
    has_gpu = backend in _GPU_BACKENDS

    # Whether anything *can* be offloaded is the binary's answer, not the
    # machine's; only fall back to "there is a GPU here" when the binary
    # couldn't be asked.
    devices = backend_devices(refresh=refresh)
    can_offload = has_gpu if devices is None else bool(devices)

    if cores:
        threads = max(1, min(cores, _MAX_AUTO_THREADS))
    elif logical:
        threads = max(1, min(logical // 2, _MAX_AUTO_THREADS))
    else:
        threads = 4  # last resort, and flagged as such by cpu_cores == None

    detected = {
        "threads": threads,
        "cpu_cores": cores,
        "cpu_threads": logical,
        # "auto" rather than a layer count: the real number depends on the
        # model's depth, which is only known once the file is opened.
        "gpu_layers": "auto" if can_offload else 0,
        # Can the loaded model actually run on a GPU here — binary and machine
        # both willing. The two fields below say which half is missing.
        "gpu_available": can_offload,
        "gpu_detected": has_gpu,
        "backend_devices": devices,
        "gpu_model": gpu_model,
        "vram_mb": vram_mb,
        "compute_backend": backend,
        # Left to llama.cpp — it picks per build, and reporting a number here
        # would name a default the binary may not actually use.
        "batch_size": None,
        "flash_attention": "auto",
        "kv_cache_type": "f16",
        "context_length": app_settings.get("default_context_length"),
    }

    with _cache_lock:
        _cached_detection = (time.monotonic(), detected)
    return detected


def resolve(overrides: dict[str, Any] | None = None) -> dict:
    """The effective runtime for one load: request override, else the user's
    saved setting, else Auto.

    Sentinels come from the settings registry, where every knob needs an "Auto"
    position expressible as a number: 0 threads, 0 batch and -1 GPU layers all
    mean "decide for me".
    """
    given = {k: v for k, v in (overrides or {}).items() if v is not None}
    auto = detect()

    context_length = given.get("context_length") or app_settings.get("default_context_length")

    threads = given.get("threads", app_settings.get("inference_threads"))
    if not threads:
        threads = auto["threads"]

    gpu_layers = given.get("gpu_layers", app_settings.get("gpu_layers"))
    if gpu_layers is None or gpu_layers < 0:
        gpu_layers = auto["gpu_layers"]

    batch_size = given.get("batch_size", app_settings.get("batch_size"))
    if not batch_size:
        batch_size = None  # llama.cpp's own default

    flash_attention = given.get("flash_attention", app_settings.get("flash_attention"))
    if flash_attention not in FLASH_ATTENTION_MODES:
        flash_attention = "auto"

    kv_cache_type = given.get("kv_cache_type", app_settings.get("kv_cache_type"))
    if kv_cache_type not in KV_CACHE_TYPES:
        kv_cache_type = "f16"

    return {
        "context_length": int(context_length),
        "threads": int(threads),
        "gpu_layers": gpu_layers,
        "batch_size": int(batch_size) if batch_size else None,
        "flash_attention": flash_attention,
        "kv_cache_type": kv_cache_type,
    }


def _server_help() -> str:
    """`llama-server --help`, cached for the process.

    Vendored binaries differ by release: -fa took an on/off/auto value only from
    mid-2025, and an 'auto' keyword for -ngl is newer still. Rather than pin the
    app to one build, we read what this binary advertises and fall back to the
    argument forms every release has accepted.
    """
    global _cached_help
    if _cached_help is not None:
        return _cached_help

    text = ""
    try:
        exe = settings.llama_server_executable
        if exe.exists():
            completed = subprocess.run(
                [str(exe), "--help"],
                capture_output=True,
                text=True,
                timeout=20,
                cwd=str(exe.parent),
            )
            text = f"{completed.stdout}\n{completed.stderr}"
    except Exception:  # noqa: BLE001
        log.warning("Could not read llama-server --help; using conservative flags", exc_info=True)

    _cached_help = text
    return text


def build_args(resolved: dict, help_text: str | None = None) -> list[str]:
    """Turns a resolved runtime into llama-server command-line arguments.

    Only the flags this binary actually documents are emitted; an unknown flag
    makes llama-server exit at startup, which the user would only see as an
    unexplained "did not become ready".
    """
    help_text = _server_help() if help_text is None else help_text
    args: list[str] = ["-c", str(resolved["context_length"])]

    if resolved.get("threads"):
        args += ["-t", str(resolved["threads"])]

    gpu_layers = resolved.get("gpu_layers")
    if gpu_layers == "auto":
        # Older builds have no auto keyword for -ngl; there, letting llama.cpp
        # apply its own default (by omitting the flag) is the equivalent. The
        # match is against -ngl's own wording ("'auto', or 'all'") rather than a
        # bare "auto", which appears all over the help for unrelated flags.
        if _NGL_AUTO_MARKER in help_text:
            args += ["-ngl", "auto"]
    elif isinstance(gpu_layers, int):
        args += ["-ngl", str(gpu_layers)]

    if resolved.get("batch_size") and "--batch-size" in help_text:
        args += ["-b", str(resolved["batch_size"])]

    flash_attention = resolved.get("flash_attention", "auto")
    if flash_attention != "auto":
        if "[on|off|auto]" in help_text:
            args += ["-fa", flash_attention]
        elif flash_attention == "on":
            # Pre-value builds: a bare -fa means on, and off is their default.
            args += ["-fa"]

    kv_cache_type = resolved.get("kv_cache_type", "f16")
    if kv_cache_type != "f16" and "--cache-type-k" in help_text:
        args += ["-ctk", kv_cache_type, "-ctv", kv_cache_type]

    return args
