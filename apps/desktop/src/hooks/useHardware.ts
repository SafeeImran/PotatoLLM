import { useQuery } from "@tanstack/react-query";
import { hardwareApi } from "../api/hardware";
import { useSetting } from "./useSettings";

export function useLatestHardwareProfile() {
  return useQuery({
    queryKey: ["hardware", "latest"],
    queryFn: hardwareApi.latest,
  });
}

/**
 * Polled for the live monitor / status bar — a cheap read, not a full
 * re-detect. The interval comes from the `hardware_poll_interval_ms` setting
 * (3s by default), so a user on a laptop can dial the polling back.
 */
export function useLiveHardware(enabled = true) {
  const intervalMs = useSetting("hardware_poll_interval_ms", 3000);
  return useQuery({
    queryKey: ["hardware", "live"],
    queryFn: hardwareApi.live,
    refetchInterval: enabled ? intervalMs : false,
    enabled,
  });
}
