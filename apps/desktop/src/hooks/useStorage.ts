import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storageApi } from "../api/storage";

export function useStorageSummary() {
  return useQuery({ queryKey: ["storage", "summary"], queryFn: storageApi.summary });
}

export function useStoredModels() {
  return useQuery({ queryKey: ["storage", "models"], queryFn: storageApi.models });
}

export function useStorageOrphans() {
  return useQuery({ queryKey: ["storage", "orphans"], queryFn: storageApi.orphans });
}

/**
 * Every mutation here changes what's on disk, so they all invalidate the whole
 * storage tree. Builds and the Playground's model list are invalidated too —
 * deleting a model file can remove Builds and drop a loadable model.
 */
export function useStorageActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["storage"] });
    queryClient.invalidateQueries({ queryKey: ["builds"] });
    queryClient.invalidateQueries({ queryKey: ["inference"] });
    queryClient.invalidateQueries({ queryKey: ["doctor"] });
  };

  return {
    deleteModel: useMutation({
      mutationFn: ({ artifactId, force }: { artifactId: string; force?: boolean }) =>
        storageApi.deleteModel(artifactId, force),
      onSuccess: invalidate,
    }),
    deleteFile: useMutation({
      mutationFn: (filePath: string) => storageApi.deleteUntrackedFile(filePath),
      onSuccess: invalidate,
    }),
    purgeMissing: useMutation({ mutationFn: storageApi.purgeMissing, onSuccess: invalidate }),
    clearCache: useMutation({ mutationFn: storageApi.clearCache, onSuccess: invalidate }),
  };
}
