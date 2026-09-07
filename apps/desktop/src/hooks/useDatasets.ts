import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { datasetApi } from "../api/dataset";

export function useDatasets() {
  return useQuery({ queryKey: ["datasets"], queryFn: datasetApi.list });
}

export function useDatasetActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["datasets"] });

  return {
    register: useMutation({
      mutationFn: ({ name, sourcePath }: { name: string; sourcePath: string }) => datasetApi.register(name, sourcePath),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: datasetApi.delete, onSuccess: invalidate }),
  };
}
