import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "../components/ui/Card";
import { Metric } from "../components/ui/Metric";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { hardwareApi } from "../api/hardware";
import { useLatestHardwareProfile, useLiveHardware } from "../hooks/useHardware";
import { classificationTone } from "../lib/potatoClassification";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="text-fg-secondary">{label}</span>
      <span className="font-mono text-fg">{value}</span>
    </div>
  );
}

export default function Hardware() {
  const queryClient = useQueryClient();
  const { data: profile } = useLatestHardwareProfile();
  const { data: live } = useLiveHardware();

  const rescan = useMutation({
    mutationFn: hardwareApi.scan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hardware"] });
    },
  });

  const snapshot = profile?.snapshot;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-secondary">What PotatoLLM detected on this machine.</p>
        <div className="flex items-center gap-2">
          {snapshot?.is_mock && <Badge tone="warning">Mock Data</Badge>}
          <Button variant="secondary" onClick={() => rescan.mutate()} disabled={rescan.isPending}>
            {rescan.isPending ? "Scanning..." : "Re-scan"}
          </Button>
        </div>
      </div>

      {!snapshot && <div className="text-sm text-fg-muted">No hardware profile yet — click Re-scan.</div>}

      {snapshot && profile && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="Potato Score">
              <div className="flex items-center justify-between">
                <Metric value={profile.potato_score.score} unit="/ 100" label="Score" size="lg" />
                <Badge tone={classificationTone(profile.potato_score.classification)}>
                  {profile.potato_score.classification}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-5 gap-2 text-center text-[11px] text-fg-muted">
                {Object.entries(profile.potato_score.breakdown).map(([key, val]) => (
                  <div key={key}>
                    <div className="font-mono text-fg-secondary">{val}</div>
                    <div className="capitalize">{key}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Live Monitor">
              {live ? (
                <div className="grid grid-cols-2 gap-4">
                  <Metric value={live.gpu.utilization_pct?.toFixed(0) ?? "—"} unit="%" label="GPU" provenance="measured" />
                  <Metric value={live.gpu.temp_c?.toFixed(0) ?? "—"} unit="°C" label="Temp" provenance="measured" />
                  <Metric
                    value={live.memory.total_mb && live.memory.available_mb ? ((live.memory.total_mb - live.memory.available_mb) / 1024).toFixed(1) : "—"}
                    unit="GB"
                    label="RAM Used"
                    provenance="measured"
                  />
                  <Metric value={live.gpu.vram_mb ? (live.gpu.vram_mb / 1024).toFixed(1) : "—"} unit="GB" label="VRAM Total" provenance="measured" />
                </div>
              ) : (
                <div className="text-sm text-fg-muted">Polling...</div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card title="CPU">
              <Row label="Model" value={snapshot.cpu.model} />
              <Row label="Vendor" value={snapshot.cpu.vendor} />
              <Row label="Cores / Threads" value={`${snapshot.cpu.cores ?? "—"} / ${snapshot.cpu.threads ?? "—"}`} />
              <Row label="Architecture" value={snapshot.cpu.architecture} />
              <Row label="Instruction Sets" value={snapshot.cpu.instruction_sets.join(", ") || "—"} />
            </Card>

            <Card title="GPU">
              <Row label="Vendor" value={snapshot.gpu.vendor} />
              <Row label="Model" value={snapshot.gpu.model} />
              <Row label="VRAM" value={snapshot.gpu.vram_mb ? `${(snapshot.gpu.vram_mb / 1024).toFixed(1)} GB` : "Unknown"} />
              <Row label="Driver" value={snapshot.gpu.driver_version} />
              <Row label="Backend" value={snapshot.compute_backend} />
            </Card>

            <Card title="System">
              <Row label="OS" value={`${snapshot.os_name} ${snapshot.os_version}`} />
              <Row label="RAM Total" value={snapshot.memory.total_mb ? `${(snapshot.memory.total_mb / 1024).toFixed(1)} GB` : "Unknown"} />
              <Row label="RAM Available" value={snapshot.memory.available_mb ? `${(snapshot.memory.available_mb / 1024).toFixed(1)} GB` : "Unknown"} />
              <Row label="Storage Total" value={snapshot.storage.total_gb ? `${snapshot.storage.total_gb} GB` : "Unknown"} />
              <Row label="Storage Available" value={snapshot.storage.available_gb ? `${snapshot.storage.available_gb} GB` : "Unknown"} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
