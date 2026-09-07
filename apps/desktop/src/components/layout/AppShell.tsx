import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { StatusBar } from "./StatusBar";
import { LiveMonitor } from "./LiveMonitor";
import { CommandPalette } from "./CommandPalette";

/**
 * Scroll/padding frame for the non-Playground pages. The Playground manages its
 * own scrolling (transcript scrolls, composer is pinned), so it renders bare.
 */
export function PageFrame() {
  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 24 }}>
      <Outlet />
    </div>
  );
}

/**
 * The shell from PotatoLLM-Playground-standalone.html: collapsible left panel,
 * title bar, routed body, status strip, and the live monitor drawer on the
 * right. Every section of the app renders inside it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [monitorOpen, setMonitorOpen] = useState(false);

  useEffect(() => {
    const toggle = () => setMonitorOpen((open) => !open);
    window.addEventListener("potato-toggle-monitor", toggle);
    return () => window.removeEventListener("potato-toggle-monitor", toggle);
  }, []);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "stretch",
        background: "var(--pot-bg)",
        color: "var(--pot-ink)",
        overflow: "hidden",
      }}
    >
      <Sidebar />

      <main
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--pot-bg)",
        }}
      >
        <Header />
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          {children}
        </div>
        <StatusBar monitorOpen={monitorOpen} onToggleMonitor={() => setMonitorOpen((o) => !o)} />
      </main>

      <LiveMonitor open={monitorOpen} onToggle={() => setMonitorOpen((o) => !o)} />
      <CommandPalette />
    </div>
  );
}
