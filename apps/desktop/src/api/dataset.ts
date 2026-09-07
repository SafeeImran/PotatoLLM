import { api } from "./client";
import type { Dataset } from "./types";

export const datasetApi = {
  list: () => api.get<Dataset[]>("/datasets"),
  get: (id: string) => api.get<Dataset>(`/datasets/${id}`),
  register: (name: string, sourcePath: string) => api.post<Dataset>("/datasets", { name, source_path: sourcePath }),
  reanalyze: (id: string) => api.post<Dataset>(`/datasets/${id}/reanalyze`),
  delete: (id: string) => api.del<void>(`/datasets/${id}`),
};
