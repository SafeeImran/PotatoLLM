import "./AsciiParameterSlider.css";

export interface AsciiParameterSliderProps {
  /** Short parameter name, e.g. "Temperature" or "Top P". */
  label: string;
  /** A compact machine-like identifier displayed above the track. */
  code?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  lowLabel?: string;
  highLabel?: string;
  disabled?: boolean;
}

/**
 * A self-contained terminal-style range control for generation parameters.
 * It deliberately uses a native range input for keyboard and screen-reader
 * support; the surrounding characters are purely presentational.
 */
export function AsciiParameterSlider({
  label,
  code = "GEN.PARAM",
  value,
  min,
  max,
  step,
  onChange,
  formatValue = (next) => String(next),
  lowLabel,
  highLabel,
  disabled = false,
}: AsciiParameterSliderProps) {
  const progress = max === min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const valueText = formatValue(value);

  return (
    <div className="ascii-parameter-slider" data-disabled={disabled || undefined}>
      <div className="ascii-parameter-slider__header">
        <div>
          <span className="ascii-parameter-slider__code">{code}</span>
          <label className="ascii-parameter-slider__label">{label}</label>
        </div>
        <output className="ascii-parameter-slider__value" htmlFor={`${code}-${label}`}>
          {valueText}
        </output>
      </div>

      <div className="ascii-parameter-slider__rail" aria-hidden="true">
        <span>[</span>
        <div className="ascii-parameter-slider__track-shell">
          <div className="ascii-parameter-slider__ticks" />
          <div className="ascii-parameter-slider__fill" style={{ width: `${progress}%` }} />
          <i className="ascii-parameter-slider__cursor" style={{ left: `${progress}%` }} />
        </div>
        <span>]</span>
      </div>

      <input
        id={`${code}-${label}`}
        className="ascii-parameter-slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      <div className="ascii-parameter-slider__bounds" aria-hidden="true">
        <span>{lowLabel ?? formatValue(min)}</span>
        <span>{highLabel ?? formatValue(max)}</span>
      </div>
    </div>
  );
}
