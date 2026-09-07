"""Curated model packs — sets of models meant to be loaded *together*.

A pack is the answer to "which models should I actually download?", which the
flat 32-entry catalog does not answer on its own. Each pack names one model per
role, and those roles are the same ones the Playground routes on: the primary
answers, the vision member is the chat's eyes when the primary has none, and
the code/reasoning members are there for the user to hand a turn to.

The important difference from a single-model recommendation is that a pack's
members are resident at the same time, so a pack is priced by the **sum** of
its members' estimates, not the largest one. A pack of three 8B models does
not fit a machine that runs one 8B model comfortably, and saying otherwise
would be the most useful-sounding lie this module could tell.
"""
from __future__ import annotations

from dataclasses import dataclass

from potato_core.db.base import get_session
from potato_core.db.models import Model, ModelArtifact
from potato_core.engines import settings as app_settings
from potato_core.engines.hardware import service as hardware_service
from potato_core.engines.recommendation.compatibility import (
    classify_fit,
    context_overhead_mb,
    recommend_backend,
)

# Roles a pack member can hold. One member per role, at most — the Playground's
# router picks a model by role, so two claimants would make that ambiguous.
ROLES = ("primary", "vision", "code", "reasoning")

_TIER_RANK = {"GREEN": 0, "YELLOW": 1, "RED": 2}


@dataclass(frozen=True)
class PackMember:
    model_id: str
    role: str
    #: Why this model and not another — shown next to the member in the UI.
    why: str


@dataclass(frozen=True)
class ModelPack:
    id: str
    name: str
    tagline: str
    description: str
    members: tuple[PackMember, ...]


PACKS: tuple[ModelPack, ...] = (
    ModelPack(
        id="featherweight",
        name="Featherweight",
        tagline="Runs on almost anything",
        description=(
            "Three small models that fit together on a CPU-only machine or an entry-level GPU. "
            "Nothing here will astonish you, but all of it runs, and the vision model means you "
            "can still ask about a screenshot."
        ),
        members=(
            PackMember("qwen3-1.7b", "primary", "Current, quick, and small enough to leave loaded all day."),
            PackMember("smolvlm-256m-instruct", "vision", "Eyes for under 300 MB — captions and simple questions."),
            PackMember("qwen2.5-coder-1.5b-instruct", "code", "Better at code than any general model this size."),
        ),
    ),
    ModelPack(
        id="everyday",
        name="Everyday Potato",
        tagline="The sensible default",
        description=(
            "A capable generalist to do the talking, a vision model to read screenshots and "
            "photos, and a dedicated coder. The pack most people should start with if the "
            "memory is there."
        ),
        members=(
            PackMember("qwen2.5-7b-instruct", "primary", "Strong all-rounder that also holds its own on code."),
            PackMember("qwen2.5-vl-3b-instruct", "vision", "Detailed image reading without a 7B vision bill."),
            PackMember("qwen2.5-coder-3b-instruct", "code", "Everyday coding help that leaves room for the other two."),
        ),
    ),
    ModelPack(
        id="sharp-eyes",
        name="Sharp Eyes",
        tagline="For work that starts with a picture",
        description=(
            "The pairing the Playground's hand-off was built for: a text model that writes well "
            "but cannot see, and a vision model that sees in detail. Attach an image and the "
            "vision model describes it for the writer automatically."
        ),
        members=(
            PackMember("llama-3.1-8b-instruct", "primary", "Writes and reasons better than most vision models can."),
            PackMember("qwen2.5-vl-7b-instruct", "vision", "Reads screenshots, documents and charts closely."),
        ),
    ),
    ModelPack(
        id="workshop",
        name="The Workshop",
        tagline="Everything, if you have the memory",
        description=(
            "A 12B multimodal generalist that already sees, plus a real code model and a "
            "step-by-step reasoner to hand the hard questions to. Wants a large GPU or a lot "
            "of system RAM."
        ),
        members=(
            PackMember("gemma-3-12b-it", "primary", "Reads images itself, so no hand-off is needed."),
            PackMember("qwen2.5-coder-7b-instruct", "code", "The strongest coder here that still quantizes small."),
            PackMember(
                "deepseek-r1-distill-llama-8b",
                "reasoning",
                "Thinks before answering — worth the wait on maths and multi-step problems.",
            ),
        ),
    ),
)

BY_ID = {pack.id: pack for pack in PACKS}

#: The tailored pack's id. Not in PACKS, because its members are chosen per
#: machine rather than written down.
TAILORED_ID = "tailored"

#: Fraction of detected memory a pack may occupy and still count as fitting.
#: The rest is the operating system, the browser the user has open, and the
#: fact that these are estimates.
_VRAM_BUDGET = 0.8
_RAM_BUDGET = 0.7


