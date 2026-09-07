import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useDoctor } from "../../hooks/useDoctor";
import type { CheckStatus } from "../../api/types";

const STATUS_TONE: Record<CheckStatus, "success" | "warning" | "danger"> = {
  pass: "success",
  warn: "warning",
  fail: "danger",
};

/** Potato Doctor (spec section 55) — real probes, not hardcoded passes. */
export function DoctorPanel() {
  const { data, isLoading, isFetching, isError, refetch } = useDoctor();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-muted">Diagnoses your setup for real — GPU, CUDA, llama.cpp, storage, and more.</p>
        <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Running..." : "Run Diagnostics"}
        </Button>
      </div>

      {isLoading && <div className="text-sm text-fg-muted">Running diagnostics...</div>}
      {isError && <div className="text-sm text-danger">Couldn't reach Potato Core to run diagnostics.</div>}

      {data && (
        <div className="flex flex-col gap-2">
          {data.checks.map((check) => (
            <div key={check.name} className="flex flex-col gap-1 border-b border-border/60 py-2 last:border-0">
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg">{check.name}</span>
                <Badge tone={STATUS_TONE[check.status]}>{check.status}</Badge>
              </div>
              <div className="text-xs text-fg-secondary">{check.message}</div>
              {check.fix && <div className="text-xs text-potato-strong">Fix: {check.fix}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
