import { api } from "./client";
import type { Build } from "./types";

export const buildApi = {
  list: () => api.get<Build[]>("/builds"),
  get: (id: string) => api.get<Build>(`/builds/${id}`),
  create: (name: string, modelArtifactId: string, contextLength?: number) =>
    api.post<Build>("/builds", { name, model_artifact_id: modelArtifactId, context_length: contextLength }),
  rename: (id: string, name: string) => api.patch<Build>(`/builds/${id}`, { name }),
  duplicate: (id: string, name?: string) => api.post<Build>(`/builds/${id}/duplicate`, { name }),
  delete: (id: string) => api.del<void>(`/builds/${id}`),
};
