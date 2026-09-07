import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Playground from "../pages/Playground";
import { PlaygroundProvider } from "../playground/PlaygroundProvider";
import type { AvailableModel, InferenceStatus, LoadedSlot, ResolvedRuntime } from "../api/types";

const RUNTIME: ResolvedRuntime = {
  context_length: 8192,
  threads: 4,
  gpu_layers: "auto",
  batch_size: null,
  flash_attention: "auto",
  kv_cache_type: "f16",
};

const MODELS: AvailableModel[] = [
  {
    artifact_id: "writer",
    model_id: "llama-3.1-8b-instruct",
    model_name: "Llama 3.1 8B Instruct",
    quantization: "Q4_K_M",
    size_bytes: 4_920_000_000,
    context_length: 131072,
    multimodal: false,
  },
  {
    artifact_id: "eyes",
    model_id: "qwen2.5-vl-7b-instruct",
    model_name: "Qwen2.5-VL 7B Instruct",
    quantization: "Q4_K_M",
    size_bytes: 4_680_000_000,
    context_length: 128000,
    multimodal: true,
  },
];

function slot(artifactId: string, role: LoadedSlot["role"], multimodal: boolean): LoadedSlot {
  const model = MODELS.find((m) => m.artifact_id === artifactId)!;
  return {
    artifact_id: artifactId,
    model_id: model.model_id,
    model_name: model.model_name,
    role,
    context_length: 8192,
    multimodal,
    runtime: RUNTIME,
  };
}

function statusWith(slots: LoadedSlot[]): InferenceStatus {
  const primary = slots.find((s) => s.role === "primary") ?? slots[0];
  return {
    loaded: slots.length > 0,
    model_artifact_id: primary?.artifact_id ?? null,
    model_name: primary?.model_name ?? null,
    context_length: primary?.context_length ?? null,
    multimodal: primary?.multimodal ?? false,
    primary_artifact_id: primary?.artifact_id ?? null,
    max_slots: 3,
    slots,
  };
}

/** Bodies of POST /inference/load and /inference/primary, for assertions. */
let loadBodies: Record<string, unknown>[] = [];
let primaryBodies: Record<string, unknown>[] = [];
let generateBody: Record<string, unknown> | null = null;
/** NDJSON lines the stubbed generate endpoint replies with. */
let generateLines: string[] = ['{"delta":"ok"}', '{"done":true,"stats":{}}', ""];

function stubFetch(status: InferenceStatus) {
  loadBodies = [];
  primaryBodies = [];
  generateBody = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/inference/generate")) {
        generateBody = JSON.parse(String(init?.body));
        return new Response(generateLines.join("\n"), { status: 200 });
      }
      if (url.includes("/inference/available-models")) {
        return new Response(JSON.stringify(MODELS), { status: 200 });
      }
      if (url.includes("/inference/load")) {
        loadBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/inference/primary")) {
        primaryBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(status), { status: 200 });
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

