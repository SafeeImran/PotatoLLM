"""Compatibility/Recommendation Engine (spec section 13) — real hardware +
real registry data feeding the pure math in compatibility.py. Every
VRAM/RAM figure this returns must be presented as "Estimated" — the
Benchmark Engine (Phase 9) is the only source of "Measured" numbers.
"""
from __future__ import annotations

from potato_core.db.base import get_session
from potato_core.db.models import Model, ModelArtifact
from potato_core.engines import downloads as download_engine
from potato_core.engines import quantization as quantization_engine
from potato_core.engines import settings as app_settings
from potato_core.engines.hardware import service as hardware_service
from potato_core.engines.recommendation.compatibility import evaluate_fit, pick_best_fit
from potato_core.logging_config import get_logger

log = get_logger("recommendation")

_ALWAYS_AVAILABLE_QUANT = "Q4_K_M"  # the one every curated model ships as a direct download
_FULL_PRECISION_QUANTS = ("FP16", "F16", "F32")

# Default context length used to size the fit estimate when the caller
# doesn't specify one. Several curated models advertise 128K-token context
# windows; sizing "Make It Potato" against that maximum by default would
# call an 8B model RED on an 8GB GPU it runs perfectly well on for normal
# chat — real KV-cache math confirms 128K context alone needs ~16GB just
# for cache on a GQA 8B model. The 4096 default matches typical everyday
# usage and is also compatibility.py's own baseline (zero context overhead
# below it); it is user-adjustable via the `default_context_length` setting,
# so a fit estimate always reflects the context the model would actually be
# loaded with.
_DEFAULT_CONTEXT_LENGTH_SETTING = "default_context_length"


class RecommendationError(Exception):
    pass


def available_quant_options(model: Model) -> list[str]:
    """Only quant levels this app can actually produce for this model:
    Q4_K_M (the direct download every curated model has) plus, only if a
    full-precision source is available for local requantization, the rest
    of the model's recommended list."""
    options = [_ALWAYS_AVAILABLE_QUANT]
    if model.fp16_available:
        for q in model.recommended_quantizations:
            if q not in options:
                options.append(q)
    return options


def recommend(model_id: str, context_length: int | None = None) -> dict:
    with get_session() as session:
        model = session.get(Model, model_id)
        if model is None:
            raise RecommendationError(f"Unknown model '{model_id}'")
        base_est_vram_mb = model.est_vram_mb
        base_est_ram_mb = model.est_ram_mb
        parameter_count = model.parameter_count
        model_max_context = model.context_length
        options = available_quant_options(model)

    profile = hardware_service.get_latest_profile()
    if profile is None:
        raise RecommendationError("No hardware profile yet — run a hardware scan first")

    resolved_context = min(
        context_length or app_settings.get(_DEFAULT_CONTEXT_LENGTH_SETTING), model_max_context
    )
    snapshot = profile.snapshot

    estimates = [
        evaluate_fit(
            base_est_vram_mb=base_est_vram_mb,
            base_est_ram_mb=base_est_ram_mb,
            parameter_count=parameter_count,
            quant=quant,
            context_length=resolved_context,
            hw_vram_mb=snapshot.gpu.vram_mb,
            hw_ram_mb=snapshot.memory.total_mb,
            hw_backend=snapshot.compute_backend,
        )
        for quant in options
    ]
    best = pick_best_fit(estimates)

    def _serialize(e):
        return {
            "quantization": e.quantization,
            "context_length": e.context_length,
            "estimated_vram_mb": e.estimated_vram_mb,
            "estimated_ram_mb": e.estimated_ram_mb,
            "compatibility": e.compatibility,
            "recommended_backend": e.recommended_backend,
            "recommended_gpu_offload_pct": e.recommended_gpu_offload_pct,
        }

    return {
        "model_id": model_id,
        "potato_score": profile.potato_score.score,
        "potato_classification": profile.potato_score.classification,
        "recommended": _serialize(best),
        "all_options": [_serialize(e) for e in estimates],
        "is_mock_hardware": snapshot.is_mock,
    }


def make_it_potato(model_id: str, context_length: int | None = None) -> dict:
    """"Make It Potato" (spec section 14): the signature one-click flow.

    Runs `recommend()` (steps 1-8: inspect hardware/model, determine
    quant/backend/offload) then advances whatever real pipeline step is
    still needed to reach a runnable artifact (steps 9-10: prepare,
    benchmark is a separate explicit user action once ready — this
    function's job ends at "ready to run/benchmark").

    Safe to call repeatedly: each call checks current state and does
    whatever's next, or reports "ready" if nothing's left to do. Reuses any
    already-in-flight download/quantization job for this model rather than
    starting a duplicate (start_download/start_quantization already do this).
    """
    recommendation = recommend(model_id, context_length)
    target_quant = recommendation["recommended"]["quantization"]
    # A full-precision target (e.g. "FP16") is satisfied by *any*
    # full-precision artifact regardless of its exact label (FP16/F16/F32
    # are interchangeable bit-for-bit-equivalent labels — see
    # quant_scaling.BPW_TABLE) — matching only the literal target string
    # would miss an already-downloaded fp16 source and trigger a pointless
    # "quantize FP16 into FP16" pass through llama-quantize.
    acceptable_quants = _FULL_PRECISION_QUANTS if target_quant in _FULL_PRECISION_QUANTS else (target_quant,)

    with get_session() as session:
        existing = (
            session.query(ModelArtifact)
            .filter(
                ModelArtifact.model_id == model_id,
                ModelArtifact.quantization.in_(acceptable_quants),
                ModelArtifact.status == "verified",
            )
            .first()
        )
        if existing:
            return {"status": "ready", "recommendation": recommendation, "artifact_id": existing.id}

    if target_quant == _ALWAYS_AVAILABLE_QUANT:
        job = download_engine.start_download(model_id, variant="quantized")
        log.info("Make It Potato: downloading %s (%s) for %s", target_quant, job["job_id"], model_id)
        return {"status": "preparing", "step": "downloading", "recommendation": recommendation, "job": job}

    # A better-than-default quant was recommended (more VRAM/RAM headroom
    # than Q4_K_M needs) — this only happens for models with a verified
    # fp16_download_url (see available_quant_options), so a local
    # requantization path is guaranteed to exist here.
    with get_session() as session:
        fp16_artifact = (
            session.query(ModelArtifact)
            .filter(
                ModelArtifact.model_id == model_id,
                ModelArtifact.quantization.in_(_FULL_PRECISION_QUANTS),
                ModelArtifact.status == "verified",
            )
            .first()
        )
        fp16_artifact_id = fp16_artifact.id if fp16_artifact else None

    if fp16_artifact_id is None:
        job = download_engine.start_download(model_id, variant="fp16")
        log.info("Make It Potato: downloading FP16 source (%s) for %s", job["job_id"], model_id)
        return {"status": "preparing", "step": "downloading_fp16_source", "recommendation": recommendation, "job": job}

    if target_quant in _FULL_PRECISION_QUANTS:
        # The just-verified fp16 source already *is* the target precision —
        # no quantization pass needed, it's ready to use as-is.
        return {"status": "ready", "recommendation": recommendation, "artifact_id": fp16_artifact_id}

    job = quantization_engine.start_quantization(fp16_artifact_id, target_quant)
    log.info("Make It Potato: quantizing to %s (%s) for %s", target_quant, job["job_id"], model_id)
    return {"status": "preparing", "step": "quantizing", "recommendation": recommendation, "job": job}
