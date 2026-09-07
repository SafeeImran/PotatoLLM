import { api } from "./client";
import type { DailyUsagePoint, ModelUsageBreakdown, RecentSession, UsageSummary } from "./types";

export const usageApi = {
  summary: () => api.get<UsageSummary>("/usage/summary"),
  byModel: () => api.get<ModelUsageBreakdown[]>("/usage/by-model"),
  timeseries: (days = 14) => api.get<DailyUsagePoint[]>(`/usage/timeseries?days=${days}`),
  sessions: (limit = 10) => api.get<RecentSession[]>(`/usage/sessions?limit=${limit}`),
  clearRecords: () => api.del<{ deleted: number }>("/usage/records"),
};
