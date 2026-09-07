import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Metric } from "../components/ui/Metric";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { useLatestHardwareProfile } from "../hooks/useHardware";
import { useBuilds } from "../hooks/useBuilds";
import { useUsageSummary } from "../hooks/useUsage";
import { useBenchmarks } from "../hooks/useBenchmark";
import { settingsApi } from "../api/settings";
import { classificationTone } from "../lib/potatoClassification";
import { formatBytes } from "../lib/format";

export default function Profile() {
  const { data: hardware } = useLatestHardwareProfile();
  const { data: builds } = useBuilds();
  const { data: usage } = useUsageSummary();
  const { data: benchmarks } = useBenchmarks();

  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: settingsApi.list });
  const developerMode = Boolean(settings?.developer_mode?.value);
  const toggleDeveloperMode = useMutation({
    mutationFn: () => settingsApi.put("developer_mode", !developerMode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-fg-secondary">Your hardware, your builds, and what you've actually run.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Your Potato">
          {!hardware && (
            <div className="text-sm text-fg-muted">
              No hardware profile yet.{" "}
              <Link to="/hardware" className="text-accent hover:underline">
                Run a scan
              </Link>
              .
            </div>
          )}
          {hardware && (
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium text-fg">{hardware.snapshot.gpu.model}</div>
              <div className="text-xs text-fg-secondary">{hardware.snapshot.cpu.model}</div>
              <div className="text-xs text-fg-muted">
                {hardware.snapshot.memory.total_mb ? `${(hardware.snapshot.memory.total_mb / 1024).toFixed(0)} GB RAM` : "RAM unknown"}
              </div>
            </div>
          )}
        </Card>

        <Card title="Potato Score">
          {hardware ? (
            <div className="flex items-center justify-between">
              <Metric value={hardware.potato_score.score} unit="/ 100" label="Score" size="lg" />
              <Badge tone={classificationTone(hardware.potato_score.classification)}>
                {hardware.potato_score.classification}
              </Badge>
            </div>
          ) : (
            <div className="text-sm text-fg-muted">Run a hardware scan to see your score.</div>
          )}
        </Card>

        <Card title="Tokens Generated">
          {usage && usage.total_tokens_all_time > 0 ? (
            <Metric value={usage.total_tokens_all_time.toLocaleString()} label="All-time tokens" size="lg" />
          ) : (
            <div className="text-sm text-fg-muted">
              No generations yet.{" "}
              <Link to="/playground" className="text-accent hover:underline">
                Open the Playground
              </Link>
              .
            </div>
          )}
        </Card>
      </div>

      <Card title="Downloaded &amp; Optimized Models">
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
            {builds.map((b) => (
              <div key={b.id} className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                <span className="text-fg">{b.name}</span>
                <div className="flex items-center gap-3 font-mono text-xs text-fg-muted">
                  <span>{b.quantization ?? "—"}</span>
                  <span>{formatBytes(b.size_bytes)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Benchmark History">
        {!benchmarks || benchmarks.length === 0 ? (
          <div className="text-sm text-fg-muted">
            No benchmarks run yet.{" "}
            <Link to="/benchmarks" className="text-accent hover:underline">
              Run one
            </Link>
            .
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {benchmarks.slice(0, 8).map((b) => (
              <div key={b.id} className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                <span className="text-fg-secondary">{new Date(b.created_at).toLocaleString()}</span>
                <div className="flex items-center gap-3 font-mono text-xs text-fg-muted">
                  <span>{b.backend ?? "—"}</span>
                  <span>{b.tokens_per_sec ? `${b.tokens_per_sec.toFixed(1)} tok/s` : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Preferences">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-fg">Developer Mode</div>
            <div className="text-xs text-fg-muted">Exposes diagnostics and raw technical logs.</div>
          </div>
          <Button
            variant={developerMode ? "primary" : "secondary"}
            size="sm"
            onClick={() => toggleDeveloperMode.mutate()}
          >
            {developerMode ? "On" : "Off"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
