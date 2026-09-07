import { useQuery } from "@tanstack/react-query";
import { logsApi } from "../api/logs";
import type { LogsQuery } from "../api/logs";

export function useLogs(query: LogsQuery) {
  return useQuery({
    queryKey: ["logs", query],
    queryFn: () => logsApi.list(query),
    refetchInterval: 5000,
  });
}

export function useLogFileInfo() {
  return useQuery({ queryKey: ["logs", "info"], queryFn: logsApi.info, refetchInterval: 5000 });
}
