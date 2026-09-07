import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { PRIMARY_NAV, SECONDARY_NAV, visibleNav, type NavEntry } from "./nav";
import { usePlayground, type Conversation } from "../../playground/PlaygroundProvider";
import { useUsageSummary } from "../../hooks/useUsage";
import { useLatestHardwareProfile } from "../../hooks/useHardware";
import type { HardwareSnapshot } from "../../api/types";
import { useSetting } from "../../hooks/useSettings";
import { usePotatoTheme, type PotatoTheme } from "../../hooks/usePotatoTheme";
import {
  useAppearance,
  FONT_SIZES,
  FONT_STYLES,
  COLOR_THEMES,
  type FontSize,
  type FontStyle,
  type ColorTheme,
} from "../../hooks/useAppearance";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { formatCompact } from "../../lib/spark";
import { formatBytes } from "../../lib/format";
import {
  ArchiveIcon,
  ChevronIcon,
  DotIcon,
  EraseIcon,
  FilterIcon,
  HideSidebarIcon,
  PinIcon,
  PotatoGlyph,
  SearchIcon,
  SettingsIcon,
  ThemeBakedPotatoIcon,
  ThemeMonochromaticIcon,
  TrashIcon,
  MarkIcon,
} from "./icons";

const MONO = "var(--pot-mono)";
// Default panel width. Trimmed back from the earlier 317px so the chat list
// feels like a slim rail rather than a wide dashboard column. The panel is
// user-resizable — this is only the starting point for a fresh session.
const PANEL_WIDTH_DEFAULT = 280;
const PANEL_WIDTH_MIN = 240;
const PANEL_WIDTH_MAX = 440;
const RAIL_WIDTH = 52;
// The nav icons' size — bumped past the app-wide 16px default twice now.
const NAV_ICON_SIZE = 22;

type ChatScope = "all" | "pinned" | "archived" | "active";
type ChatSort = "recent" | "oldest" | "title";

const SCOPES: { id: ChatScope; label: string }[] = [
  { id: "all", label: "All chats" },
  { id: "pinned", label: "Pinned" },
  { id: "active", label: "With messages" },
  { id: "archived", label: "Archived" },
];

const MODES: readonly PotatoTheme[] = ["light", "dark"];
const MODE_LABELS: Record<PotatoTheme, string> = { light: "Light", dark: "Dark" };
const FONT_SIZE_LABELS: Record<FontSize, string> = { sm: "Small", md: "Default", lg: "Large" };
const FONT_STYLE_LABELS: Record<FontStyle, string> = { walsheim: "Walsheim", grotesk: "Grotesk" };
const COLOR_THEME_LABELS: Record<ColorTheme, string> = { "baked-potato": "Baked Potato", monochromatic: "Monochromatic" };
const COLOR_THEME_ICONS: Record<ColorTheme, ComponentType<SVGProps<SVGSVGElement>>> = {
  "baked-potato": ThemeBakedPotatoIcon,
  monochromatic: ThemeMonochromaticIcon,
};

/** One labeled row of the appearance popover's Mode / Font Size / Font Style
 * / Theme controls. `icons`, when given, draws one small icon ahead of each
 * option's label — used only for Theme, where a swatch reads faster than
 * the name alone. */
