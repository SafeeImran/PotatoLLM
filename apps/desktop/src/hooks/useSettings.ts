import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "../api/settings";
import type { SettingsMap } from "../api/types";

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: settingsApi.list });
}

export function useSettingsSchema() {
  // Separate key, not ["settings", "schema"]: writing a value invalidates
  // ["settings"], and the registry itself never changes at runtime.
  return useQuery({ queryKey: ["settings-schema"], queryFn: settingsApi.schema, staleTime: Infinity });
}

/**
 * Reads one setting with a caller-supplied fallback, for the places that need a
 * single value (the Playground's initial slider positions, the hardware poll
 * interval) rather than the whole map.
 */
export function useSetting<T>(key: string, fallback: T): T {
  const { data } = useSettings();
  const value = data?.[key]?.value;
  return value === undefined ? fallback : (value as T);
}

export function useSettingsActions() {
  const queryClient = useQueryClient();

  /**
   * Writes land optimistically: a slider that snapped back to its old value for
   * a round-trip would be unusable. The server's coerced value replaces the
   * optimistic one on success, and a rejected value is rolled back.
   */
  const update = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => settingsApi.put(key, value),
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previous = queryClient.getQueryData<SettingsMap>(["settings"]);
      if (previous) {
        queryClient.setQueryData<SettingsMap>(["settings"], {
          ...previous,
          [key]: { value, is_default: false },
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["settings"], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const reset = useMutation({
    mutationFn: (key?: string) => settingsApi.reset(key),
    onSuccess: (data) => queryClient.setQueryData(["settings"], data),
  });

  return { update, reset };
}
