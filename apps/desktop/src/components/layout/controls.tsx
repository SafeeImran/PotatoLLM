import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * The live monitor's control vocabulary: the prototype's dashed
 * [ ---|--- ] slider, plus the two things the llama.cpp runtime knobs need
 * that a plain slider can't express — an "Auto" position that means "detect
 * it for me", and a small set of named choices (Flash Attention, KV cache).
 *
 * They live here rather than in LiveMonitor.tsx so that file stays a layout:
 * which knob belongs to which section, and what a change to it costs.
 */

const MONO = "var(--pot-mono)";

export interface NumericSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  /**
   * An explicit ladder of allowed values, for knobs whose useful range spans
   * orders of magnitude — a linear 512..131072 context slider would spend most
   * of its travel in sizes nobody picks. When set, the track moves between
   * these values and `min`/`max`/`step` are ignored.
   */
  steps?: number[];
  decimals?: number;
  /** Rendered under the track, e.g. "precise" / "wild". */
  lowLabel?: string;
  highLabel?: string;
  /** What the knob does, shown as a tooltip on hover/focus rather than inline. */
  hint?: string;
  unit?: string;
}

/** Index of the ladder rung at or below `value` — the nearest legal position. */
function nearestStep(steps: number[], value: number): number {
  let best = 0;
  for (let i = 0; i < steps.length; i++) {
    if (Math.abs(steps[i] - value) < Math.abs(steps[best] - value)) best = i;
  }
  return best;
}

export function formatNumber(value: number, decimals = 0): string {
  return decimals ? value.toFixed(decimals) : String(Math.round(value));
}

function Row({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-.15px" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {children}
        <span
          className="pot-num"
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: "-.2px",
            background: "var(--pot-accent-soft)",
            border: "1px solid var(--pot-accent-line)",
            borderRadius: 5,
            padding: "1px 7px",
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

/**
 * Explanatory copy on hover, rather than a line of small text under every
 * control. Eleven permanent hint lines turned the drawer into a manual; the
 * words are the same, they just wait to be asked for.
 *
 * Positioned `fixed` from the trigger's measured rect: the drawer body is a
 * scroll container, so an absolutely-positioned bubble would be clipped by it.
 * That also means the bubble has to be dismissed on scroll, since it cannot
 * follow the element it is anchored to.
 */
export function Tooltip({ text, children }: { text?: ReactNode; children: ReactNode }) {
  // Anchored by `top` OR `bottom`, never by a transform: the potPop entrance
  // animation below ends on `transform: none`, and an animation beats an
  // inline style — a translateY(-100%) used to flip the bubble upward would be
  // silently dropped the moment the animation settled, dropping the tooltip
  // straight over the control it describes.
  const [box, setBox] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const hide = useCallback(() => setBox(null), []);

  const show = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Above by default, flipping below only when the control sits too close to
    // the top of the window for the bubble to fit.
    const below = rect.top < 120;
    setBox({
      left: rect.left,
      ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }),
    });
  }, []);

  useEffect(() => {
    if (!box) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [box, hide]);

  if (!text) return <>{children}</>;

  return (
    <div
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      aria-describedby={box ? id : undefined}
    >
      {children}
      {box && (
        <div
          id={id}
          role="tooltip"
          style={{
            position: "fixed",
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            zIndex: 70,
            maxWidth: 250,
            padding: "7px 9px",
            borderRadius: 8,
            border: "1px solid var(--pot-line-strong)",
            background: "var(--pot-bg)",
            boxShadow: "0 14px 32px -12px rgba(0,0,0,.45)",
            fontSize: 10.5,
            lineHeight: 1.5,
            fontWeight: 500,
            color: "var(--pot-ink-soft)",
            pointerEvents: "none",
            animation: "potPop .14s cubic-bezier(.2,.9,.3,1) both",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/**
 * Wrapper for one control. Greying out is a statement about the session, not
 * the control: with no model loaded there is nothing for any of these to apply
 * to, so the whole set dims together rather than each knob deciding alone.
 */
function Field({
  tip,
  disabled,
  children,
}: {
  tip?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip text={tip}>
      <div
        style={{
          marginBottom: 16,
          opacity: disabled ? 0.4 : 1,
          transition: "opacity .2s ease",
        }}
      >
        {children}
      </div>
    </Tooltip>
  );
}

/**
 * The dashed track itself. Dragging is pointer-based like the prototype's;
 * arrow/Home/End keys are added so the control is reachable without a mouse,
 * which the canvas mock had no way to express.
 */
function DashTrack({
  label,
  value,
  valueText,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  /** Spoken instead of the raw number, for a track that moves over indices. */
  valueText?: string;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const fraction = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));

  const commit = (nextFraction: number) => {
    const raw = min + Math.max(0, Math.min(1, nextFraction)) * (max - min);
    const snapped = Math.round(raw / step) * step;
    onChange(parseFloat(Math.max(min, Math.min(max, snapped)).toFixed(4)));
  };

  const nudge = (steps: number) => {
    const next = Math.max(min, Math.min(max, value + steps * step));
    onChange(parseFloat(next.toFixed(4)));
  };

  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    commit((e.clientX - rect.left) / rect.width);
  };

  const trackCell: React.CSSProperties = {
    height: 14,
    pointerEvents: "none",
    flex: "0 0 auto",
    transition: "width .12s ease-out",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--pot-ghost)", flex: "0 0 auto" }}>[</span>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (!disabled && e.buttons === 1) fromPointer(e);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            nudge(-1);
          } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            nudge(1);
          } else if (e.key === "Home") {
            e.preventDefault();
            onChange(min);
          } else if (e.key === "End") {
            e.preventDefault();
            onChange(max);
          }
        }}
        style={{
          position: "relative",
          flex: "1 1 auto",
          minWidth: 0,
          height: 22,
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
          cursor: disabled ? "default" : "ew-resize",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <span
          style={{
            ...trackCell,
            width: `${fraction * 100}%`,
            backgroundImage: "repeating-linear-gradient(90deg, var(--pot-ink) 0 2px, transparent 2px 7px)",
          }}
        />
        <span
          style={{
            ...trackCell,
            flex: "1 1 auto",
            backgroundImage: "repeating-linear-gradient(90deg, var(--pot-ghost) 0 2px, transparent 2px 7px)",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: "50%",
            left: `${fraction * 100}%`,
            width: 3,
            height: 20,
            marginLeft: -1.5,
            borderRadius: 2,
            background: "var(--pot-accent-dot)",
            pointerEvents: "none",
            transform: "translateY(-50%)",
            transition: "left .12s ease-out",
          }}
        />
      </div>
      <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--pot-ghost)", flex: "0 0 auto" }}>]</span>
    </div>
  );
}

