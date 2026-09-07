"""Real Inference Engine backend — spawns the vendored `llama-server` binary
as a child process per loaded model and talks to its OpenAI-compatible HTTP
API. The UI never touches llama.cpp directly; it only ever calls the
functions in this module (via api/inference.py).

**Several models can be resident at once.** Each loaded artifact gets its own
`llama-server` on its own port — a "slot" — and every slot carries a role
(primary / vision / code / reasoning) that the orchestrator routes on. That is
what lets one chat turn use more than one model: a vision slot reads the image,
the primary slot writes the answer.

Slots are capped by the `max_loaded_models` setting rather than by hope: each
one is a real process holding real weights, and the failure mode of loading a
fourth 8B model is the machine swapping, not a tidy error. Nothing here
estimates whether the next model *will* fit — the pack evaluator does that
before the user commits (see engines/models/packs.py); this module only
enforces the count.
"""
from __future__ import annotations

import json
import socket
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator

import httpx

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import Model, ModelArtifact
from potato_core.engines import settings as app_settings
from potato_core.engines.inference import process_group, runtime
from potato_core.logging_config import get_logger

log = get_logger("inference.llama_cpp")

_READY_TIMEOUT_S = 60.0
_READY_POLL_INTERVAL_S = 0.25
#: Read timeout for a streamed answer — generous, because it also has to
#: cover prompt processing before the first token (see `stream`).
_STREAM_TIMEOUT_S = 900.0

# "member" is the neutral state: loaded and answerable by name, but holding no
# duty the router looks for. It is what a slot is demoted to when another model
# takes its role, so losing a role never means losing the model.
ROLES = ("primary", "vision", "code", "reasoning", "member")

# "auto" is not a role — it asks the engine to work one out from what the model
# can do. It is the default because orchestration that only works when the user
# already understood the role system is orchestration that mostly does not run.
AUTO_ROLE = "auto"


class InferenceError(Exception):
    pass


@dataclass
class _Slot:
    artifact_id: str
    model_id: str
    model_name: str
    role: str
    process: subprocess.Popen
    port: int
    context_length: int
    multimodal: bool
    runtime: dict
    #: From the catalog: what this model claims to be good at. Routing reads
    #: capabilities, not roles — a label can be wrong or simply never set, but
    #: whether a projector loaded is a fact about the running process.
    capabilities: list[str] = field(default_factory=list)
    parameter_count: str = ""
    last_stats: dict | None = None

    def describe(self) -> dict:
        return {
            "artifact_id": self.artifact_id,
            "model_id": self.model_id,
            "model_name": self.model_name,
            "role": self.role,
            "context_length": self.context_length,
            "multimodal": self.multimodal,
            "runtime": self.runtime,
            "capabilities": list(self.capabilities),
            "parameter_count": self.parameter_count,
        }


@dataclass
class _Registry:
    lock: threading.Lock = field(default_factory=threading.Lock)
    #: artifact_id -> slot, in load order (dicts preserve insertion order, and
    #: the UI lists slots in the order the user added them).
    slots: dict[str, _Slot] = field(default_factory=dict)
    #: The slot that answers when no other is named.
    primary_id: str | None = None


_registry = _Registry()


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _stream_subprocess_output(process: subprocess.Popen, label: str) -> None:
    def pump():
        assert process.stdout is not None
        for line in process.stdout:
            log.debug("[llama-server %s] %s", label, line.rstrip())

    threading.Thread(target=pump, daemon=True).start()


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


def get_status() -> dict:
    """Whole-engine status.

    The top-level fields describe the primary slot and keep the shape older
    callers (the benchmark engine, the status bar) already read; `slots` is
    the multi-model view.
    """
    with _registry.lock:
        primary = _registry.slots.get(_registry.primary_id or "")
        return {
            "loaded": bool(_registry.slots),
            "model_artifact_id": primary.artifact_id if primary else None,
            "model_name": primary.model_name if primary else None,
            "context_length": primary.context_length if primary else None,
            "multimodal": primary.multimodal if primary else False,
            "runtime": primary.runtime if primary else None,
            "slots": [slot.describe() for slot in _registry.slots.values()],
            "primary_artifact_id": _registry.primary_id,
            "max_slots": app_settings.get("max_loaded_models"),
        }


