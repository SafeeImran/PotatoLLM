"""Unit tests for the pure logic in the inference engine, plus one real
integration test that actually spawns llama-server and generates text —
skipped (not failed) when the vendored binary or a real downloaded model
isn't available on this machine, since neither is something CI can assume.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import Model, ModelArtifact
from potato_core.engines import inference as inference_engine
from potato_core.engines.inference.llama_cpp_backend import (
    _build_payload,
    _fold_system_messages,
    _is_unsupported_system_role_error,
    _timings_to_stats,
)
from potato_core.engines.models import seed_models

# The real file this session downloaded during Phase 6 testing, if present.
_REAL_DOWNLOADED_GGUF = (
    Path.home() / "AppData" / "Roaming" / "PotatoLLM" / "models" / "qwen2.5-0.5b-instruct"
    / "qwen2.5-0.5b-instruct-q4_k_m.gguf"
)


def test_build_payload_includes_generation_params():
    payload = _build_payload(
        [{"role": "user", "content": "hi"}],
        {"temperature": 0.5, "top_p": 0.9, "top_k": 20, "max_tokens": 100, "stop": ["\n"]},
        stream=True,
    )
    assert payload["temperature"] == 0.5
    assert payload["top_p"] == 0.9
    assert payload["top_k"] == 20
    assert payload["max_tokens"] == 100
    assert payload["stop"] == ["\n"]
    assert payload["stream"] is True


def test_build_payload_uses_sensible_defaults_when_params_missing():
    payload = _build_payload([{"role": "user", "content": "hi"}], {}, stream=False)
    assert payload["temperature"] == 0.8
    assert payload["max_tokens"] == 512
    assert payload["min_p"] == 0.05
    assert payload["repeat_penalty"] == 1.1
    assert payload["repeat_last_n"] == 64
    assert "stop" not in payload


def test_build_payload_passes_the_repetition_and_min_p_controls_through():
    payload = _build_payload(
        [{"role": "user", "content": "hi"}],
        {"min_p": 0.1, "repeat_penalty": 1.25, "repeat_last_n": 256},
        stream=False,
    )
    assert payload["min_p"] == 0.1
    assert payload["repeat_penalty"] == 1.25
    assert payload["repeat_last_n"] == 256


def test_build_payload_sends_a_pinned_seed_but_not_the_random_sentinel():
    pinned = _build_payload([{"role": "user", "content": "hi"}], {"seed": 42}, stream=False)
    assert pinned["seed"] == 42

    # -1 means "roll a new one", which is what omitting the field already does.
    random_seed = _build_payload([{"role": "user", "content": "hi"}], {"seed": -1}, stream=False)
    assert "seed" not in random_seed


def test_timings_to_stats_maps_llama_server_fields():
    stats = _timings_to_stats(
        {
            "prompt_n": 36,
            "prompt_per_second": 191.3,
            "predicted_n": 11,
            "predicted_per_second": 50.07,
            "prompt_ms": 188.174,
        }
    )
    assert stats["prompt_tokens"] == 36
    assert stats["tokens_per_sec"] == 50.07
    assert stats["ttft_ms"] == 188.174


def test_timings_to_stats_handles_missing_timings():
    assert _timings_to_stats(None) == {}


def test_is_unsupported_system_role_error_matches_mistrals_own_wording():
    # Mistral-Instruct's official chat_template raises this exact text when a
    # leading system message breaks its strict user/assistant alternation.
    message = (
        "Unable to generate parser for this template. Automatic parser generation failed: "
        "While executing CallExpression at line 1, column 125 in source: ...op.index0 % 2 == 0) %}"
        "{{ raise_exception('Conversation roles must alternate user/assistant/user/assistant/...') }}"
        "{% endif %}... Error: Jinja Exception: Conversation roles must alternate "
        "user/assistant/user/assistant/..."
    )
    assert _is_unsupported_system_role_error(message) is True


def test_is_unsupported_system_role_error_ignores_unrelated_errors():
    assert _is_unsupported_system_role_error("The request is longer than the context window") is False


def test_fold_system_messages_merges_a_leading_system_prompt_into_the_first_user_turn():
    folded = _fold_system_messages(
        [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "hi"},
        ]
    )
    assert folded == [{"role": "user", "content": "You are helpful.\n\nhi"}]


def test_fold_system_messages_preserves_other_fields_on_the_merged_turn():
    folded = _fold_system_messages(
        [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "hi", "attachment_ids": ["a1"]},
        ]
    )
    assert folded[0]["attachment_ids"] == ["a1"]
    assert folded[0]["content"] == "You are helpful.\n\nhi"


def test_fold_system_messages_handles_a_hand_off_note_mid_conversation():
    # send()'s history: leading system prompt, a user turn, an assistant
    # reply, a hand-off note (also role "system"), then the next user turn.
    folded = _fold_system_messages(
        [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "what is in this image?"},
            {"role": "assistant", "content": "a cat"},
            {"role": "system", "content": "The vision model read the image as: a cat."},
            {"role": "user", "content": "now describe its color"},
        ]
    )
    roles = [m["role"] for m in folded]
    assert roles == ["user", "assistant", "user"]
    assert folded[0]["content"] == "You are helpful.\n\nwhat is in this image?"
    assert folded[2]["content"] == "The vision model read the image as: a cat.\n\nnow describe its color"


def test_fold_system_messages_appends_a_trailing_system_message_to_the_previous_turn():
    folded = _fold_system_messages(
        [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
            {"role": "system", "content": "a trailing note"},
        ]
    )
    assert folded == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello\n\na trailing note"},
    ]


def test_fold_system_messages_merges_into_multimodal_content_as_a_text_part():
    # orchestrator.py's _expand_after_handoff always returns list content
    # (a list of {"type": ...} parts) for the final turn once a vision
    # hand-off has occurred, even for a text-only responder. Splicing the
    # system text into that list — rather than inserting it as a separate
    # same-role turn — is what keeps this fold from re-breaking Mistral's
    # strict alternation on exactly the multi-model hand-off path it exists
    # to fix (a separate turn would sit right next to this one, both "user").
    image_parts = [{"type": "text", "text": "what is this?"}, {"type": "image_url", "image_url": {"url": "data:..."}}]
    folded = _fold_system_messages(
        [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": image_parts},
        ]
    )
    assert len(folded) == 1
    assert folded[0]["role"] == "user"
    assert folded[0]["content"] == [{"type": "text", "text": "You are helpful."}, *image_parts]


def test_fold_system_messages_appends_a_trailing_system_message_into_multimodal_content():
    image_parts = [{"type": "image_url", "image_url": {"url": "data:..."}}]
    folded = _fold_system_messages(
        [
            {"role": "user", "content": image_parts},
            {"role": "system", "content": "a trailing note"},
        ]
    )
    assert len(folded) == 1
    assert folded[0]["content"] == [*image_parts, {"type": "text", "text": "a trailing note"}]


def test_fold_system_messages_is_a_no_op_without_any_system_message():
    messages = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
    assert _fold_system_messages(messages) == messages


def test_fold_system_messages_never_produces_adjacent_same_role_turns():
    # Reproduces orchestrator.py's run_turn shape for a text-only responder
    # (Mistral) paired with a vision slot (SmolVLM): the leading system
    # prompt AND the freshly-inserted hand-off note both land immediately
    # before the final turn, which _expand_after_handoff has already turned
    # into list content. This is the exact request that kept failing after
    # the first fold fix — that version folded a list-content target into a
    # *new* same-role message instead of into the list, so the retry still
    # broke Mistral's alternation check the same way the original request did.
    image_parts = [{"type": "text", "text": "[image: photo.png — read by SmolVLM, transcribed above]"}]
    folded = _fold_system_messages(
        [
            {"role": "system", "content": "You are helpful."},
            {"role": "system", "content": "SmolVLM read the image(s) and transcribed them as:\n\na cat"},
            {"role": "user", "content": image_parts},
        ]
    )
    roles = [m["role"] for m in folded]
    assert all(a != b for a, b in zip(roles, roles[1:])), f"adjacent same-role turns in {roles}"
    assert roles == ["user"]
    assert folded[0]["content"] == [
        {"type": "text", "text": "You are helpful.\n\nSmolVLM read the image(s) and transcribed them as:\n\na cat"},
        *image_parts,
    ]


def test_status_when_nothing_loaded():
    inference_engine.unload_model()  # ensure clean state regardless of test order
    status = inference_engine.get_status()
    assert status["loaded"] is False
    assert status["model_artifact_id"] is None


def test_load_unknown_artifact_raises():
    with pytest.raises(inference_engine.InferenceError, match="Unknown model artifact"):
        inference_engine.load_model("does-not-exist")


def test_load_unverified_artifact_raises():
    seed_models()
    with get_session() as session:
        artifact = ModelArtifact(
            model_id="tinyllama-1.1b-chat",
            format="gguf",
            quantization="Q4_K_M",
            file_path="C:\\nowhere.gguf",
            status="downloading",  # not yet verified
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    with pytest.raises(inference_engine.InferenceError, match="not verified"):
        inference_engine.load_model(artifact_id)


@pytest.fixture(scope="module")
def real_verified_artifact():
    """Copies the real GGUF this session already downloaded (Phase 6) into
    the isolated test data dir and registers it as a verified artifact —
    skips the dependent tests if that file or the vendored binary aren't
    present, rather than failing a fresh checkout/CI."""
    if not settings.llama_server_executable.exists():
        pytest.skip("llama-server binary not vendored — see DEVELOPMENT.md")
    if not _REAL_DOWNLOADED_GGUF.exists():
        pytest.skip("no real downloaded GGUF available to test against")

    seed_models()
    target_dir = settings.models_dir / "qwen2.5-0.5b-instruct"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / _REAL_DOWNLOADED_GGUF.name
    if not target.exists():
        shutil.copyfile(_REAL_DOWNLOADED_GGUF, target)

    with get_session() as session:
        artifact = ModelArtifact(
            model_id="qwen2.5-0.5b-instruct",
            format="gguf",
            quantization="Q4_K_M",
            file_path=str(target),
            size_bytes=target.stat().st_size,
            status="verified",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    yield artifact_id
    inference_engine.unload_model()


def test_real_load_generate_unload_roundtrip(real_verified_artifact):
    status = inference_engine.load_model(real_verified_artifact, context_length=1024)
    assert status["loaded"] is True
    assert status["model_artifact_id"] == real_verified_artifact

    result = inference_engine.generate(
        [{"role": "user", "content": "Reply with exactly the word: potato"}],
        {"max_tokens": 10, "temperature": 0.0},
    )
    assert isinstance(result["content"], str)
    assert len(result["content"]) > 0
    # Measured, not estimated — must be real positive numbers from llama-server.
    assert result["stats"]["tokens_per_sec"] > 0
    assert result["stats"]["prompt_tokens"] > 0

    inference_engine.unload_model()
    assert inference_engine.get_status()["loaded"] is False


def test_real_benchmark_returns_measured_stats(real_verified_artifact):
    inference_engine.load_model(real_verified_artifact, context_length=1024)
    stats = inference_engine.benchmark("Count to three.")
    assert stats["tokens_per_sec"] > 0
    assert stats["prompt_tokens_per_sec"] > 0
    inference_engine.unload_model()


def test_generate_without_loaded_model_raises():
    inference_engine.unload_model()
    with pytest.raises(inference_engine.InferenceError, match="No model is loaded"):
        inference_engine.generate([{"role": "user", "content": "hi"}], {})
