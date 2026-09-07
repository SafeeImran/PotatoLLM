import { useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { recommendationApi } from "../api/recommendation";
import type { CompatibilityLevel } from "../api/types";

/** Fetches the real compatibility assessment for a model against this
 * machine's latest hardware profile — silently disabled (no request, no
 * error) until a profile exists, since that's a normal pre-scan state. */
export function useRecommendation(modelId: string, enabled = true) {
  return useQuery({
    queryKey: ["recommendation", modelId],
    queryFn: () => recommendationApi.get(modelId),
    enabled,
    retry: false,
  });
}

/**
 * The compatibility verdict for a whole list of models at once, so the Model
 * Library can filter/sort by fit. Shares the `["recommendation", id]` cache
 * key with useRecommendation, so the per-row badge and this list view issue
 * one request per model between them, not two.
 */
export function useRecommendations(modelIds: string[]) {
  const results = useQueries({
    queries: modelIds.map((id) => ({
      queryKey: ["recommendation", id],
      queryFn: () => recommendationApi.get(id),
      retry: false,
    })),
  });

  return useMemo(() => {
    const byId = new Map<string, CompatibilityLevel>();
    modelIds.forEach((id, i) => {
      const level = results[i]?.data?.recommended?.compatibility;
      if (level) byId.set(id, level);
    });
    return byId;
    // results identity changes each render; key off the resolved levels instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIds.join(","), results.map((r) => r.data?.recommended?.compatibility).join(",")]);
}

/**
 * Drives the "Make It Potato" flow: calling `start()` kicks off the real
 * orchestration (see engines/recommendation/service.py::make_it_potato),
 * then re-polls the same idempotent endpoint every 1.5s while it reports
 * "preparing" (a real download or quantization job in flight), stopping
 * once it reports "ready".
 */
export function useMakeItPotato(modelId: string) {
  const [active, setActive] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["make-it-potato", modelId],
    queryFn: () => recommendationApi.makeItPotato(modelId),
    enabled: active,
    refetchInterval: (q) => (q.state.data?.status === "preparing" ? 1500 : false),
  });

  return {
    ...query,
    active,
    start: () => {
      setActive(true);
      queryClient.invalidateQueries({ queryKey: ["make-it-potato", modelId] });
    },
  };
}
