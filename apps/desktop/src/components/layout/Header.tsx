import { useLocation, useNavigate } from "react-router-dom";
import { navEntryFor } from "./nav";
import { LogsIcon } from "./icons";
import { usePlayground } from "../../playground/PlaygroundProvider";

const MONO = "var(--pot-mono)";

/**
 * The prototype's top bar. The title/meta pair tracks the route, except on the
 * Playground where it tracks the open conversation — that page is the app's
 * face, so its header should read like a chat header, not a page header.
 *
 * The light/dark toggle lives in the sidebar's Appearance & Settings popover
 * (see Sidebar.tsx's Mode row) rather than here — that keeps every appearance
 * control in one place instead of splitting Mode out to the header while Font
 * Size/Style/Theme live in the popover.
 */
export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeConversation, messages } = usePlayground();

  const entry = navEntryFor(location.pathname);
  const onPlayground = location.pathname === "/";

  const title = onPlayground ? activeConversation.title : entry?.label ?? "PotatoLLM";
  const rawMeta = onPlayground
    ? `${messages.length} ${messages.length === 1 ? "turn" : "turns"}`
    : entry?.meta ?? "";
  // Title Case, leaving the "·" separators alone.
  const meta = rawMeta.replace(/\b[a-z]/g, (c) => c.toUpperCase());

  return (
    <header
      className="pot-shell-scale"
      style={{
        height: 56,
        flex: "0 0 56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "0 18px",
        borderBottom: "1px solid var(--pot-line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: "var(--pot-nav-tracking)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </h1>
        {meta && (
          <>
            <span
              aria-hidden="true"
              style={{ fontSize: 11, color: "var(--pot-line-strong)", transform: "translateY(-1px)" }}
            >
              ·
            </span>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "var(--pot-nav-tracking)",
                color: "var(--pot-ink-soft)",
                whiteSpace: "nowrap",
              }}
            >
              {meta}
            </span>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto", whiteSpace: "nowrap" }}>
        {/* Logs belong to the Playground: they are what you reach for when a
            generation misbehaves, and nowhere else in the app is that the
            question being asked. This is the only way in. */}
        {onPlayground && (
          <button
            type="button"
            className="pot-solid-btn"
            title="Open Logs"
            onClick={() => navigate("/logs")}
          >
            <LogsIcon width={16} height={16} aria-hidden="true" />
            Logs
          </button>
        )}
      </div>
    </header>
  );
}