def loaded_slots() -> list[dict]:
    with _registry.lock:
        return [slot.describe() for slot in _registry.slots.values()]


def slot_for_role(role: str) -> dict | None:
    """The loaded slot holding `role`, if any."""
    with _registry.lock:
        for slot in _registry.slots.values():
            if slot.role == role:
                return slot.describe()
    return None


def vision_provider(exclude_artifact_id: str | None = None) -> dict | None:
    """A loaded model that can actually see, if there is one.

    Deliberately *not* `slot_for_role("vision")`. Whether a model can read an
    image is a fact about the running process — llama-server either loaded a
    projector or it did not — while the role is a label the user may never have
    set. Routing on the label meant a perfectly good vision model added with
    "+ add" sat there unused while the answer said it could not see images.

    An explicit "vision" tag still wins when several models can see; otherwise
    load order decides.
    """
    with _registry.lock:
        candidates = [
            slot
            for slot in _registry.slots.values()
            if slot.multimodal and slot.artifact_id != exclude_artifact_id
        ]
        if not candidates:
            return None
        tagged = next((s for s in candidates if s.role == "vision"), None)
        return (tagged or candidates[0]).describe()


def _require_slot(artifact_id: str | None) -> _Slot:
    with _registry.lock:
        key = artifact_id or _registry.primary_id
        if key is None or key not in _registry.slots:
            if artifact_id:
                raise InferenceError(f"Model '{artifact_id}' is not loaded")
            raise InferenceError("No model is loaded")
        return _registry.slots[key]


# ---------------------------------------------------------------------------
# Loading / unloading
# ---------------------------------------------------------------------------


def load_model(
    model_artifact_id: str,
    context_length: int | None = None,
    runtime_options: dict | None = None,
    role: str = AUTO_ROLE,
) -> dict:
    """Bring one artifact up in its own slot.

    `role` defaults to "auto", which works one out from what the model can do
    and what is already loaded — see `_auto_role_locked`. Pass an explicit role
    to override.

    Re-loading an artifact that is already resident only re-points its role —
    restarting a healthy server to change a label would cost the user a model
    load for nothing.
    """
    if role not in ROLES and role != AUTO_ROLE:
        raise InferenceError(f"Unknown role '{role}' — expected one of {', '.join(ROLES)}")

    with get_session() as session:
        artifact = session.get(ModelArtifact, model_artifact_id)
        if artifact is None:
            raise InferenceError(f"Unknown model artifact '{model_artifact_id}'")
        if artifact.status != "verified":
            raise InferenceError(f"Artifact is '{artifact.status}', not verified — can't load it")
        file_path = artifact.file_path
        mmproj_path = artifact.mmproj_path
        model_id = artifact.model_id
        model_row = session.get(Model, model_id)
        model_name = model_row.name if model_row else model_id
        capabilities = list(model_row.capabilities or []) if model_row else []
        parameter_count = model_row.parameter_count if model_row else ""

    with _registry.lock:
        existing = _registry.slots.get(model_artifact_id)
        if existing is not None:
            resolved_role = (
                _auto_role_locked(existing.multimodal, existing.capabilities, existing.artifact_id)
                if role == AUTO_ROLE
                else role
            )
            existing.role = resolved_role
            _reassign_roles_locked(model_artifact_id, resolved_role)
            return get_status_locked()

        max_slots = app_settings.get("max_loaded_models")
        if len(_registry.slots) >= max_slots:
            raise InferenceError(
                f"{len(_registry.slots)} models are already loaded and the limit is {max_slots}. "
                "Unload one first, or raise 'Max Loaded Models' in Settings."
            )

        overrides = dict(runtime_options or {})
        if context_length is not None:
            overrides.setdefault("context_length", context_length)
        resolved = runtime.resolve(overrides)
        ctx = resolved["context_length"]
        port = _free_port()
        exe = settings.llama_server_executable
        if not exe.exists():
            raise InferenceError(
                f"llama-server binary not found at {exe}. See DEVELOPMENT.md's "
                "'Inference engine (llama.cpp)' section to fetch it."
            )

        cmd = [
            str(exe),
            "-m", file_path,
            "--host", "127.0.0.1",
            "--port", str(port),
            *runtime.build_args(resolved),
        ]

        # The projector is what turns llama-server multimodal. Without it a
        # vision model loads and runs, but silently ignores images — so treat a
        # missing file as text-only rather than passing a broken path.
        multimodal = bool(mmproj_path) and Path(mmproj_path).exists()
        if mmproj_path and not multimodal:
            log.warning("mmproj file missing at %s — loading %s text-only", mmproj_path, model_id)
        if multimodal:
            cmd += ["--mmproj", mmproj_path]
        log.info(
            "Starting llama-server for %s as '%s' on port %d (ctx %d, threads %s, gpu layers %s, "
            "batch %s, flash attn %s, kv cache %s, vision %s)",
            model_id, role, port, ctx, resolved["threads"], resolved["gpu_layers"],
            resolved["batch_size"] or "auto", resolved["flash_attention"],
            resolved["kv_cache_type"], "on" if multimodal else "off",
        )
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(Path(exe).parent),
        )
        _stream_subprocess_output(process, model_id)
        process_group.assign(process)

        if not _wait_ready(port, process):
            process.kill()
            raise InferenceError(f"llama-server did not become ready within {_READY_TIMEOUT_S:.0f}s")

        # Resolved now that `multimodal` is known — that is the fact the auto
        # rule turns on, and it is only settled once llama-server has the
        # projector (or does not).
        resolved_role = (
            _auto_role_locked(multimodal, capabilities, model_artifact_id)
            if role == AUTO_ROLE
            else role
        )

        _registry.slots[model_artifact_id] = _Slot(
            artifact_id=model_artifact_id,
            model_id=model_id,
            model_name=model_name,
            role=resolved_role,
            process=process,
            port=port,
            context_length=ctx,
            multimodal=multimodal,
            runtime=resolved,
            capabilities=capabilities,
            parameter_count=parameter_count,
        )
        _reassign_roles_locked(model_artifact_id, resolved_role)
        return get_status_locked()


