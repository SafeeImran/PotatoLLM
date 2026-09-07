"""The typed registry of every application setting (spec section 32).

Every key defined here is read by real code somewhere in Potato Core — the
`effect` field names that consumer explicitly, so the Settings UI can tell the
user what a knob actually changes rather than presenting a switch that does
nothing. Adding a key here without wiring a consumer is a bug.

Values live in the `application_settings` table; this module only describes
them (type, bounds, default) and is the single source of truth for validation.
See service.py for reads/writes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

SECTIONS = ["General", "Inference", "Storage", "Performance", "Privacy"]


@dataclass(frozen=True)
class SettingDefinition:
    key: str
    section: str
    label: str
    description: str
    type: str  # bool | int | float | string | enum
    default: Any
    minimum: float | None = None
    maximum: float | None = None
    options: list[str] = field(default_factory=list)
    unit: str | None = None
    # What this value actually changes, in the user's terms. Written from the
    # real consumer, not aspirationally.
    effect: str = ""
    # Internal state that happens to live in the settings table (onboarding
    # progress, say). Validated and persisted like anything else, but never
    # offered as a control and never touched by "reset all", which would
    # otherwise silently re-trigger first-run flows.
    hidden: bool = False

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "section": self.section,
            "label": self.label,
            "description": self.description,
            "type": self.type,
            "default": self.default,
            "minimum": self.minimum,
            "maximum": self.maximum,
            "options": list(self.options),
            "unit": self.unit,
            "effect": self.effect,
        }


DEFINITIONS: list[SettingDefinition] = [
    # ---- Internal --------------------------------------------------------
    SettingDefinition(
        key="onboarding_complete",
        section="Internal",
        label="Onboarding Complete",
        description="Whether the first-launch hardware scan has been completed.",
        type="bool",
        default=False,
        hidden=True,
        effect="Gates the first-run hardware scan in App.tsx.",
    ),
    # ---- General ---------------------------------------------------------
    SettingDefinition(
        key="developer_mode",
        section="General",
        label="Developer Mode",
        description="Exposes diagnostics and raw technical logs across the app.",
        type="bool",
        default=False,
        effect="Shows the raw-log view on the Logs page and extra technical detail on Profile.",
    ),
    # ---- Inference -------------------------------------------------------
    SettingDefinition(
        key="default_context_length",
        section="Inference",
        label="Default Context Length",
        description="Context window used when loading a model without an explicit override.",
        type="int",
        default=4096,
        minimum=512,
        maximum=131072,
        unit="tokens",
        effect="Passed to llama-server as -c, and used as the baseline for compatibility checks.",
    ),
    SettingDefinition(
        key="inference_threads",
        section="Inference",
        label="CPU Threads",
        description=(
            "Threads llama.cpp uses for generation. 0 means Auto — PotatoLLM uses the "
            "machine's physical core count (capped at 16)."
        ),
        type="int",
        default=0,
        minimum=0,
        maximum=256,
        unit="threads",
        effect="Passed to llama-server as -t; 0 resolves to the detected core count.",
    ),
    SettingDefinition(
        key="max_loaded_models",
        section="Inference",
        label="Max Loaded Models",
        description=(
            "How many models the Playground may keep resident at once for multi-model chats. "
            "Each one is a live llama-server holding its own weights."
        ),
        type="int",
        default=3,
        minimum=1,
        maximum=6,
        unit="models",
        effect="Caps the Inference Engine's slots; loading past it is refused rather than swapped.",
    ),
    SettingDefinition(
        key="vision_handoff_enabled",
        section="Inference",
        label="Automatic Vision Hand-off",
        description=(
            "When a chat has a vision model loaded and the answering model cannot see, let the "
            "vision model describe attached images first and pass the description along."
        ),
        type="bool",
        default=True,
        effect="Enables the Playground's vision hand-off step in the inference orchestrator.",
    ),
    SettingDefinition(
        key="gpu_layers",
        section="Inference",
        label="GPU Layers / Offload",
        description=(
            "How many model layers run on the GPU. -1 means Auto (llama.cpp fits what it can), "
            "and 0 keeps everything on the CPU."
        ),
        type="int",
        default=-1,
        minimum=-1,
        maximum=200,
        unit="layers",
        effect="Passed to llama-server as -ngl; -1 becomes 'auto' on builds that accept it.",
    ),
    SettingDefinition(
        key="batch_size",
        section="Inference",
        label="Batch Size",
        description=(
            "Tokens llama.cpp processes per batch while reading the prompt. 0 means Auto, "
            "leaving llama.cpp's own default in place."
        ),
        type="int",
        default=0,
        minimum=0,
        maximum=8192,
        unit="tokens",
        effect="Passed to llama-server as -b when non-zero.",
    ),
    SettingDefinition(
        key="flash_attention",
        section="Inference",
        label="Flash Attention",
        description=(
            "Faster, lower-memory attention on supported hardware. Auto lets llama.cpp decide "
            "per backend."
        ),
        type="enum",
        default="auto",
        options=["auto", "on", "off"],
        effect="Passed to llama-server as -fa when not Auto.",
    ),
    SettingDefinition(
        key="kv_cache_type",
        section="Inference",
        label="KV Cache Type",
        description=(
            "Precision of the stored attention cache. Quantizing it (q8_0, q4_0) fits a longer "
            "context in the same memory, at a small quality cost."
        ),
        type="enum",
        default="f16",
        options=["f16", "q8_0", "q4_0"],
        effect="Passed to llama-server as -ctk/-ctv when not f16.",
    ),
    SettingDefinition(
        key="default_system_prompt",
        section="Inference",
        label="Default System Prompt",
        description="Pre-filled system prompt for a new Playground session.",
        type="string",
        default="You are a helpful assistant.",
        effect="Seeds the Playground's system prompt box.",
    ),
    SettingDefinition(
        key="default_temperature",
        section="Inference",
        label="Default Temperature",
        description="Sampling temperature used when a request does not specify one.",
        type="float",
        default=0.8,
        minimum=0.0,
        maximum=2.0,
        effect="Playground's initial slider value and the server-side fallback.",
    ),
    SettingDefinition(
        key="default_top_p",
        section="Inference",
        label="Default Top-P",
        description="Nucleus sampling cutoff used when a request does not specify one.",
        type="float",
        default=0.95,
        minimum=0.0,
        maximum=1.0,
        effect="Playground's initial slider value and the server-side fallback.",
    ),
    SettingDefinition(
        key="default_top_k",
        section="Inference",
        label="Default Top-K",
        description="Top-K sampling cutoff used when a request does not specify one.",
        type="int",
        default=40,
        minimum=1,
        maximum=200,
        effect="Playground's initial slider value and the server-side fallback.",
    ),
    SettingDefinition(
        key="default_min_p",
        section="Inference",
        label="Default Min-P",
        description=(
            "Drops tokens less likely than this fraction of the top token. 0 disables it. "
            "A gentler alternative to Top-P."
        ),
        type="float",
        default=0.05,
        minimum=0.0,
        maximum=1.0,
        effect="Playground's initial slider value and the server-side fallback.",
    ),
    SettingDefinition(
        key="default_repeat_penalty",
        section="Inference",
        label="Default Repeat Penalty",
        description="Penalizes tokens the model has recently used. 1.0 disables it.",
        type="float",
        default=1.1,
        minimum=1.0,
        maximum=2.0,
        effect="Playground's initial slider value and the server-side fallback.",
    ),
    SettingDefinition(
        key="default_repeat_last_n",
        section="Inference",
        label="Default Repeat Last N",
        description="How many recent tokens the repeat penalty looks back over. 0 disables it.",
        type="int",
        default=64,
        minimum=0,
        maximum=2048,
        unit="tokens",
        effect="Playground's initial slider value and the server-side fallback.",
    ),
    SettingDefinition(
        key="default_seed",
        section="Inference",
        label="Default Seed",
        description=(
            "Fixes the random draw so the same prompt gives the same answer. "
            "-1 means a fresh random seed each time."
        ),
        type="int",
        default=-1,
        minimum=-1,
        maximum=2147483647,
        effect="Playground's initial seed value and the server-side fallback.",
    ),
    SettingDefinition(
        key="default_max_tokens",
        section="Inference",
        label="Default Max Tokens",
        description="Generation length cap used when a request does not specify one.",
        type="int",
        default=512,
        minimum=16,
        maximum=8192,
        unit="tokens",
        effect="Playground's initial slider value and the server-side fallback.",
    ),
    SettingDefinition(
        key="reasoning_max_tokens",
        section="Inference",
        label="Reasoning Max Tokens",
        description=(
            "Minimum generation budget for a reasoning model. The <think> block "
            "uses tokens before the visible answer begins, so the default 512 often "
            "runs out mid-thought."
        ),
        type="int",
        default=2048,
        minimum=256,
        maximum=16384,
        unit="tokens",
        effect="Floor applied to max_tokens when the responder has a reasoning capability.",
    ),
    # ---- Storage ---------------------------------------------------------
    SettingDefinition(
        key="low_disk_warning_gb",
        section="Storage",
        label="Low Disk Warning",
        description="Free space below this raises a warning in Potato Doctor and on the Storage page.",
        type="float",
        default=10.0,
        minimum=1.0,
        maximum=500.0,
        unit="GB",
        effect="Threshold for Potato Doctor's Storage check and the Storage page's disk meter.",
    ),
    SettingDefinition(
        key="low_disk_critical_gb",
        section="Storage",
        label="Critical Disk Threshold",
        description="Free space below this is reported as an outright failure.",
        type="float",
        default=2.0,
        minimum=0.5,
        maximum=100.0,
        unit="GB",
        effect="Failure threshold for Potato Doctor's Storage check and the Storage page's disk meter.",
    ),
    SettingDefinition(
        key="auto_purge_missing_artifacts",
        section="Storage",
        label="Auto-Purge Missing Models",
        description=(
            "On startup, drop database rows for model files that are no longer on disk "
            "(e.g. the data directory was cleared outside the app)."
        ),
        type="bool",
        default=False,
        effect="Runs the Storage page's 'purge missing' cleanup automatically when Potato Core starts.",
    ),
    # ---- Performance -----------------------------------------------------
    SettingDefinition(
        key="max_concurrent_downloads",
        section="Performance",
        label="Concurrent Downloads",
        description="How many model downloads may transfer at once. Extra downloads stay queued.",
        type="int",
        default=2,
        minimum=1,
        maximum=8,
        unit="downloads",
        effect="Caps the Download Manager's transfer slots; over-cap jobs sit in 'queued' until one frees.",
    ),
    SettingDefinition(
        key="hardware_poll_interval_ms",
        section="Performance",
        label="Hardware Poll Interval",
        description="How often the live hardware monitor re-reads CPU/GPU/RAM.",
        type="int",
        default=3000,
        minimum=500,
        maximum=60000,
        unit="ms",
        effect="Refetch interval for the status bar, Hardware page, and Playground's live monitor.",
    ),
    # ---- Privacy ---------------------------------------------------------
    SettingDefinition(
        key="usage_analytics_enabled",
        section="Privacy",
        label="Local Usage Tracking",
        description=(
            "Record token counts and speed for each generation. Everything stays in the local "
            "database — PotatoLLM never uploads usage data anywhere."
        ),
        type="bool",
        default=True,
        effect="When off, no usage rows are written and the Usage page stops gaining new data.",
    ),
    SettingDefinition(
        key="log_level",
        section="Privacy",
        label="Log Level",
        description="How much detail Potato Core writes to its local log file.",
        type="enum",
        default="INFO",
        options=["DEBUG", "INFO", "WARNING", "ERROR"],
        effect="Applied to the Potato Core logger immediately, and again on every core start.",
    ),
]

BY_KEY: dict[str, SettingDefinition] = {d.key: d for d in DEFINITIONS}
