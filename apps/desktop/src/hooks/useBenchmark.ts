import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { benchmarkApi } from "../api/benchmark";

export function useBenchmarks(modelArtifactId?: string) {
  return useQuery({
    queryKey: ["benchmarks", modelArtifactId ?? "all"],
    queryFn: () => benchmarkApi.list(modelArtifactId),
  });
}

export function useRunBenchmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ artifactId, contextLength, prompt }: { artifactId: string; contextLength?: number; prompt?: string }) =>
      benchmarkApi.run(artifactId, contextLength, prompt),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["benchmarks"] }),
  });
}
