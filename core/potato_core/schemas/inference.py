from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class RuntimeOptions(BaseModel):
    """The load-time llama.cpp knobs (see engines/inference/runtime.py).

    Every field is optional and every one has an Auto position, so the UI can
    send only what the user actually pinned: anything omitted falls back to the
    saved setting, and anything still on Auto there is detected from the
    machine.
    """

    context_length: int | None = Field(default=None, ge=512, le=1_048_576)
    threads: int | None = Field(default=None, ge=0, le=256)
    # -1 = Auto, 0 = CPU only, N = that many layers on the GPU.
    gpu_layers: int | None = Field(default=None, ge=-1, le=200)
    batch_size: int | None = Field(default=None, ge=0, le=8192)
    flash_attention: Literal["auto", "on", "off"] | None = None
    kv_cache_type: Literal["f16", "q8_0", "q4_0"] | None = None


class ResolvedRuntime(BaseModel):
    """What a loaded server was actually started with. `gpu_layers` stays a
    union because "auto" is a value llama.cpp itself resolves, not a number we
    are in a position to report."""

    context_length: int
    threads: int
    gpu_layers: int | Literal["auto"]
    batch_size: int | None
    flash_attention: str
    kv_cache_type: str


class RuntimeDefaults(BaseModel):
    """Hardware-derived Auto values, for labelling the Auto controls."""

    threads: int
    cpu_cores: int | None
    cpu_threads: int | None
    gpu_layers: int | Literal["auto"]
    gpu_available: bool
    gpu_detected: bool
    backend_devices: list[str] | None
    gpu_model: str | None
    vram_mb: int | None
    compute_backend: str
    batch_size: int | None
    flash_attention: str
    kv_cache_type: str
    context_length: int


class LoadModelRequest(BaseModel):
    model_artifact_id: str
    context_length: int | None = None
    runtime: RuntimeOptions | None = None
    # Which duty this model takes in a multi-model chat. "primary" answers;
    # "vision" is the chat's eyes when the primary has none. "auto" (the
    # default) works one out from what the model can do and what is already
    # loaded, so orchestration does not depend on the user knowing the scheme.
    role: Literal["auto", "primary", "vision", "code", "reasoning", "member"] = "auto"


class UnloadModelRequest(BaseModel):
    # None unloads every slot, which is what the old single-model button did.
    model_artifact_id: str | None = None


class SetPrimaryRequest(BaseModel):
    model_artifact_id: str


class LoadedSlot(BaseModel):
    """One resident model."""

    artifact_id: str
    model_id: str
    model_name: str
    role: str
    context_length: int
    multimodal: bool
    runtime: ResolvedRuntime
    #: What the catalog says this model is good at — the UI explains the
    #: assigned role from these.
    capabilities: list[str] = []
    parameter_count: str = ""


class InferenceStatusResponse(BaseModel):
    loaded: bool
    model_artifact_id: str | None
    model_name: str | None
    context_length: int | None
    # True only when llama-server was started with --mmproj, i.e. the loaded
    # model can actually see images. The UI reads this before offering to.
    multimodal: bool = False
    # None while nothing is loaded — there is no runtime to report yet.
    runtime: ResolvedRuntime | None = None
    # Every resident model. The fields above describe the primary slot and are
    # kept so single-model callers (status bar, benchmarks) need no changes.
    slots: list[LoadedSlot] = []
    primary_artifact_id: str | None = None
    max_slots: int = 1


class ChatMessage(BaseModel):
    role: str  # "system" | "user" | "assistant"
    content: str
    # Attachments are referenced by id, not inlined: the core already has the
    # bytes on disk, so sending a base64 image back through the UI would double
    # the transfer and cap the practical file size at whatever fetch tolerates.
    # Expansion into OpenAI content parts happens in api/inference.py.
    attachment_ids: list[str] = []


class GenerateRequest(BaseModel):
    messages: list[ChatMessage]
    temperature: float = 0.8
    top_p: float = 0.95
    top_k: int = 40
    max_tokens: int = 512
    min_p: float = 0.05
    repeat_penalty: float = 1.1
    repeat_last_n: int = 64
    # -1 means "new random seed per request", matching llama.cpp's own sentinel.
    seed: int = -1
    stop: list[str] | None = None
    # Which loaded model answers. None means the primary slot.
    responder_artifact_id: str | None = None


class AvailableModel(BaseModel):
    artifact_id: str
    model_id: str
    model_name: str
    quantization: str | None
    size_bytes: int | None
    context_length: int
    # Whether this artifact has its mmproj projector on disk, so the Playground
    # can label vision models before one is loaded.
    multimodal: bool = False


class InferenceStats(BaseModel):
    prompt_tokens: int | None = None
    prompt_tokens_per_sec: float | None = None
    completion_tokens: int | None = None
    tokens_per_sec: float | None = None
    ttft_ms: float | None = None