describe("Playground multi-model chat", () => {
  beforeEach(() => {
    localStorage.clear();
    generateLines = ['{"delta":"ok"}', '{"done":true,"stats":{}}', ""];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists every resident model with the duty it holds", async () => {
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    await userEvent.click(await screen.findByTitle("Model selector"));

    expect(await screen.findByText("MODELS IN THIS CHAT")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("answers")).toBeInTheDocument();
    expect(screen.getByText("eyes")).toBeInTheDocument();
  });

  it("shows how many extra models are loaded on the composer chip", async () => {
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    // The chip names who answers, and says there is one more model behind it.
    expect(await screen.findByText("Llama 3.1 8B Instruct")).toBeInTheDocument();
    expect(screen.getByTitle("2 models loaded for this chat")).toHaveTextContent("+1");
  });

  it("lets the engine work out a model's job when added plainly", async () => {
    stubFetch(statusWith([slot("writer", "primary", false)]));
    renderPlayground();

    await userEvent.click(await screen.findByTitle("Model selector"));
    await userEvent.click(await screen.findByTitle(/Add Qwen2.5-VL 7B Instruct — its job is worked out/));

    // "auto", not a role the user had to pick: orchestration that only runs
    // when someone already understood the role scheme mostly does not run.
    await waitFor(() => expect(loadBodies).toHaveLength(1));
    expect(loadBodies[0]).toMatchObject({ model_artifact_id: "eyes", role: "auto" });
  });

  it("explains the arrangement once a seer and a writer are both loaded", async () => {
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    await userEvent.click(await screen.findByTitle("Model selector"));

    const note = await screen.findByText(/will read it for/);
    expect(note).toHaveTextContent("Qwen2.5-VL 7B Instruct");
    expect(note).toHaveTextContent("Llama 3.1 8B Instruct");
  });

  it("adds a vision model as the chat's eyes without unloading the writer", async () => {
    stubFetch(statusWith([slot("writer", "primary", false)]));
    renderPlayground();

    await userEvent.click(await screen.findByTitle("Model selector"));
    await userEvent.click(await screen.findByTitle(/Add Qwen2.5-VL 7B Instruct as this chat's eyes/));

    await waitFor(() => expect(loadBodies).toHaveLength(1));
    expect(loadBodies[0]).toMatchObject({ model_artifact_id: "eyes", role: "vision" });
  });

  it("hands the answering role to another loaded model", async () => {
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    await userEvent.click(await screen.findByTitle("Model selector"));
    await userEvent.click(await screen.findByTitle("Let Qwen2.5-VL 7B Instruct answer"));

    await waitFor(() => expect(primaryBodies).toHaveLength(1));
    expect(primaryBodies[0]).toEqual({ model_artifact_id: "eyes" });
  });

  it("warns when nothing loaded can see", async () => {
    stubFetch(statusWith([slot("writer", "primary", false)]));
    renderPlayground();

    await userEvent.click(await screen.findByTitle("Model selector"));

    expect(await screen.findByText(/No model here can see/)).toBeInTheDocument();
  });

  it("names the answering model in the request", async () => {
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    await userEvent.type(await screen.findByPlaceholderText("Ask PotatoLLM anything"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(generateBody).not.toBeNull());
    expect(generateBody!.responder_artifact_id).toBe("writer");
  });

  it("attributes a hand-off to the model that actually looked", async () => {
    generateLines = [
      JSON.stringify({
        handoff: {
          role: "vision",
          model_name: "Qwen2.5-VL 7B Instruct",
          artifact_id: "eyes",
          content: "A bar chart of training loss.",
        },
      }),
      '{"delta":"It shows loss falling."}',
      '{"done":true,"stats":{}}',
      "",
    ];
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    await userEvent.type(await screen.findByPlaceholderText("Ask PotatoLLM anything"), "what is this?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // The transcript credits the vision model rather than passing its reading
    // off as the answering model's own.
    const note = await screen.findByRole("button", { name: /looked at the image for this turn/ });
    expect(note).toHaveTextContent("Qwen2.5-VL 7B Instruct");

    // And the description is there to check, once asked for.
    expect(screen.queryByText("A bar chart of training loss.")).not.toBeInTheDocument();
    await userEvent.click(note);
    expect(screen.getByText("A bar chart of training loss.")).toBeInTheDocument();
  });

  it("carries what the eyes read into the next message", async () => {
    // Images are not re-sent turn after turn, so the vision slot's reading is
    // the only trace of the picture the answering model ever gets. Dropping it
    // from the replay meant "now do part b" reached a model that had never
    // heard of the screenshot.
    generateLines = [
      JSON.stringify({
        handoff: {
          role: "vision",
          model_name: "Qwen2.5-VL 7B Instruct",
          artifact_id: "eyes",
          content: "def solve(n): return n * 2",
        },
      }),
      '{"delta":"It doubles n."}',
      '{"done":true,"stats":{}}',
      "",
    ];
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    const box = await screen.findByPlaceholderText("Ask PotatoLLM anything");
    await userEvent.type(box, "what does this do?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("It doubles n.");

    generateLines = ['{"delta":"Sure."}', '{"done":true,"stats":{}}', ""];
    await userEvent.type(box, "now optimise it");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const messages = generateBody!.messages as { role: string; content: string }[];
      expect(messages.some((m) => m.content.includes("def solve(n): return n * 2"))).toBe(true);
    });
  });

  it("says the eyes failed rather than letting the answer look blind", async () => {
    generateLines = [
      JSON.stringify({
        handoff: {
          role: "vision",
          model_name: "Qwen2.5-VL 7B Instruct",
          artifact_id: "eyes",
          content: "ReadTimeout: the vision model did not answer in time",
          failed: true,
        },
      }),
      '{"delta":"I cannot see the image."}',
      '{"done":true,"stats":{}}',
      "",
    ];
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    await userEvent.type(await screen.findByPlaceholderText("Ask PotatoLLM anything"), "what is this?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByRole("button", { name: /could not read the image for this turn/ }),
    ).toBeInTheDocument();
    // Open by default, because the reason is the whole point of the note.
    expect(screen.getByText(/ReadTimeout/)).toBeInTheDocument();
  });

  it("names the model that wrote a turn once more than one is loaded", async () => {
    stubFetch(statusWith([slot("writer", "primary", false), slot("eyes", "vision", true)]));
    renderPlayground();

    await userEvent.type(await screen.findByPlaceholderText("Ask PotatoLLM anything"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // Two names on screen now: the composer chip and the turn's byline.
    await waitFor(() => expect(screen.getAllByText("Llama 3.1 8B Instruct").length).toBe(2));
  });

  it("leaves a single-model chat unattributed, since there is nothing to distinguish", async () => {
    stubFetch(statusWith([slot("writer", "primary", false)]));
    renderPlayground();

    await userEvent.type(await screen.findByPlaceholderText("Ask PotatoLLM anything"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    // Wait for the turn to land, then check the name appears only on the
    // composer chip — a byline on every turn of a one-model chat is noise.
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
    expect(screen.getAllByText("Llama 3.1 8B Instruct")).toHaveLength(1);
  });
});
