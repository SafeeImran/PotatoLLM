import { api } from "./client";
import type { Hyperparameters, MLDependencyStatus, SliderConfig, TrainingJob } from "./types";

export const trainingApi = {
  dependencies: () => api.get<MLDependencyStatus>("/training/dependencies"),
  preview: (sliders: SliderConfig) => api.post<Hyperparameters>("/training/preview", sliders),
  listJobs: () => api.get<TrainingJob[]>("/training/jobs"),
  getJob: (jobId: string) => api.get<TrainingJob>(`/training/jobs/${jobId}`),
  createJob: (baseModelId: string, datasetId: string, sliders: SliderConfig) =>
    api.post<TrainingJob>("/training/jobs", { base_model_id: baseModelId, dataset_id: datasetId, sliders }),
  startJob: (jobId: string) => api.post<TrainingJob>(`/training/jobs/${jobId}/start`),
  pauseJob: (jobId: string) => api.post<TrainingJob>(`/training/jobs/${jobId}/pause`),
  stopJob: (jobId: string) => api.post<TrainingJob>(`/training/jobs/${jobId}/stop`),
};
