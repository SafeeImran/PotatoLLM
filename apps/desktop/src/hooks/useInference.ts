import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inferenceApi } from "../api/inference";
import { packsApi } from "../api/packs";
import type { RequestedRole, RuntimeOptions } from "../api/types";

export function useAvailableModels() {
  return useQuery({ queryKey: ["inference", "available-models"], queryFn: inferenceApi.availableModels });
}

export function useInferenceStatus() {
  return useQuery({ queryKey: ["inference", "status"], queryFn: inferenceApi.status });
}

/**
 * The hardware behind the runtime controls' Auto positions. Detection is
 * cached server-side and the answer only changes when the machine does, so
 * this never refetches on its own.
 */
export function useRuntimeDefaults() {
  return useQuery({
    queryKey: ["inference", "runtime-defaults"],
    queryFn: inferenceApi.runtimeDefaults,
    staleTime: 5 * 60 * 1000,
  });
}

/** Curated model packs, priced against this machine. */
export function usePacks() {
  return useQuery({ queryKey: ["packs"], queryFn: packsApi.list });
}

export function usePackActions() {
  const queryClient = useQueryClient();
  return {
    download: useMutation({
      mutationFn: (packId: string) => packsApi.download(packId),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["packs"] });
        queryClient.invalidateQueries({ queryKey: ["downloads"] });
      },
    }),
  };
}

export function useInferenceActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["inference", "status"] });
    // A newly loaded model changes which pack members are resident.
    queryClient.invalidateQueries({ queryKey: ["packs"] });
  };

  return {
    load: useMutation({
      mutationFn: ({
        artifactId,
        runtime,
        role,
      }: {
        artifactId: string;
        runtime?: RuntimeOptions;
        role?: RequestedRole;
      }) => inferenceApi.load(artifactId, runtime, role ?? "auto"),
      onSuccess: invalidate,
    }),
    unload: useMutation({
      mutationFn: (artifactId?: string) => inferenceApi.unload(artifactId),
      onSuccess: invalidate,
    }),
    setPrimary: useMutation({
      mutationFn: (artifactId: string) => inferenceApi.setPrimary(artifactId),
      onSuccess: invalidate,
    }),
  };
}
