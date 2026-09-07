interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

export function Slider({ label, value, min, max, step, onChange, formatValue }: SliderProps) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <div className="flex items-center justify-between text-fg-secondary">
        <span>{label}</span>
        <span className="font-mono text-fg">{formatValue ? formatValue(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-elevated accent-accent"
      />
    </label>
  );
}