function SegmentedRow<T extends string>({
  label,
  options,
  labels,
  icons,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  icons?: Record<T, ComponentType<SVGProps<SVGSVGElement>>>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="pot-popover-row">
      <span className="pot-popover-label" style={{ padding: 0 }}>
        {label}
      </span>
      <div className="pot-segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const Icon: ComponentType<SVGProps<SVGSVGElement>> | undefined = icons?.[option];
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={value === option}
              className="pot-segmented-btn"
              data-active={value === option}
              onClick={() => onChange(option)}
            >
              {Icon && <Icon width={13} height={13} aria-hidden="true" />}
              {labels[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SORTS: { id: ChatSort; label: string }[] = [
  { id: "recent", label: "Most recent" },
  { id: "oldest", label: "Oldest first" },
  { id: "title", label: "Title A–Z" },
];

interface Anchor {
  x: number;
  /** Distance from the top of the viewport when opening below the trigger
   * (the common case), or from the bottom when `openUpward` is set. */
  y: number;
  openUpward?: boolean;
}

/**
 * Positions a popover under a trigger, nudged left so it can't leave the
 * viewport. Flips to open *above* the trigger instead when there isn't
 * `menuHeight` worth of room below it — the account card's settings button
 * sits right at the bottom of the sidebar, so its popover opening downward
 * (the only direction this ever did before) ran off the bottom of the
 * window instead of just being clipped by a scroll container.
 */
function anchorFrom(element: HTMLElement, menuWidth = 180, menuHeight = 200): Anchor {
  const rect = element.getBoundingClientRect();
  const x = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUpward = spaceBelow < menuHeight && rect.top > spaceBelow;
  return {
    x,
    y: openUpward ? window.innerHeight - rect.top + 6 : rect.bottom + 6,
    openUpward,
  };
}

/** Shared dismissal behaviour for both popovers: outside click, Escape, scroll. */
function useDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      // The trigger is excluded so a second click on it closes rather than
      // dismissing and immediately reopening.
      if (!(e.target as HTMLElement).closest("[data-pot-popover], [data-pot-trigger]")) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    // Capture phase: the sidebar's own scroll container doesn't bubble scroll.
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open, close]);
}

function NavRow({ entry, active, index }: { entry: NavEntry; active: boolean; index: number }) {
  const Icon = entry.icon;
  return (
    <NavLink
      to={entry.to}
      end={entry.to === "/"}
      className="pot-row"
      data-active={active}
      style={{ animation: "potRowIn .3s ease both", animationDelay: `${index * 20}ms` }}
    >
      <Icon
        width={NAV_ICON_SIZE}
        height={NAV_ICON_SIZE}
        style={{ flex: `0 0 ${NAV_ICON_SIZE}px`, color: active ? "var(--pot-accent-ink)" : "var(--pot-nav-icon)" }}
      />
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          letterSpacing: "var(--pot-nav-tracking)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {entry.label}
      </span>
      {entry.beta && (
        <span className="pot-beta-badge" style={{ flex: "0 0 auto", marginLeft: "auto" }}>
          Beta
        </span>
      )}
    </NavLink>
  );
}

/** Collapsible workspace / tools group. */
function NavGroup({
  label,
  entries,
  isActive,
}: {
  label: string;
  entries: NavEntry[];
  isActive: (to: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div style={{ padding: "0 10px 10px" }}>
      <button
        type="button"
        className="pot-disclosure"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <ChevronIcon className="pot-disclosure-caret" aria-hidden="true" />
        <span className="pot-section-label">{label}</span>
      </button>
      <div className="pot-collapsible" data-open={expanded}>
        <div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
            {entries.map((entry, index) => (
              <NavRow key={entry.to} entry={entry} active={isActive(entry.to)} index={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The prototype's left panel, carrying the real app. Chats lead — they are what
 * the Playground is for — followed by the collapsible workspace and tools
 * groups, with Profile / Settings / Usage pinned to the footer.
 */
export function Sidebar() {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [scope, setScope] = useState<ChatScope>("all");
  const [sort, setSort] = useState<ChatSort>("recent");
  const [filterAnchor, setFilterAnchor] = useState<Anchor | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; anchor: Anchor } | null>(null);
  const [appearanceAnchor, setAppearanceAnchor] = useState<Anchor | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  const {
    conversations,
    activeId,
    selectConversation,
    newConversation,
    clearConversation,
    togglePin,
    toggleArchive,
    deleteConversation,
  } = usePlayground();
  const { data: usage } = useUsageSummary();
  const { data: hardware } = useLatestHardwareProfile();
  // Developer Mode decides how much of the machinery this sidebar admits to.
  const developerMode = useSetting("developer_mode", false);
  const primaryNav = visibleNav(PRIMARY_NAV, developerMode);
  const secondaryNav = visibleNav(SECONDARY_NAV, developerMode);

  const { fontSize, setFontSize, fontStyle, setFontStyle, colorTheme, setColorTheme } = useAppearance();
  const { theme, setTheme } = usePotatoTheme();
  const { width: panelWidth, startDrag: startPanelResize, dragging: resizingPanel } = useResizableWidth({
    min: PANEL_WIDTH_MIN,
    max: PANEL_WIDTH_MAX,
    defaultWidth: PANEL_WIDTH_DEFAULT,
    storageKey: "potatollm.sidebarWidth",
    edge: "right",
  });

  useDismiss(filterAnchor !== null, () => setFilterAnchor(null));
  useDismiss(rowMenu !== null, () => setRowMenu(null));
  useDismiss(appearanceAnchor !== null, () => setAppearanceAnchor(null));

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
    else setQuery("");
  }, [searchOpen]);

  const needle = query.trim().toLowerCase();

  const chats = useMemo(() => {
    const matches = conversations.filter((c) => {
      if (needle && !c.title.toLowerCase().includes(needle)) return false;
      if (scope === "archived") return Boolean(c.archived);
      if (c.archived) return false;
      if (scope === "pinned") return Boolean(c.pinned);
      if (scope === "active") return c.messages.length > 0;
      return true;
    });

    const ordered = [...matches].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "oldest") return a.updatedAt - b.updatedAt;
      return b.updatedAt - a.updatedAt;
    });

    // Pinned chats float to the top of every scope except the pinned-only one,
    // where the grouping would be meaningless.
    if (scope === "pinned") return ordered;
    return [...ordered.filter((c) => c.pinned), ...ordered.filter((c) => !c.pinned)];
  }, [conversations, needle, scope, sort]);

  const menuTarget = rowMenu ? conversations.find((c) => c.id === rowMenu.id) : undefined;
  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  const openChat = (id: string) => {
    selectConversation(id);
    navigate("/");
  };

  return (
    <>
      <aside
        className="pot-shell-scale"
        style={{
          width: open ? panelWidth : RAIL_WIDTH,
          flex: "0 0 auto",
          position: "relative",
          borderRight: "1px solid var(--pot-line)",
          background: "var(--pot-panel)",
          overflow: "hidden",
          // A live drag has to track the cursor exactly; the eased transition
          // is for the open/close toggle only, and would otherwise make the
          // panel visibly lag a couple of frames behind the mouse.
          transition: resizingPanel ? "none" : "width .34s cubic-bezier(.4,0,.2,1)",
        }}
      >
        {open && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize"
            className="pot-resize-handle"
            style={{ right: 0 }}
            onMouseDown={startPanelResize}
          />
        )}
        {/* Both trees stay mounted and cross-fade so the width transition has
            nothing reflowing underneath it. */}
        <div
          aria-hidden={open}
          style={{
            position: "absolute",
            inset: 0,
            width: RAIL_WIDTH,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            opacity: open ? 0 : 1,
            pointerEvents: open ? "none" : "auto",
            transition: "opacity .2s ease",
          }}
        >
          <div
            style={{
              height: 56,
              flex: "0 0 56px",
              display: "grid",
              placeItems: "center",
              borderBottom: "1px solid var(--pot-line)",
              width: "100%",
            }}
          >
            <button
              type="button"
              className="pot-icon-btn"
              style={{ width: 30, height: 30 }}
              title="Open side panel"
              aria-label="Open side panel"
              tabIndex={open ? -1 : 0}
              onClick={() => setOpen(true)}
            >
              {/* The flip lives on a wrapper, not the icon's own inline style —
                  .pot-icon-drawn's mount/hover animations set `transform` via
                  CSS keyframes on the <svg> itself, and a running animation's
                  keyframe value wins over an inline style for that property.
                  Flipping the icon directly used to lose the mirroring the
                  instant its entrance animation finished, leaving this
                  "reopen" button showing the same "«" as the collapse button
                  right next to it. */}
              <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
                <HideSidebarIcon width={16} height={16} aria-hidden="true" />
              </span>
            </button>
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 0" }}>
            {primaryNav.map((entry) => {
              const Icon = entry.icon;
              const active = isActive(entry.to);
              return (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  end={entry.to === "/"}
                  title={entry.label}
                  className="pot-row"
                  data-active={active}
                  tabIndex={open ? -1 : 0}
                  style={{ width: 34, justifyContent: "center", padding: "8px 0" }}
                >
                  <Icon
                    width={NAV_ICON_SIZE}
                    height={NAV_ICON_SIZE}
                    style={{ color: active ? "var(--pot-accent-ink)" : "var(--pot-nav-icon)" }}
                  />
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div
          aria-hidden={!open}
          style={{
            position: "absolute",
            inset: 0,
            width: panelWidth,
            display: "flex",
            flexDirection: "column",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: "opacity .22s ease",
          }}
        >
          <div
            style={{
              height: 56,
              flex: "0 0 56px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 10px 0 16px",
              borderBottom: "1px solid var(--pot-line)",
            }}
          >
            <div className="pot-potato-row" style={{ display: "flex", alignItems: "center", gap: 9, whiteSpace: "nowrap" }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 26,
                  height: 20,
                  fontSize: 12,
                  letterSpacing: "-.5px",
                  background: "var(--pot-inv-bg)",
                  color: "var(--pot-accent)",
                  borderRadius: 4,
                }}
              >
                <PotatoGlyph />
              </span>
              <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: "-.35px" }}>PotatoLLM</span>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: ".4px",
                  color: "var(--pot-sub)",
                  border: "1px solid var(--pot-line-strong)",
                  padding: "2px 4px",
                  borderRadius: 3,
                }}
              >
                v0.1
              </span>
            </div>
            <button
              type="button"
              className="pot-icon-btn"
              style={{ width: 30, height: 30, flex: "0 0 30px" }}
              title="Close side panel"
              aria-label="Close side panel"
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
            >
              <HideSidebarIcon width={16} height={16} aria-hidden="true" />
            </button>
          </div>

          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "14px 0 10px" }}>
            {/* Standing on its own above every group: starting a chat is the
                one action, not a destination in a section. */}
            <div style={{ padding: "0 10px 14px" }}>
              <button
                type="button"
                className="pot-row"
                data-new-chat="true"
                onClick={() => {
                  newConversation();
                  navigate("/");
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 20,
                    width: 20,
                    flex: "0 0 20px",
                    lineHeight: 1,
                    textAlign: "center",
                    color: "var(--pot-accent-ink)",
                  }}
                >
                  +
                </span>
                <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "var(--pot-nav-tracking)" }}>
                  New chat
                </span>
              </button>
            </div>

            <NavGroup label="Workspace" entries={primaryNav} isActive={isActive} />

            {/* ---- Chats ---- */}
            <div style={{ padding: "0 10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px 8px" }}>
                <span className="pot-section-label">Chats</span>
                <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: "var(--pot-faint)" }}>
                  {chats.length}
                </span>
                <button
                  type="button"
                  className="pot-icon-btn"
                  style={{
                    width: 22,
                    height: 22,
                    flex: "0 0 22px",
                    borderRadius: 6,
                    fontSize: 11,
                    background: searchOpen ? "var(--pot-accent-soft)" : undefined,
                    borderColor: searchOpen ? "var(--pot-accent-edge)" : undefined,
                  }}
                  title="Search chats"
                  aria-label="Search chats"
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen((v) => !v)}
                >
                  <SearchIcon aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="pot-icon-btn"
                  style={{
                    width: 22,
                    height: 22,
                    flex: "0 0 22px",
                    borderRadius: 6,
                    fontSize: 11,
                    background: scope !== "all" || sort !== "recent" ? "var(--pot-accent-soft)" : undefined,
                    borderColor: scope !== "all" || sort !== "recent" ? "var(--pot-accent-edge)" : undefined,
                  }}
                  data-pot-trigger
                  title="Filter chats"
                  aria-label="Filter chats"
                  aria-expanded={filterAnchor !== null}
                  onClick={(e) => {
                    // Capture the node now: React clears currentTarget once the
                    // handler returns, and the updater can run after that.
                    const trigger = e.currentTarget;
                    setFilterAnchor((current) => (current ? null : anchorFrom(trigger)));
                  }}
                >
                  <FilterIcon aria-hidden="true" />
                </button>
              </div>

              <div className="pot-collapsible" data-open={searchOpen}>
                <div>
                  <div className="pot-search" style={{ margin: "0 4px 8px" }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--pot-ghost)" }}>/</span>
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setSearchOpen(false);
                      }}
                      placeholder="search chats"
                      aria-label="Search chats"
                      tabIndex={searchOpen ? 0 : -1}
                      style={{
                        flex: "1 1 auto",
                        minWidth: 0,
                        border: 0,
                        background: "transparent",
                        fontSize: 13.5,
                        letterSpacing: "var(--pot-nav-tracking)",
                        color: "var(--pot-ink)",
                        outline: "none",
                      }}
                    />
                  </div>
                </div>
              </div>

              {(scope !== "all" || sort !== "recent") && (
                <div style={{ padding: "0 6px 6px", fontFamily: MONO, fontSize: 9.5, color: "var(--pot-faint)" }}>
                  {SCOPES.find((s) => s.id === scope)?.label} · {SORTS.find((s) => s.id === sort)?.label}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {chats.length === 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 10,
                      padding: "22px 12px",
                      textAlign: "center",
                    }}
                  >
                    <span style={{ fontSize: 22, color: "var(--pot-line-strong)" }}>(_)</span>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pot-sub)", letterSpacing: "var(--pot-nav-tracking)" }}>
                      {needle ? "No matching chats" : "No chats yet"}
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--pot-faint)", letterSpacing: "var(--pot-nav-tracking)" }}>
                      {needle
                        ? "Try a different search term."
                        : "Start a new chat and PotatoLLM will remember it here."}
                    </div>
                    {!needle && (
                      <button
                        type="button"
                        className="pot-chip-btn"
                        onClick={() => {
                          newConversation();
                          navigate("/");
                        }}
                      >
                        + New chat
                      </button>
                    )}
                  </div>
                )}
                {chats.map((conversation, index) => (
                  <ChatRow
                    key={conversation.id}
                    conversation={conversation}
                    index={index}
                    active={conversation.id === activeId && location.pathname === "/"}
                    menuOpen={rowMenu?.id === conversation.id}
                    onOpen={() => openChat(conversation.id)}
                    onMenu={(element) => {
                      const anchor = anchorFrom(element);
                      setRowMenu((current) =>
                        current?.id === conversation.id ? null : { id: conversation.id, anchor },
                      );
                    }}
                  />
                ))}
              </div>
            </div>

            <NavGroup label="Tools" entries={secondaryNav} isActive={isActive} />
          </div>

          <div style={{ flex: "0 0 auto", borderTop: "1px solid var(--pot-line)", padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <NavLink
                to="/profile"
                className="pot-potato-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flex: "1 1 auto",
                  minWidth: 0,
                  textDecoration: "none",
                  color: "inherit",
                }}
                title="Open Profile"
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    flex: "0 0 34px",
                    borderRadius: 9,
                    background: "var(--pot-inv-bg)",
                    color: "var(--pot-accent)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: ".3px",
                    fontFamily: MONO,
                  }}
                >
                  <PotatoGlyph />
                </div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "var(--pot-nav-tracking)" }}>Your Potato</div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 9.5,
                      color: "var(--pot-faint)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    <YourPotatoSubtitle hardware={hardware?.snapshot ?? null} />
                  </div>
                </div>
              </NavLink>
              <button
                type="button"
                className="pot-icon-btn"
                style={{ width: 30, height: 30, flex: "0 0 30px", fontSize: 11, borderRadius: 8 }}
                data-pot-trigger
                title="Appearance & Settings"
                aria-label="Appearance & Settings"
                aria-haspopup="menu"
                aria-expanded={appearanceAnchor !== null}
                onClick={(e) => {
                  const trigger = e.currentTarget;
                  setAppearanceAnchor((current) => (current ? null : anchorFrom(trigger, 220, 370)));
                }}
              >
                <SettingsIcon width={20} height={20} aria-hidden="true" />
              </button>
            </div>
            <NavLink
              to="/usage"
              className="pot-chip-btn"
              style={{ width: "100%", height: 34, borderRadius: 9 }}
              title="Open Usage"
            >
              <span className="pot-section-label" style={{ letterSpacing: 1.2 }}>
                Usage
              </span>
              <span style={{ flex: "1 1 auto" }} />
              <span className="pot-num" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "-.3px" }}>
                {formatCompact(usage?.tokens_today)} tok today
              </span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--pot-faint)" }}>›</span>
            </NavLink>
          </div>
        </div>
      </aside>

      {filterAnchor && (
        <div
          data-pot-popover
          data-pot-sidebar-popover
          className="pot-popover"
          role="menu"
          aria-label="Chat filters"
          style={{
            left: filterAnchor.x,
            [filterAnchor.openUpward ? "bottom" : "top"]: filterAnchor.y,
            minWidth: 190,
          }}
        >
          <div className="pot-popover-label">Show</div>
          {SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={scope === option.id}
              className="pot-popover-item"
              onClick={() => {
                setScope(option.id);
                setFilterAnchor(null);
              }}
            >
              <span className="pot-popover-item-glyph" aria-hidden="true">
                {scope === option.id ? <MarkIcon /> : null}
              </span>
              {option.label}
            </button>
          ))}
          <div className="pot-popover-sep" />
          <div className="pot-popover-label">Sort</div>
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={sort === option.id}
              className="pot-popover-item"
              onClick={() => {
                setSort(option.id);
                setFilterAnchor(null);
              }}
            >
              <span className="pot-popover-item-glyph" aria-hidden="true">
                {sort === option.id ? <MarkIcon /> : null}
              </span>
              {option.label}
            </button>
          ))}
        </div>
      )}

      {appearanceAnchor && (
        <div
          data-pot-popover
          data-pot-sidebar-popover
          className="pot-popover"
          role="menu"
          aria-label="Appearance"
          style={{
            left: appearanceAnchor.x,
            [appearanceAnchor.openUpward ? "bottom" : "top"]: appearanceAnchor.y,
            minWidth: 220,
          }}
        >
          <div className="pot-popover-label">Appearance</div>

          <SegmentedRow label="Mode" options={MODES} labels={MODE_LABELS} value={theme} onChange={setTheme} />
          <SegmentedRow label="Font Size" options={FONT_SIZES} labels={FONT_SIZE_LABELS} value={fontSize} onChange={setFontSize} />
          <SegmentedRow label="Font Style" options={FONT_STYLES} labels={FONT_STYLE_LABELS} value={fontStyle} onChange={setFontStyle} />
          <SegmentedRow
            label="Theme"
            options={COLOR_THEMES}
            labels={COLOR_THEME_LABELS}
            icons={COLOR_THEME_ICONS}
            value={colorTheme}
            onChange={setColorTheme}
          />

          <div className="pot-popover-sep" />
          <button
            type="button"
            role="menuitem"
            className="pot-popover-item"
            onClick={() => {
              setAppearanceAnchor(null);
              navigate("/settings");
            }}
          >
            <SettingsIcon className="pot-popover-item-glyph" aria-hidden="true" />
            Settings
          </button>
        </div>
      )}

      {rowMenu && menuTarget && (
        <div
          data-pot-popover
          data-pot-sidebar-popover
          className="pot-popover"
          role="menu"
          aria-label={`Actions for ${menuTarget.title}`}
          style={{
            left: rowMenu.anchor.x,
            [rowMenu.anchor.openUpward ? "bottom" : "top"]: rowMenu.anchor.y,
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="pot-popover-item"
            onClick={() => {
              togglePin(menuTarget.id);
              setRowMenu(null);
            }}
          >
            <PinIcon className="pot-popover-item-glyph" aria-hidden="true" />
            {menuTarget.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="pot-popover-item"
            title="Empty this chat but keep it in the list"
            onClick={() => {
              clearConversation(menuTarget.id);
              setRowMenu(null);
            }}
          >
            <EraseIcon className="pot-popover-item-glyph" aria-hidden="true" />
            Remove messages
          </button>
          <button
            type="button"
            role="menuitem"
            className="pot-popover-item"
            title="Hide from the list — find it again under the Archived filter"
            onClick={() => {
              toggleArchive(menuTarget.id);
              setRowMenu(null);
            }}
          >
            <ArchiveIcon className="pot-popover-item-glyph" aria-hidden="true" />
            {menuTarget.archived ? "Unarchive" : "Archive"}
          </button>
          <div className="pot-popover-sep" />
          <button
            type="button"
            role="menuitem"
            className="pot-popover-item"
            data-danger="true"
            onClick={() => {
              deleteConversation(menuTarget.id);
              setRowMenu(null);
            }}
          >
            <TrashIcon className="pot-popover-item-glyph" aria-hidden="true" />
            Delete
          </button>
        </div>
      )}
    </>
  );
}

function YourPotatoSubtitle({ hardware }: { hardware: HardwareSnapshot | null }) {
  if (!hardware) return <>no hardware scan yet</>;

  const backend = hardware.compute_backend;
  const gpu = hardware.gpu;
  const cpu = hardware.cpu;

  if (backend !== "CPU" && gpu.model) {
    const vram = gpu.vram_mb ? formatBytes(gpu.vram_mb * 1024 * 1024) : null;
    return (
      <>
        {backend} · {gpu.model}
        {vram && <> · {vram}</>}
      </>
    );
  }

  const cores = cpu.cores ? `${cpu.cores} cores` : null;
  return (
    <>
      {backend} · {cpu.model}
      {cores && <> · {cores}</>}
    </>
  );
}

function ChatRow({
  conversation,
  index,
  active,
  menuOpen,
  onOpen,
  onMenu,
}: {
  conversation: Conversation;
  index: number;
  active: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: (element: HTMLElement) => void;
}) {
  return (
    <div
      className="pot-row"
      data-active={active}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ animation: "potRowIn .3s ease both", animationDelay: `${Math.min(index * 20, 200)}ms` }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          width: 12,
          flex: "0 0 12px",
          color: conversation.pinned ? "var(--pot-accent-ink)" : "var(--pot-ghost)",
        }}
      >
        {conversation.pinned ? <PinIcon /> : <DotIcon filled={conversation.messages.length > 0} />}
      </span>
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          fontSize: 13.5,
          fontWeight: 600,
          letterSpacing: "var(--pot-nav-tracking)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontStyle: conversation.archived ? "italic" : undefined,
          color: conversation.archived ? "var(--pot-faint)" : undefined,
        }}
      >
        {conversation.title}
      </span>
      <button
        type="button"
        className="pot-row-menu"
        data-pot-trigger
        style={menuOpen ? { opacity: 1, background: "var(--pot-raised)", color: "var(--pot-ink)" } : undefined}
        title="Chat actions"
        aria-label={`Actions for ${conversation.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget);
        }}
      >
        ···
      </button>
    </div>
  );
}
