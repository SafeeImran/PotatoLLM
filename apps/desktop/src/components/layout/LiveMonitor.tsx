import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePlayground } from "../../playground/PlaygroundProvider";
import type { GenerationParams } from "../../playground/PlaygroundProvider";
import { useLiveHardware } from "../../hooks/useHardware";
import { useUsageSummary } from "../../hooks/useUsage";
import { useSetting } from "../../hooks/useSettings";
import { formatCompact } from "../../lib/spark";
import { Sparkline } from "../ui/Sparkline";
import { formatBytes } from "../../lib/format";
import { AutoSlider, ChoiceRow, DashSlider, SeedRow, Tooltip } from "./controls";
import type { NumericSpec } from "./controls";
import { ChevronIcon } from "./icons";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import type { FlashAttentionMode, KvCacheType } from "../../api/types";

const MONO = "var(--pot-mono)";
const DRAWER_WIDTH_DEFAULT = 380;
const DRAWER_WIDTH_MIN = 320;
const DRAWER_WIDTH_MAX = 560;

/**
 * The sampling knobs, split into the four most people touch and the four they
 * mostly should not. Both sets are per-request, so a change here lands on the
 * next message without restarting anything.
 */
const GENERATION: (NumericSpec & { key: keyof GenerationParams })[] = [
  {
    key: "temperature",
    label: "Temperature",
    min: 0,
    max: 2,
    step: 0.05,
    decimals: 2,
    lowLabel: "precise",
    highLabel: "wild",
    hint: "How much the model is allowed to surprise itself. Lower is steadier.",
  },
  {
    key: "topP",
    label: "Top P",
    min: 0,
    max: 1,
    step: 0.01,
    decimals: 2,
    hint: "Considers only the most likely tokens that add up to this probability.",
  },
  {
    key: "topK",
    label: "Top K",
    min: 1,
    max: 200,
    step: 1,
    hint: "Hard cap on how many candidate tokens stay in the running.",
  },
  {
    key: "maxTokens",
    label: "Max Tokens",
    min: 16,
    max: 8192,
    step: 16,
    unit: "tok",
    hint: "Longest answer the model may write before it is cut off.",
  },
];

const ADVANCED: (NumericSpec & { key: keyof GenerationParams })[] = [
  {
    key: "minP",
    label: "Min P",
    min: 0,
    max: 0.5,
    step: 0.01,
    decimals: 2,
    hint: "Drops tokens far less likely than the best one. 0 turns it off.",
  },
  {
    key: "repeatPenalty",
    label: "Repeat Penalty",
    min: 1,
    max: 2,
    step: 0.01,
    decimals: 2,
    lowLabel: "off",
    highLabel: "strong",
    hint: "Discourages the model from looping. 1.00 turns it off.",
  },
  {
    key: "repeatLastN",
    label: "Repeat Last N",
    min: 0,
    max: 2048,
    step: 16,
    unit: "tok",
    hint: "How far back the repeat penalty looks. 0 turns it off.",
  },
];

/** Context sizes worth offering — a linear track would waste its travel. */
const CONTEXT_STEPS = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072];
const BATCH_STEPS = [128, 256, 512, 1024, 2048, 4096];

const CONTEXT_SPEC: NumericSpec = {
  label: "Context Size",
  min: 1024,
  max: 131072,
  step: 1024,
  steps: CONTEXT_STEPS,
  unit: "tok",
  lowLabel: "1K",
  highLabel: "128K",
};

const GPU_LAYERS_SPEC: NumericSpec = {
  label: "GPU Layers / Offload",
  min: 0,
  max: 100,
  step: 1,
  unit: "layers",
  lowLabel: "CPU only",
  highLabel: "100",
  hint: "How many model layers run on the GPU. More is faster, until VRAM runs out.",
};

const THREADS_SPEC: NumericSpec = {
  label: "CPU Threads",
  min: 1,
  max: 64,
  step: 1,
  hint: "Cores llama.cpp generates on. More than your physical core count rarely helps.",
};

const BATCH_SPEC: NumericSpec = {
  label: "Batch Size",
  min: 128,
  max: 4096,
  step: 128,
  steps: BATCH_STEPS,
  unit: "tok",
  hint: "Tokens processed at once while reading your prompt. Bigger is faster but uses more memory.",
};

