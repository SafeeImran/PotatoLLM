import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Metric } from "../components/ui/Metric";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { EmptyState } from "../components/ui/EmptyState";
import { useStorageActions, useStorageOrphans, useStoredModels, useStorageSummary } from "../hooks/useStorage";
import { formatFileSize } from "../lib/format";
import type { StorageSummary, StoredModel } from "../api/types";

const DISK_TONE = { ok: "success", low: "warning", critical: "danger" } as const;

const CATEGORIES = [
  { key: "models_bytes", label: "Models", fill: "bg-potato" },
  { key: "datasets_bytes", label: "Datasets", fill: "bg-accent" },
  { key: "attachments_bytes", label: "Attachments", fill: "bg-warning" },
  { key: "cache_bytes", label: "Cache", fill: "bg-fg-muted" },
  { key: "logs_bytes", label: "Logs", fill: "bg-border-strong" },
  { key: "database_bytes", label: "Database", fill: "bg-success" },
] as const;

/**
 * A single stacked bar of what PotatoLLM itself is using, drawn from the real
 * per-category byte counts. Deliberately not scaled to the whole drive — at a
 * few GB out of a 2 TB disk every segment would round to nothing.
 */
function UsageBreakdown({ summary }: { summary: StorageSummary }) {
  const total = summary.total_bytes;
  const segments = CATEGORIES.map((category) => ({
    ...category,
    bytes: summary[category.key],
    pct: total > 0 ? (summary[category.key] / total) * 100 : 0,
  })).filter((segment) => segment.bytes > 0);

  if (segments.length === 0) {
    return <div className="text-sm text-fg-muted">Nothing stored yet.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-elevated">
        {segments.map((segment) => (
          <div key={segment.key} className={segment.fill} style={{ width: `${segment.pct}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${segment.fill}`} />
            <span className="text-fg-secondary">{segment.label}</span>
            <span className="font-mono text-fg">{formatFileSize(segment.bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelRow({
  model,
  onDelete,
  busy,
}: {
  model: StoredModel;
  onDelete: (model: StoredModel) => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-fg">{model.model_name}</span>
          {model.quantization && <Badge>{model.quantization}</Badge>}
          {model.in_use && <Badge tone="accent">Loaded</Badge>}
          {!model.exists && <Badge tone="danger">File missing</Badge>}
          {model.status !== "verified" && <Badge tone="warning">{model.status}</Badge>}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">{model.file_path}</div>
        {model.used_by_builds.length > 0 && (
          <div className="mt-0.5 text-[11px] text-fg-muted">
            Used by {model.used_by_builds.length} build{model.used_by_builds.length === 1 ? "" : "s"}:{" "}
            {model.used_by_builds.join(", ")}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-sm text-fg-secondary">{formatFileSize(model.size_bytes)}</span>
        <Button size="sm" variant="danger" onClick={() => onDelete(model)} disabled={busy || model.in_use}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export default function Storage() {
  const { data: summary, isLoading } = useStorageSummary();
  const { data: models } = useStoredModels();
  const { data: orphans } = useStorageOrphans();
  const { deleteModel, deleteFile, purgeMissing, clearCache } = useStorageActions();

  const [pendingDelete, setPendingDelete] = useState<StoredModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  function requestDelete(model: StoredModel) {
    setError(null);
    setPendingDelete(model);
  }

  async function confirmDelete(force: boolean) {
    if (!pendingDelete) return;
    try {
      await deleteModel.mutateAsync({ artifactId: pendingDelete.artifact_id, force });
      setPendingDelete(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const diskUsedPct = summary ? (summary.disk_used_bytes / summary.disk_total_bytes) * 100 : 0;
  const untracked = orphans?.untracked_files ?? [];
  const missing = orphans?.missing_artifacts ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-fg-secondary">
          What's actually on disk in the PotatoLLM data directory, and what you can safely reclaim.
        </p>
      </div>

      {isLoading && <div className="text-sm text-fg-muted">Reading disk usage...</div>}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <Metric value={formatFileSize(summary.models_bytes)} label="Models" />
            </Card>
            <Card>
              <Metric value={formatFileSize(summary.datasets_bytes)} label="Datasets" />
            </Card>
            <Card>
              <Metric value={formatFileSize(summary.attachments_bytes)} label="Attachments" />
            </Card>
            <Card>
              <Metric value={formatFileSize(summary.total_bytes)} label="PotatoLLM Total" />
            </Card>
            <Card>
              <Metric value={`${summary.disk_free_gb} GB`} label="Free on Disk" />
            </Card>
          </div>

          <Card title="Disk">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-fg-secondary">
                  {formatFileSize(summary.disk_used_bytes)} used of {formatFileSize(summary.disk_total_bytes)}
                </span>
                <Badge tone={DISK_TONE[summary.disk_status]}>
                  {summary.disk_status === "ok"
                    ? "Healthy"
                    : summary.disk_status === "low"
                      ? `Below ${summary.low_disk_warning_gb} GB`
                      : `Below ${summary.low_disk_critical_gb} GB`}
                </Badge>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-elevated">
                <div
                  className={
                    summary.disk_status === "critical"
                      ? "h-full bg-danger"
                      : summary.disk_status === "low"
                        ? "h-full bg-warning"
                        : "h-full bg-accent"
                  }
                  style={{ width: `${diskUsedPct}%` }}
                />
              </div>
              <div className="text-[11px] text-fg-muted">
                Thresholds come from{" "}
                <Link to="/settings" className="text-accent hover:underline">
                  Settings › Storage
                </Link>
                .
              </div>
            </div>
          </Card>

          <Card title="PotatoLLM Usage">
            <UsageBreakdown summary={summary} />
          </Card>
        </>
      )}

      <Card
        title="Models on Disk"
        action={
          models && models.length > 0 ? (
            <span className="text-xs text-fg-muted">{models.length} artifact{models.length === 1 ? "" : "s"}</span>
          ) : undefined
        }
      >
        {models && models.length === 0 && (
          <EmptyState
            title="No models downloaded yet"
            description="Downloaded and quantized models show up here with what they actually cost on disk."
            action={
              <Link to="/models">
                <Button size="sm" variant="potato">
                  Browse the Model Library
                </Button>
              </Link>
            }
          />
        )}
        {models && models.length > 0 && (
          <div className="flex flex-col">
            {models.map((model) => (
              <ModelRow
                key={model.artifact_id}
                model={model}
                onDelete={requestDelete}
                busy={deleteModel.isPending}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Cleanup"
        action={
          <Button size="sm" onClick={() => clearCache.mutate()} disabled={clearCache.isPending}>
            {clearCache.isPending ? "Clearing..." : "Clear Cache"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {clearCache.isSuccess && (
            <div className="text-xs text-success">
              Freed {formatFileSize(clearCache.data.freed_bytes)} of cache.
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm text-fg">Untracked files</span>
              {untracked.length > 0 && (
                <span className="font-mono text-xs text-fg-secondary">
                  {formatFileSize(orphans?.untracked_bytes ?? 0)} reclaimable
                </span>
              )}
            </div>
            {untracked.length === 0 ? (
              <div className="text-xs text-fg-muted">
                Nothing stray in the models directory — every file belongs to a model or an active download.
              </div>
            ) : (
              <div className="flex flex-col">
                {untracked.map((file) => (
                  <div
                    key={file.file_path}
                    className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs text-fg">{file.relative_path}</span>
                        {file.is_partial_download && <Badge tone="warning">Partial download</Badge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-xs text-fg-secondary">{formatFileSize(file.size_bytes)}</span>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => deleteFile.mutate(file.file_path)}
                        disabled={deleteFile.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm text-fg">Missing model files</span>
              {missing.length > 0 && (
                <Button size="sm" onClick={() => purgeMissing.mutate()} disabled={purgeMissing.isPending}>
                  {purgeMissing.isPending ? "Purging..." : `Purge ${missing.length}`}
                </Button>
              )}
            </div>
            {missing.length === 0 ? (
              <div className="text-xs text-fg-muted">Every registered model still has its file on disk.</div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-fg-muted">
                  These models are in the database but their files are gone. Purging drops the records — and any
                  builds that can no longer run — without touching anything on disk.
                </div>
                {missing.map((entry) => (
                  <div key={entry.artifact_id} className="truncate font-mono text-[11px] text-fg-muted">
                    {entry.model_name} &middot; {entry.file_path}
                  </div>
                ))}
              </div>
            )}
          </div>

          {(deleteFile.isError || purgeMissing.isError) && (
            <div className="text-xs text-danger">
              {((deleteFile.error ?? purgeMissing.error) as Error).message}
            </div>
          )}
        </div>
      </Card>

      {summary && (
        <Card title="Directories">
          <div className="flex flex-col gap-2 text-xs text-fg-secondary">
            {(
              [
                ["Data", summary.data_dir],
                ["Models", summary.models_dir],
                ["Datasets", summary.datasets_dir],
                ["Attachments", summary.attachments_dir],
                ["Cache", summary.cache_dir],
                ["Logs", summary.logs_dir],
              ] as const
            ).map(([label, dir]) => (
              <div key={label}>
                <span className="text-fg-muted">{label}: </span>
                <span className="font-mono">{dir}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)}>
        {pendingDelete && (
          <div className="flex flex-col gap-4 p-5">
            <div>
              <h2 className="text-sm font-semibold text-fg">Delete {pendingDelete.model_name}?</h2>
              <p className="mt-1 text-xs text-fg-secondary">
                This permanently removes {formatFileSize(pendingDelete.size_bytes)} from disk. You can download it
                again later.
              </p>
            </div>

            {pendingDelete.used_by_builds.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning-muted p-3 text-xs text-fg">
                {pendingDelete.used_by_builds.length} build
                {pendingDelete.used_by_builds.length === 1 ? "" : "s"} use this model (
                {pendingDelete.used_by_builds.join(", ")}). Deleting the file makes them unrunnable, so they will be
                removed too.
              </div>
            )}

            {error && <div className="text-xs text-danger">{error}</div>}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => confirmDelete(pendingDelete.used_by_builds.length > 0)}
                disabled={deleteModel.isPending}
              >
                {deleteModel.isPending
                  ? "Deleting..."
                  : pendingDelete.used_by_builds.length > 0
                    ? "Delete model and builds"
                    : "Delete"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