/** DashTrack driven by a spec — linear, or over a `steps` ladder. */
function SpecTrack({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: NumericSpec;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  if (spec.steps) {
    const steps = spec.steps;
    return (
      <DashTrack
        label={spec.label}
        value={nearestStep(steps, value)}
        valueText={formatNumber(value, spec.decimals ?? 0)}
        min={0}
        max={steps.length - 1}
        step={1}
        disabled={disabled}
        onChange={(index) => onChange(steps[Math.max(0, Math.min(steps.length - 1, Math.round(index)))])}
      />
    );
  }
  return (
    <DashTrack
      label={spec.label}
      value={value}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function lowBound(spec: NumericSpec): string {
  if (spec.lowLabel) return spec.lowLabel;
  return formatNumber(spec.steps ? spec.steps[0] : spec.min, spec.decimals ?? 0);
}

function highBound(spec: NumericSpec): string {
  if (spec.highLabel) return spec.highLabel;
  return formatNumber(spec.steps ? spec.steps[spec.steps.length - 1] : spec.max, spec.decimals ?? 0);
}

function Bounds({ low, high }: { low: string; high: string }) {
  return (
    <div
      className="pot-num"
      style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--pot-ghost)", marginTop: 1 }}
    >
      <span>{low}</span>
      <span>{high}</span>
    </div>
  );
}

/** A plain numeric parameter — the sampling knobs use this. */
export function DashSlider({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: NumericSpec;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const decimals = spec.decimals ?? 0;
  return (
    <Field tip={spec.hint} disabled={disabled}>
      <Row label={spec.label} value={`${formatNumber(value, decimals)}${spec.unit ? ` ${spec.unit}` : ""}`} />
      <SpecTrack spec={spec} value={value} disabled={disabled} onChange={onChange} />
      <Bounds low={lowBound(spec)} high={highBound(spec)} />
    </Field>
  );
}

/**
 * A numeric parameter that can also be left on Auto.
 *
 * `autoValue` is the sentinel the core stores for "decide for me" (0 threads,
 * 0 batch, -1 GPU layers); `autoLabel` is what that resolves to on this
 * machine, so the control can say "Auto · 8 threads" instead of just "auto"
 * and leave the user guessing what they actually get.
 */
export function AutoSlider({
  spec,
  value,
  autoValue,
  autoLabel,
  autoDisplay,
  manualFallback,
  disabled,
  onChange,
}: {
  spec: NumericSpec;
  value: number;
  autoValue: number;
  autoLabel?: string;
  /**
   * What Auto currently works out to, shown in the value badge. Without it the
   * badge would just say "auto" beside a button already labelled AUTO, and the
   * user would still not know what they were getting.
   */
  autoDisplay?: string;
  /** Where the slider lands the first time Auto is switched off. */
  manualFallback: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const decimals = spec.decimals ?? 0;
  const isAuto = value === autoValue;
  const sliderValue = isAuto ? manualFallback : value;

  return (
    <Field tip={isAuto && autoLabel ? autoLabel : spec.hint} disabled={disabled}>
      <Row
        label={spec.label}
        value={isAuto ? (autoDisplay ?? "auto") : `${formatNumber(value, decimals)}${spec.unit ? ` ${spec.unit}` : ""}`}
      >
        <button
          type="button"
          role="switch"
          aria-checked={isAuto}
          aria-label={`${spec.label} automatic`}
          disabled={disabled}
          onClick={() => onChange(isAuto ? manualFallback : autoValue)}
          style={{
            height: 20,
            padding: "0 8px",
            borderRadius: 5,
            cursor: disabled ? "default" : "pointer",
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".6px",
            border: `1px solid ${isAuto ? "var(--pot-accent-edge)" : "var(--pot-line-strong)"}`,
            background: isAuto ? "var(--pot-accent)" : "var(--pot-bg)",
            color: isAuto ? "var(--pot-on-accent)" : "var(--pot-sub)",
            transition: "background .16s ease, border-color .16s ease, color .16s ease",
          }}
        >
          AUTO
        </button>
      </Row>
      <SpecTrack spec={spec} value={sliderValue} disabled={isAuto || disabled} onChange={onChange} />
      <Bounds low={lowBound(spec)} high={highBound(spec)} />
    </Field>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** A short list of named settings — Flash Attention, KV cache precision. */
export function ChoiceRow<T extends string>({
  label,
  options,
  value,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  options: ChoiceOption<T>[];
  value: T;
  hint?: ReactNode;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Field tip={hint} disabled={disabled}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-.15px", marginBottom: 6 }}>{label}</div>
      <div
        role="radiogroup"
        aria-label={label}
        style={{
          display: "flex",
          border: "1px solid var(--pot-line-strong)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                height: 28,
                border: 0,
                borderLeft: index === 0 ? 0 : "1px solid var(--pot-line-strong)",
                cursor: disabled ? "default" : "pointer",
                fontSize: 11,
                fontWeight: 700,
                background: selected ? "var(--pot-accent)" : "var(--pot-bg)",
                color: selected ? "var(--pot-on-accent)" : "var(--pot-sub)",
                transition: "background .16s ease, color .16s ease",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/**
 * A number entered rather than dragged. The seed is the only knob where a
 * slider is the wrong instrument — its range is the whole int space and no
 * value is "near" another.
 */
export function SeedRow({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const isRandom = value < 0;

  // Re-sync when the value changes elsewhere (the dice button, or defaults
  // arriving) — but not while this field is what changed it.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(isRandom ? "" : String(value));
  }, [value, isRandom]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange(-1);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(isRandom ? "" : String(value));
      return;
    }
    onChange(Math.min(2147483647, Math.round(parsed)));
  };

  return (
    <Field
      disabled={disabled}
      tip={
        isRandom
          ? "Every answer is a fresh draw. Pin a seed to get the same answer twice."
          : "The same prompt and settings will now produce the same answer."
      }
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-.15px" }}>Seed</span>
        <button
          type="button"
          className="pot-chip-btn"
          style={{ height: 22, fontSize: 10 }}
          disabled={disabled}
          onClick={() => onChange(isRandom ? Math.floor(Math.random() * 2147483647) : -1)}
        >
          {isRandom ? "Pin one" : "Randomize"}
        </button>
      </div>
      <input
        className="pot-textarea"
        style={{ height: 30, padding: "0 10px", fontSize: 11.5 }}
        inputMode="numeric"
        value={draft}
        placeholder="random each time"
        aria-label="Seed"
        disabled={disabled}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </Field>
  );
}
