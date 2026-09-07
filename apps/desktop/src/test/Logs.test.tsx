import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Logs from "../pages/Logs";
import type { LogsResponse } from "../api/types";

const SAMPLE: LogsResponse = {
  entries: [
    { timestamp: "2026-08-28 20:00:03,012", level: "INFO", logger: "potato_core.main", message: "Recovered" },
    { timestamp: "2026-08-28 20:00:01,456", level: "WARNING", logger: "potato_core.hardware.real", message: "No NVIDIA GPU detected" },
  ],
  total_matched: 2,
  file_exists: true,
};

const EMPTY: LogsResponse = { entries: [], total_matched: 0, file_exists: false };

function renderLogs() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Logs />
    </QueryClientProvider>,
  );
}

function stubFetch(response: LogsResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/logs/info")) {
        return new Response(
          JSON.stringify({ path: "C:/potato/logs/potato-core.log", exists: response.file_exists, size_bytes: 512 }),
          { status: 200 },
        );
      }
      if (url.includes("/logs/raw")) {
        return new Response("raw log text", { status: 200 });
      }
      return new Response(JSON.stringify(response), { status: 200 });
    }),
  );
}

describe("Logs page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows an honest empty state when no log file exists", async () => {
    stubFetch(EMPTY);
    renderLogs();

    await waitFor(() =>
      expect(within(screen.getByRole("log")).getByText(/No log file yet/)).toBeInTheDocument(),
    );
  });

  it("renders real parsed log entries", async () => {
    stubFetch(SAMPLE);
    renderLogs();

    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());
    expect(screen.getByText("No NVIDIA GPU detected")).toBeInTheDocument();
    expect(screen.getByText("2 matching")).toBeInTheDocument();
  });

  it("prints each line as a terminal record — clock, level, logger, message", async () => {
    stubFetch(SAMPLE);
    renderLogs();

    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());

    // The date repeats on every line of a tail; the clock is what separates them.
    expect(screen.getByText("20:00:03.012")).toBeInTheDocument();
    expect(screen.queryByText(/2026-08-28/)).not.toBeInTheDocument();

    // Levels are plain text in the line, not badges wrapped around it. Scoped
    // to the output, since the level filter lists the same words as options.
    const level = within(screen.getByRole("log")).getByText("WARNING");
    expect(level.tagName).toBe("SPAN");
    expect(level.className).toBe("");

    expect(screen.getByText("potato_core.hardware.real")).toBeInTheDocument();
  });

  it("shows the command the pane stands in for, filters included", async () => {
    stubFetch(SAMPLE);
    renderLogs();
    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());

    expect(screen.getByText(/tail -n 500 potato-core\.log/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Log level"), { target: { value: "ERROR" } });

    await waitFor(() => expect(screen.getByText(/--level ERROR/)).toBeInTheDocument());
  });

  it("re-queries with the selected level filter", async () => {
    stubFetch(SAMPLE);
    renderLogs();
    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Log level"), { target: { value: "WARNING" } });

    await waitFor(() =>
      expect(fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        expect.stringContaining("level=WARNING"),
        expect.anything(),
      ),
    );
  });
});