def _auto_role_locked(multimodal: bool, capabilities: list[str], artifact_id: str) -> str:
    """Work out what a model being added is *for*.

    The rules encode one judgement: a vision model's job in a mixed chat is to
    see, and a text model's job is to write. Vision-language models are, at a
    given size, weaker writers than their text-only siblings — so pairing a
    small VLM with a text model and letting the VLM answer produces exactly the
    complaint that motivated this: correct but curt replies. The text model
    takes the chair; the VLM becomes the eyes and its reading is handed over.

    The user can still override any of this with an explicit role.
    """
    others = [s for s in _registry.slots.values() if s.artifact_id != artifact_id]
    if not others:
        return "primary"

    primary = _registry.slots.get(_registry.primary_id or "")

    eyes_taken = any(s.role == "vision" for s in others)
    if multimodal and not eyes_taken and (primary is None or not primary.multimodal):
        return "vision"
    if not multimodal and primary is not None and primary.multimodal:
        # A text model arriving to a chat led by a VLM: it is the better writer,
        # so it answers and the VLM keeps its real advantage as the eyes.
        return "primary"

    for capability in ("code", "reasoning"):
        if capability in capabilities and not any(s.role == capability for s in others):
            return capability
    return "member"


def _reassign_roles_locked(claimant_id: str, role: str) -> None:
    """One holder per role, so the router never has to choose between two.

    A displaced slot is demoted to "member", not unloaded: it is still resident
    and can still be asked to answer by name — it just no longer owns the duty.
    """
    if role != "member":
        for artifact_id, slot in _registry.slots.items():
            if artifact_id != claimant_id and slot.role == role:
                # A displaced model that can see becomes the eyes rather than a
                # bystander: losing the chair should not cost the chat the one
                # thing that model was uniquely good for.
                takes_vision = slot.multimodal and not any(
                    other.role == "vision" and other.artifact_id != slot.artifact_id
                    for other in _registry.slots.values()
                )
                slot.role = "vision" if takes_vision else "member"

    if role == "primary":
        _registry.primary_id = claimant_id
    elif _registry.primary_id not in _registry.slots:
        # First model in, or the previous primary is gone: somebody has to
        # answer, so the oldest remaining slot takes the chair.
        _registry.primary_id = next(iter(_registry.slots), None)
        if _registry.primary_id:
            _registry.slots[_registry.primary_id].role = "primary"


