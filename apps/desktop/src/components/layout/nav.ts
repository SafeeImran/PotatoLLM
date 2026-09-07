import type { ComponentType, SVGProps } from "react";
import {
  BenchmarkIcon,
  BuildIcon,
  DashboardIcon,
  DownloadsIcon,
  FinetuneIcon,
  HardwareIcon,
  LibraryIcon,
  LogsIcon,
  OptimizeIcon,
  PlaygroundIcon,
  ProfileIcon,
  SettingsIcon,
  StorageIcon,
  UsageIcon,
} from "./icons";

export interface NavEntry {
  to: string;
  label: string;
  /** Sub-line under the header title — the prototype's `activeMeta` slot. */
  meta: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * Listed only while Developer Mode is on. These pages report on the machine
   * and the training loop rather than on the user's own work, so for everyone
   * else they are noise between Playground and Model Library.
   */
  devOnly?: boolean;
  /** Show a small Beta chip after the label. */
  beta?: boolean;
}

/**
 * The Playground is the app's face, so it owns "/" and leads the list. The rest
 * of the sections keep their spec section 5 order and their existing routes.
 */
export const PRIMARY_NAV: NavEntry[] = [
  { to: "/", label: "Playground", meta: "chat · local inference", icon: PlaygroundIcon },
  { to: "/dashboard", label: "Dashboard", meta: "your potato, at a glance", icon: DashboardIcon },
  { to: "/models", label: "Model Library", meta: "browse · download", icon: LibraryIcon },
  { to: "/optimize", label: "Optimize", meta: "quantize · convert", icon: OptimizeIcon },
  { to: "/finetune", label: "Fine-tune", meta: "datasets · training runs", icon: FinetuneIcon, devOnly: true, beta: true },
];

export const SECONDARY_NAV: NavEntry[] = [
  { to: "/hardware", label: "Hardware", meta: "detected specs", icon: HardwareIcon, devOnly: true },
  { to: "/benchmarks", label: "Benchmarks", meta: "measured throughput", icon: BenchmarkIcon, devOnly: true },
  { to: "/builds", label: "Build History", meta: "past optimizations", icon: BuildIcon },
  { to: "/storage", label: "Storage", meta: "disk · cleanup", icon: StorageIcon },
  { to: "/downloads", label: "Downloads", meta: "active transfers", icon: DownloadsIcon },
];

/**
 * Reachable, but never listed as a nav row.
 *
 * Logs open from the Playground's header and nowhere else. Usage, Profile and
 * Settings already have their own pinned icons in the sidebar footer, so a
 * second row for each was the same destination listed twice.
 *
 * These entries still exist so `navEntryFor` can title the route once you are
 * on it — a page with no nav entry would render a blank header.
 */
export const UNLISTED_NAV: NavEntry[] = [
  { to: "/usage", label: "Usage", meta: "tokens · throughput", icon: UsageIcon },
  { to: "/profile", label: "Profile", meta: "hardware · builds · score", icon: ProfileIcon },
  { to: "/settings", label: "Settings", meta: "preferences · privacy", icon: SettingsIcon },
  { to: "/logs", label: "Logs", meta: "core output", icon: LogsIcon },
];

export const ALL_NAV: NavEntry[] = [...PRIMARY_NAV, ...SECONDARY_NAV, ...UNLISTED_NAV];

/** The rows to actually show, given the Developer Mode setting. */
export function visibleNav(entries: NavEntry[], developerMode: boolean): NavEntry[] {
  return developerMode ? entries : entries.filter((entry) => !entry.devOnly);
}

export function navEntryFor(pathname: string): NavEntry | undefined {
  if (pathname === "/") return ALL_NAV[0];
  return ALL_NAV.find((entry) => entry.to !== "/" && pathname.startsWith(entry.to));
}
