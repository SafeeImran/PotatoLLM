import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Playground from "../pages/Playground";
import { PlaygroundProvider } from "../playground/PlaygroundProvider";
import type { AvailableModel, InferenceStatus } from "../api/types";

const MODELS: AvailableModel[] = [
  {
    artifact_id: "artifact-1",
    model_id: "qwen2.5-0.5b-instruct",
    model_name: "Qwen2.5 0.5B Instruct",
    quantization: "Q4_K_M",
    size_bytes: 491_400_032,
    context_length: 32768,
    multimodal: false,
  },
];

const UNLOADED_STATUS: InferenceStatus = {
  loaded: false,
  model_artifact_id: null,
  model_name: null,
  context_length: null,
  multimodal: false,
};

/** Body of the last /inference/generate call, for asserting on sampling params. */
let generateBody: Record<string, unknown> | null = null;

function stubFetch(status: InferenceStatus) {
  generateBody = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/inference/generate")) {
        generateBody = JSON.parse(String(init?.body));
        return new Response(['{"delta":"hi"}', '{"done":true,"stats":{}}', ""].join("\n"), { status: 200 });
      }
      if (url.includes("/inference/available-models")) {
        return new Response(JSON.stringify(MODELS), { status: 200 });
      }
      if (url.includes("/inference/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

function renderPlayground() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlaygroundProvider>
          <Playground />
        </PlaygroundProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Playground", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("prompts to load a model rather than showing a fake chat", async () => {
    stubFetch(UNLOADED_STATUS);
    renderPlayground();

    await waitFor(() => expect(screen.getByText("Load a model to start chatting")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("Load a model first")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("offers the downloaded models in the composer's model panel", async () => {
    stubFetch(UNLOADED_STATUS);
    renderPlayground();

    await userEvent.click(screen.getByTitle("Model selector"));

    await waitFor(() => expect(screen.getByText("Qwen2.5 0.5B Instruct")).toBeInTheDocument());
    expect(screen.getByText("Q4_K_M · 32,768 ctx · 469 MB")).toBeInTheDocument();
    // Nothing is loaded yet, so the only offer is to load a first model.
    expect(screen.getByText("LOAD A MODEL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load" })).toBeInTheDocument();
  });

  it("enables the composer once a model is loaded", async () => {
    stubFetch({
      loaded: true,
      model_artifact_id: "artifact-1",
      model_name: "Qwen2.5 0.5B Instruct",
      context_length: 32768,
      multimodal: false,
    });
    renderPlayground();

    const box = await screen.findByPlaceholderText("Ask PotatoLLM anything");
    expect(box).not.toBeDisabled();

    await userEvent.type(box, "hello");
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("sends the full sampling set, not just the four visible sliders", async () => {
    stubFetch({
      loaded: true,
      model_artifact_id: "artifact-1",
      model_name: "Qwen2.5 0.5B Instruct",
      context_length: 32768,
      multimodal: false,
    });
    renderPlayground();

    await userEvent.type(await screen.findByPlaceholderText("Ask PotatoLLM anything"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(generateBody).not.toBeNull());
    expect(generateBody).toMatchObject({
      temperature: 0.8,
      top_p: 0.95,
      top_k: 40,
      max_tokens: 512,
      min_p: 0.05,
      repeat_penalty: 1.1,
      repeat_last_n: 64,
      seed: -1,
    });
  });
});