function Divider() {
  return <div style={{ height: 1, background: "var(--pot-line)", margin: "20px 0" }} />;
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div
      className="pot-section-label"
      style={{
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A collapsible group of knobs. Everything past Generation starts closed:
 * the drawer is a chat sidebar first and a control panel second, and eleven
 * expanded sliders would bury the throughput readout below the fold.
 */
function Section({
  title,
  note,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** One line under the heading — what this group of knobs costs to change. */
  note?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        type="button"
        className="pot-disclosure"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ marginBottom: open ? 10 : 2 }}
      >
        <ChevronIcon className="pot-disclosure-caret" aria-hidden="true" />
        <span className="pot-section-label">{title}</span>
      </button>
      {open && (
        <div>
          {note && (
            <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--pot-faint)", marginBottom: 12 }}>{note}</div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ border: "1px solid var(--pot-line)", borderRadius: 10, padding: "10px 11px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.1, color: "var(--pot-faint)" }}>{k}</div>
      <div className="pot-num" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.6px", marginTop: 3 }}>
        {v}
      </div>
    </div>
  );
}

/** The sampling controls — Generation, and the rarely-touched rest. */
function SamplingSpecs({ specs }: { specs: (NumericSpec & { key: keyof GenerationParams })[] }) {
  const { params, setParam, loaded } = usePlayground();
  return (
    <>
      {specs.map((spec) => (
        <DashSlider
          key={spec.key}
          spec={spec}
          value={params[spec.key]}
          disabled={!loaded}
          onChange={(value) => setParam(spec.key, value)}
        />
      ))}
    </>
  );
}

/**
 * Runtime knobs are baked into the running llama-server, so changing one is a
 * promise about the *next* load rather than an edit to the current session.
 * This says so, and offers the reload that makes it true.
 */
function ReloadBanner() {
  const { runtimeDirty, reloadModel, loadingModel } = usePlayground();
  if (!runtimeDirty) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid var(--pot-accent-edge)",
        background: "var(--pot-accent-soft)",
        borderRadius: 10,
        padding: "9px 10px",
        marginBottom: 14,
        animation: "potFadeUp .28s cubic-bezier(.2,.9,.3,1) both",
      }}
    >
      <span style={{ flex: "1 1 auto", fontSize: 11, lineHeight: 1.45, color: "var(--pot-ink-soft)" }}>
        These take effect the next time the model loads.
      </span>
      <button
        type="button"
        className="pot-chip-btn"
        style={{ flex: "0 0 auto", height: 26, fontSize: 11 }}
        onClick={reloadModel}
        disabled={loadingModel}
      >
        {loadingModel ? "Reloading…" : "Reload now"}
      </button>
    </div>
  );
}

