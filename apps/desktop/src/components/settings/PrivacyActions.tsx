import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { usageApi } from "../../api/usage";
import { logsApi } from "../../api/logs";
import { formatFileSize } from "../../lib/format";

/**
 * The two things "local-first" should actually let you do: delete the usage
 * history and delete the logs. Both are real deletes against real local data —
 * there is nothing to revoke on a server because nothing was ever sent to one.
 */
export function PrivacyActions() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<"usage" | "logs" | null>(null);

  const clearUsage = useMutation({
    mutationFn: usageApi.clearRecords,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["usage"] });
      setConfirming(null);
    },
  });

  const clearLogs = useMutation({
    mutationFn: logsApi.clear,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logs"] });
      queryClient.invalidateQueries({ queryKey: ["storage"] });
      setConfirming(null);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-surface-elevated p-3 text-xs text-fg-secondary">
        Everything PotatoLLM records — usage, benchmarks, logs, models — lives in your local data directory and is
        never uploaded. These actions delete it for good.
      </div>

      <div className="flex items-center justify-between gap-4 border-b border-border py-2">
        <div>
          <div className="text-sm text-fg">Usage history</div>
          <div className="text-xs text-fg-muted">
            Deletes every recorded generation. Charts and totals on the Usage page reset to zero.
          </div>
        </div>
        {confirming === "usage" ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={() => clearUsage.mutate()} disabled={clearUsage.isPending}>
              {clearUsage.isPending ? "Deleting..." : "Confirm"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="danger" className="shrink-0" onClick={() => setConfirming("usage")}>
            Delete
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-fg">Local logs</div>
          <div className="text-xs text-fg-muted">
            Deletes the log file and its rotated backups. New entries start immediately.
          </div>
        </div>
        {confirming === "logs" ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={() => clearLogs.mutate()} disabled={clearLogs.isPending}>
              {clearLogs.isPending ? "Deleting..." : "Confirm"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="danger" className="shrink-0" onClick={() => setConfirming("logs")}>
            Delete
          </Button>
        )}
      </div>

      {clearUsage.isSuccess && (
        <div className="text-xs text-success">Deleted {clearUsage.data.deleted} usage record(s).</div>
      )}
      {clearLogs.isSuccess && (
        <div className="text-xs text-success">
          Deleted {clearLogs.data.files_removed} log file(s), freeing {formatFileSize(clearLogs.data.freed_bytes)}.
        </div>
      )}
      {(clearUsage.isError || clearLogs.isError) && (
        <div className="text-xs text-danger">{((clearUsage.error ?? clearLogs.error) as Error).message}</div>
      )}
    </div>
  );
}
