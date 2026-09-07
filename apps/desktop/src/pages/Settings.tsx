import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { DoctorPanel } from "../components/settings/DoctorPanel";
import { SettingControl } from "../components/settings/SettingControl";
import { PrivacyActions } from "../components/settings/PrivacyActions";
import { useSettings, useSettingsActions, useSettingsSchema } from "../hooks/useSettings";
import type { SettingDefinition } from "../api/types";

/** Extra context rendered under a section's controls, where the section has
 * actions or caveats the individual settings can't carry. */
const SECTION_FOOTERS: Record<string, ReactNode> = {
  Storage: (
    <div className="mt-3 text-xs text-fg-muted">
      To see what's actually on disk and delete individual models, go to{" "}
      <Link to="/storage" className="text-accent hover:underline">
        Potato Storage
      </Link>
      .
    </div>
  ),
  Inference: (
    <div className="mt-3 text-xs text-fg-muted">
      These apply to the next model you load. A model that's already running keeps the settings it started with —
      unload and reload it from the Playground to pick up a change.
    </div>
  ),
};

function groupBySection(definitions: SettingDefinition[]): [string, SettingDefinition[]][] {
  const groups: [string, SettingDefinition[]][] = [];
  for (const definition of definitions) {
    const existing = groups.find(([section]) => section === definition.section);
    if (existing) existing[1].push(definition);
    else groups.push([definition.section, [definition]]);
  }
  return groups;
}

export default function Settings() {
  const { data: schema, isLoading: schemaLoading, isError } = useSettingsSchema();
  const { data: values } = useSettings();
  const { update, reset } = useSettingsActions();

  const sections = schema ? groupBySection(schema) : [];
  const anyOverridden = values ? Object.values(values).some((entry) => !entry.is_default) : false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-fg-secondary">
          Every setting here is read by something real — each one says what it changes.
        </p>
        {anyOverridden && (
          <Button size="sm" onClick={() => reset.mutate(undefined)} disabled={reset.isPending}>
            {reset.isPending ? "Resetting..." : "Reset all to defaults"}
          </Button>
        )}
      </div>

      {schemaLoading && <div className="text-sm text-fg-muted">Loading settings...</div>}
      {isError && (
        <div className="text-sm text-danger">
          Couldn't reach Potato Core to load settings. It may still be starting up.
        </div>
      )}

      {update.isError && <div className="text-sm text-danger">{(update.error as Error).message}</div>}

      {sections.map(([section, definitions]) => (
        <Card key={section} title={section}>
          <div className="flex flex-col">
            {definitions.map((definition) => {
              const resolved = values?.[definition.key];
              return (
                <SettingControl
                  key={definition.key}
                  definition={definition}
                  value={resolved?.value ?? definition.default}
                  isDefault={resolved?.is_default ?? true}
                  onChange={(value) => update.mutate({ key: definition.key, value })}
                  onReset={() => reset.mutate(definition.key)}
                  disabled={!values}
                />
              );
            })}
          </div>
          {SECTION_FOOTERS[section]}
          {section === "Privacy" && (
            <div className="mt-5 border-t border-border pt-4">
              <PrivacyActions />
            </div>
          )}
        </Card>
      ))}

      <Card title="Advanced">
        <DoctorPanel />
      </Card>
    </div>
  );
}
