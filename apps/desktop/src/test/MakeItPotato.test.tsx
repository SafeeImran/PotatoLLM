import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { CompatibilityBadge } from "../components/models/CompatibilityBadge";
import { MakeItPotatoAction } from "../components/models/MakeItPotatoAction";
import type { MakeItPotatoResult, Recommendation } from "../api/types";

const RECOMMENDATION: Recommendation = {
  model_id: "tinyllama-1.1b-chat",
  potato_score: 46,
  potato_classification: "Capable Potato",
  recommended: {
    quantization: "Q4_K_M",
    context_length: 2048,
    estimated_vram_mb: 1024,
    estimated_ram_mb: 1536,
    compatibility: "GREEN",
    recommended_backend: "CUDA",
    recommended_gpu_offload_pct: 100,
  },
  all_options: [],
  is_mock_hardware: false,
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CompatibilityBadge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders nothing while there's no hardware profile to compare against", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "no profile" }), { status: 400 })));
    const { container } = renderWithProviders(<CompatibilityBadge modelId="tinyllama-1.1b-chat" />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("shows the real compatibility level once a recommendation is available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(RECOMMENDATION), { status: 200 })));
    renderWithProviders(<CompatibilityBadge modelId="tinyllama-1.1b-chat" />);
    await waitFor(() => expect(screen.getByText("GREEN")).toBeInTheDocument());
  });
});

describe("MakeItPotatoAction", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts idle with a single clear call to action", () => {
    renderWithProviders(<MakeItPotatoAction modelId="tinyllama-1.1b-chat" />);
    expect(screen.getByRole("button", { name: "Quantize" })).toBeInTheDocument();
  });

  it("shows real download progress while preparing, then a Run link once ready", async () => {
    const preparing: MakeItPotatoResult = {
      status: "preparing",
      step: "downloading",
      recommendation: RECOMMENDATION,
      job: { job_id: "job-1", status: "running", progress: 0.42 },
    };
    const ready: MakeItPotatoResult = {
      status: "ready",
      recommendation: RECOMMENDATION,
      artifact_id: "artifact-1",
    };

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount += 1;
        return new Response(JSON.stringify(callCount === 1 ? preparing : ready), { status: 200 });
      }),
    );

    renderWithProviders(<MakeItPotatoAction modelId="tinyllama-1.1b-chat" />);
    await userEvent.click(screen.getByRole("button", { name: "Quantize" }));

    await waitFor(() => expect(screen.getByText(/42%/)).toBeInTheDocument());
    expect(screen.getByText(/Downloading/)).toBeInTheDocument();
  });

  it("never shows a fake ready state before the backend confirms it", async () => {
    const preparing: MakeItPotatoResult = {
      status: "preparing",
      step: "quantizing",
      recommendation: RECOMMENDATION,
      job: { job_id: "job-1", status: "running", progress: 0.1 },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(preparing), { status: 200 })));

    renderWithProviders(<MakeItPotatoAction modelId="tinyllama-1.1b-chat" />);
    await userEvent.click(screen.getByRole("button", { name: "Quantize" }));

    await waitFor(() => expect(screen.getByText(/Quantizing/)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Run" })).not.toBeInTheDocument();
  });
});