/** "Auto · 8 threads", "Auto · RTX 4060, 8.0 GB" — what Auto means here. */
function useAutoLabels() {
  const { runtimeDefaults } = usePlayground();
  if (!runtimeDefaults) return { threads: undefined, gpuLayers: undefined, hardware: null };

  const cores = runtimeDefaults.cpu_cores;
  const gpu = [
    runtimeDefaults.gpu_model,
    runtimeDefaults.vram_mb ? formatBytes(runtimeDefaults.vram_mb * 1024 * 1024) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Three distinct situations, and conflating them would misreport where the
  // work runs: a usable GPU, a GPU this llama.cpp build can't reach, and no
  // GPU at all.
  let gpuLayers: string;
  let hardware: string;
  if (runtimeDefaults.gpu_available) {
    gpuLayers = `Auto — llama.cpp fits what it can onto your ${gpu || "GPU"}.`;
    hardware = gpu || runtimeDefaults.compute_backend;
  } else if (runtimeDefaults.gpu_detected) {
    gpuLayers = `Auto — this llama.cpp build is CPU-only, so nothing offloads to your ${gpu || "GPU"}.`;
    hardware = `${gpu || runtimeDefaults.compute_backend} (unused — CPU-only build)`;
  } else {
    gpuLayers = "Auto — no GPU detected, so everything runs on the CPU.";
    hardware = "CPU only";
  }

  return {
    threads: `Auto — ${runtimeDefaults.threads} threads${cores ? ` of ${cores} cores` : ""} detected.`,
    gpuLayers,
    hardware,
  };
}

/** The prototype's right-hand drawer: session parameters plus real telemetry. */
export function LiveMonitor({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const {
    systemPrompt,
    setSystemPrompt,
    params,
    setParam,
    runtime,
    setRuntimeOption,
    runtimeDefaults,
    tpsHistory,
    liveTps,
    lastStats,
    generating,
    status,
    loaded,
    unloadModel,
  } = usePlayground();
  const { data: live } = useLiveHardware(open);
  const { data: usage } = useUsageSummary();
  const autoLabels = useAutoLabels();
  const developerMode = useSetting("developer_mode", false);

  // Only poll the drawer's own data while it's visible; `useLiveHardware(open)`
  // above does that, but the status bar keeps its own always-on subscription.
  const [mountedOnce, setMountedOnce] = useState(open);
  useEffect(() => {
    if (open) setMountedOnce(true);
  }, [open]);

  const { width: drawerWidth, startDrag: startDrawerResize, dragging: resizingDrawer } = useResizableWidth({
    min: DRAWER_WIDTH_MIN,
    max: DRAWER_WIDTH_MAX,
    defaultWidth: DRAWER_WIDTH_DEFAULT,
    storageKey: "potatollm.liveMonitorWidth",
    edge: "left",
  });

  const measured = lastStats?.tokens_per_sec ?? null;
  const peak = Math.max(0, ...tpsHistory);

  return (
    <div className="pot-shell-scale" style={{ position: "relative", display: "flex", alignItems: "stretch", flex: "0 0 auto" }}>
      <button
        type="button"
        className="pot-icon-btn"
        title={open ? "Close live monitor" : "Open live monitor"}
        aria-label={open ? "Close live monitor" : "Open live monitor"}
        aria-expanded={open}
        onClick={onToggle}
        style={{
          position: "absolute",
          left: -22,
          top: "50%",
          transform: "translateY(-50%)",
          width: 22,
          height: 86,
          border: "1px solid var(--pot-status-line)",
          borderRight: 0,
          borderRadius: "9px 0 0 9px",
          background: "var(--pot-panel)",
          zIndex: 5,
        }}
      >
        {open ? "›" : "‹"}
      </button>

      <section
        style={{
          width: open ? drawerWidth : 0,
          flex: "0 0 auto",
          position: "relative",
          overflow: "hidden",
          borderLeft: open ? "1px solid var(--pot-line)" : 0,
          background: "var(--pot-bg)",
          opacity: open ? 1 : 0,
          // See the sidebar's identical reasoning: a live drag has to track
          // the cursor exactly, not ease behind it.
          transition: resizingDrawer ? "none" : "width .38s cubic-bezier(.4,0,.2,1), opacity .3s ease",
        }}
        aria-hidden={!open}
      >
        {open && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize live monitor"
            title="Drag to resize"
            className="pot-resize-handle"
            style={{ left: 0 }}
            onMouseDown={startDrawerResize}
          />
        )}
        {mountedOnce && (
          <div style={{ width: drawerWidth, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div
              style={{
                height: 56,
                flex: "0 0 56px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 18px",
                borderBottom: "1px solid var(--pot-line)",
              }}
            >
              <span className="pot-section-label" style={{ fontWeight: 800, letterSpacing: 1.7, color: "var(--pot-ink)" }}>
                LIVE MONITOR
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--pot-faint)" }}>
                {generating ? "streaming" : loaded ? "idle" : "no model"}
              </span>
            </div>

            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 18 }}>
              <Label>Model</Label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid var(--pot-line)",
                  borderRadius: 10,
                  padding: "10px 11px",
                }}
              >
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-.2px" }}>
                    {status?.model_name ?? "No model loaded"}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--pot-faint)", marginTop: 2 }}>
                    {status?.context_length
                      ? `${status.context_length.toLocaleString()} ctx`
                      : "load one from the composer"}
                  </div>
                </div>
                {loaded && (
                  <button type="button" className="pot-chip-btn" onClick={unloadModel} title="Unload model">
                    Unload
                  </button>
                )}
              </div>

              <Divider />

              <ReloadBanner />

              <Section title="Generation" defaultOpen>
                <SamplingSpecs specs={GENERATION} />
              </Section>

              {/* Everything below is llama.cpp's plumbing — context sizing, GPU
                  offload, sampling minutiae. Generation alone is what a normal
                  session needs, so the rest waits for Developer Mode. */}
              {developerMode && (
                <>
              <Section title="Context" note="Applied when a model loads.">
                <DashSlider
                  spec={{
                    ...CONTEXT_SPEC,
                    hint: `How much conversation the model can hold at once. Bigger costs memory.${
                      status?.context_length && status.context_length !== runtime.contextLength
                        ? ` The loaded model is running at ${status.context_length.toLocaleString()}.`
                        : ""
                    }`,
                  }}
                  value={runtime.contextLength}
                  disabled={!loaded}
                  onChange={(value) => setRuntimeOption("contextLength", value)}
                />
                <ChoiceRow<KvCacheType>
                  label="KV Cache"
                  value={runtime.kvCacheType}
                  options={[
                    { value: "f16", label: "f16" },
                    { value: "q8_0", label: "q8_0" },
                    { value: "q4_0", label: "q4_0" },
                  ]}
                  hint="Precision of the stored conversation. Quantizing it fits a longer context in the same memory, for a small quality cost."
                  disabled={!loaded}
                  onChange={(value) => setRuntimeOption("kvCacheType", value)}
                />
              </Section>

              <Section
                title="Performance"
                note={
                  autoLabels.hardware
                    ? `Applied when a model loads. Detected: ${autoLabels.hardware}.`
                    : "Applied when a model loads."
                }
              >
                <AutoSlider
                  spec={GPU_LAYERS_SPEC}
                  value={runtime.gpuLayers}
                  autoValue={-1}
                  autoLabel={autoLabels.gpuLayers}
                  autoDisplay={runtimeDefaults?.gpu_available ? "all" : "cpu"}
                  manualFallback={runtimeDefaults?.gpu_available ? 32 : 0}
                  disabled={!loaded}
                  onChange={(value) => setRuntimeOption("gpuLayers", value)}
                />
                <AutoSlider
                  spec={THREADS_SPEC}
                  value={runtime.threads}
                  autoValue={0}
                  autoLabel={autoLabels.threads}
                  autoDisplay={runtimeDefaults ? String(runtimeDefaults.threads) : undefined}
                  manualFallback={runtimeDefaults?.threads ?? 4}
                  disabled={!loaded}
                  onChange={(value) => setRuntimeOption("threads", value)}
                />
                <AutoSlider
                  spec={BATCH_SPEC}
                  value={runtime.batchSize}
                  autoValue={0}
                  autoLabel="Auto — llama.cpp picks a batch size for this build."
                  autoDisplay="llama.cpp"
                  manualFallback={512}
                  disabled={!loaded}
                  onChange={(value) => setRuntimeOption("batchSize", value)}
                />
                <ChoiceRow<FlashAttentionMode>
                  label="Flash Attention"
                  value={runtime.flashAttention}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                  hint="Faster, lighter attention where the hardware supports it. Auto lets llama.cpp decide."
                  disabled={!loaded}
                  onChange={(value) => setRuntimeOption("flashAttention", value)}
                />
              </Section>

              <Section title="Advanced" note="Sampling details. Most sessions never need these.">
                <SamplingSpecs specs={ADVANCED} />
                <SeedRow value={params.seed} disabled={!loaded} onChange={(value) => setParam("seed", value)} />
              </Section>
                </>
              )}

              <Divider />

              <Tooltip text="Standing instructions sent ahead of every message in this chat — tone, role, rules the model should keep to.">
                <div style={{ opacity: loaded ? 1 : 0.4, transition: "opacity .2s ease" }}>
                  <Label>System Prompt</Label>
                  <textarea
                    className="pot-textarea"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={5}
                    disabled={!loaded}
                    aria-label="System prompt"
                  />
                </div>
              </Tooltip>

              <Divider />

              <Label>Throughput</Label>
              <div
                style={{
                  border: "1px solid var(--pot-line)",
                  borderRadius: 10,
                  padding: "12px 12px 10px",
                  background: "var(--pot-field)",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
                    <span
                      className="pot-num"
                      style={{
                        fontSize: 26,
                        fontWeight: 500,
                        letterSpacing: "-1px",
                        lineHeight: 1,
                        color: generating ? "var(--pot-ink)" : "var(--pot-faint)",
                        transition: "color .3s ease",
                      }}
                    >
                      {generating ? liveTps.toFixed(1) : (measured?.toFixed(1) ?? "0.0")}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--pot-sub)" }}>tok/s</span>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--pot-ghost)" }}>
                    {generating ? "~est" : "measured"}
                  </span>
                </div>

                {/* Brackets to match the [ ---|--- ] parameter sliders above. */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--pot-ghost)", flex: "0 0 auto" }}>[</span>
                  <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <Sparkline values={tpsHistory} height={64} live={generating} />
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--pot-ghost)", flex: "0 0 auto" }}>]</span>
                </div>

                <div
                  className="pot-num"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                    fontSize: 9.5,
                    color: "var(--pot-ghost)",
                  }}
                >
                  <span>peak {peak.toFixed(1)}</span>
                  <span>ttft {lastStats?.ttft_ms ? `${Math.round(lastStats.ttft_ms)}ms` : "—"}</span>
                  <span>
                    prompt{" "}
                    {lastStats?.prompt_tokens_per_sec ? `${lastStats.prompt_tokens_per_sec.toFixed(0)}/s` : "—"}
                  </span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <Stat k="Generations" v={formatCompact(usage?.generations_today)} />
                <Stat k="Tokens Today" v={formatCompact(usage?.tokens_today)} />
                <Stat
                  k="GPU"
                  v={
                    live?.gpu?.utilization_pct !== null && live?.gpu?.utilization_pct !== undefined
                      ? `${live.gpu.utilization_pct.toFixed(0)}%`
                      : "—"
                  }
                />
                <Stat k="VRAM" v={live?.gpu?.vram_mb ? formatBytes(live.gpu.vram_mb * 1024 * 1024) : "—"} />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
