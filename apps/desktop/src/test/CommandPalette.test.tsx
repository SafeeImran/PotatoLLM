import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { CommandPalette } from "../components/layout/CommandPalette";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

/** The palette hides the same commands the sidebar hides, so it reads the
 *  Developer Mode setting like everything else. */
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

function renderPalette() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CommandPalette />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CommandPalette", () => {
  beforeEach(() => stubSettings(false));
  afterEach(() => vi.unstubAllGlobals());

  it("is hidden until Ctrl+K is pressed", () => {
    renderPalette();
    expect(screen.queryByPlaceholderText("Type a command or search...")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("Type a command or search...")).toBeInTheDocument();
  });

  it("toggles closed on a second Ctrl+K", () => {
    renderPalette();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("Type a command or search...")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.queryByPlaceholderText("Type a command or search...")).not.toBeInTheDocument();
  });

  it("filters commands as the user types", () => {
    renderPalette();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "storage" } });

    expect(screen.getByText("Manage Storage")).toBeInTheDocument();
    expect(screen.queryByText("Open Playground")).not.toBeInTheDocument();
  });

  it("navigates and closes when a command is clicked", () => {
    renderPalette();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    fireEvent.click(screen.getByText("Open Build History"));

    expect(screen.getByTestId("path")).toHaveTextContent("/builds");
    expect(screen.queryByPlaceholderText("Type a command or search...")).not.toBeInTheDocument();
  });

  it("omits the Developer Mode commands while it is off", () => {
    renderPalette();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    for (const label of ["Open Hardware", "Start Benchmark", "Start Fine-tuning"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // Logs never appear here at all — the Playground header is the only way in.
    expect(screen.queryByText("Open Logs")).not.toBeInTheDocument();
  });

  it("offers them once Developer Mode is on", async () => {
    stubSettings(true);
    renderPalette();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    for (const label of ["Open Hardware", "Start Benchmark", "Start Fine-tuning"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it("navigates via Enter on the selected command", () => {
    renderPalette();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "Manage Storage" } });
    fireEvent.keyDown(document, { key: "Enter" });

    expect(screen.getByTestId("path")).toHaveTextContent("/storage");
  });

  it("supports Ctrl+1..5 as direct primary-nav shortcuts without opening the palette", () => {
    renderPalette();
    fireEvent.keyDown(document, { code: "Digit4", ctrlKey: true });

    expect(screen.getByTestId("path")).toHaveTextContent("/optimize");
    expect(screen.queryByPlaceholderText("Type a command or search...")).not.toBeInTheDocument();
  });
});