def get_status_locked() -> dict:
    """`get_status()` for callers already inside the registry lock."""
    primary = _registry.slots.get(_registry.primary_id or "")
    return {
        "loaded": bool(_registry.slots),
        "model_artifact_id": primary.artifact_id if primary else None,
        "model_name": primary.model_name if primary else None,
        "context_length": primary.context_length if primary else None,
        "multimodal": primary.multimodal if primary else False,
        "runtime": primary.runtime if primary else None,
        "slots": [slot.describe() for slot in _registry.slots.values()],
        "primary_artifact_id": _registry.primary_id,
        "max_slots": app_settings.get("max_loaded_models"),
    }


def set_primary(model_artifact_id: str) -> dict:
    """Hand the answering role to an already-loaded slot."""
    with _registry.lock:
        if model_artifact_id not in _registry.slots:
            raise InferenceError(f"Model '{model_artifact_id}' is not loaded")
        for slot in _registry.slots.values():
            if slot.role == "primary":
                slot.role = "member"
        _registry.slots[model_artifact_id].role = "primary"
        _registry.primary_id = model_artifact_id
        return get_status_locked()


def unload_model(model_artifact_id: str | None = None) -> dict:
    """Unload one slot, or every slot when no id is given."""
    with _registry.lock:
        if model_artifact_id is None:
            for slot in list(_registry.slots.values()):
                _stop_slot(slot)
            _registry.slots.clear()
            _registry.primary_id = None
            return get_status_locked()

        slot = _registry.slots.pop(model_artifact_id, None)
        if slot is None:
            raise InferenceError(f"Model '{model_artifact_id}' is not loaded")
        _stop_slot(slot)
        if _registry.primary_id == model_artifact_id:
            # Promote whatever is left so the chat keeps a responder.
            _registry.primary_id = next(iter(_registry.slots), None)
            if _registry.primary_id:
                _registry.slots[_registry.primary_id].role = "primary"
        return get_status_locked()


def _stop_slot(slot: _Slot) -> None:
    log.info("Stopping llama-server for %s", slot.model_name)
    slot.process.terminate()
    try:
        slot.process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        slot.process.kill()


def _wait_ready(port: int, process: subprocess.Popen) -> bool:
    deadline = time.monotonic() + _READY_TIMEOUT_S
    url = f"http://127.0.0.1:{port}/health"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False  # process died during load
        try:
            resp = httpx.get(url, timeout=1.0)
            if resp.status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(_READY_POLL_INTERVAL_S)
    return False


def get_stats(model_artifact_id: str | None = None) -> dict | None:
    with _registry.lock:
        key = model_artifact_id or _registry.primary_id
        slot = _registry.slots.get(key or "")
        return slot.last_stats if slot else None


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def _build_payload(messages: list[dict], params: dict, stream: bool) -> dict:
    """Request params win; anything the caller left out falls back to the
    user's configured defaults rather than a hardcoded constant."""

    def resolve(name: str, setting_key: str):
        value = params.get(name)
        return app_settings.get(setting_key) if value is None else value

    payload = {
        "messages": messages,
        "stream": stream,
        "temperature": resolve("temperature", "default_temperature"),
        "top_p": resolve("top_p", "default_top_p"),
        "top_k": resolve("top_k", "default_top_k"),
        "max_tokens": resolve("max_tokens", "default_max_tokens"),
        # llama-server extensions to the OpenAI schema — it accepts these on
        # /v1/chat/completions alongside the standard fields.
        "min_p": resolve("min_p", "default_min_p"),
        "repeat_penalty": resolve("repeat_penalty", "default_repeat_penalty"),
        "repeat_last_n": resolve("repeat_last_n", "default_repeat_last_n"),
    }

    # -1 is the "roll a fresh one" sentinel; sending it is the same as sending
    # nothing, so leave it out rather than pinning the server to a literal -1.
    seed = resolve("seed", "default_seed")
    if seed is not None and seed >= 0:
        payload["seed"] = seed

    if params.get("stop"):
        payload["stop"] = params["stop"]
    return payload


