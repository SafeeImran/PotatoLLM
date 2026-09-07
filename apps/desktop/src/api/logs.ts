import { api, CORE_BASE_URL } from "./client";
import type { LogFileInfo, LogsResponse } from "./types";

export interface LogsQuery {
  level?: string;
  search?: string;
  limit?: number;
}

export const logsApi = {
  list: (query: LogsQuery = {}) => {
    const params = new URLSearchParams();
    if (query.level) params.set("level", query.level);
    if (query.search) params.set("search", query.search);
    if (query.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return api.get<LogsResponse>(`/logs${qs ? `?${qs}` : ""}`);
  },
  info: () => api.get<LogFileInfo>("/logs/info"),
  raw: async () => {
    const response = await fetch(`${CORE_BASE_URL}/logs/raw`);
    return response.text();
  },
  clear: () => api.del<{ freed_bytes: number; files_removed: number }>("/logs"),
};
