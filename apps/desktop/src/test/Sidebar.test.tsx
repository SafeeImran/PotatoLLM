import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/layout/Sidebar";
import { PlaygroundProvider } from "../playground/PlaygroundProvider";

/** Settings map the sidebar reads; Developer Mode decides how much it lists. */
function stubSettings(developerMode: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/settings")) {
        return new Response(
          JSON.stringify({ developer_mode: { value: developerMode, is_default: !developerMode } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlaygroundProvider>
          <Sidebar />
        </PlaygroundProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    stubSettings(false);
  });

  it("lists the sections a normal session actually uses", () => {
    renderSidebar();

    const expectedLabels = [
      "Playground",
      "Dashboard",
      "Model Library",
      "Optimize",
      "Build History",
      "Storage",
      "Downloads",
    ];

    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("does not list Logs — it is opened from the Playground header only", () => {
    renderSidebar();
    expect(screen.queryByText("Logs")).not.toBeInTheDocument();
  });

  it("does not duplicate the pinned footer icons as nav rows", () => {
    renderSidebar();

    // Usage, Profile and Settings each already have an icon in the footer; a
    // nav row as well was the same destination listed twice. Checked as a
    // *link named exactly that* rather than a bare text match — the footer's
    // own Usage chip legitimately renders the word "Usage" as its label, and
    // a plain queryByText would flag that as if it were a duplicate nav row.
    for (const label of ["Usage", "Profile", "Settings"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("hides the machinery pages while Developer Mode is off", () => {
    renderSidebar();

    for (const label of ["Hardware", "Benchmarks", "Fine-tune"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("brings the machinery pages back with Developer Mode on", async () => {
    stubSettings(true);
    renderSidebar();

    for (const label of ["Hardware", "Benchmarks", "Fine-tune"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    // Developer Mode is not an excuse to re-list the footer icons, or Logs.
    await waitFor(() => expect(screen.queryByText("Settings")).not.toBeInTheDocument());
    expect(screen.queryByText("Logs")).not.toBeInTheDocument();
  });

  it("links the Playground item to the root route, since it is the app's face", () => {
    renderSidebar();
    expect(screen.getByText("Playground").closest("a")).toHaveAttribute("href", "/");
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/dashboard");
  });

  it("links the footer controls to Profile and Usage", () => {
    renderSidebar();
    expect(screen.getByTitle("Open Profile")).toHaveAttribute("href", "/profile");
    expect(screen.getByTitle("Open Usage")).toHaveAttribute("href", "/usage");
  });

  it("opens the appearance menu from the footer's settings button, with a Settings item leading to the real page", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.queryByRole("menu", { name: "Appearance" })).not.toBeInTheDocument();

    await user.click(screen.getByTitle("Appearance & Settings"));
    const menu = await screen.findByRole("menu", { name: "Appearance" });
    expect(menu).toBeInTheDocument();

    for (const label of ["Font Size", "Font Style", "Theme"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    const settingsItem = screen.getByRole("menuitem", { name: "Settings" });
    await user.click(settingsItem);
    expect(screen.queryByRole("menu", { name: "Appearance" })).not.toBeInTheDocument();
  });

  it("opens the appearance menu upward when the trigger sits too close to the bottom of the window", async () => {
    // The settings button lives in the account card at the very bottom of
    // the sidebar, so it — more than the sidebar's other popovers — is the
    // one that actually hits this case in practice.
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute("title") === "Appearance & Settings") {
        return { x: 10, y: 370, top: 370, bottom: 396, left: 10, right: 36, width: 26, height: 26, toJSON() {} };
      }
      return originalRect.call(this);
    };

    try {
      const user = userEvent.setup();
      renderSidebar();
      await user.click(screen.getByTitle("Appearance & Settings"));

      const menu = await screen.findByRole("menu", { name: "Appearance" });
      expect(menu.style.top).toBe("");
      expect(menu.style.bottom).not.toBe("");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });

  it("switches font size from the appearance menu, applied as an <html> data attribute", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByTitle("Appearance & Settings"));
    await user.click(screen.getByRole("radio", { name: "Large" }));

    expect(document.documentElement.dataset.potFontSize).toBe("lg");
  });

  it("switches font style between Walsheim and Grotesk, applied as an <html> data attribute", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByTitle("Appearance & Settings"));
    expect(document.documentElement.dataset.potFontFamily).toBe("walsheim");

    await user.click(screen.getByRole("radio", { name: "Grotesk" }));
    expect(document.documentElement.dataset.potFontFamily).toBe("grotesk");
  });

  it("switches the color theme between Baked Potato and Monochromatic, each option carrying its own icon", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByTitle("Appearance & Settings"));
    const themeGroup = screen.getByRole("radiogroup", { name: "Theme" });
    const bakedPotato = within(themeGroup).getByRole("radio", { name: "Baked Potato" });
    const monochromatic = within(themeGroup).getByRole("radio", { name: "Monochromatic" });

    expect(bakedPotato.querySelector("svg")).toBeInTheDocument();
    expect(monochromatic.querySelector("svg")).toBeInTheDocument();
    expect(document.documentElement.dataset.potColorTheme).toBe("baked-potato");

    await user.click(monochromatic);
    expect(document.documentElement.dataset.potColorTheme).toBe("monochromatic");
  });

  it("resizes by dragging its edge handle, and remembers the width", () => {
    renderSidebar();

    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 340 }); // +40px — dragging right grows a left-docked panel
    fireEvent.mouseUp(document);

    expect(localStorage.getItem("potatollm.sidebarWidth")).toBe("320"); // 280 default + 40
  });

  it("clamps a dragged sidebar width to its minimum", () => {
    renderSidebar();

    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: -1000 }); // way past the minimum
    fireEvent.mouseUp(document);

    expect(Number(localStorage.getItem("potatollm.sidebarWidth"))).toBe(240);
  });
});
