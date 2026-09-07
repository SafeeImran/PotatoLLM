import { api } from "./client";
import type { BenchmarkResult } from "./types";

export const benchmarkApi = {
  list: (modelArtifactId?: string) =>
    api.get<BenchmarkResult[]>(`/benchmark${modelArtifactId ? `?model_artifact_id=${modelArtifactId}` : ""}`),
  get: (benchmarkId: string) => api.get<BenchmarkResult>(`/benchmark/${benchmarkId}`),
  run: (modelArtifactId: string, contextLength?: number, prompt?: string) =>
    api.post<BenchmarkResult>("/benchmark/run", { model_artifact_id: modelArtifactId, context_length: contextLength, prompt }),
};