def _fits(vram_mb: int, ram_mb: int, hw_vram: int | None, hw_ram: int | None, backend: str) -> bool:
    if backend in ("CUDA", "ROCm", "Metal") and hw_vram:
        return vram_mb <= hw_vram * _VRAM_BUDGET
    return bool(hw_ram) and ram_mb <= hw_ram * _RAM_BUDGET


def _build_tailored(
    catalog: dict[str, Model],
    hw_vram: int | None,
    hw_ram: int | None,
    backend: str,
    default_context: int,
) -> ModelPack | None:
    """Assemble a pack that actually fits, from the catalog.

    The curated packs are fixed sets, which is what makes their descriptions
    honest — but it also means the best of them may be a "tight fit" on a
    machine, with no smaller equivalent offered. This builds one to the budget
    instead: the largest writer that fits, then the largest pair of eyes that
    fits in what is left, then a coder if there is still room.

    Returns None when nothing at all fits, rather than proposing a pack that
    does not.
    """

    def cost(model: Model) -> tuple[int, int]:
        overhead = context_overhead_mb(model.parameter_count, min(default_context, model.context_length))
        return model.est_vram_mb + overhead, model.est_ram_mb + overhead

    def candidates(predicate) -> list[Model]:
        # Largest first: within a budget, more parameters is the better model.
        return sorted(
            (m for m in catalog.values() if predicate(m)),
            key=lambda m: m.est_ram_mb,
            reverse=True,
        )

    def first_that_fits(models: list[Model], used_vram: int, used_ram: int) -> Model | None:
        for model in models:
            vram, ram = cost(model)
            if _fits(used_vram + vram, used_ram + ram, hw_vram, hw_ram, backend):
                return model
        return None

    is_vision = lambda m: bool(m.mmproj_download_url)  # noqa: E731
    is_text = lambda m: not m.mmproj_download_url  # noqa: E731

    vision_options = candidates(is_vision)

    # Room for the eyes is reserved *before* the writer is chosen. Picking the
    # largest writer that fits and only then looking for a vision model spends
    # the whole budget on the writer and leaves none — which loses the pairing
    # the pack exists for. Reserving the cheapest projector-carrying model
    # guarantees the pair, and the writer still gets everything left over.
    cheapest_eyes = min(vision_options, key=lambda m: m.est_ram_mb, default=None)
    reserve_vram, reserve_ram = cost(cheapest_eyes) if cheapest_eyes else (0, 0)

    writer = first_that_fits(candidates(is_text), reserve_vram, reserve_ram)
    if writer is None:
        # Nothing fits alongside eyes — fall back to a writer on its own rather
        # than offering nothing at all.
        writer = first_that_fits(candidates(is_text), 0, 0)
    if writer is None:
        return None
    used_vram, used_ram = cost(writer)

    members = [
        PackMember(
            writer.id,
            "primary",
            f"The largest text model that fits your {backend if hw_vram else 'system'} budget.",
        )
    ]

    eyes = first_that_fits(vision_options, used_vram, used_ram)
    if eyes is not None:
        vram, ram = cost(eyes)
        used_vram += vram
        used_ram += ram
        members.append(
            PackMember(eyes.id, "vision", f"Reads images for {writer.name}, which cannot see them itself.")
        )

    coder = first_that_fits(
        candidates(lambda m: is_text(m) and "code" in (m.capabilities or []) and m.id != writer.id),
        used_vram,
        used_ram,
    )
    if coder is not None:
        members.append(PackMember(coder.id, "code", "Fits in the memory left over, and is better at code."))

    fitted = "your GPU" if (hw_vram and backend in ("CUDA", "ROCm", "Metal")) else "your system RAM"
    return ModelPack(
        id=TAILORED_ID,
        name="Built for your potato",
        tagline="Assembled to fit, not to impress",
        description=(
            f"Chosen from the catalog against what this machine actually has: the largest models "
            f"that still leave headroom in {fitted} when loaded together. This is the set to take "
            "if the curated packs above come out as a tight fit."
        ),
        members=tuple(members),
    )


def _downloaded_model_ids() -> set[str]:
    with get_session() as session:
        rows = (
            session.query(ModelArtifact.model_id)
            .filter(ModelArtifact.status == "verified")
            .distinct()
            .all()
        )
        return {row[0] for row in rows}


def _catalog() -> dict[str, Model]:
    with get_session() as session:
        rows = session.query(Model).all()
        session.expunge_all()
        return {row.id: row for row in rows}


