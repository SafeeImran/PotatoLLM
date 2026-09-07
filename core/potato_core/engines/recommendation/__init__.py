"""Compatibility/Recommendation Engine (spec section 13) — real implementation.

Combines the real latest HardwareProfile with a model's registry data to
produce a GREEN/YELLOW/RED compatibility verdict and estimated (never
measured) VRAM/RAM figures across every quant level this app can actually
produce for that model. See compatibility.py (pure math) and service.py
(DB/hardware integration).
"""
from potato_core.engines.recommendation.service import (
    RecommendationError,
    available_quant_options,
    make_it_potato,
    recommend,
)

__all__ = ["RecommendationError", "available_quant_options", "make_it_potato", "recommend"]
