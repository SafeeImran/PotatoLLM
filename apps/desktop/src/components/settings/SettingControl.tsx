import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Tooltip } from "../layout/controls";
import type { SettingDefinition } from "../../api/types";

interface SettingControlProps {
  definition: SettingDefinition;
  value: unknown;
  isDefault: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
  disabled?: boolean;
}

/**
 * One row of the Settings page, rendered from the backend's own registry entry
 * rather than a hand-written control per key — so a setting can't drift out of
 * sync with the type and bounds the server will actually accept.
 *
 * Text and number inputs commit on blur or Enter, not on every keystroke: a
 * per-keystroke write would send "8" and "81" on the way to "8192", and the
 * server would reject the intermediate values as out of range.
 *
 * The description and effect used to sit permanently under every label —
 * eighteen settings meant eighteen paragraphs of always-on text before you'd
 * touched a single control. They're a hover tip now instead (the same
 * Tooltip the live monitor's sliders use), covering the whole row so hovering
 * anywhere on a setting — not just its label — surfaces it.
 */
export function SettingControl({
  definition,
  value,
  isDefault,
  onChange,
  onReset,
  disabled,
}: SettingControlProps) {
  function formatDraft(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (definition.type === "float" && typeof v === "number") {
      // Strip float32 noise from Python-serialized values while keeping the
      // meaningful digits the user actually set (e.g. 0.8, not 0.8000000119).
      const trimmed = Number(v.toFixed(6));
      if (trimmed === 0 && v !== 0) return String(v);
      return String(trimmed);
    }
    return String(v);
  }

  const [draft, setDraft] = useState(formatDraft(value));

  // Re-sync when the value changes elsewhere (a reset, or the server's coerced
  // value coming back) — but not while this control is what changed it.
  useEffect(() => {
    setDraft(formatDraft(value));
  }, [value]);

  function commitNumber() {
    const parsed = Number(draft);
    if (draft.trim() === "" || Number.isNaN(parsed)) {
      setDraft(String(value ?? ""));
      return;
    }
    if (parsed !== value) onChange(definition.type === "int" ? Math.round(parsed) : parsed);
  }

  function commitText() {
    if (draft !== value) onChange(draft);
  }

  const tip = (
    <>
      <div>{definition.description}</div>
      {definition.effect && (
        <div className="mt-1 italic" style={{ opacity: 0.8 }}>
          {definition.effect}
        </div>
      )}
    </>
  );

  return (
    <Tooltip text={tip}>
      <div className="flex items-start justify-between gap-6 border-b border-border py-3 last:border-b-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <label htmlFor={`setting-${definition.key}`} className="text-sm text-fg">
              {definition.label}
            </label>
            {!isDefault && (
              <button
                type="button"
                onClick={onReset}
                className="text-[11px] text-accent hover:underline"
                aria-label={`Reset ${definition.label} to default`}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {definition.type === "bool" && (
            <Button
              id={`setting-${definition.key}`}
              size="sm"
              variant={value ? "primary" : "secondary"}
              onClick={() => onChange(!value)}
              disabled={disabled}
              role="switch"
              aria-checked={Boolean(value)}
              aria-label={definition.label}
            >
              {value ? "On" : "Off"}
            </Button>
          )}

          {definition.type === "enum" && (
            <Select
              id={`setting-${definition.key}`}
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              aria-label={definition.label}
            >
              {definition.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          )}

          {(definition.type === "int" || definition.type === "float") && (
            <>
              <Input
                id={`setting-${definition.key}`}
                type="number"
                className="w-28 text-right font-mono"
                value={draft}
                min={definition.minimum ?? undefined}
                max={definition.maximum ?? undefined}
                step={definition.type === "int" ? 1 : 0.05}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitNumber}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                disabled={disabled}
                aria-label={definition.label}
              />
              {definition.unit && <span className="text-xs text-fg-muted">{definition.unit}</span>}
            </>
          )}

          {definition.type === "string" && (
            <Input
              id={`setting-${definition.key}`}
              className="w-64"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              disabled={disabled}
              aria-label={definition.label}
            />
          )}
        </div>
      </div>
    </Tooltip>
  );
}
