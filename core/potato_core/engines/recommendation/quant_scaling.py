"""Real bits-per-weight ratios for GGUF quantization levels, used to scale a
model's registry-listed memory estimate (which is calibrated for Q4_K_M —
see registry_data.py's module docstring) to any other quant level.

These are not invented: they're copied directly from the vendored
llama-quantize binary's own --help output (captured during Phase 8 —
`llama-quantize --help` prints each quant type's calibrated size on
Llama-3-8B in GB, e.g. "Q4_K_M : 4.58G, +0.1754 ppl @ Llama-3-8B" — since
that's an 8-billion-parameter model, GB-for-8B numerically equals
bits-per-weight, so these values ARE the bpw ratios, not a derived guess).
"""
from __future__ import annotations

# quant_name -> bits per weight
BPW_TABLE: dict[str, float] = {
    "Q2_K": 2.5,
    "Q3_K_S": 3.41,
    "Q3_K_M": 3.74,
    "Q3_K_L": 4.03,
    "Q4_0": 4.34,
    "Q4_K_S": 4.37,
    "Q4_K_M": 4.58,
    "Q5_0": 5.21,
    "Q5_K_S": 5.21,
    "Q5_K_M": 5.33,
    "Q6_K": 6.14,
    "Q8_0": 7.96,
    "FP16": 16.0,
    "F16": 16.0,
    "F32": 32.0,
}

_BASELINE_QUANT = "Q4_K_M"  # what registry_data.py's est_ram_mb/est_vram_mb are calibrated for


def bpw(quant: str) -> float:
    if quant not in BPW_TABLE:
        raise ValueError(f"Unknown quantization level '{quant}' — expected one of {sorted(BPW_TABLE)}")
    return BPW_TABLE[quant]


def scale_memory_estimate(baseline_mb: int, target_quant: str) -> int:
    """Scales a Q4_K_M-calibrated memory estimate to a different quant level
    by the ratio of their real bits-per-weight."""
    return round(baseline_mb * (bpw(target_quant) / bpw(_BASELINE_QUANT)))
