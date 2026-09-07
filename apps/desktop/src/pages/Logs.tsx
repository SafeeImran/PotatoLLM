import { useEffect, useRef, useState } from "react";
import { useLogFileInfo, useLogs } from "../hooks/useLogs";
import { logsApi } from "../api/logs";

/**
 * Potato Core's log file, rendered as the terminal it came from.
 *
 * The console styling is deliberately fixed rather than themed: a log tail is
 * one of the few surfaces where the dark-on-black convention *is* the format,
 * and level colours only read correctly against a console ground. Everything
 * else in the app follows the light/dark palette; this pane is the exception,
 * the same way an embedded terminal is in an editor.
 *
 * Levels are plain coloured text in the line, not chips. A badge is a UI
 * ornament; a log line is a record, and the record is what a terminal shows.
 */

const LEVELS = ["", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

/** GT Walsheim Condensed (the app's --pot-mono alias) is proportional, not
 * monospace, so a real monospace stack is named here instead — a log tail
 * that does not align is not a log tail. */
const MONO = 'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace';

/** Console palette, fixed to the panel rather than the app theme. */
const CONSOLE = {
  bg: "#0a0b0a",
  chrome: "#111311",
  line: "#1e221e",
  time: "#5c6b5c",
  logger: "#6f7a86",
  message: "#d3d7cf",
  prompt: "#7fbf78",
  dim: "#55625a",
};

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: "#6b7669",
  INFO: "#7fbf78",
  WARNING: "#e0b341",
  ERROR: "#e07b74",
  CRITICAL: "#ff6b6b",
};

/** Widest level word, so the message column lines up down the whole tail. */
const LEVEL_WIDTH = "CRITICAL".length;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "2026-08-28 20:00:03,012" -> "20:00:03.012". The date is the same for
 * nearly every line in a tail; the time is what distinguishes them. */
function clockOf(timestamp: string): string {
  const time = timestamp.split(" ")[1] ?? timestamp;
  return time.replace(",", ".");
}

function ConsoleButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 22,
        padding: "0 9px",
        borderRadius: 5,
        border: `1px solid ${CONSOLE.line}`,
        background: "transparent",
        color: disabled ? CONSOLE.dim : CONSOLE.message,
        fontFamily: MONO,
        fontSize: 10.5,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function Logs() {
  const [level, setLevel] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const tailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError } = useLogs({
    level: level || undefined,
    search: search || undefined,
    limit: 500,
  });
  const { data: info } = useLogFileInfo();

  async function handleCopy() {
    const raw = await logsApi.raw();
    await navigator.clipboard.writeText(raw);
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 1500);
  }

  async function handleExport() {
    const raw = await logsApi.raw();
    const blob = new Blob([raw], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "potato-core.log";
    link.click();
    URL.revokeObjectURL(url);
  }

  // The command line the pane is standing in for. Reflects the actual filters,
  // so what is on screen and what the header claims cannot drift apart.
  const command = [
    "tail -n 500",
    level ? `--level ${level}` : null,
    search ? `--grep ${JSON.stringify(search)}` : null,
    "potato-core.log",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm text-fg-secondary">
            {info?.exists ? `${info.path} — ${formatBytes(info.size_bytes)}` : "No log file yet."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            placeholder="grep…"
            aria-label="Search logs"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              width: 190,
              height: 28,
              padding: "0 10px",
              borderRadius: 6,
              border: `1px solid ${CONSOLE.line}`,
              background: CONSOLE.chrome,
              color: CONSOLE.message,
              fontFamily: MONO,
              fontSize: 11.5,
              outline: "none",
            }}
          />
          <select
            value={level}
            aria-label="Log level"
            onChange={(e) => setLevel(e.target.value)}
            style={{
              height: 28,
              padding: "0 8px",
              borderRadius: 6,
              border: `1px solid ${CONSOLE.line}`,
              background: CONSOLE.chrome,
              color: CONSOLE.message,
              fontFamily: MONO,
              fontSize: 11.5,
              outline: "none",
            }}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l} style={{ background: CONSOLE.chrome }}>
                {l ? l : "All levels"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{
          borderRadius: 10,
          border: `1px solid ${CONSOLE.line}`,
          background: CONSOLE.bg,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.03)",
        }}
      >
        {/* Window chrome: the file being tailed, and the actions on it. */}
        <div
          className="flex shrink-0 items-center gap-3"
          style={{
            height: 34,
            padding: "0 10px",
            borderBottom: `1px solid ${CONSOLE.line}`,
            background: CONSOLE.chrome,
          }}
        >
          <span style={{ display: "flex", gap: 5 }} aria-hidden="true">
            {["#3f4a3f", "#4a4a3f", "#3f4444"].map((dot) => (
              <span key={dot} style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} />
            ))}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: CONSOLE.logger }}>potato-core.log</span>
          <span className="flex-1" />
          {data && (
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: CONSOLE.dim }}>
              {data.total_matched} matching
            </span>
          )}
          <ConsoleButton onClick={handleCopy} disabled={!info?.exists}>
            {copyState === "copied" ? "copied" : "copy"}
          </ConsoleButton>
          <ConsoleButton onClick={handleExport} disabled={!info?.exists}>
            export
          </ConsoleButton>
        </div>

        <div
          ref={tailRef}
          role="log"
          aria-label="Log output"
          className="min-h-0 flex-1 overflow-auto"
          style={{
            padding: "10px 12px 14px",
            fontFamily: MONO,
            fontSize: 11.5,
            lineHeight: 1.65,
          }}
        >
          <div style={{ color: CONSOLE.prompt, marginBottom: 8 }}>
            <span style={{ color: CONSOLE.dim }}>$</span> {command}
          </div>

          {isLoading && <div style={{ color: CONSOLE.dim }}>reading…</div>}
          {isError && <div style={{ color: LEVEL_COLOR.ERROR }}>potato-core unreachable — cannot read the log file.</div>}

          {data && !data.file_exists && (
            <div style={{ color: CONSOLE.dim }}>
              No log file yet — entries appear here once Potato Core writes its first line.
            </div>
          )}

          {data && data.file_exists && data.entries.length === 0 && (
            <div style={{ color: CONSOLE.dim }}>No matching entries. Try a different filter.</div>
          )}

          {data?.entries.map((entry, i) => (
            <div key={i} style={{ display: "flex", gap: 10, whiteSpace: "pre-wrap" }}>
              <span style={{ flex: "0 0 auto", color: CONSOLE.time }}>{clockOf(entry.timestamp)}</span>
              <span
                style={{
                  flex: "0 0 auto",
                  width: `${LEVEL_WIDTH}ch`,
                  color: LEVEL_COLOR[entry.level] ?? CONSOLE.message,
                }}
              >
                {entry.level}
              </span>
              <span style={{ flex: "0 0 auto", color: CONSOLE.logger }}>{entry.logger}</span>
              <span style={{ flex: "1 1 auto", minWidth: 0, color: CONSOLE.message, wordBreak: "break-word" }}>
                {entry.message}
              </span>
            </div>
          ))}

          {data?.file_exists && (
            <div style={{ color: CONSOLE.prompt, marginTop: 6 }}>
              <span style={{ color: CONSOLE.dim }}>$</span>
              <span
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 13,
                  marginLeft: 6,
                  verticalAlign: -2,
                  background: CONSOLE.prompt,
                  animation: "potBlink 1s steps(1) infinite",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
