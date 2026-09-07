import { Link } from "react-router-dom";
import { Button } from "../ui/Button";
import { ProgressBar } from "../ui/ProgressBar";
import { useMakeItPotato } from "../../hooks/useRecommendation";

const STEP_LABEL: Record<string, string> = {
  downloading: "Downloading...",
  downloading_fp16_source: "Downloading source...",
  quantizing: "Quantizing...",
};

/**
 * The signature one-click flow (spec section 14): inspects hardware +
 * model, picks the best quant this app can actually produce, and drives
 * whatever real pipeline step (download or local requantization) is still
 * needed — polling the same idempotent endpoint until the result is ready
 * to run. See engines/recommendation/service.py::make_it_potato.
 */
export function MakeItPotatoAction({ modelId }: { modelId: string }) {
  const { data, isLoading, active, start } = useMakeItPotato(modelId);

  if (!active) {
    return (
      <Button size="sm" variant="potato" onClick={start}>
        Quantize
      </Button>
    );
  }

  if (isLoading || !data) {
    return <span className="text-xs text-fg-muted">Checking your potato...</span>;
  }

  if (data.status === "ready") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-success">Ready — {data.recommendation.recommended.quantization}</span>
        <Link to={`/playground?artifact=${data.artifact_id}`}>
          <Button size="sm" variant="primary">
            Run
          </Button>
        </Link>
      </div>
    );
  }

  const job = data.job;
  const progress = typeof job?.progress === "number" ? job.progress : 0;

  return (
    <div className="flex w-full flex-col gap-1">
      <ProgressBar value={progress} tone="accent" />
      <span className="text-[11px] text-fg-muted">
        {data.step ? STEP_LABEL[data.step] : "Preparing..."} {Math.round(progress * 100)}%
      </span>
    </div>
  );
}
