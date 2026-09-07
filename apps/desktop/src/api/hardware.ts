import { api } from "./client";
import type { HardwareProfileResponse, HardwareSnapshot } from "./types";

export const hardwareApi = {
  scan: () => api.post<HardwareProfileResponse>("/hardware/scan"),
  latest: () => api.get<HardwareProfileResponse | null>("/hardware/latest"),
  live: () => api.get<HardwareSnapshot>("/hardware/live"),
};
