import type { HTMLAttributes, SVGProps } from "react";
import clsx from "clsx";

/** The Potato "(_)" mark rendered as three pieces so it can animate together
 *  when the user hovers its parent row: the parentheses close in and the
 *  underscore solidifies. Kept as text in the mono typeface so it matches the
 *  ASCII glyph the prototype already uses. */
export function PotatoGlyph({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={clsx("pot-potato-glyph", className)} aria-hidden="true" {...rest}>
      <span className="pot-potato-glyph-paren pot-potato-glyph-paren-left">(</span>
      <span className="pot-potato-glyph-underscore">_</span>
      <span className="pot-potato-glyph-paren pot-potato-glyph-paren-right">)</span>
    </span>
  );
}

/** Minimal geometric stroke icons — no icon library dependency, keeps the app offline-safe. */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      {...props}
    />
  );
}

/**
 * Base for the sketch-style nav/utility icon set — see the reference icons
 * in icons/. A small broken-line stroke plus a one-time "forming" entrance
 * (`.pot-icon-drawn`, potato.css), rather than the plain solid strokes the
 * rest of the app's small inline glyphs (search, close, chevrons, …) use.
 * Kept as its own base instead of changing `Icon` itself: a dashed 10px
 * close button reads as broken, not hand-drawn — this is for the nav-scale
 * icons the sketches actually cover.
 */
function DrawnIcon({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return <Icon className={clsx("pot-icon-drawn", className)} {...rest} />;
}

export const DashboardIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </DrawnIcon>
);

export const LibraryIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M4 4h4v16H4zM10 6h4v14h-4zM16 4h4v16h-4z" />
  </DrawnIcon>
);

export const OptimizeIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M4 12h4l2-7 4 14 2-7h4" />
  </DrawnIcon>
);

export const FinetuneIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <circle cx="6" cy="7" r="2" />
    <path d="M6 9v12M6 3v2" />
    <circle cx="12" cy="15" r="2" />
    <path d="M12 17v4M12 3v10" />
    <circle cx="18" cy="10" r="2" />
    <path d="M18 12v9M18 3v5" />
  </DrawnIcon>
);

/** A leading tick, two rising bars, and a trailing baseline — matches the
 * reference sketch's shape more closely than a plain even bar chart. */
export const UsageIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M4 5v14" />
    <path d="M9 9v10" />
    <path d="M14 6v13" />
    <path d="M14 19h6" />
  </DrawnIcon>
);

export const ProfileIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </Icon>
);

export const HardwareIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
  </DrawnIcon>
);

export const PlaygroundIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M4 4h16v12H8l-4 4z" />
  </DrawnIcon>
);

export const BenchmarkIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    <circle cx="12" cy="12" r="6" />
  </DrawnIcon>
);

export const BuildIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M12 2 3 7v10l9 5 9-5V7z" />
    <path d="M3 7l9 5 9-5M12 12v10" />
  </DrawnIcon>
);

export const StorageIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </DrawnIcon>
);

/** Three sketched slider tracks with a knob each, replacing the old gear —
 * matches the reference sketch, and reads better at 16px than a gear's teeth. */
export const SettingsIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M3 7h18" />
    <circle cx="14" cy="7" r="2" />
    <path d="M3 12h18" />
    <circle cx="8" cy="12" r="2" />
    <path d="M3 17h18" />
    <circle cx="17" cy="17" r="2" />
  </DrawnIcon>
);

/** A chevron-and-dash prompt glyph, replacing the old lined-document — echoes
 * the ">_" text Header.tsx's own Logs button already used, now the same mark
 * everywhere Logs appears. */
export const LogsIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M5 7l6 5-6 5" />
    <path d="M13 17h6" />
  </DrawnIcon>
);

export const DownloadsIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 19h16" />
  </DrawnIcon>
);

/** A speech bubble with a question mark — Header.tsx's Feedback button,
 * previously a bare ":)" text glyph. */
