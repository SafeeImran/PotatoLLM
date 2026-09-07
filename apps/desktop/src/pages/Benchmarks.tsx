import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { Input } from "../components/ui/Input";
import { Metric } from "../components/ui/Metric";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { useAvailableModels } from "../hooks/useInference";
import { useBenchmarks, useRunBenchmark } from "../hooks/useBenchmark";
import { useBuildActions } from "../hooks/useBuilds";
import { useLatestHardwareProfile } from "../hooks/useHardware";
import { classificationTone } from "../lib/potatoClassification";
import { formatBytes } from "../lib/format";
import type { BenchmarkResult } from "../api/types";

function SaveAsBuildAction({ artifactId, contextLength }: { artifactId: string; contextLength: number | null }) {
  const { create } = useBuildActions();
  const [name, setName] = useState("");

  if (create.isSuccess) {
    return <div className="text-sm text-success">Saved as build "{create.data.name}".</div>;
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Build name..."
        className="flex-1"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => create.mutate({ name: name.trim(), modelArtifactId: artifactId, contextLength: contextLength ?? undefined })}
        disabled={!name.trim() || create.isPending}
      >
        {create.isPending ? "Saving..." : "Save Build"}
      </Button>
    </div>
  );
}

function BenchmarkResultCard({ result, artifactId }: { result: BenchmarkResult; artifactId: string }) {
  const { data: profile } = useLatestHardwareProfile();

  return (
    <Card title="Benchmark Complete">
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-surface-elevated p-4 text-center">
          <div className="font-mono text-4xl font-semibold text-fg">{result.tokens_per_sec?.toFixed(1) ?? "—"}</div>
          <div className="text-xs capitalize tracking-wide text-fg-muted">tok/s generation</div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric value={result.ttft_seconds?.toFixed(2) ?? "—"} unit="s" label="TTFT" provenance="measured" />
          <Metric value={result.vram_mb ? (result.vram_mb / 1024).toFixed(1) : "—"} unit="GB" label="VRAM" provenance="measured" />
          <Metric value={result.ram_mb ? (result.ram_mb / 1024).toFixed(1) : "—"} unit="GB" label="RAM" provenance="measured" />
          <Metric value={result.gpu_util_pct?.toFixed(0) ?? "—"} unit="%" label="GPU" provenance="measured" />
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Metric value={result.prompt_tokens_per_sec?.toFixed(1) ?? "—"} unit="tok/s" label="Prompt Processing" provenance="measured" />
          <Metric value={result.cpu_util_pct?.toFixed(0) ?? "—"} unit="%" label="CPU" provenance="measured" />
          <Metric value={result.context_length ?? "—"} label="Context" />
        </div>

        {profile && (
          <div className="flex items-center justify-between border-t border-border/60 pt-3">
            <span className="text-xs capitalize tracking-wide text-fg-muted">Potato Score</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-fg">{profile.potato_score.score} / 100</span>
              <Badge tone={classificationTone(profile.potato_score.classification)}>{profile.potato_score.classification}</Badge>
            </div>
          </div>
        )}

        <div className="border-t border-border/60 pt-3">
          <SaveAsBuildAction artifactId={artifactId} contextLength={result.context_length} />
        </div>
      </div>
    </Card>
  );
}

export default function Benchmarks() {
  const { data: models } = useAvailableModels();
  const { data: history } = useBenchmarks();
  const runBenchmark = useRunBenchmark();
  const [searchParams] = useSearchParams();

  const [selectedArtifact, setSelectedArtifact] = useState(() => searchParams.get("artifact") ?? "");

  const latestResult = runBenchmark.data;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-secondary">Real, measured generation speed — not an estimate.</p>

      <Card title="Run a Benchmark">
        {!models || models.length === 0 ? (
          <EmptyState title="No downloaded models yet" description="Download a model from the Model Library first." />
        ) : (
          <div className="flex items-center gap-2">
            <Select value={selectedArtifact} onChange={(e) => setSelectedArtifact(e.target.value)} className="flex-1">
              <option value="">Select a model...</option>
              {models.map((m) => (
                <option key={m.artifact_id} value={m.artifact_id}>
                  {m.model_name} ({m.quantization}, {formatBytes(m.size_bytes)})
                </option>
              ))}
            </Select>
            <Button
              variant="potato"
              onClick={() => runBenchmark.mutate({ artifactId: selectedArtifact })}
              disabled={!selectedArtifact || runBenchmark.isPending}
            >
              {runBenchmark.isPending ? "Running..." : "Run Benchmark"}
            </Button>
          </div>
        )}
        {runBenchmark.isError && (
          <div className="mt-2 text-sm text-danger">{(runBenchmark.error as Error).message}</div>
        )}
        {runBenchmark.isPending && (
          <div className="mt-2 text-xs text-fg-muted">
            Loading model and generating a real response — this may take a moment on first load.
          </div>
        )}
      </Card>

      {latestResult && selectedArtifact && <BenchmarkResultCard result={latestResult} artifactId={selectedArtifact} />}

      <Card title="History">
        {!history || history.length === 0 ? (
          <div className="text-sm text-fg-muted">No benchmarks run yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((b) => (
              <div key={b.id} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
                <span className="text-fg-secondary">{new Date(b.created_at).toLocaleString()}</span>
                <div className="flex items-center gap-4 font-mono text-xs text-fg">
                  <span>{b.tokens_per_sec?.toFixed(1) ?? "—"} tok/s</span>
                  <span>{b.ttft_seconds?.toFixed(2) ?? "—"}s TTFT</span>
                  <Badge tone="success">Measured</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
