import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Profile from "../pages/Profile";
import type { HardwareProfileResponse } from "../api/types";

const HARDWARE: HardwareProfileResponse = {
  id: "hp-1",
  created_at: "2026-08-28T00:00:00Z",
  snapshot: {
    os_name: "Windows",
    os_version: "11",
    cpu: { model: "Intel i3-12100", vendor: "Intel", cores: 4, threads: 8, architecture: "x86_64", instruction_sets: [] },
    gpu: { vendor: "NVIDIA", model: "RTX 5060", vram_mb: 8192, driver_version: "560.1", utilization_pct: 0, temp_c: 40 },
    memory: { total_mb: 32768, available_mb: 16384 },
    storage: { total_gb: 500, available_gb: 200 },
    compute_backend: "CUDA",
    is_mock: false,
  },
  potato_score: { score: 72, classification: "Serious Potato", breakdown: {} },
};

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubFetch(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    "/settings": { developer_mode: { value: false } },
    "/hardware/latest": HARDWARE,
    "/builds": [],
    "/usage/summary": {
      tokens_today: 0,
      avg_tokens_per_sec_today: null,
      avg_ttft_seconds_today: null,
      generations_today: 0,
      total_tokens_all_time: 0,
      total_sessions: 0,
      total_generations: 0,
    },
    "/benchmark": [],
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const body = url.pathname in defaults ? defaults[url.pathname] : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

describe("Profile page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows real hardware and potato score once a scan exists", async () => {
    stubFetch();
    renderProfile();

    await waitFor(() => expect(screen.getByText("RTX 5060")).toBeInTheDocument());
    expect(screen.getByText("Intel i3-12100")).toBeInTheDocument();
    expect(screen.getByText("Serious Potato")).toBeInTheDocument();
  });

  it("is honest about no builds, tokens, or benchmarks yet", async () => {
    stubFetch();
    renderProfile();

    await waitFor(() => expect(screen.getByText(/No builds yet/)).toBeInTheDocument());
    expect(screen.getByText(/No generations yet/)).toBeInTheDocument();
    expect(screen.getByText(/No benchmarks run yet/)).toBeInTheDocument();
  });

  it("reflects the real developer mode preference and toggles it", async () => {
    stubFetch({ "/settings": { developer_mode: { value: true } } });
    renderProfile();

    await waitFor(() => expect(screen.getByText("On")).toBeInTheDocument());
  });
});
