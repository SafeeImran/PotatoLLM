import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { hardwareApi } from "../api/hardware";
import { settingsApi } from "../api/settings";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { classificationTone } from "../lib/potatoClassification";
import type { HardwareProfileResponse } from "../api/types";

const STEPS = [
  "Detecting CPU...",
  "Detecting GPU...",
  "Detecting VRAM...",
  "Detecting RAM...",
  "Detecting CUDA...",
  "Detecting storage...",
  "Computing Potato Score...",
];

const STEP_INTERVAL_MS = 350;

interface HardwareScanProps {
  onDone: () => void;
}

/**
 * First-launch flow (spec section 8). The detection line-by-line reveal is
 * paced for legibility — the underlying scan is one real API call; we don't
 * show its result before the sequence finishes, but we never invent numbers.
 */
export function HardwareScan({ onDone }: HardwareScanProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const queryClient = useQueryClient();

  const scan = useMutation({
    mutationFn: hardwareApi.scan,
  });

  useEffect(() => {
    scan.mutate();
    const timer = setInterval(() => {
      setStepIndex((i) => (i < STEPS.length - 1 ? i + 1 : i));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sequenceDone = stepIndex >= STEPS.length - 1;
  const result = scan.data;
  const ready = sequenceDone && Boolean(result);

  const finish = useMutation({
    mutationFn: () => settingsApi.put("onboarding_complete", true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      onDone();
    },
  });

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-bg px-6 text-fg">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-1 text-2xl font-bold tracking-tight">POTATOLLM</div>
          <div className="text-sm text-fg-secondary">Let's inspect your potato.</div>
        </div>

        {!ready && (
          <div className="flex flex-col gap-1.5 font-mono text-sm">
            {STEPS.slice(0, stepIndex + 1).map((step, i) => (
              <div key={step} className={i === stepIndex ? "text-accent" : "text-fg-muted"}>
                {step}
              </div>
            ))}
          </div>
        )}

        {ready && result && (
          <ScanResult result={result} onContinue={() => finish.mutate()} pending={finish.isPending} />
        )}

        {scan.isError && (
          <div className="mt-4 text-center text-sm text-danger">
            Couldn't reach Potato Core. Make sure it's running, then retry.
          </div>
        )}
      </div>
    </div>
  );
}

function ScanResult({
  result,
  onContinue,
  pending,
}: {
  result: HardwareProfileResponse;
  onContinue: () => void;
  pending: boolean;
}) {
  const { snapshot, potato_score } = result;
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center text-xs font-semibold capitalize tracking-widest text-fg-muted">Your Potato</div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-fg-muted">GPU</div>
          <div className="text-fg">{snapshot.gpu.model}</div>
          <div className="text-xs text-fg-secondary">
            {snapshot.gpu.vram_mb ? `${(snapshot.gpu.vram_mb / 1024).toFixed(1)} GB VRAM` : "VRAM unknown"}
          </div>
        </div>
        <div>
          <div className="text-xs text-fg-muted">CPU</div>
          <div className="text-fg">{snapshot.cpu.model}</div>
        </div>
        <div>
          <div className="text-xs text-fg-muted">RAM</div>
          <div className="text-fg">{snapshot.memory.total_mb ? `${(snapshot.memory.total_mb / 1024).toFixed(1)} GB` : "Unknown"}</div>
        </div>
        <div>
          <div className="text-xs text-fg-muted">Backend</div>
          <div className="text-fg">{snapshot.compute_backend}</div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-md border border-border bg-surface p-3">
        <div>
          <div className="text-xs capitalize tracking-wide text-fg-muted">Potato Score</div>
          <div className="font-mono text-2xl font-semibold text-fg">{potato_score.score} / 100</div>
        </div>
        <Badge tone={classificationTone(potato_score.classification)}>{potato_score.classification}</Badge>
      </div>

      {snapshot.is_mock && (
        <div className="text-center text-xs text-warning">Mock hardware data — this is not your real machine.</div>
      )}

      <Button variant="potato" size="lg" onClick={onContinue} disabled={pending} className="mt-2 w-full">
        {pending ? "Entering..." : "Enter PotatoLLM"}
      </Button>
    </div>
  );
}
