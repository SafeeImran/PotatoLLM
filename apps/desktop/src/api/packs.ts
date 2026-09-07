import { api } from "./client";
import type { PackDownloadResult, PacksResponse } from "./types";

export const packsApi = {
  /** Every curated pack, priced against this machine, best fit flagged. */
  list: () => api.get<PacksResponse>("/packs"),
  /** Queues every member of a pack that is not already on disk. */
  download: (packId: string) => api.post<PackDownloadResult>(`/packs/${packId}/download`),
};
