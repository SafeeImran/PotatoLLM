/**
 * A generation belongs to the chat it was sent from.
 *
 * Only one turn runs at a time, so the streaming state lives above the
 * conversation list — which meant every chat rendered the same in-flight
 * answer as its own, and an empty chat lost its idle screen while a different
 * chat was working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Playground from "../pages/Playground";
import { Sidebar } from "../components/layout/Sidebar";
import { PlaygroundProvider, type Conversation } from "../playground/PlaygroundProvider";
import type { InferenceStatus } from "../api/types";

const STORAGE_KEY = "potatollm.playground.conversations";

const SEED: Conversation[] = [
  { id: "a", title: "Eval sweep", messages: [], updatedAt: 3_000 },
  {
    id: "b",
    title: "Tokenizer diff",
    messages: [{ role: "user", content: "earlier question", time: "09:00" }],
    updatedAt: 2_000,
  },
];

const STATUS: InferenceStatus = {
  loaded: true,
  model_artifact_id: "writer",
  model_name: "Qwen2.5 0.5B Instruct",
  context_length: 4096,
  multimodal: false,
  primary_artifact_id: "writer",
  max_slots: 3,
  slots: [
    {
      artifact_id: "writer",
      model_id: "qwen2.5-0.5b-instruct",
      model_name: "Qwen2.5 0.5B Instruct",
      role: "primary",
      context_length: 4096,
      multimodal: false,
      runtime: {
        context_length: 4096,
        threads: 4,
        gpu_layers: "auto",
        batch_size: null,
        flash_attention: "auto",
        kv_cache_type: "f16",
      },
    },
  ],
};

/** Lets the test hold the generation open and feed it a line at a time. */
let feed: ReadableStreamDefaultController<Uint8Array> | null = null;

function stubFetch() {
  feed = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/inference/status")) {
        return new Response(JSON.stringify(STATUS), { status: 200 });
      }
      if (url.includes("/inference/generate")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            feed = controller;
          },
        });
        return new Response(body, { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

function send(line: string) {
  feed!.enqueue(new TextEncoder().encode(line + "\n"));
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlaygroundProvider>
          <Sidebar />
          <Playground />
        </PlaygroundProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("A generation stays in its own chat", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not render the in-flight answer in a chat that did not ask for it", async () => {
    renderApp();

    await userEvent.type(await screen.findByPlaceholderText("Ask PotatoLLM anything"), "what is 2+2?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(feed).not.toBeNull());
    send('{"delta":"Four, because"}');
    expect(await screen.findByText(/Four, because/)).toBeInTheDocument();

    // Switch to the other chat while the answer is still streaming.
    await userEvent.click(screen.getByText("Tokenizer diff"));

    await waitFor(() => expect(screen.queryByText(/Four, because/)).not.toBeInTheDocument());
    expect(screen.getByText("earlier question")).toBeInTheDocument();
    // And the composer says why it is busy rather than just refusing to send.
    expect(screen.getByText("answering in another chat")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();

    // The finished turn lands in the chat that asked for it, not the open one.
    send('{"done":true,"stats":{}}');
    feed!.close();
    await waitFor(() => expect(screen.queryByText("answering in another chat")).not.toBeInTheDocument());
    expect(screen.queryByText(/Four, because/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("what is 2+2?"));
    expect(await screen.findByText(/Four, because/)).toBeInTheDocument();
  });
});