export const FeedbackIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    <path d="M9.8 9.6a2.2 2.2 0 1 1 3.3 1.9c-.7.4-1.1.9-1.1 1.7" />
    <circle cx="12" cy="15.4" r=".6" fill="currentColor" stroke="none" />
  </DrawnIcon>
);

/** A double chevron — Sidebar.tsx's collapse/expand rail button, previously
 * the bare "«"/"»" characters. Flip with `scaleX(-1)` for the reopen side. */
export const HideSidebarIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <path d="M15 5l-6 7 6 7" />
    <path d="M20 5l-6 7 6 7" />
  </DrawnIcon>
);

/**
 * The two Theme options in the appearance menu, drawn as the exact thing the
 * setting controls: a little app layout (a narrow sidebar column, a wider
 * main column, split by a dashed divider — same shape both icons share).
 * Baked Potato fills the sidebar column with a warm accent tint the main
 * column doesn't get; Monochromatic marks both columns the same way instead,
 * so the pair reads as "sidebar has its own color" vs. "sidebar matches
 * everywhere else" without needing a caption to explain it.
 */
export const ThemeBakedPotatoIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <rect x="4.4" y="5.4" width="3.2" height="13.2" rx="1" fill="currentColor" opacity=".4" stroke="none" />
  </DrawnIcon>
);

export const ThemeMonochromaticIcon = (p: SVGProps<SVGSVGElement>) => (
  <DrawnIcon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none" />
    <circle cx="14" cy="12" r=".9" fill="currentColor" stroke="none" />
    <circle cx="18.4" cy="12" r=".9" fill="currentColor" stroke="none" />
  </DrawnIcon>
);

export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Icon>
);

export const BoltIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
  </Icon>
);

/*
 * Shell markers, drawn rather than typed as characters (⌕ ≡ ↵ ■ ▤ ⌫ ☾ ☀ ▸ ▾ ▪)
 * — the app's single loaded face isn't guaranteed to carry box-drawing or
 * dingbat glyphs, and a character it lacks would silently fall back to some
 * other font on the system, breaking the single-typeface rule invisibly.
 */

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={13} height={13} {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M20 20l-4.8-4.8" />
  </Icon>
);

export const FilterIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={13} height={13} {...p}>
    <path d="M4 7h16M7 12h10M10 17h4" />
  </Icon>
);

export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={14} height={14} {...p}>
    <path d="M4 12h13" />
    <path d="M12 7l5 5-5 5" />
  </Icon>
);

export const StopIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={13} height={13} {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const PinIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={13} height={13} {...p}>
    <path d="M9 3h6l-1 6 3 3H7l3-3-1-6z" />
    <path d="M12 12v9" />
  </Icon>
);

export const EraseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={13} height={13} {...p}>
    <path d="M9 5h10a1 1 0 011 1v12a1 1 0 01-1 1H9l-6-7 6-7z" />
    <path d="M13 10l4 4M17 10l-4 4" />
  </Icon>
);

export const ArchiveIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={13} height={13} {...p}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8" />
    <path d="M10 12h4" />
  </Icon>
);

export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={13} height={13} {...p}>
    <path d="M4 7h16M10 4h4M9 7v13M15 7v13" />
    <path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
  </Icon>
);

export const SunIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={14} height={14} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
  </Icon>
);

export const MoonIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={14} height={14} {...p}>
    <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
  </Icon>
);

export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={12} height={12} {...p}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

/** Filled square used as the "this one is selected" marker in menus. */
export const MarkIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={10} height={10} {...p}>
    <rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none" />
  </Icon>
);

export const PaperclipIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={14} height={14} {...p}>
    <path d="M6 6l6 6a3 3 0 1 1-4.2 4.2L3.5 11.9a5 5 0 1 1 7.1-7.1l6.2 6.2" />
  </Icon>
);

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width={12} height={12} {...p}>
    <path d="M7 7l10 10M17 7L7 17" />
  </Icon>
);

/** Hollow ring for "no messages yet". */
export const DotIcon = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <Icon width={10} height={10} {...p}>
    <circle cx="12" cy="12" r="4" fill={filled ? "currentColor" : "none"} strokeWidth={2.4} />
  </Icon>
);
