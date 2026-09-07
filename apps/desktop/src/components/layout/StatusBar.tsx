import { usePlayground } from "../../playground/PlaygroundProvider";
import { useLiveHardware } from "../../hooks/useHardware";
import { Sparkline } from "../ui/Sparkline";

const MONO = "var(--pot-mono)";
const NUM = "var(--pot-num)";

const glowStyle = {
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: ".3px",
  backgroundImage:
    "linear-gradient(90deg, var(--pot-faint) 0%, var(--pot-faint) 38%, var(--pot-ink) 50%, var(--pot-faint) 62%, var(--pot-faint) 100%)",
  backgroundSize: "220% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  animation: "potTextGlow 1.6s linear infinite",
} as const;

function cell(font: string = MONO): React.CSSProperties {
  return {
    fontFamily: font,
    fontVariantNumeric: "tabular-nums",
    fontSize: 10,
    color: "var(--pot-sub)",
    whiteSpace: "nowrap",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: "0 1 auto",
  };
}

/**
 * The prototype's status strip, reading from the real inference session: model,
 * state, throughput and context all come from Potato Core, and the sparkline is
 * the live tok/s history rather than a scripted wave.
 */
export function StatusBar({
  monitorOpen,
  onToggleMonitor,
}: {
  monitorOpen: boolean;
  onToggleMonitor: () => void;
}) {
  const { generating, loaded, status, liveTps, lastStats, tpsHistory, params } = usePlayground();
  const { data: live } = useLiveHardware();

  const label = generating ? "GENERATING" : loaded ? "READY" : "IDLE";
  const measured = lastStats?.tokens_per_sec ?? null;
  const throughputText = generating
    ? `~${liveTps.toFixed(1)} tok/s`
    : measured
      ? `${measured.toFixed(1)} tok/s`
      : "0.0 tok/s";
  const throughputTitle = generating
    ? "Live tokens per second during this generation"
    : measured
      ? "Measured tokens per second from the last generation"
      : "No generation measured yet";

  return (
    <div
      style={{
        height: 34,
        flex: "0 0 34px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 12px 0 14px",
        borderTop: "1px solid var(--pot-status-line)",
        background: "var(--pot-status)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "0 0 auto" }}>
        <span
          style={{
            width: 7,
            height: 7,
            flex: "0 0 7px",
            borderRadius: "50%",
            background: generating
              ? "var(--pot-accent-dot)"
              : loaded
                ? "var(--pot-ok)"
                : "var(--pot-ghost)",
            transition: "background .25s ease",
          }}
        />
        <span style={generating ? glowStyle : { fontWeight: 700, fontSize: 11, letterSpacing: ".3px" }}>
          {label}
        </span>
      </div>

      <span style={{ width: 1, height: 14, flex: "0 0 1px", background: "var(--pot-line-strong)" }} />

      <span style={cell()}>{status?.model_name ?? "no model loaded"}</span>
      {/* Drawn, not block characters (U+2581-2588) — the loaded face isn't
          guaranteed to carry them, and this app draws its own marks rather
          than risk a silent fallback font (see icons.tsx). */}
      <span style={{ width: 72, flex: "0 0 72px", display: "block" }} aria-hidden="true">
        <Sparkline values={tpsHistory.slice(-22)} height={13} live={generating} />
      </span>
      <span style={cell(NUM)} title={throughputTitle}>
        {throughputText}
      </span>

      <span style={{ flex: "1 1 auto", minWidth: 8 }} />

      {live?.gpu.utilization_pct !== null && live?.gpu.utilization_pct !== undefined && (
        <span style={cell(NUM)} title="GPU utilization">
          GPU {live.gpu.utilization_pct.toFixed(0)}%
        </span>
      )}
      <span style={cell(NUM)} title="Loaded context length · sampling temperature">
        ctx {status?.context_length ? status.context_length.toLocaleString() : "—"} · t=
        {params.temperature.toFixed(2)}
      </span>
      <button
        type="button"
        className="pot-icon-btn"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "auto",
          height: 22,
          padding: "0 9px",
          flex: "0 0 auto",
          borderRadius: 6,
          fontFamily: "inherit",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: ".8px",
          color: "var(--pot-ink-soft)",
        }}
        aria-expanded={monitorOpen}
        onClick={onToggleMonitor}
      >
        LIVE MONITOR <span style={{ fontFamily: MONO }}>{monitorOpen ? "‹" : "›"}</span>
      </button>
    </div>
  );
}
