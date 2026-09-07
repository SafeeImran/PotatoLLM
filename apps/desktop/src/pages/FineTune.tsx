import { useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { Input } from "../components/ui/Input";
import { Slider } from "../components/ui/Slider";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { useModels } from "../hooks/useModels";
import { useDatasetActions, useDatasets } from "../hooks/useDatasets";
import { useHyperparameterPreview, useMLDependencies, useTrainingActions, useTrainingJobs } from "../hooks/useTraining";
import type { SliderConfig } from "../api/types";

const DEFAULT_SLIDERS: SliderConfig = {
  training_intensity: 0.5,
  learning_rate: 0.5,
  training_time: 0.5,
  model_adaptation: 0.5,
  memory_usage: 0.5,
};

function DatasetAnalysisCard({ dataset }: { dataset: NonNullable<ReturnType<typeof useDatasets>["data"]>[number] }) {
  if (dataset.example_count === null) {
    return <div className="text-sm text-danger">Analysis failed for this file — it may be corrupt or empty.</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
      <div>
        <div className="font-mono text-fg">{dataset.example_count.toLocaleString()}</div>
        <div className="text-xs text-fg-muted">Examples</div>
      </div>
      <div>
        <div className="font-mono text-fg">{dataset.estimated_tokens?.toLocaleString() ?? "—"}</div>
        <div className="text-xs text-fg-muted">Est. Tokens</div>
      </div>
      <div>
        <div className="font-mono text-fg">{dataset.avg_tokens ? Math.round(dataset.avg_tokens) : "—"}</div>
        <div className="text-xs text-fg-muted">Average</div>
      </div>
      <div>
        <div className="font-mono text-fg">{dataset.duplicate_pct ?? "—"}%</div>
        <div className="text-xs text-fg-muted">Duplicates</div>
      </div>
      <div>
        <div className={`font-mono ${(dataset.valid_pct ?? 0) < 80 ? "text-warning" : "text-fg"}`}>{dataset.valid_pct ?? "—"}%</div>
        <div className="text-xs text-fg-muted">Valid</div>
      </div>
    </div>
  );
}

export default function FineTune() {
  const { data: models } = useModels();
  const { data: datasets } = useDatasets();
  const { register } = useDatasetActions();
  const { data: mlDeps } = useMLDependencies();
  const { create, start } = useTrainingActions();
  const { data: jobs } = useTrainingJobs();

  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [sliders, setSliders] = useState<SliderConfig>(DEFAULT_SLIDERS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fineTunableModels = useMemo(() => models?.filter((m) => m.finetune_support) ?? [], [models]);
  const selectedDataset = datasets?.find((d) => d.id === selectedDatasetId);
  const { data: hyperparams } = useHyperparameterPreview(sliders);

  const activeJob = jobs?.find((j) => j.status === "queued" || j.status === "running" || j.status === "paused");

  function updateSlider(key: keyof SliderConfig, value: number) {
    setSliders((s) => ({ ...s, [key]: value }));
  }

  async function handleStartTraining() {
    const job = await create.mutateAsync({ baseModelId: selectedModelId, datasetId: selectedDatasetId, sliders });
    start.mutate(job.job_id);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-fg-secondary">Guided LoRA fine-tuning — real dataset analysis, real hyperparameters, transparently mapped from simple sliders.</p>
      </div>

      {mlDeps && !mlDeps.available && (
        <Card>
          <div className="flex items-start gap-3">
            <Badge tone="warning">Setup Needed</Badge>
            <div className="text-sm text-fg-secondary">
              Fine-tuning needs additional components that aren't installed on this machine: <span className="font-mono text-fg">{mlDeps.missing.join(", ")}</span>.
              You can still configure a training job below — starting it will show this same message until they're installed.
              <div className="mt-1 font-mono text-xs text-fg-muted">{mlDeps.install_hint}</div>
            </div>
          </div>
        </Card>
      )}

      <Card title="1. Model">
        <Select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} className="w-full">
          <option value="">Select a fine-tunable model...</option>
          {fineTunableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.parameter_count})
            </option>
          ))}
        </Select>
      </Card>

      <Card title="2. Dataset">
        <div className="flex flex-col gap-3">
          {datasets && datasets.length > 0 && (
            <Select value={selectedDatasetId} onChange={(e) => setSelectedDatasetId(e.target.value)} className="w-full">
              <option value="">Select a registered dataset...</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.format}, {d.example_count ?? "?"} examples)
                </option>
              ))}
            </Select>
          )}

          <div className="flex items-center gap-2 border-t border-border/60 pt-3">
            <Input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder="Dataset name..." className="flex-1" />
            <Input
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder="Absolute path to .jsonl/.json/.csv/.txt file..."
              className="flex-[2]"
            />
            <Button
              variant="secondary"
              onClick={() =>
                register.mutate(
                  { name: datasetName.trim(), sourcePath: sourcePath.trim() },
                  { onSuccess: (d) => setSelectedDatasetId(d.id) },
                )
              }
              disabled={!datasetName.trim() || !sourcePath.trim() || register.isPending}
            >
              {register.isPending ? "Analyzing..." : "Register"}
            </Button>
          </div>
          {register.isError && <div className="text-sm text-danger">{(register.error as Error).message}</div>}

          {selectedDataset && (
            <div className="border-t border-border/60 pt-3">
              <DatasetAnalysisCard dataset={selectedDataset} />
            </div>
          )}
        </div>
      </Card>

      <Card title="3. Configure Training">
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide" : "Show"} Advanced Settings
          </Button>
        </div>
        <div className="flex flex-col gap-4">
          <Slider label="Training Intensity (Light to Heavy)" value={sliders.training_intensity} min={0} max={1} step={0.05} onChange={(v) => updateSlider("training_intensity", v)} formatValue={(v) => v.toFixed(2)} />
          <Slider label="Learning Rate (Conservative to Aggressive)" value={sliders.learning_rate} min={0} max={1} step={0.05} onChange={(v) => updateSlider("learning_rate", v)} formatValue={(v) => v.toFixed(2)} />
          <Slider label="Training Time (Fast to Thorough)" value={sliders.training_time} min={0} max={1} step={0.05} onChange={(v) => updateSlider("training_time", v)} formatValue={(v) => v.toFixed(2)} />
          <Slider label="Model Adaptation (Low to High)" value={sliders.model_adaptation} min={0} max={1} step={0.05} onChange={(v) => updateSlider("model_adaptation", v)} formatValue={(v) => v.toFixed(2)} />
          <Slider label="Memory Usage (Low to Max)" value={sliders.memory_usage} min={0} max={1} step={0.05} onChange={(v) => updateSlider("memory_usage", v)} formatValue={(v) => v.toFixed(2)} />
        </div>

        {showAdvanced && hyperparams && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-xs md:grid-cols-5">
            <div>
              <div className="font-mono text-fg">{hyperparams.learning_rate}</div>
              <div className="text-fg-muted">Learning Rate</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.epochs}</div>
              <div className="text-fg-muted">Epochs</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.lora_rank}</div>
              <div className="text-fg-muted">LoRA Rank</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.lora_alpha}</div>
              <div className="text-fg-muted">LoRA Alpha</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.lora_dropout}</div>
              <div className="text-fg-muted">Dropout</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.batch_size}</div>
              <div className="text-fg-muted">Batch Size</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.gradient_accumulation_steps}</div>
              <div className="text-fg-muted">Grad. Accum.</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.warmup_ratio}</div>
              <div className="text-fg-muted">Warmup Ratio</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.max_seq_length}</div>
              <div className="text-fg-muted">Max Seq. Len</div>
            </div>
            <div>
              <div className="font-mono text-fg">{hyperparams.scheduler}</div>
              <div className="text-fg-muted">Scheduler</div>
            </div>
          </div>
        )}
      </Card>

      <Card title="4. Train">
        {activeJob ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-fg">{activeJob.base_model_name} on {activeJob.dataset_name}</span>
              <Badge tone={activeJob.status === "failed" ? "danger" : "neutral"}>{activeJob.status}</Badge>
            </div>
            {activeJob.error && <div className="text-sm text-danger">{activeJob.error}</div>}
          </div>
        ) : (
          <>
            <Button
              variant="potato"
              onClick={handleStartTraining}
              disabled={!selectedModelId || !selectedDatasetId || create.isPending || start.isPending}
            >
              {create.isPending || start.isPending ? "Starting..." : "Start Training"}
            </Button>
            {start.isError && <div className="mt-2 text-sm text-danger">{(start.error as Error).message}</div>}
          </>
        )}
      </Card>

      {jobs && jobs.length === 0 && !activeJob && (
        <EmptyState title="No training jobs yet" description="Configure a model and dataset above, then start training." />
      )}
    </div>
  );
}
