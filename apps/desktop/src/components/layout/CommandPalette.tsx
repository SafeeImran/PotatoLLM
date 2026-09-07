import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../ui/Modal";
import { useSetting } from "../../hooks/useSettings";
import {
  BenchmarkIcon,
  BuildIcon,
  DashboardIcon,
  DownloadsIcon,
  FinetuneIcon,
  HardwareIcon,
  LibraryIcon,
  OptimizeIcon,
  PlaygroundIcon,
  ProfileIcon,
  SettingsIcon,
  StorageIcon,
  UsageIcon,
} from "./icons";
import type { ComponentType, SVGProps } from "react";

interface Command {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  to: string;
  /** Offered only while Developer Mode is on, matching the sidebar. */
  devOnly?: boolean;
}

/** Command list per spec section 47 — navigation plus the named action shortcuts.
 *  The Playground leads the list and owns "/" now that it is the app's face. */
const COMMANDS: Command[] = [
  { id: "playground", label: "Open Playground", shortcut: "Ctrl+1", icon: PlaygroundIcon, to: "/" },
  { id: "dashboard", label: "Open Dashboard", shortcut: "Ctrl+2", icon: DashboardIcon, to: "/dashboard" },
  { id: "models", label: "Open Model Library", shortcut: "Ctrl+3", icon: LibraryIcon, to: "/models" },
  { id: "search-models", label: "Search Models", hint: "Model Library", icon: LibraryIcon, to: "/models" },
  { id: "make-it-potato", label: "Quantize a Model", hint: "Pick a model to auto-optimize", icon: LibraryIcon, to: "/models" },
  { id: "optimize", label: "Open Optimize", shortcut: "Ctrl+4", icon: OptimizeIcon, to: "/optimize" },
  { id: "finetune", label: "Start Fine-tuning", icon: FinetuneIcon, to: "/finetune", devOnly: true },
  { id: "usage", label: "Open Usage", shortcut: "Ctrl+5", icon: UsageIcon, to: "/usage" },
  { id: "profile", label: "Open Profile", icon: ProfileIcon, to: "/profile" },
  { id: "hardware", label: "Open Hardware", icon: HardwareIcon, to: "/hardware", devOnly: true },
  { id: "benchmark", label: "Start Benchmark", hint: "Benchmarks", icon: BenchmarkIcon, to: "/benchmarks", devOnly: true },
  { id: "builds", label: "Open Build History", icon: BuildIcon, to: "/builds" },
  { id: "storage", label: "Manage Storage", icon: StorageIcon, to: "/storage" },
  { id: "settings", label: "Open Settings", icon: SettingsIcon, to: "/settings" },
  // No Logs entry: it is reached from the Playground header only, and a
  // palette command would be a second, global way in.
  { id: "downloads", label: "Open Downloads", icon: DownloadsIcon, to: "/downloads" },
];

/** Ctrl+1..5 map to the five most-used sections (spec section 48). */
const PRIMARY_SHORTCUTS: Record<string, string> = {
  Digit1: "/",
  Digit2: "/dashboard",
  Digit3: "/models",
  Digit4: "/optimize",
  Digit5: "/usage",
};

export function CommandPalette() {
  const navigate = useNavigate();
  const developerMode = useSetting("developer_mode", false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    // Hidden from the sidebar means hidden here too — a palette that still
    // offered them would just be a second, less obvious way in.
    const available = developerMode ? COMMANDS : COMMANDS.filter((c) => !c.devOnly);
    const needle = query.trim().toLowerCase();
    if (!needle) return available;
    return available.filter(
      (c) => c.label.toLowerCase().includes(needle) || c.hint?.toLowerCase().includes(needle),
    );
  }, [query, developerMode]);

  function close() {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }

  function run(command: Command) {
    navigate(command.to);
    close();
  }

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code in PRIMARY_SHORTCUTS) {
        e.preventDefault();
        navigate(PRIMARY_SHORTCUTS[e.code]);
        return;
      }
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const command = filtered[selected];
        if (command) run(command);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, filtered, selected, navigate]);

  return (
    <Modal open={open} onClose={close} align="top">
      <div className="border-b border-border px-3 py-2.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command or search..."
          className="w-full bg-transparent text-sm text-fg placeholder:text-fg-muted focus:outline-none"
        />
      </div>
      <div className="max-h-80 overflow-y-auto p-1.5">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-fg-muted">No matching commands</div>
        )}
        {filtered.map((command, index) => {
          const IconComp = command.icon;
          const isSelected = index === selected;
          return (
            <button
              key={command.id}
              type="button"
              onMouseEnter={() => setSelected(index)}
              onClick={() => run(command)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-[var(--duration-fast)] ${
                isSelected ? "bg-accent-muted text-accent-strong" : "text-fg-secondary hover:bg-surface-hover"
              }`}
            >
              <IconComp className="shrink-0" />
              <span className="flex-1">{command.label}</span>
              {command.hint && <span className="text-xs text-fg-muted">{command.hint}</span>}
              {command.shortcut && (
                <kbd className="rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-fg-muted">
                  {command.shortcut}
                </kbd>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
