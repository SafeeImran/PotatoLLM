import { api } from "./client";
import type {
  DeleteArtifactResult,
  OrphanReport,
  PurgeResult,
  StorageSummary,
  StoredDataset,
  StoredModel,
} from "./types";

export const storageApi = {
  summary: () => api.get<StorageSummary>("/storage/summary"),
  models: () => api.get<StoredModel[]>("/storage/models"),
  datasets: () => api.get<StoredDataset[]>("/storage/datasets"),
  orphans: () => api.get<OrphanReport>("/storage/orphans"),
  deleteModel: (artifactId: string, force = false) =>
    api.del<DeleteArtifactResult>(`/storage/models/${artifactId}${force ? "?force=true" : ""}`),
  deleteUntrackedFile: (filePath: string) =>
    api.post<{ file_path: string; freed_bytes: number }>("/storage/orphans/delete-file", { file_path: filePath }),
  purgeMissing: () => api.post<PurgeResult>("/storage/orphans/purge-missing"),
  clearCache: () => api.post<{ freed_bytes: number }>("/storage/cache/clear"),
};
