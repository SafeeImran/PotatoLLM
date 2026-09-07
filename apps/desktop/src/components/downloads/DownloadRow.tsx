import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ProgressBar } from "../ui/ProgressBar";
import { useDownloadActions } from "../../hooks/useDownloads";
import { formatBytes, formatEta, formatSpeed } from "../../lib/format";
import type { DownloadJob } from "../../api/types";
import type { Tone } from "../ui/Badge";

const STATUS_TONE: Record<DownloadJob["status"], Tone> = {
  queued: "neutral",
  running: "accent",
  paused: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export function DownloadRow({ job }: { job: DownloadJob }) {
  const { pause, resume, cancel, retry } = useDownloadActions();

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-fg">{job.model_name}</div>
        <Badge tone={STATUS_TONE[job.status]}>{job.status}</Badge>
      </div>

      {(job.status === "running" || job.status === "paused" || job.status === "queued") && (
        <>
          <ProgressBar value={job.progress} tone={job.status === "paused" ? "warning" : "accent"} />
          <div className="flex items-center justify-between text-xs text-fg-muted">
            <span>
              {formatBytes(job.bytes_downloaded)} / {formatBytes(job.bytes_total)} ({Math.round(job.progress * 100)}%)
            </span>
            <span>
              {formatSpeed(job.speed_bps)} · ETA {formatEta(job.bytes_downloaded, job.bytes_total, job.speed_bps)}
            </span>
          </div>
        </>
      )}

      {job.status === "failed" && job.error && <div className="text-xs text-danger">{job.error}</div>}
      {job.status === "completed" && (
        <div className="text-xs text-fg-muted">{formatBytes(job.bytes_downloaded)} downloaded and verified.</div>
      )}

      <div className="flex gap-2">
        {job.status === "running" && (
          <Button size="sm" variant="secondary" onClick={() => pause.mutate(job.job_id)} disabled={pause.isPending}>
            Pause
          </Button>
        )}
        {job.status === "paused" && (
          <Button size="sm" variant="primary" onClick={() => resume.mutate(job.job_id)} disabled={resume.isPending}>
            Resume
          </Button>
        )}
        {job.status === "failed" && (
          <Button size="sm" variant="primary" onClick={() => retry.mutate(job.job_id)} disabled={retry.isPending}>
            Retry
          </Button>
        )}
        {(job.status === "running" || job.status === "paused" || job.status === "queued") && (
          <Button size="sm" variant="danger" onClick={() => cancel.mutate(job.job_id)} disabled={cancel.isPending}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
