# ASCII parameter slider

Drop-in control for the Live Monitor’s generation parameters. It is intentionally isolated from the existing slider, so it can be introduced one parameter at a time.

```tsx
import { AsciiParameterSlider } from "../components/ui/ascii-controls/AsciiParameterSlider";

<AsciiParameterSlider
  label="Temperature"
  code="GEN.TEMP"
  value={params.temperature}
  min={0}
  max={2}
  step={0.05}
  formatValue={(value) => value.toFixed(2)}
  lowLabel="precise"
  highLabel="wild"
  onChange={(value) => setParam("temperature", value)}
/>
```

Use the same component for Top P, Top K, and token limits; only its `code`, range, and endpoint labels change.
