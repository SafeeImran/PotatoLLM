import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Metric } from "../components/ui/Metric";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { StatusIndicator } from "../components/ui/StatusIndicator";
import { useLatestHardwareProfile } from "../hooks/useHardware";
import { useInferenceStatus } from "../hooks/useInference";
import { useBuilds } from "../hooks/useBuilds";
import { classificationTone } from "../lib/potatoClassification";
import { formatBytes } from "../lib/format";

export default function Dashboard() {
  const { data: profile, isLoading } = useLatestHardwareProfile();
  const { data: inferenceStatus } = useInferenceStatus();
  const { data: builds } = useBuilds();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-secondary">Your potato, at a glance.</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Your Potato">
          {isLoading && <div className="text-sm text-fg-muted">Scanning...</div>}
          {!isLoading && !profile && (
            <div className="text-sm text-fg-muted">
              No hardware profile yet.{" "}
              <Link to="/hardware" className="text-accent hover:underline">
                Run a scan
              </Link>
              .
            </div>
          )}
          {profile && (
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium text-fg">{profile.snapshot.gpu.model}</div>
              <div className="text-xs text-fg-secondary">
                {profile.snapshot.gpu.vram_mb ? `${(profile.snapshot.gpu.vram_mb / 1024).toFixed(1)} GB VRAM` : "VRAM unknown"}
              </div>
              <div className="mt-1 text-xs text-fg-muted">{profile.snapshot.cpu.model}</div>
            </div>
          )}
        </Card>

        <Card title="Potato Score">
          {profile ? (
            <div className="flex items-center justify-between">
              <Metric value={profile.potato_score.score} unit="/ 100" label="Score" size="lg" />
              <Badge tone={classificationTone(profile.potato_score.classification)}>
                {profile.potato_score.classification}
              </Badge>
            </div>
          ) : (
            <div className="text-sm text-fg-muted">Run a hardware scan to see your score.</div>
          )}
        </Card>

        <Card title="Current Model">
          {inferenceStatus?.loaded ? (
            <div className="flex flex-col gap-1">
              <StatusIndicator status="running" label="MODEL RUNNING" />
              <div className="mt-1 text-sm font-medium text-fg">{inferenceStatus.model_name}</div>
              <div className="text-xs text-fg-muted">Context: {inferenceStatus.context_length?.toLocaleString()}</div>
            </div>
          ) : (
            <>
              <StatusIndicator status="offline" label="NO MODEL LOADED" />
              <div className="mt-2 text-xs text-fg-muted">
                Load one from the{" "}
                <Link to="/playground" className="text-accent hover:underline">
                  Playground
                </Link>
                .
              </div>
            </>
          )}
        </Card>
      </div>

      <Card title="Recent Builds">
        {!builds || builds.length === 0 ? (
          <div className="text-sm text-fg-muted">
            No builds yet.{" "}
            <Link to="/models" className="text-accent hover:underline">
              Quantize
            </Link>{" "}
            a model to create one.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {builds.slice(0, 5).map((b) => (
              <div key={b.id} className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                <span className="text-fg">{b.name}</span>
                <div className="flex items-center gap-3 font-mono text-xs text-fg-muted">
                  <span>{b.quantization}</span>
                  <span>{formatBytes(b.size_bytes)}</span>
                  {b.last_benchmark_tokens_per_sec && <span>{b.last_benchmark_tokens_per_sec.toFixed(1)} tok/s</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Quick Actions" padded={false} className="p-4">
        <div className="flex flex-wrap gap-2">
          <Link to="/models">
            <Button variant="potato">Quantize</Button>
          </Link>
          <Link to="/models">
            <Button variant="secondary">Model Library</Button>
          </Link>
          <Link to="/finetune">
            <Button variant="secondary">Fine-tune</Button>
          </Link>
          <Link to="/playground">
            <Button variant="secondary">Playground</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
