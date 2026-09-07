"""Slider-to-hyperparameter mapping (spec section 25) — the core UX
differentiator: beginners move 5 named sliders, never see a raw
hyperparameter unless they open Advanced Settings. Every mapping here is a
plain, documented formula (no ML call, no randomness) so it's cheap to test
and the "transparent" requirement in the spec is actually true — a curious
user (or "Show Advanced Settings") can see exactly why a slider position
produced a given number.

Sliders are 0.0-1.0 (the UI presents them as 0-100).
"""
from __future__ import annotations

import math
from dataclasses import dataclass


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _lerp(lo: float, hi: float, t: float) -> float:
    return lo + (hi - lo) * t


def _log_lerp(lo: float, hi: float, t: float) -> float:
    """Interpolates on a log scale — appropriate for learning rate, which
    matters in orders of magnitude, not linear steps."""
    return math.exp(_lerp(math.log(lo), math.log(hi), t))


def _snap(value: float, choices: list[int]) -> int:
    return min(choices, key=lambda c: abs(c - value))


@dataclass(frozen=True)
class SliderInputs:
    training_intensity: float = 0.5  # LIGHT -> HEAVY
    learning_rate: float = 0.5  # CONSERVATIVE -> AGGRESSIVE
    training_time: float = 0.5  # FAST -> THOROUGH
    model_adaptation: float = 0.5  # LOW -> HIGH
    memory_usage: float = 0.5  # LOW -> MAX

    def clamped(self) -> "SliderInputs":
        return SliderInputs(
            training_intensity=_clamp01(self.training_intensity),
            learning_rate=_clamp01(self.learning_rate),
            training_time=_clamp01(self.training_time),
            model_adaptation=_clamp01(self.model_adaptation),
            memory_usage=_clamp01(self.memory_usage),
        )


@dataclass(frozen=True)
class Hyperparameters:
    learning_rate: float
    epochs: int
    lora_rank: int
    lora_alpha: int
    lora_dropout: float
    batch_size: int
    gradient_accumulation_steps: int
    warmup_ratio: float
    max_seq_length: int
    scheduler: str

    def to_dict(self) -> dict:
        return {
            "learning_rate": self.learning_rate,
            "epochs": self.epochs,
            "lora_rank": self.lora_rank,
            "lora_alpha": self.lora_alpha,
            "lora_dropout": self.lora_dropout,
            "batch_size": self.batch_size,
            "gradient_accumulation_steps": self.gradient_accumulation_steps,
            "warmup_ratio": self.warmup_ratio,
            "max_seq_length": self.max_seq_length,
            "scheduler": self.scheduler,
        }


# Bounds chosen for consumer ("potato") hardware, not datacenter GPUs —
# these are real, commonly-used LoRA fine-tuning ranges, not arbitrary.
_LR_RANGE = (5e-5, 5e-4)
_EPOCHS_RANGE = (1, 5)
_LORA_RANK_RANGE = (4, 64)
_DROPOUT_RANGE = (0.0, 0.1)
_BATCH_SIZE_CHOICES = [1, 2, 4, 8, 16]
_TARGET_EFFECTIVE_BATCH = 16  # gradient_accumulation is solved to approximate this regardless of batch_size
_SEQ_LEN_RANGE = (512, 2048)
_WARMUP_RANGE = (0.0, 0.1)


def map_sliders_to_hyperparameters(sliders: SliderInputs) -> Hyperparameters:
    s = sliders.clamped()

    learning_rate = _log_lerp(*_LR_RANGE, s.learning_rate)
    epochs = round(_lerp(*_EPOCHS_RANGE, s.training_intensity))

    lora_rank = _snap(_lerp(*_LORA_RANK_RANGE, s.model_adaptation), [4, 8, 16, 32, 64])
    lora_alpha = lora_rank * 2  # alpha = 2*rank is a standard, well-documented LoRA default heuristic
    lora_dropout = round(_lerp(*_DROPOUT_RANGE, s.training_intensity), 3)

    batch_size = _snap(_lerp(_BATCH_SIZE_CHOICES[0], _BATCH_SIZE_CHOICES[-1], s.memory_usage), _BATCH_SIZE_CHOICES)
    gradient_accumulation_steps = max(1, round(_TARGET_EFFECTIVE_BATCH / batch_size))

    warmup_ratio = round(_lerp(*_WARMUP_RANGE, s.learning_rate), 3)
    max_seq_length = _snap(_lerp(*_SEQ_LEN_RANGE, s.memory_usage), [512, 1024, 1536, 2048])

    # Thorough runs benefit from a decaying schedule; fast runs keep it simple.
    scheduler = "cosine" if s.training_time > 0.5 else "linear"

    return Hyperparameters(
        learning_rate=round(learning_rate, 6),
        epochs=epochs,
        lora_rank=lora_rank,
        lora_alpha=lora_alpha,
        lora_dropout=lora_dropout,
        batch_size=batch_size,
        gradient_accumulation_steps=gradient_accumulation_steps,
        warmup_ratio=warmup_ratio,
        max_seq_length=max_seq_length,
        scheduler=scheduler,
    )
