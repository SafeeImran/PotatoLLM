import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Builds from "../pages/Builds";
import type { Build } from "../api/types";

const SAMPLE_BUILD: Build = {
  id: "build-1",
  name: "My Qwen Build",
  base_model_id: "qwen2.5-0.5b-instruct",
  base_model_name: "Qwen2.5 0.5B Instruct",
  model_artifact_id: "artifact-1",
  quantization: "Q4_K_M",
  size_bytes: 491400032,
  backend: "llama.cpp",
  gpu_offload_layers: null,
  context_length: 2048,
  last_benchmark_tokens_per_sec: 46.1,
  created_at: "2026-08-28T00:00:00Z",
  updated_at: "2026-08-28T00:00:01Z",
};

function renderBuilds() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Builds />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Builds page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is honest when no builds are saved, rather than showing a fake card", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    renderBuilds();

    await waitFor(() => expect(screen.getByText("No builds saved yet")).toBeInTheDocument());
  });

  it("renders a real saved build with its measured last-benchmark speed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([SAMPLE_BUILD]), { status: 200 })));
    renderBuilds();

    await waitFor(() => expect(screen.getByText("My Qwen Build")).toBeInTheDocument());
    expect(screen.getByText("Qwen2.5 0.5B Instruct")).toBeInTheDocument();
    expect(screen.getByText("46.1 tok/s")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run" })).toHaveAttribute("href", "/playground?artifact=artifact-1");
  });
});
