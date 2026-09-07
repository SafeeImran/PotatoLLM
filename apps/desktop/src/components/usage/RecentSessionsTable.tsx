import type { RecentSession } from "../../api/types";
import { formatDuration, formatTimeAgo } from "../../lib/format";
import { MODEL_COLOR_OTHER } from "./modelColor";

interface RecentSessionsTableProps {
  sessions: RecentSession[];
  modelColors: Map<string, string>;
}

const COLUMNS = ["Session", "Model", "Tokens", "Duration", "Tokens / sec", "TTFT", "Time"];

export function RecentSessionsTable({ sessions, modelColors }: RecentSessionsTableProps) {
  if (sessions.length === 0) {
    return <div className="text-sm text-fg-soft">No sessions recorded yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[0.6875rem] tracking-wide text-fg-soft">
            {COLUMNS.map((col) => (
              <th key={col} className="py-2 pr-4 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.session_id} className="pot-table-row-in border-b border-border/60 last:border-0 hover:bg-surface-hover">
              <td className="py-2.5 pr-4 font-mono text-xs text-fg-secondary">Session #{s.session_id.slice(0, 6)}</td>
              <td className="py-2.5 pr-4">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: (s.model_id && modelColors.get(s.model_id)) || MODEL_COLOR_OTHER }}
                  />
                  <span className="text-fg">{s.model_name ?? "Unknown model"}</span>
                </div>
              </td>
              <td className="py-2.5 pr-4 font-mono text-fg">{s.total_tokens.toLocaleString()}</td>
              <td className="py-2.5 pr-4 font-mono text-fg-secondary">{formatDuration(s.duration_seconds)}</td>
              <td className="py-2.5 pr-4 font-mono text-fg-secondary">{s.avg_tokens_per_sec?.toFixed(0) ?? "—"}</td>
              <td className="py-2.5 pr-4 font-mono text-fg-secondary">{s.avg_ttft_seconds?.toFixed(2) ?? "—"}s</td>
              <td className="py-2.5 pr-0 font-mono text-fg-soft">{formatTimeAgo(s.last_activity_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
