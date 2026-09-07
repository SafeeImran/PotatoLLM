import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { Badge } from "../components/ui/Badge";
import { ChevronIcon } from "../components/layout/icons";
import { ProgressBar } from "../components/ui/ProgressBar";
import { EmptyState } from "../components/ui/EmptyState";
import { useModels } from "../hooks/useModels";
import { useAvailableModels } from "../hooks/useInference";
import { useDownloadForModel, useDownloadActions } from "../hooks/useDownloads";
import { useQuantizationActions, useQuantizationForSource } from "../hooks/useQuantization";
import { quantizationApi } from "../api/quantization";
import { formatBytes } from "../lib/format";
import type { QuantizationEstimate } from "../api/types";

type Mode = "beginner" | "advanced";

const PRESETS = [
  { label: "Smallest", quant: "Q3_K_M", description: "Lowest memory use, some quality loss" },
  { label: "Balanced", quant: "Q4_K_M", description: "The default most tools recommend" },
  { label: "Best Quality", quant: "Q6_K", description: "Closest to full precision, largest file" },
] as const;

const ADVANCED_QUANTS = ["Q2_K", "Q3_K_S", "Q3_K_M", "Q3_K_L", "Q4_K_S", "Q4_K_M", "Q5_K_S", "Q5_K_M", "Q6_K", "Q8_0"];

export default function Optimize() {
  const { data: allModels } = useModels();
  const { data: artifacts } = useAvailableModels();
  const { start: startQuantization, cancel: cancelQuantization } = useQuantizationActions();
  const { start: startDownload } = useDownloadActions();

  const quantizableModels = useMemo(() => allModels?.filter((m) => m.fp16_available) ?? [], [allModels]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [mode, setMode] = useState<Mode>("beginner");
  const [targetQuant, setTargetQuant] = useState("Q4_K_M");
  const [estimate, setEstimate] = useState<QuantizationEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const fp16Artifact = artifacts?.find((a) => a.model_id === selectedModelId && a.quantization === "FP16");
  const fp16DownloadJob = useDownloadForModel(selectedModelId, "fp16");
  const job = useQuantizationForSource(fp16Artifact?.artifact_id);

  useEffect(() => {
    setEstimate(null);
    setEstimateError(null);
    if (!fp16Artifact) return;
    quantizationApi
      .estimate(fp16Artifact.artifact_id, targetQuant)
      .then(setEstimate)
      .catch((err) => setEstimateError(err instanceof Error ? err.message : String(err)));
  }, [fp16Artifact, targetQuant]);

  const outputArtifact = job?.status === "completed" ? artifacts?.find((a) => a.artifact_id === job.output_artifact_id) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-secondary">Requantize a model locally with llama-quantize — real conversion, real measured output size.</p>

      <Card title="Model">
        {quantizableModels.length === 0 ? (
          <EmptyState
            title="No models support local requantization yet"
            description="This needs a full-precision (FP16) source file. Qwen2.5 0.5B and Qwen2.5-Coder 1.5B / 3B have one — see registry_data.py for why the others don't yet."
          />
        ) : (
          <Select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} className="w-full">
            <option value="">Select a model...</option>
            {quantizableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
      </Card>

      {selectedModelId && !fp16Artifact && (
        <Card title="Full-Precision Source">
          {fp16DownloadJob && fp16DownloadJob.status !== "cancelled" && fp16DownloadJob.status !== "failed" ? (
            <div className="flex flex-col gap-2">
              <ProgressBar value={fp16DownloadJob.progress} />
              <div className="text-xs text-fg-muted">
                {formatBytes(fp16DownloadJob.bytes_downloaded)} / {formatBytes(fp16DownloadJob.bytes_total)} — {fp16DownloadJob.status}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-sm text-fg-muted">Quantization needs the full-precision source downloaded first (~1.2 GB).</div>
              <Button variant="primary" onClick={() => startDownload.mutate({ modelId: selectedModelId, variant: "fp16" })}>
                Download FP16 Source
              </Button>
            </div>
          )}
        </Card>
      )}

      {fp16Artifact && (
        <>
          <Card title="Target Quantization">
            <div className="mb-3 flex gap-2">
              <Button size="sm" variant={mode === "beginner" ? "primary" : "secondary"} onClick={() => setMode("beginner")}>
                Beginner
              </Button>
              <Button size="sm" variant={mode === "advanced" ? "primary" : "secondary"} onClick={() => setMode("advanced")}>
                Advanced
              </Button>
            </div>

            {mode === "beginner" ? (
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.quant}
                    onClick={() => setTargetQuant(preset.quant)}
                    className={`rounded-md border p-3 text-left text-xs transition-colors ${
                      targetQuant === preset.quant ? "border-accent bg-accent-muted" : "border-border hover:border-border-strong"
                    }`}
                  >
                    <div className="font-medium text-fg">{preset.label}</div>
                    <div className="mt-1 text-fg-muted">{preset.description}</div>
                    <div className="mt-1 font-mono text-fg-secondary">{preset.quant}</div>
                  </button>
                ))}
              </div>
            ) : (
              <Select value={targetQuant} onChange={(e) => setTargetQuant(e.target.value)} className="w-full">
                {ADVANCED_QUANTS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </Select>
            )}
          </Card>

          <Card title="Preview">
            {estimateError && <div className="text-sm text-danger">{estimateError}</div>}
            {estimate && (
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-fg-muted">Input </span>
                  <span className="font-mono text-fg">{formatBytes(estimate.input_bytes)}</span>
                </div>
                <ChevronIcon className="shrink-0 text-fg-muted" aria-hidden="true" />
                <div>
                  <span className="text-fg-muted">Output </span>
                  <span className="font-mono text-fg">~{formatBytes(estimate.estimated_output_bytes)}</span>
                </div>
                <Badge tone="success">{estimate.estimated_savings_pct.toFixed(0)}% smaller</Badge>
                <span className="text-[10px] uppercase text-fg-muted">Estimated</span>
              </div>
            )}

            {!job && (
              <Button
                variant="potato"
                className="mt-4 w-full"
                onClick={() => startQuantization.mutate({ sourceArtifactId: fp16Artifact.artifact_id, targetQuant })}
                disabled={startQuantization.isPending || !estimate}
              >
                Quantize
              </Button>
            )}

            {job && (job.status === "queued" || job.status === "running") && (
              <div className="mt-4 flex flex-col gap-2">
                <ProgressBar value={job.progress} tone="accent" />
                <div className="flex items-center justify-between text-xs text-fg-muted">
                  <span>{Math.round(job.progress * 100)}% — {job.status}</span>
                  <button className="hover:text-danger" onClick={() => cancelQuantization.mutate(job.job_id)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {job?.status === "failed" && <div className="mt-4 text-sm text-danger">{job.error}</div>}

            {job?.status === "completed" && outputArtifact && (
              <div className="mt-4 flex flex-col gap-2 rounded-md border border-success/30 bg-success-muted p-3">
                <div className="text-sm font-medium text-fg">Optimization complete</div>
                <div className="text-xs text-fg-secondary">
                  {formatBytes(fp16Artifact.size_bytes)} to {formatBytes(outputArtifact.size_bytes)} (measured)
                </div>
                <a href="#/playground" className="mt-1">
                  <Button variant="primary" size="sm">
                    Run in Playground
                  </Button>
                </a>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
