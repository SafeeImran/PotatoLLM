import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildApi } from "../api/build";

export function useBuilds() {
  return useQuery({ queryKey: ["builds"], queryFn: buildApi.list });
}

export function useBuildActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["builds"] });

  return {
    create: useMutation({
      mutationFn: ({ name, modelArtifactId, contextLength }: { name: string; modelArtifactId: string; contextLength?: number }) =>
        buildApi.create(name, modelArtifactId, contextLength),
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) => buildApi.rename(id, name),
      onSuccess: invalidate,
    }),
    duplicate: useMutation({
      mutationFn: ({ id, name }: { id: string; name?: string }) => buildApi.duplicate(id, name),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: buildApi.delete, onSuccess: invalidate }),
  };
}
