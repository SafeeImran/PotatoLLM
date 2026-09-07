import { api } from "./client";
import type { DiagnosticsResponse } from "./types";

export const doctorApi = {
  run: () => api.get<DiagnosticsResponse>("/doctor"),
};
