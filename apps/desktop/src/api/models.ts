import { api } from "./client";
import type { ModelSummary } from "./types";

export const modelsApi = {
  list: (params?: { family?: string; q?: string }) => {
    const query = new URLSearchParams();
    if (params?.family) query.set("family", params.family);
    if (params?.q) query.set("q", params.q);
    const qs = query.toString();
    return api.get<ModelSummary[]>(`/models${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<ModelSummary>(`/models/${id}`),
};
