import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trainingApi } from "../api/training";
import type { SliderConfig } from "../api/types";

export function useMLDependencies() {
  return useQuery({ queryKey: ["training", "dependencies"], queryFn: trainingApi.dependencies });
}

export function useHyperparameterPreview(sliders: SliderConfig) {
  return useQuery({
    queryKey: ["training", "preview", sliders],
    queryFn: () => trainingApi.preview(sliders),
  });
}

export function useTrainingJobs() {
  return useQuery({ queryKey: ["training", "jobs"], queryFn: trainingApi.listJobs });
}

export function useTrainingActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["training", "jobs"] });

  return {
    create: useMutation({
      mutationFn: ({ baseModelId, datasetId, sliders }: { baseModelId: string; datasetId: string; sliders: SliderConfig }) =>
        trainingApi.createJob(baseModelId, datasetId, sliders),
      onSuccess: invalidate,
    }),
    start: useMutation({ mutationFn: trainingApi.startJob, onSuccess: invalidate }),
    stop: useMutation({ mutationFn: trainingApi.stopJob, onSuccess: invalidate }),
  };
}
