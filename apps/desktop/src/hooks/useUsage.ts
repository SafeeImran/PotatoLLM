import { useQuery } from "@tanstack/react-query";
import { usageApi } from "../api/usage";

export function useUsageSummary() {
  return useQuery({ queryKey: ["usage", "summary"], queryFn: usageApi.summary });
}

export function useUsageByModel() {
  return useQuery({ queryKey: ["usage", "by-model"], queryFn: usageApi.byModel });
}

export function useUsageTimeseries(days = 14) {
  return useQuery({ queryKey: ["usage", "timeseries", days], queryFn: () => usageApi.timeseries(days) });
}

export function useRecentSessions(limit = 10) {
  return useQuery({ queryKey: ["usage", "sessions", limit], queryFn: () => usageApi.sessions(limit) });
}
