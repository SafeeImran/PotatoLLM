"""Model packs: the definitions have to be internally consistent, and a pack
has to be priced by the sum of what it loads."""
from __future__ import annotations

import pytest

from potato_core.db.base import get_session
from potato_core.db.models import ModelArtifact
from potato_core.engines import settings as app_settings
from potato_core.engines.models import packs as pack_engine
from potato_core.engines.models import seed_models
from potato_core.engines.models.registry_data import CURATED_MODELS

BY_ID = {m["id"]: m for m in CURATED_MODELS}


def test_every_pack_member_exists_in_the_catalog():
    for pack in pack_engine.PACKS:
        for member in pack.members:
            assert member.model_id in BY_ID, f"{pack.id} names unknown model '{member.model_id}'"


def test_roles_are_valid_and_unique_within_a_pack():
    # The router picks a model *by role*, so two claimants would make the
    # choice arbitrary.
    for pack in pack_engine.PACKS:
        roles = [m.role for m in pack.members]
        assert all(r in pack_engine.ROLES for r in roles), f"{pack.id} has an unknown role"
        assert len(roles) == len(set(roles)), f"{pack.id} has two members in the same role"


def test_every_pack_has_something_to_answer_with():
    for pack in pack_engine.PACKS:
        assert any(m.role == "primary" for m in pack.members), f"{pack.id} has no primary"


def test_a_vision_member_can_actually_see():
    # A pack promising eyes has to name a model that ships a projector —
    # without one, llama.cpp loads it text-only and the hand-off is a no-op.
    for pack in pack_engine.PACKS:
        for member in pack.members:
            if member.role == "vision":
                assert BY_ID[member.model_id]["mmproj_download_url"], (
                    f"{pack.id}'s vision member '{member.model_id}' has no projector"
                )


def test_role_specialists_have_the_capability_they_are_named_for():
    for pack in pack_engine.PACKS:
        for member in pack.members:
            if member.role in ("code", "reasoning"):
                assert member.role in BY_ID[member.model_id]["capabilities"], (
                    f"{pack.id}'s {member.role} member does not claim that capability"
                )


def test_every_member_says_why_it_is_there():
    for pack in pack_engine.PACKS:
        for member in pack.members:
            assert member.why.strip(), f"{pack.id}/{member.model_id} has no rationale"


def test_pack_is_priced_by_the_sum_of_its_members():
    seed_models()
    result = pack_engine.evaluate()
    packs = {p["id"]: p for p in result["packs"]}

    everyday = packs["everyday"]
    assert everyday["members"], "expected the catalog to be seeded"
    # The whole point of a pack is that the members are resident together, so
    # the total must exceed the largest single member rather than equal it.
    assert everyday["total_estimated_ram_mb"] == sum(m["estimated_ram_mb"] for m in everyday["members"])
    assert everyday["total_estimated_ram_mb"] > max(m["estimated_ram_mb"] for m in everyday["members"])


def test_featherweight_is_lighter_than_the_workshop():
    seed_models()
    packs = {p["id"]: p for p in pack_engine.evaluate()["packs"]}
    assert packs["featherweight"]["total_estimated_ram_mb"] < packs["workshop"]["total_estimated_ram_mb"]


def test_downloaded_members_are_reported_as_such():
    seed_models()
    member = pack_engine.BY_ID["featherweight"].members[0]

    before = {p["id"]: p for p in pack_engine.evaluate()["packs"]}["featherweight"]
    assert before["downloaded_count"] == 0

    with get_session() as session:
        session.add(
            ModelArtifact(
                model_id=member.model_id,
                format="gguf",
                quantization="Q4_K_M",
                file_path="C:\\somewhere.gguf",
                status="verified",
            )
        )

    after = {p["id"]: p for p in pack_engine.evaluate()["packs"]}["featherweight"]
    assert after["downloaded_count"] == 1
    assert any(m["downloaded"] and m["model_id"] == member.model_id for m in after["members"])


def test_no_hardware_profile_means_no_verdict_rather_than_a_guess():
    seed_models()
    result = pack_engine.evaluate()
    if not result["has_hardware_profile"]:
        assert all(p["compatibility"] is None for p in result["packs"])
        assert result["recommended_pack_id"] is None


def test_context_length_override_reprices_the_packs():
    seed_models()
    app_settings.set_value("default_context_length", 4096)
    small = {p["id"]: p for p in pack_engine.evaluate()["packs"]}["everyday"]
    large = {p["id"]: p for p in pack_engine.evaluate(context_length=32768)["packs"]}["everyday"]

    # More context is more KV cache, so a bigger window must cost more memory.
    assert large["total_estimated_ram_mb"] > small["total_estimated_ram_mb"]
    app_settings.reset("default_context_length")


# ---------------------------------------------------------------------------
# The tailored pack — assembled to the machine rather than written down
# ---------------------------------------------------------------------------


def _tailored_for(vram_mb, ram_mb, backend="CUDA", context=4096):
    seed_models()
    return pack_engine._build_tailored(pack_engine._catalog(), vram_mb, ram_mb, backend, context)


def _total_vram(pack, catalog):
    return sum(catalog[m.model_id].est_vram_mb for m in pack.members)


def test_tailored_pack_stays_inside_a_small_vram_budget():
    seed_models()
    catalog = pack_engine._catalog()
    pack = _tailored_for(vram_mb=8192, ram_mb=32768)

    assert pack is not None
    # The point of this pack: it fits, where a curated one may not.
    assert _total_vram(pack, catalog) <= 8192 * pack_engine._VRAM_BUDGET


def test_a_bigger_card_earns_a_bigger_pack():
    seed_models()
    catalog = pack_engine._catalog()
    small = _tailored_for(vram_mb=6144, ram_mb=32768)
    large = _tailored_for(vram_mb=24576, ram_mb=65536)

    assert _total_vram(large, catalog) > _total_vram(small, catalog)


def test_tailored_pack_pairs_a_writer_with_eyes():
    seed_models()
    catalog = pack_engine._catalog()
    pack = _tailored_for(vram_mb=8192, ram_mb=32768)

    roles = {m.role: m.model_id for m in pack.members}
    assert "primary" in roles
    # The writer is a text model and the eyes can actually see — that pairing is
    # what the hand-off needs.
    assert not catalog[roles["primary"]].mmproj_download_url
    assert catalog[roles["vision"]].mmproj_download_url


def test_no_tailored_pack_rather_than_one_that_cannot_run():
    # A machine too small for even the smallest model gets nothing offered,
    # not a pack that will swap.
    assert _tailored_for(vram_mb=64, ram_mb=256) is None


def test_a_cpu_only_machine_is_budgeted_on_ram():
    seed_models()
    pack = _tailored_for(vram_mb=None, ram_mb=8192, backend="CPU")
    assert pack is not None
    catalog = pack_engine._catalog()
    total_ram = sum(catalog[m.model_id].est_ram_mb for m in pack.members)
    assert total_ram <= 8192 * pack_engine._RAM_BUDGET


def test_members_of_rejects_an_unknown_pack():
    with pytest.raises(KeyError):
        pack_engine.members_of("no-such-pack")
