import { api } from "./client";
import type { QuantizationEstimate, QuantizationJob } from "./types";

export const quantizationApi = {
  list: () => api.get<QuantizationJob[]>("/quantization"),
  get: (jobId: string) => api.get<QuantizationJob>(`/quantization/${jobId}`),
  estimate: (sourceArtifactId: string, targetQuant: string) =>
    api.post<QuantizationEstimate>("/quantization/estimate", { source_artifact_id: sourceArtifactId, target_quant: targetQuant }),
  start: (sourceArtifactId: string, targetQuant: string) =>
    api.post<QuantizationJob>("/quantization/start", { source_artifact_id: sourceArtifactId, target_quant: targetQuant }),
  cancel: (jobId: string) => api.post<QuantizationJob>(`/quantization/${jobId}/cancel`),
};
