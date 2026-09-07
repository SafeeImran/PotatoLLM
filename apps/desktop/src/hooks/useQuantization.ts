import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { quantizationApi } from "../api/quantization";
import type { QuantizationJob } from "../api/types";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

export function useQuantizationJobs() {
  return useQuery({
    queryKey: ["quantization"],
    queryFn: quantizationApi.list,
    refetchInterval: (query) => (query.state.data?.some((j) => ACTIVE_STATUSES.has(j.status)) ? 1000 : false),
  });
}

export function useQuantizationForSource(sourceArtifactId: string | undefined): QuantizationJob | undefined {
  const { data } = useQuantizationJobs();
  if (!sourceArtifactId) return undefined;
  return data?.filter((j) => j.source_artifact_id === sourceArtifactId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function useQuantizationActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["quantization"] });

  return {
    start: useMutation({
      mutationFn: ({ sourceArtifactId, targetQuant }: { sourceArtifactId: string; targetQuant: string }) =>
        quantizationApi.start(sourceArtifactId, targetQuant),
      onSuccess: invalidate,
    }),
    cancel: useMutation({ mutationFn: quantizationApi.cancel, onSuccess: invalidate }),
  };
}