class _ThinkSplitter:
    """Classifies streamed deltas as reasoning (inside <think>) or answer (outside).

    Reasoning models emit their chain-of-thought wrapped in <think>…</think> tags
    followed by the actual answer. The tags may arrive split across deltas —
    "<thin" in one chunk and "k>" in the next — so a small tail buffer holds
    partial tag prefixes until the next chunk resolves them.
    """

    _OPEN = "<think>"
    _CLOSE = "</think>"

    def __init__(self) -> None:
        self._inside = False
        self._tail = ""

    @staticmethod
    def _suffix_overlap(buf: str, tag: str) -> int:
        """Length of the longest suffix of *buf* that is a prefix of *tag*."""
        for n in range(min(len(tag) - 1, len(buf)), 0, -1):
            if buf.endswith(tag[:n]):
                return n
        return 0

    def feed(self, text: str) -> list[tuple[str, str]]:
        buf = self._tail + text
        self._tail = ""
        out: list[tuple[str, str]] = []

        while buf:
            if self._inside:
                idx = buf.find(self._CLOSE)
                if idx == -1:
                    overlap = self._suffix_overlap(buf, self._CLOSE)
                    if overlap:
                        out.append(("reasoning", buf[:-overlap]))
                        self._tail = buf[-overlap:]
                    else:
                        out.append(("reasoning", buf))
                    buf = ""
                else:
                    if idx > 0:
                        out.append(("reasoning", buf[:idx]))
                    buf = buf[idx + len(self._CLOSE) :]
                    self._inside = False
            else:
                idx = buf.find(self._OPEN)
                if idx == -1:
                    overlap = self._suffix_overlap(buf, self._OPEN)
                    if overlap:
                        out.append(("delta", buf[:-overlap]))
                        self._tail = buf[-overlap:]
                    else:
                        out.append(("delta", buf))
                    buf = ""
                else:
                    if idx > 0:
                        out.append(("delta", buf[:idx]))
                    buf = buf[idx + len(self._OPEN) :]
                    self._inside = True

        return out

    def flush(self) -> list[tuple[str, str]]:
        if not self._tail:
            return []
        kind = "reasoning" if self._inside else "delta"
        piece = self._tail
        self._tail = ""
        return [(kind, piece)]


def _record_stats(artifact_id: str, stats: dict) -> None:
    with _registry.lock:
        slot = _registry.slots.get(artifact_id)
        if slot:
            slot.last_stats = stats


async def stream(
    messages: list[dict], params: dict, model_artifact_id: str | None = None
) -> AsyncIterator[dict]:
    """Yields {"delta": str} chunks, then a final {"done": True, "stats": {...}} record."""
    slot = _require_slot(model_artifact_id)
    base_url = f"http://127.0.0.1:{slot.port}"

    # The read timeout has to cover time-to-first-token, not just the gap
    # between tokens, and prompt processing is the slow part on a CPU-only
    # machine: a long context (a hand-off transcription, a pasted file) can sit
    # for minutes before the first delta arrives.
    attempt_messages = messages
    retried_system_fold = False
    final_timings: dict | None = None
    splitter = _ThinkSplitter()
    async with httpx.AsyncClient(timeout=httpx.Timeout(_STREAM_TIMEOUT_S, connect=5.0)) as client:
        while True:
            payload = _build_payload(attempt_messages, params, stream=True)
            async with client.stream("POST", f"{base_url}/v1/chat/completions", json=payload) as response:
                if response.status_code >= 400:
                    # The body has to be pulled in explicitly on a streamed
                    # response — without this, the reason llama-server gave is
                    # discarded and the user is shown httpx's bare status line
                    # instead.
                    raw = (await response.aread()).decode("utf-8", errors="replace")
                    detail = _describe_http_error(raw, response.status_code, slot)
                    log.warning("llama-server %s for %s: %s", response.status_code, slot.model_id, raw[:500])
                    if (
                        not retried_system_fold
                        and _is_unsupported_system_role_error(detail)
                        and any(m.get("role") == "system" for m in attempt_messages)
                    ):
                        log.info(
                            "%s's chat template rejected a system message; retrying with it folded into the conversation",
                            slot.model_name,
                        )
                        attempt_messages = _fold_system_messages(attempt_messages)
                        retried_system_fold = True
                        continue
                    raise InferenceError(detail)

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    choice = (chunk.get("choices") or [{}])[0]
                    delta = choice.get("delta", {}).get("content")
                    if delta:
                        for kind, piece in splitter.feed(delta):
                            yield {kind: piece}
                    if chunk.get("timings"):
                        final_timings = chunk["timings"]
            break

    for kind, piece in splitter.flush():
        yield {kind: piece}
    stats = _timings_to_stats(final_timings)
    _record_stats(slot.artifact_id, stats)
    yield {"done": True, "stats": stats}


