import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import ModelLibrary from "../pages/ModelLibrary";
import type { ModelSummary, PacksResponse } from "../api/types";

const MODELS: ModelSummary[] = [
  {
    id: "tinyllama-1.1b-chat",
    name: "TinyLlama 1.1B Chat",
    family: "TinyLlama",
    parameter_count: "1.1B",
    architecture: "Llama",
    context_length: 2048,
    license: "Apache 2.0",
    source: "TinyLlama Project",
    model_url: "https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    supported_backends: ["llama.cpp"],
    supported_quant_formats: ["GGUF"],
    finetune_support: true,
    est_ram_mb: 1536,
    est_vram_mb: 922,
    recommended_quantizations: ["Q4_K_M"],
    description: "Tiny chat model.",
    tags: ["tiny"],
    capabilities: ["chat"],
    fp16_available: false,
  },
  {
    id: "qwen2.5-14b-instruct",
    name: "Qwen2.5 14B Instruct",
    family: "Qwen",
    parameter_count: "14B",
    architecture: "Qwen2",
    context_length: 131072,
    license: "Apache 2.0",
    source: "Alibaba Cloud",
    model_url: "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct",
    supported_backends: ["llama.cpp"],
    supported_quant_formats: ["GGUF"],
    finetune_support: true,
    est_ram_mb: 11264,
    est_vram_mb: 9216,
    recommended_quantizations: ["Q4_K_M"],
    description: "Larger Qwen model.",
    tags: ["reasoning"],
    capabilities: ["chat"],
    fp16_available: false,
  },
];

const PACKS: PacksResponse = {
  packs: [
    {
      id: "featherweight",
      name: "Featherweight",
      tagline: "Runs on almost anything",
      description: "Three small models that fit together.",
      members: [
        {
          model_id: "tinyllama-1.1b-chat",
          model_name: "TinyLlama 1.1B Chat",
          role: "primary",
          why: "Small enough to leave loaded.",
          parameter_count: "1.1B",
          capabilities: ["chat"],
          vision: false,
          estimated_vram_mb: 922,
          estimated_ram_mb: 1536,
          downloaded: false,
        },
      ],
      missing_from_catalog: [],
      total_estimated_vram_mb: 922,
      total_estimated_ram_mb: 1536,
      context_length: 4096,
      compatibility: "GREEN",
      recommended_backend: "CPU",
      downloaded_count: 0,
      member_count: 1,
    },
    {
      id: "workshop",
      name: "The Workshop",
      tagline: "Everything, if you have the memory",
      description: "A 12B generalist plus specialists.",
      members: [
        {
          model_id: "qwen2.5-14b-instruct",
          model_name: "Qwen2.5 14B Instruct",
          role: "primary",
          why: "Writes well.",
          parameter_count: "14B",
          capabilities: ["chat"],
          vision: false,
          estimated_vram_mb: 9216,
          estimated_ram_mb: 11264,
          downloaded: false,
        },
      ],
      missing_from_catalog: [],
      total_estimated_vram_mb: 9216,
      total_estimated_ram_mb: 11264,
      context_length: 4096,
      compatibility: "RED",
      recommended_backend: "CPU",
      downloaded_count: 0,
      member_count: 1,
    },
  ],
  recommended_pack_id: "featherweight",
  has_hardware_profile: true,
  is_mock_hardware: false,
};

function renderLibrary() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ModelLibrary />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ModelLibrary", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/downloads")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes("/packs")) {
          return new Response(JSON.stringify(PACKS), { status: 200 });
        }
        if (url.includes("/recommendation/")) {
          // No hardware profile in this test environment — matches the
          // real backend's honest 400 for that case (see RecommendationError).
          return new Response(JSON.stringify({ detail: "No hardware profile yet" }), { status: 400 });
        }
        return new Response(JSON.stringify(MODELS), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps packs on their own tab, priced by everything they load", async () => {
    renderLibrary();

    await userEvent.click(await screen.findByRole("tab", { name: "Packs" }));

    await waitFor(() => expect(screen.getByText("Featherweight")).toBeInTheDocument());
    expect(screen.getByText("Best for you")).toBeInTheDocument();
    // A pack is priced by everything it loads, and says so.
    expect(screen.getAllByText(/all loaded at once/).length).toBe(2);
  });

  it("says plainly when a pack will not fit", async () => {
    renderLibrary();
    await userEvent.click(await screen.findByRole("tab", { name: "Packs" }));
    await waitFor(() => expect(screen.getByText("The Workshop")).toBeInTheDocument());
    expect(screen.getByText("Too big for this machine")).toBeInTheDocument();
  });

  it("renders every model returned by the registry", async () => {
    renderLibrary();
    // Scoped to the catalog: the pack shelf above lists some of the same names.
    const catalog = await screen.findByRole("region", { name: "All models" });
    expect(within(catalog).getByText("TinyLlama 1.1B Chat")).toBeInTheDocument();
    expect(within(catalog).getByText("Qwen2.5 14B Instruct")).toBeInTheDocument();
  });

  it("filters by search text", async () => {
    renderLibrary();
    const catalog = await screen.findByRole("region", { name: "All models" });
    expect(within(catalog).getByText("TinyLlama 1.1B Chat")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search models..."), "qwen");

    // The search filters the catalog; the packs above are a separate offer and
    // are deliberately left alone.
    await waitFor(() =>
      expect(within(catalog).queryByText("TinyLlama 1.1B Chat")).not.toBeInTheDocument(),
    );
    expect(within(catalog).getByText("Qwen2.5 14B Instruct")).toBeInTheDocument();
  });

  it("offers a real Download action instead of a fake installed/compatibility state", async () => {
    renderLibrary();
    const catalog = await screen.findByRole("region", { name: "All models" });
    expect(within(catalog).getAllByRole("button", { name: "Download" }).length).toBe(2);
    expect(within(catalog).queryByText(/compatible|installed/i)).not.toBeInTheDocument();
  });

  it("links each pack's View Pack button to its own detail page", async () => {
    renderLibrary();
    await userEvent.click(await screen.findByRole("tab", { name: "Packs" }));
    await waitFor(() => expect(screen.getByText("The Workshop")).toBeInTheDocument());

    const viewButtons = screen.getAllByRole("link", { name: "View Pack →" });
    expect(viewButtons).toHaveLength(2);
    expect(viewButtons[0]).toHaveAttribute("href", "/packs/featherweight");
  });
});
