"""Real Benchmark Engine (spec sections 19-20).

Runs a fixed-prompt generation through the Inference Engine (loading the
target artifact first if it isn't already loaded) while sampling real
hardware utilization on a background thread, then persists everything as a
Benchmark row. Every number here is measured from an actual run — nothing
in this module estimates.
"""
from __future__ import annotations

import threading
import time

from potato_core.db.base import get_session
from potato_core.db.models import Benchmark, ModelArtifact
from potato_core.engines import inference as inference_engine
from potato_core.engines.hardware import service as hardware_service
from potato_core.logging_config import get_logger

log = get_logger("benchmark")

_DEFAULT_PROMPT = "Explain what a potato is in two or three sentences."
_HARDWARE_SAMPLE_INTERVAL_S = 0.2


class BenchmarkError(Exception):
    pass


def _sample_hardware_during(stop_event: threading.Event, samples: list[dict]) -> None:
    while not stop_event.is_set():
        try:
            snapshot = hardware_service.poll_live()
            samples.append(
                {
                    "cpu_util_pct": snapshot.cpu.utilization_pct,
                    "gpu_util_pct": snapshot.gpu.utilization_pct,
                    "vram_mb": snapshot.gpu.vram_mb,
                    "ram_mb": (snapshot.memory.total_mb - snapshot.memory.available_mb) if snapshot.memory.total_mb and snapshot.memory.available_mb else None,
                    "temp_c": snapshot.gpu.temp_c,
                }
            )
        except Exception:  # noqa: BLE001 — a sampling hiccup must never abort the benchmark itself
            log.warning("Hardware sample failed during benchmark", exc_info=True)
        stop_event.wait(_HARDWARE_SAMPLE_INTERVAL_S)


def _summarize_samples(samples: list[dict]) -> dict:
    def _peak(key: str) -> float | None:
        values = [s[key] for s in samples if s.get(key) is not None]
        return max(values) if values else None

    def _last(key: str) -> float | None:
        for s in reversed(samples):
            if s.get(key) is not None:
                return s[key]
        return None

    return {
        "cpu_util_pct": _peak("cpu_util_pct"),
        "gpu_util_pct": _peak("gpu_util_pct"),
        "vram_mb": _last("vram_mb"),  # allocation is steady-state, not a peak-of-interest
        "ram_mb": _peak("ram_mb"),
        "temp_c": _peak("temp_c"),
    }


def run_benchmark(
    model_artifact_id: str,
    context_length: int | None = None,
    prompt: str = _DEFAULT_PROMPT,
    generation_params: dict | None = None,
    build_id: str | None = None,
) -> dict:
    """build_id, when given, takes precedence for persistence: the resulting
    Benchmark row is tied to the Build (so its "last benchmark" lookup finds
    it) rather than the raw artifact — matching the "exactly one of
    build_id/model_artifact_id is set" invariant documented on Benchmark."""
    with get_session() as session:
        artifact = session.get(ModelArtifact, model_artifact_id)
        if artifact is None:
            raise BenchmarkError(f"Unknown model artifact '{model_artifact_id}'")
        if artifact.status != "verified":
            raise BenchmarkError(f"Artifact is '{artifact.status}', not verified — can't benchmark it")

    status = inference_engine.get_status()
    if not status["loaded"] or status["model_artifact_id"] != model_artifact_id:
        try:
            inference_engine.load_model(model_artifact_id, context_length)
        except inference_engine.InferenceError as exc:
            raise BenchmarkError(str(exc)) from exc

    params = generation_params or {"max_tokens": 128, "temperature": 0.7}

    stop_event = threading.Event()
    samples: list[dict] = []
    sampler = threading.Thread(target=_sample_hardware_during, args=(stop_event, samples), daemon=True)
    sampler.start()

    start = time.monotonic()
    try:
        result = inference_engine.generate([{"role": "user", "content": prompt}], params)
    except inference_engine.InferenceError as exc:
        stop_event.set()
        sampler.join(timeout=2)
        raise BenchmarkError(str(exc)) from exc
    total_latency = time.monotonic() - start

    stop_event.set()
    sampler.join(timeout=2)

    hw = _summarize_samples(samples)
    stats = result["stats"]
    current_status = inference_engine.get_status()

    with get_session() as session:
        benchmark = Benchmark(
            model_artifact_id=None if build_id else model_artifact_id,
            build_id=build_id,
            tokens_per_sec=stats.get("tokens_per_sec"),
            prompt_tokens_per_sec=stats.get("prompt_tokens_per_sec"),
            ttft_seconds=(stats["ttft_ms"] / 1000) if stats.get("ttft_ms") is not None else None,
            total_latency_seconds=total_latency,
            cpu_util_pct=hw["cpu_util_pct"],
            gpu_util_pct=hw["gpu_util_pct"],
            vram_mb=hw["vram_mb"],
            ram_mb=hw["ram_mb"],
            temp_c=hw["temp_c"],
            context_length=current_status.get("context_length"),
            backend="llama.cpp",
            generation_params_json=params,
            is_measured=True,
        )
        session.add(benchmark)
        session.flush()
        benchmark_id = benchmark.id
        created_at = benchmark.created_at

    log.info(
        "Benchmark complete for artifact %s: %.1f tok/s, TTFT %.0fms",
        model_artifact_id,
        stats.get("tokens_per_sec") or 0,
        stats.get("ttft_ms") or 0,
    )

    return {
        "id": benchmark_id,
        "model_artifact_id": None if build_id else model_artifact_id,
        "build_id": build_id,
        "tokens_per_sec": stats.get("tokens_per_sec"),
        "prompt_tokens_per_sec": stats.get("prompt_tokens_per_sec"),
        "ttft_seconds": (stats["ttft_ms"] / 1000) if stats.get("ttft_ms") is not None else None,
        "total_latency_seconds": total_latency,
        "cpu_util_pct": hw["cpu_util_pct"],
        "gpu_util_pct": hw["gpu_util_pct"],
        "vram_mb": hw["vram_mb"],
        "ram_mb": hw["ram_mb"],
        "temp_c": hw["temp_c"],
        "context_length": current_status.get("context_length"),
        "backend": "llama.cpp",
        "created_at": created_at,
        "sample_count": len(samples),
    }


def run_benchmark_for_build(build_id: str, prompt: str = _DEFAULT_PROMPT) -> dict:
    from potato_core.db.models import Build

    with get_session() as session:
        build = session.get(Build, build_id)
        if build is None:
            raise BenchmarkError(f"Unknown build '{build_id}'")
        model_artifact_id = build.model_artifact_id
        context_length = build.context_length

    return run_benchmark(model_artifact_id, context_length=context_length, prompt=prompt, build_id=build_id)


def list_benchmarks(model_artifact_id: str | None = None, build_id: str | None = None) -> list[Benchmark]:
    with get_session() as session:
        query = session.query(Benchmark)
        if model_artifact_id:
            query = query.filter(Benchmark.model_artifact_id == model_artifact_id)
        if build_id:
            query = query.filter(Benchmark.build_id == build_id)
        rows = query.order_by(Benchmark.created_at.desc()).all()
        session.expunge_all()
        return rows


def get_benchmark(benchmark_id: str) -> Benchmark:
    with get_session() as session:
        row = session.get(Benchmark, benchmark_id)
        if row is None:
            raise BenchmarkError(f"Unknown benchmark '{benchmark_id}'")
        session.expunge(row)
        return row