def generate(messages: list[dict], params: dict, model_artifact_id: str | None = None) -> dict:
    """Non-streaming single-shot generation — used by the vision hand-off,
    benchmark() and tests."""
    slot = _require_slot(model_artifact_id)
    base_url = f"http://127.0.0.1:{slot.port}"
    attempt_messages = messages
    retried_system_fold = False
    while True:
        payload = _build_payload(attempt_messages, params, stream=False)
        response = httpx.post(
            f"{base_url}/v1/chat/completions", json=payload, timeout=httpx.Timeout(120.0, connect=5.0)
        )
        if response.status_code >= 400:
            log.warning("llama-server %s for %s: %s", response.status_code, slot.model_id, response.text[:500])
            detail = _describe_http_error(response.text, response.status_code, slot)
            if (
                not retried_system_fold
                and _is_unsupported_system_role_error(detail)
                and any(m.get("role") == "system" for m in attempt_messages)
            ):
                log.info(
                    "%s's chat template rejected a system message; retrying with it folded into the conversation",
                    slot.model_name,
                )
                attempt_messages = _fold_system_messages(attempt_messages)
                retried_system_fold = True
                continue
            raise InferenceError(detail)
        body = response.json()
        content = body["choices"][0]["message"]["content"]
        stats = _timings_to_stats(body.get("timings"))
        _record_stats(slot.artifact_id, stats)
        return {"content": content, "stats": stats}


async def agenerate(
    messages: list[dict],
    params: dict,
    model_artifact_id: str | None = None,
    timeout_s: float = 120.0,
) -> dict:
    """Async twin of `generate`.

    The vision hand-off runs inside the streaming response's event loop, where
    a blocking httpx.post would stall every other request the core is serving.

    `timeout_s` is the read timeout for the whole non-streaming response, so it
    has to cover the entire generation rather than the gap between tokens the
    way the streaming path's does. Callers doing heavy work on a slow machine —
    the vision pass over a full-page screenshot, above all — pass their own.
    """
    slot = _require_slot(model_artifact_id)
    base_url = f"http://127.0.0.1:{slot.port}"
    attempt_messages = messages
    retried_system_fold = False
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=5.0)) as client:
        while True:
            payload = _build_payload(attempt_messages, params, stream=False)
            response = await client.post(f"{base_url}/v1/chat/completions", json=payload)
            if response.status_code >= 400:
                log.warning("llama-server %s for %s: %s", response.status_code, slot.model_id, response.text[:500])
                detail = _describe_http_error(response.text, response.status_code, slot)
                if (
                    not retried_system_fold
                    and _is_unsupported_system_role_error(detail)
                    and any(m.get("role") == "system" for m in attempt_messages)
                ):
                    log.info(
                        "%s's chat template rejected a system message; retrying with it folded into the conversation",
                        slot.model_name,
                    )
                    attempt_messages = _fold_system_messages(attempt_messages)
                    retried_system_fold = True
                    continue
                raise InferenceError(detail)
            body = response.json()
            break
    content = body["choices"][0]["message"]["content"]
    stats = _timings_to_stats(body.get("timings"))
    _record_stats(slot.artifact_id, stats)
    return {"content": content, "stats": stats}


