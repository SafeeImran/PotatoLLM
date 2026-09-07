from __future__ import annotations

from potato_core.engines.models import get_model, list_models, seed_models
from potato_core.engines.models.registry_data import CURATED_MODELS


def test_seed_models_creates_all_curated_models():
    seed_models()
    models = list_models()
    assert len(models) == len(CURATED_MODELS)
    assert {m.id for m in models} == {d["id"] for d in CURATED_MODELS}


def test_seed_models_is_idempotent():
    seed_models()
    seed_models()
    seed_models()
    assert len(list_models()) == len(CURATED_MODELS)


def test_get_model_returns_curated_metadata():
    seed_models()
    model = get_model("llama-3.1-8b-instruct")
    assert model is not None
    assert model.name == "Llama 3.1 8B Instruct"
    assert model.family == "Llama"
    assert "llama.cpp" in model.supported_backends


def test_get_model_missing_returns_none():
    seed_models()
    assert get_model("does-not-exist") is None


def test_list_models_filters_by_family():
    seed_models()
    qwen_models = list_models(family="qwen")
    assert len(qwen_models) >= 3
    assert all(m.family == "Qwen" for m in qwen_models)


def test_list_models_filters_by_query():
    seed_models()
    results = list_models(query="tiny")
    assert any(m.id == "tinyllama-1.1b-chat" for m in results)


def test_seed_models_backfills_new_fields_on_existing_rows():
    """Regression test: seed_models() must UPDATE existing rows, not just skip
    them — otherwise a DB seeded before a registry field was added (e.g.
    download_url) stays stuck with stale/blank data forever."""
    from potato_core.db.base import get_session
    from potato_core.db.models import Model

    seed_models()
    with get_session() as session:
        row = session.get(Model, "tinyllama-1.1b-chat")
        row.download_url = ""  # simulate a pre-download_url seeded row
        row.description = "stale description"

    seed_models()
    model = get_model("tinyllama-1.1b-chat")
    assert model.download_url.startswith("https://huggingface.co/")
    assert model.description != "stale description"


def test_every_curated_model_has_positive_memory_estimates():
    for data in CURATED_MODELS:
        assert data["est_vram_mb"] > 0
        assert data["est_ram_mb"] > data["est_vram_mb"] - 2048  # RAM estimate should be in the same ballpark
        assert data["context_length"] > 0
        assert len(data["recommended_quantizations"]) > 0


def test_every_curated_model_has_a_gguf_download_url():
    for data in CURATED_MODELS:
        assert data["download_url"].startswith("https://huggingface.co/")
        assert data["download_url"].endswith(".gguf")
