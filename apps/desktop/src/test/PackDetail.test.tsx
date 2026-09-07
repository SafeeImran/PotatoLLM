import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PackDetail from "../pages/PackDetail";
import type { AvailableModel, PacksResponse } from "../api/types";

const INCOMPLETE_PACKS: PacksResponse = {
  packs: [
    {
      id: "featherweight",
      name: "Featherweight",
      tagline: "One model, nothing to configure.",
      description: "A single small chat model — the whole pack is one download.",
      members: [
        {
          model_id: "qwen2.5-0.5b-instruct",
          model_name: "Qwen2.5 0.5B Instruct",
          role: "primary",
          why: "Answers everything on its own.",
          parameter_count: "0.5B",
          capabilities: ["chat"],
          vision: false,
          estimated_vram_mb: 600,
          estimated_ram_mb: 900,
          downloaded: false,
        },
      ],
      missing_from_catalog: [],
      total_estimated_vram_mb: 600,
      total_estimated_ram_mb: 900,
      context_length: 32768,
      compatibility: "GREEN",
      recommended_backend: "llama.cpp",
      downloaded_count: 0,
      member_count: 1,
    },
  ],
  recommended_pack_id: "featherweight",
  has_hardware_profile: true,
  is_mock_hardware: false,
};

const COMPLETE_PACKS: PacksResponse = {
  ...INCOMPLETE_PACKS,
  packs: [
    {
      ...INCOMPLETE_PACKS.packs[0],
      members: [{ ...INCOMPLETE_PACKS.packs[0].members[0], downloaded: true }],
      downloaded_count: 1,
    },
  ],
};

const ARTIFACT: AvailableModel = {
  artifact_id: "artifact-1",
  model_id: "qwen2.5-0.5b-instruct",
  model_name: "Qwen2.5 0.5B Instruct",
  quantization: "Q4_K_M",
  size_bytes: 491_400_032,
  context_length: 32768,
  multimodal: false,
};

function renderDetail(packId: string, packs: PacksResponse, artifacts: AvailableModel[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const loadBodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/inference/load")) {
        loadBodies.push(init?.body ? JSON.parse(init.body as string) : undefined);
        return new Response(JSON.stringify({ loaded: true }), { status: 200 });
      }
      if (url.includes("/inference/available-models")) return new Response(JSON.stringify(artifacts), { status: 200 });
      if (url.includes("/packs")) return new Response(JSON.stringify(packs), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/packs/${packId}`]}>
        <Routes>
          <Route path="/packs/:packId" element={<PackDetail />} />
          <Route path="/" element={<div>Playground page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { loadBodies };
}

describe("PackDetail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows an honest empty state for a pack id that doesn't exist", async () => {
    renderDetail("does-not-exist", INCOMPLETE_PACKS);
    await waitFor(() => expect(screen.getByText("Pack not found")).toBeInTheDocument());
  });

  it("renders the pack's real details and offers to download it when incomplete", async () => {
    renderDetail("featherweight", INCOMPLETE_PACKS);

    await waitFor(() => expect(screen.getByText("Featherweight")).toBeInTheDocument());
    expect(screen.getByText("Qwen2.5 0.5B Instruct")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download pack" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load pack in Playground" })).not.toBeInTheDocument();
  });

  it("loads every downloaded member with its role, then returns to the Playground", async () => {
    const { loadBodies } = renderDetail("featherweight", COMPLETE_PACKS, [ARTIFACT]);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole("button", { name: "Load pack in Playground" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Load pack in Playground" }));

    await waitFor(() => expect(screen.getByText("Playground page")).toBeInTheDocument());
    expect(loadBodies).toEqual([{ model_artifact_id: "artifact-1", runtime: undefined, role: "primary" }]);
  });
});
