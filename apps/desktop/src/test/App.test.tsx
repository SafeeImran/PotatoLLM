import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../App";

function mockFetchByPath(handlers: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const body = url.pathname in handlers ? handlers[url.pathname] : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App onboarding gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the hardware scan flow when onboarding hasn't completed", async () => {
    mockFetchByPath({ "/settings": {} });
    renderApp();

    await waitFor(() => expect(screen.getByText(/Let's inspect your potato/)).toBeInTheDocument());
  });

  it("goes straight to the Playground once onboarding is complete", async () => {
    mockFetchByPath({
      "/settings": { onboarding_complete: { value: true } },
      "/hardware/latest": null,
      "/hardware/live": {
        os_name: "Windows",
        os_version: "10",
        cpu: { model: "Unknown", vendor: "Unknown", cores: null, threads: null, architecture: "Unknown", instruction_sets: [] },
        gpu: { vendor: "Unknown", model: "Unknown", vram_mb: null, driver_version: "Unknown", utilization_pct: null, temp_c: null },
        memory: { total_mb: null, available_mb: null },
        storage: { total_gb: null, available_gb: null },
        compute_backend: "Unknown",
        is_mock: false,
      },
    });
    renderApp();

    await waitFor(() => expect(screen.getByPlaceholderText(/Load a model first|Ask PotatoLLM/)).toBeInTheDocument());
    expect(screen.getByText("PotatoLLM")).toBeInTheDocument(); // sidebar brand mark
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "#/dashboard");
  });
});