def evaluate(context_length: int | None = None) -> dict:
    """Every pack, priced and graded against this machine.

    Returns packs plus the id of the one to lead with. Hardware is optional:
    without a scan the packs still list, they just carry no verdict rather
    than a guessed one.
    """
    catalog = _catalog()
    downloaded = _downloaded_model_ids()
    profile = hardware_service.get_latest_profile()
    snapshot = profile.snapshot if profile else None

    hw_vram = snapshot.gpu.vram_mb if snapshot else None
    hw_ram = snapshot.memory.total_mb if snapshot else None
    hw_backend = snapshot.compute_backend if snapshot else "Unknown"

    default_context = context_length or app_settings.get("default_context_length")

    tailored = (
        _build_tailored(catalog, hw_vram, hw_ram, hw_backend, default_context) if snapshot else None
    )

    results: list[dict] = []
    for pack in ((tailored,) if tailored else ()) + PACKS:
        members: list[dict] = []
        total_vram = 0
        total_ram = 0
        missing_from_catalog: list[str] = []

        for member in pack.members:
            model = catalog.get(member.model_id)
            if model is None:
                # A pack naming a model the catalog does not have is a bug, but
                # it should surface as a visibly incomplete pack rather than a
                # 500 from the models page.
                missing_from_catalog.append(member.model_id)
                continue

            resolved_context = min(default_context, model.context_length)
            overhead = context_overhead_mb(model.parameter_count, resolved_context)
            vram = model.est_vram_mb + overhead
            ram = model.est_ram_mb + overhead
            total_vram += vram
            total_ram += ram

            members.append(
                {
                    "model_id": model.id,
                    "model_name": model.name,
                    "role": member.role,
                    "why": member.why,
                    "parameter_count": model.parameter_count,
                    "capabilities": list(model.capabilities or []),
                    "vision": bool(model.mmproj_download_url),
                    "estimated_vram_mb": vram,
                    "estimated_ram_mb": ram,
                    "downloaded": model.id in downloaded,
                }
            )

        compatibility = (
            classify_fit(total_vram, total_ram, hw_vram, hw_ram, hw_backend) if snapshot else None
        )

        results.append(
            {
                "id": pack.id,
                "name": pack.name,
                "tagline": pack.tagline,
                "description": pack.description,
                "members": members,
                "missing_from_catalog": missing_from_catalog,
                # Summed, because the whole point of a pack is that they are
                # loaded at once.
                "total_estimated_vram_mb": total_vram,
                "total_estimated_ram_mb": total_ram,
                "context_length": default_context,
                "compatibility": compatibility,
                "recommended_backend": recommend_backend(hw_backend) if snapshot else None,
                "downloaded_count": sum(1 for m in members if m["downloaded"]),
                "member_count": len(members),
            }
        )

    return {
        "packs": results,
        "recommended_pack_id": _pick_recommended(results),
        "has_hardware_profile": snapshot is not None,
        "is_mock_hardware": bool(snapshot.is_mock) if snapshot else False,
    }


def _pick_recommended(results: list[dict]) -> str | None:
    """The most capable pack that still fits.

    Ambition is the tie-breaker, not caution: among packs of the same
    compatibility tier the heavier one is the better recommendation, since a
    GREEN verdict already says the machine can carry it.
    """
    graded = [r for r in results if r["compatibility"] is not None and r["members"]]
    if not graded:
        return None
    usable = [r for r in graded if r["compatibility"] != "RED"]
    if not usable:
        # Everything is over budget — point at the lightest, which is the only
        # honest suggestion left.
        return min(graded, key=lambda r: r["total_estimated_ram_mb"])["id"]
    return min(
        usable,
        key=lambda r: (_TIER_RANK[r["compatibility"]], -r["total_estimated_ram_mb"]),
    )["id"]


def members_of(pack_id: str) -> list[PackMember]:
    """The models a pack is made of.

    The tailored pack is rebuilt here rather than looked up: its membership is
    a function of the machine, so caching it would let the download button act
    on a set assembled before the last hardware scan.
    """
    if pack_id == TAILORED_ID:
        profile = hardware_service.get_latest_profile()
        if profile is None:
            raise KeyError("No hardware profile yet — run a hardware scan first")
        snapshot = profile.snapshot
        tailored = _build_tailored(
            _catalog(),
            snapshot.gpu.vram_mb,
            snapshot.memory.total_mb,
            snapshot.compute_backend,
            app_settings.get("default_context_length"),
        )
        if tailored is None:
            raise KeyError("No pack fits this machine")
        return list(tailored.members)

    pack = BY_ID.get(pack_id)
    if pack is None:
        raise KeyError(f"Unknown pack '{pack_id}'")
    return list(pack.members)
