import { api } from "./client";
import type { DownloadJob } from "./types";

export const downloadsApi = {
  list: () => api.get<DownloadJob[]>("/downloads"),
  get: (jobId: string) => api.get<DownloadJob>(`/downloads/${jobId}`),
  start: (modelId: string, variant: "quantized" | "fp16" = "quantized") =>
    api.post<DownloadJob>(`/downloads/models/${modelId}/start?variant=${variant}`),
  pause: (jobId: string) => api.post<DownloadJob>(`/downloads/${jobId}/pause`),
  resume: (jobId: string) => api.post<DownloadJob>(`/downloads/${jobId}/resume`),
  cancel: (jobId: string) => api.post<DownloadJob>(`/downloads/${jobId}/cancel`),
  retry: (jobId: string) => api.post<DownloadJob>(`/downloads/${jobId}/retry`),
};
