"""Benchmark Engine (spec sections 19-20) — real implementation.

Runs a fixed-prompt generation through the Inference Engine while sampling
real hardware utilization, then persists the result. Every metric is
measured from an actual run — see service.py. Never confuse this with the
Recommendation Engine's estimates (a later phase) — those must stay
labeled "Estimated" and never touch this module.
"""
from potato_core.engines.benchmark.service import (
    BenchmarkError,
    get_benchmark,
    list_benchmarks,
    run_benchmark,
    run_benchmark_for_build,
)

__all__ = ["BenchmarkError", "get_benchmark", "list_benchmarks", "run_benchmark", "run_benchmark_for_build"]
