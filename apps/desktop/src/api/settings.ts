import { api } from "./client";
import type { SettingDefinition, SettingsMap } from "./types";

export const settingsApi = {
  /** Every known key with its effective value — stored override or registry default. */
  list: () => api.get<SettingsMap>("/settings"),
  /** The typed definitions the Settings page builds its controls from. */
  schema: () => api.get<SettingDefinition[]>("/settings/schema"),
  put: (key: string, value: unknown) => api.put<{ key: string; value: unknown }>("/settings", { key, value }),
  /** Omit `key` to restore every default. */
  reset: (key?: string) => api.post<SettingsMap>("/settings/reset", { key: key ?? null }),
};
