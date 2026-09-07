import { useQuery } from "@tanstack/react-query";
import { modelsApi } from "../api/models";

export function useModels(params?: { family?: string; q?: string }) {
  return useQuery({
    queryKey: ["models", params ?? {}],
    queryFn: () => modelsApi.list(params),
  });
}
