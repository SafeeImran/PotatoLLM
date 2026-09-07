import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { downloadsApi } from "../api/downloads";
import type { DownloadJob } from "../api/types";

const ACTIVE_STATUSES = new Set(["queued", "running", "paused"]);

function hasActiveDownload(jobs: DownloadJob[] | undefined): boolean {
  return Boolean(jobs?.some((j) => ACTIVE_STATUSES.has(j.status)));
}

/** Polls fast (1s) only while something is actually downloading, otherwise idles. */
export function useDownloads() {
  return useQuery({
    queryKey: ["downloads"],
    queryFn: downloadsApi.list,
    refetchInterval: (query) => (hasActiveDownload(query.state.data) ? 1000 : false),
  });
}

export function useDownloadForModel(modelId: string, variant: "quantized" | "fp16" = "quantized"): DownloadJob | undefined {
  const { data } = useDownloads();
  return data?.find((j) => j.model_id === modelId && j.variant === variant && j.status !== "cancelled");
}

export function useDownloadActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["downloads"] });

  return {
    start: useMutation({
      mutationFn: ({ modelId, variant }: { modelId: string; variant?: "quantized" | "fp16" }) =>
        downloadsApi.start(modelId, variant),
      onSuccess: invalidate,
    }),
    pause: useMutation({ mutationFn: downloadsApi.pause, onSuccess: invalidate }),
    resume: useMutation({ mutationFn: downloadsApi.resume, onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: downloadsApi.cancel, onSuccess: invalidate }),
    retry: useMutation({ mutationFn: downloadsApi.retry, onSuccess: invalidate }),
  };
}
