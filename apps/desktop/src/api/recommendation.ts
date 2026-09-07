import { api } from "./client";
import type { MakeItPotatoResult, Recommendation } from "./types";

export const recommendationApi = {
  get: (modelId: string, contextLength?: number) =>
    api.get<Recommendation>(`/recommendation/${modelId}${contextLength ? `?context_length=${contextLength}` : ""}`),
  makeItPotato: (modelId: string) => api.post<MakeItPotatoResult>(`/recommendation/${modelId}/make-it-potato`),
};