def _describe_http_error(response_text: str, status: int, slot: _Slot) -> str:
    """llama-server's own account of what went wrong, in the user's terms.

    httpx's `raise_for_status()` produces "Client error '400 Bad Request' for
    url http://127.0.0.1:54250/v1/chat/completions", which names an internal
    port and says nothing about the cause. llama-server has already explained
    itself in the response body — this digs that out and, for the failure that
    actually happens (a request longer than the context window), says which
    knob fixes it.
    """
    message = ""
    error_type = ""
    try:
        payload = json.loads(response_text)
        error = payload.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or "")
            error_type = str(error.get("type") or "")
        elif error:
            message = str(error)
    except (ValueError, TypeError):
        message = response_text.strip()[:400]

    if error_type == "exceed_context_size_error" or "context size" in message:
        return (
            f"{message or 'The request is longer than the context window'}. "
            f"{slot.model_name} is loaded with a {slot.context_length:,}-token context — raise "
            "Context Size in the live monitor and reload it, or start a new chat."
        )
    if message:
        return f"{slot.model_name} rejected the request: {message}"
    return f"{slot.model_name} rejected the request (HTTP {status})."


def _is_unsupported_system_role_error(message: str) -> bool:
    """True for the class of chat-template error a system message triggers on
    templates with no system-role branch at all — Mistral-Instruct's official
    template is the common case: it enforces strict user/assistant
    alternation via its own `raise_exception('Conversation roles must
    alternate user/assistant/user/assistant/...')`, which a leading system
    prompt (every request has one — see PlaygroundProvider's `send`) or a
    hand-off transcription note (also sent as role "system") trips before
    generation ever starts.

    Matched on the vocabulary these templates' own raise_exception() calls
    use rather than a specific model name, so it also catches other
    templates with the same restriction, not just Mistral's.
    """
    lowered = message.lower()
    return "alternate" in lowered or "system role" in lowered or "system message" in lowered


def _fold_system_messages(messages: list[dict]) -> list[dict]:
    """Merges every system-role message into the content of the next turn.

    Used as a one-time retry fallback (see _is_unsupported_system_role_error)
    for chat templates with no system-role branch — rather than dropping the
    system prompt (or a hand-off note) outright, it becomes a plain preamble
    on whichever turn follows it, or the one before it if it was last.

    Multimodal content (a hand-off turn's list of `{"type": ...}` parts, not a
    plain string — see orchestrator.py's `_expand_after_handoff`) is merged by
    prepending a text part, never by splicing in a separate turn: an inserted
    turn would sit next to the message it came from with the same role,
    breaking the exact alternation this fold exists to restore.
    """

    def splice(target: dict, text: str, *, before: bool) -> dict:
        content = target.get("content")
        if isinstance(content, list):
            part = {"type": "text", "text": text}
            return {**target, "content": [part, *content] if before else [*content, part]}
        merged = f"{text}\n\n{content}" if before else f"{content}\n\n{text}"
        return {**target, "content": merged if content else text}

    folded: list[dict] = []
    pending: list[str] = []
    for message in messages:
        if message.get("role") == "system":
            content = message.get("content")
            if isinstance(content, str) and content:
                pending.append(content)
            continue
        if pending:
            message = splice(message, "\n\n".join(pending), before=True)
            pending = []
        folded.append(message)
    if pending:
        prefix = "\n\n".join(pending)
        if folded:
            folded[-1] = splice(folded[-1], prefix, before=False)
        else:
            folded.append({"role": "user", "content": prefix})
    return folded


def _timings_to_stats(timings: dict | None) -> dict:
    if not timings:
        return {}
    return {
        "prompt_tokens": timings.get("prompt_n"),
        "prompt_tokens_per_sec": timings.get("prompt_per_second"),
        "completion_tokens": timings.get("predicted_n"),
        "tokens_per_sec": timings.get("predicted_per_second"),
        "ttft_ms": timings.get("prompt_ms"),
    }


def benchmark(prompt: str = "Explain what a potato is in two sentences.") -> dict:
    """Runs a real, fixed-prompt generation and returns measured (not estimated) timings."""
    result = generate([{"role": "user", "content": prompt}], {"max_tokens": 128, "temperature": 0.7})
    return result["stats"]
