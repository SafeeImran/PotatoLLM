export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

/**
 * Full-range byte formatter for the Storage page, where a 300-byte stray file
 * and a 30 GB model appear in the same list. `formatBytes` above is tuned for
 * model downloads and floors at MB, which would render both small files and
 * empty directories as an indistinguishable "0 MB".
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec) return "—";
  const mbps = bytesPerSec / 1024 ** 2;
  return `${mbps.toFixed(1)} MB/s`;
}

export function formatEta(bytesDownloaded: number, bytesTotal: number | null, speedBps: number | null): string {
  if (!speedBps || !bytesTotal || bytesTotal <= bytesDownloaded) return "—";
  const remaining = bytesTotal - bytesDownloaded;
  const seconds = remaining / speedBps;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${minutes}m ${secs}s`;
}

/** A session's wall-clock length, e.g. "5m 21s" or "48s" — the Usage page's
 * Recent Sessions table. `null` (no start/end pair recorded) renders "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Coarse relative time ("2m ago", "3h ago") for the Recent Sessions table —
 * one bucket, not a live-updating ticker. */
export function formatTimeAgo(iso: string | Date): string {
  // The backend always sends timezone-aware UTC datetimes, but guard against a
  // naive-looking string (no "Z"/offset) being parsed as local time instead.
  const hasZone = typeof iso !== "string" || /Z$|[+-]\d\d:\d\d$/.test(iso);
  const then = typeof iso === "string" ? new Date(hasZone ? iso : `${iso}Z`) : iso;
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
