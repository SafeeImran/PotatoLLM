from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import benchmark as benchmark_engine
from potato_core.schemas.benchmark import BenchmarkResult, RunBenchmarkRequest, RunBuildBenchmarkRequest

router = APIRouter(prefix="/benchmark", tags=["benchmark"])


@router.get("", response_model=list[BenchmarkResult])
def list_benchmarks(model_artifact_id: str | None = None, build_id: str | None = None) -> list[BenchmarkResult]:
    return benchmark_engine.list_benchmarks(model_artifact_id, build_id)


@router.get("/{benchmark_id}", response_model=BenchmarkResult)
def get_benchmark(benchmark_id: str) -> BenchmarkResult:
    try:
        return benchmark_engine.get_benchmark(benchmark_id)
    except benchmark_engine.BenchmarkError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/run", response_model=BenchmarkResult)
def run(body: RunBenchmarkRequest) -> dict:
    try:
        kwargs = {}
        if body.prompt:
            kwargs["prompt"] = body.prompt
        return benchmark_engine.run_benchmark(body.model_artifact_id, body.context_length, **kwargs)
    except benchmark_engine.BenchmarkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/run-for-build", response_model=BenchmarkResult)
def run_for_build(body: RunBuildBenchmarkRequest) -> dict:
    try:
        kwargs = {}
        if body.prompt:
            kwargs["prompt"] = body.prompt
        return benchmark_engine.run_benchmark_for_build(body.build_id, **kwargs)
    except benchmark_engine.BenchmarkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
