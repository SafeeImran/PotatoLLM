import { Link } from "react-router-dom";
import { useDownloadActions, useDownloadForModel } from "../../hooks/useDownloads";
import { MakeItPotatoAction } from "./MakeItPotatoAction";
import type { CompatibilityLevel, ModelSummary } from "../../api/types";

function formatContext(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

function formatGb(mb: number): string {
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Whole-row wash on hover, standing in for the old coloured dot badge: green
 *  if it runs comfortably here, yellow with compromises, red not recommended.
 *  Kept faint (the `-muted` tokens are ~14% tints) so a long catalog doesn't
 *  turn into a traffic light. */
const ROW_HOVER: Record<CompatibilityLevel, string> = {
  GREEN: "hover:bg-success-muted",
  YELLOW: "hover:bg-warning-muted",
  RED: "hover:bg-danger-muted",
};

const LEVEL_WORD: Record<CompatibilityLevel, string> = {
  GREEN: "Runs comfortably",
  YELLOW: "Runs with compromises",
  RED: "Not recommended here",
};

/** The per-model download control, collapsed to a quiet text affordance —
 *  the row's emphasis belongs to "Quantize", not to two competing buttons.
 *  Active transfers surface in the page's own Downloading section. */
function DownloadAction({ model }: { model: ModelSummary }) {
  const job = useDownloadForModel(model.id);
  const { start, retry } = useDownloadActions();

  if (!job) {
    return (
      <button
        type="button"
        onClick={() => start.mutate({ modelId: model.id })}
        disabled={start.isPending}
        className="text-xs text-fg-secondary underline-offset-2 transition-colors hover:text-fg hover:underline disabled:opacity-40"
      >
        {start.isPending ? "Starting…" : "Download"}
      </button>
    );
  }

  if (job.status === "completed") {
    return <span className="text-xs text-success">On disk</span>;
  }

  if (job.status === "failed") {
    return (
      <button
        type="button"
        aria-label="Retry download"
        onClick={() => retry.mutate(job.job_id)}
        disabled={retry.isPending}
        className="text-xs text-danger underline-offset-2 transition-colors hover:underline disabled:opacity-40"
      >
        {retry.isPending ? "Retrying…" : "Retry"}
      </button>
    );
  }

  return (
    <Link to="/downloads" className="text-xs text-fg-secondary transition-colors hover:text-fg">
      Downloading…
    </Link>
  );
}

/** The spec card that appears on hover — what the model costs to run and what
 *  it can do, without leaving the list. */
function SpecTip({ model, level }: { model: ModelSummary; level?: CompatibilityLevel }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute left-3 top-full z-20 mt-1 w-72 origin-top-left scale-95 rounded-lg border border-border-strong bg-surface-elevated p-3 text-xs opacity-0 shadow-lg transition-all duration-100 group-hover:scale-100 group-hover:opacity-100"
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-muted">Specs</div>
      <div className="mt-0.5 text-[11px] text-fg-secondary">
        {model.family} · {model.parameter_count} · {model.architecture} · {model.license}
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">Context</dt>
          <dd className="pot-num text-fg">{formatContext(model.context_length)} tokens</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">Est. VRAM</dt>
          <dd className="pot-num text-fg">~{formatGb(model.est_vram_mb)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">Est. RAM</dt>
          <dd className="pot-num text-fg">~{formatGb(model.est_ram_mb)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">Quant</dt>
          <dd className="pot-num text-fg">{model.recommended_quantizations[0] ?? "Q4_K_M"}</dd>
        </div>
      </dl>
      <div className="mt-2.5">
        <div className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">Capabilities</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {model.capabilities.map((c) => (
            <span key={c} className="pot-tag">
              {c}
            </span>
          ))}
        </div>
      </div>
      {level && (
        <div
          className={`mt-2.5 border-t border-border pt-2 text-[11px] font-medium ${
            level === "GREEN" ? "text-success" : level === "YELLOW" ? "text-warning" : "text-danger"
          }`}
        >
          {LEVEL_WORD[level]} — estimated from your detected hardware
        </div>
      )}
    </div>
  );
}

export function ModelRow({ model, level }: { model: ModelSummary; level?: CompatibilityLevel }) {
  const vision = model.capabilities.includes("vision");

  return (
    <div
      className={`group relative flex flex-wrap items-center gap-x-5 gap-y-2.5 px-3 py-3 transition-colors sm:flex-nowrap ${
        level ? ROW_HOVER[level] : "hover:bg-surface-hover"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg" title={model.name}>
            {model.name}
          </span>
          {vision && <span className="pot-tag shrink-0">vision</span>}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-fg-muted">
          <span className="pot-num">{model.parameter_count}</span> · {model.family} · {model.license}
          <span className="sm:hidden">
            {" · "}
            <span className="pot-num">{formatContext(model.context_length)}</span> ctx · ~
            <span className="pot-num">{formatGb(model.est_vram_mb)}</span>
          </span>
        </div>
      </div>

      <div className="hidden w-14 shrink-0 text-right sm:block">
        <span className="pot-num text-xs text-fg-secondary">{formatContext(model.context_length)}</span>
      </div>
      <div className="hidden w-20 shrink-0 text-right sm:block">
        <span className="pot-num text-xs text-fg-secondary">~{formatGb(model.est_vram_mb)}</span>
      </div>

      {/* Download gets its own right-aligned slot so it never butts up against
          the VRAM figure; Quantize takes the rest. */}
      <div className="flex w-full items-center justify-end gap-5 sm:w-[300px]">
        <div className="w-24 shrink-0 text-right">
          <DownloadAction model={model} />
        </div>
        <div className="flex flex-1 justify-end">
          <MakeItPotatoAction modelId={model.id} />
        </div>
      </div>

      <SpecTip model={model} level={level} />
    </div>
  );
}
