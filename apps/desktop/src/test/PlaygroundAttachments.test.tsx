import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Playground from "../pages/Playground";
import { PlaygroundProvider } from "../playground/PlaygroundProvider";
import type { Attachment, AvailableModel, InferenceStatus } from "../api/types";

const PICKED: Attachment = {
  id: "att-1",
  file_name: "eval.csv",
  file_path: "/data/attachments/att-1/eval.csv",
  mime_type: "text/csv",
  size_bytes: 2048,
  kind: "document",
  message_id: null,
  created_at: "2026-09-01T00:00:00Z",
};

const IMAGE: Attachment = { ...PICKED, id: "att-2", file_name: "loss.png", mime_type: "image/png", kind: "image" };

// The Tauri dialog can't run in jsdom, so the picker is mocked at the module
// boundary — everything below it (register, send, clear) is the real code.
const pickAttachment = vi.fn<() => Promise<Attachment | null>>();
const deleteAttachment = vi.fn<(id: string) => Promise<void>>(async () => {});
vi.mock("../api/attachments", () => ({
  pickAttachment: () => pickAttachment(),
  deleteAttachment: (id: string) => deleteAttachment(id),
  listAttachments: async () => [],
}));

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
  {
    artifact_id: "artifact-2",
    model_id: "smolvlm-500m-instruct",
    model_name: "SmolVLM 500M Instruct",
    quantization: "Q8_0",
    size_bytes: 437_000_000,
    context_length: 8192,
    multimodal: true,
  },
];

const RUNTIME = {
  context_length: 8192,
  threads: 4,
  gpu_layers: "auto" as const,
  batch_size: null,
  flash_attention: "auto",
  kv_cache_type: "f16",
};

function loadedStatus(multimodal: boolean): InferenceStatus {
  const artifactId = multimodal ? "artifact-2" : "artifact-1";
  return {
    loaded: true,
    model_artifact_id: artifactId,
    model_name: multimodal ? "SmolVLM 500M Instruct" : "Qwen2.5 0.5B Instruct",
    context_length: 8192,
    multimodal,
    primary_artifact_id: artifactId,
    max_slots: 3,
    slots: [
      {
        artifact_id: artifactId,
        model_id: multimodal ? "smolvlm-500m-instruct" : "qwen2.5-0.5b-instruct",
        model_name: multimodal ? "SmolVLM 500M Instruct" : "Qwen2.5 0.5B Instruct",
        role: "primary",
        context_length: 8192,
        multimodal,
        runtime: RUNTIME,
      },
    ],
  };
}

/** A text model answering, with a vision model loaded alongside it as eyes. */
function statusWithEyes(): InferenceStatus {
  const text = loadedStatus(false);
  return {
    ...text,
    slots: [
      ...(text.slots ?? []),
      {
        artifact_id: "artifact-2",
        model_id: "smolvlm-500m-instruct",
        model_name: "SmolVLM 500M Instruct",
        role: "vision",
        context_length: 8192,
        multimodal: true,
        runtime: RUNTIME,
      },
    ],
  };
}

/** Captures the body of the /inference/generate call so we can assert on it. */
let generateBody: Record<string, unknown> | null = null;

function stubFetch(status: InferenceStatus) {
  generateBody = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/inference/available-models")) {
        return new Response(JSON.stringify(MODELS), { status: 200 });
      }
      if (url.includes("/inference/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      if (url.includes("/inference/generate")) {
        generateBody = JSON.parse(String(init?.body));
        return new Response('{"delta":"ok"}\n{"done":true,"stats":{}}\n', { status: 200 });
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

describe("Playground attachments", () => {
  beforeEach(() => {
    localStorage.clear();
    pickAttachment.mockReset();
    deleteAttachment.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stages a picked file as a chip in the composer", async () => {
    stubFetch(loadedStatus(false));
    pickAttachment.mockResolvedValue(PICKED);
    renderPlayground();

    await userEvent.click(await screen.findByRole("button", { name: "Attach a file" }));

    expect(await screen.findByText("eval.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove eval.csv" })).toBeInTheDocument();
  });

  it("sends the attachment id with the message and clears the tray", async () => {
    stubFetch(loadedStatus(false));
    pickAttachment.mockResolvedValue(PICKED);
    renderPlayground();

    await userEvent.click(await screen.findByRole("button", { name: "Attach a file" }));
    await screen.findByText("eval.csv");
    await userEvent.type(screen.getByLabelText("Message"), "summarise this");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(generateBody).not.toBeNull());
    const messages = generateBody!.messages as { role: string; attachment_ids?: string[] }[];
    expect(messages[messages.length - 1].attachment_ids).toEqual(["att-1"]);

    // The tray empties, and the chip moves onto the sent turn.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove eval.csv" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("eval.csv")).toBeInTheDocument();
  });

  it("lets an attachment be sent with no text at all", async () => {
    stubFetch(loadedStatus(false));
    pickAttachment.mockResolvedValue(PICKED);
    renderPlayground();

    await userEvent.click(await screen.findByRole("button", { name: "Attach a file" }));
    await screen.findByText("eval.csv");

    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("warns that a text-only model will not read an attached image", async () => {
    stubFetch(loadedStatus(false));
    pickAttachment.mockResolvedValue(IMAGE);
    renderPlayground();

    await userEvent.click(await screen.findByRole("button", { name: "Attach a file" }));

    expect(await screen.findByText("not read")).toBeInTheDocument();
  });

  it("does not warn when a vision model is loaded", async () => {
    stubFetch(loadedStatus(true));
    pickAttachment.mockResolvedValue(IMAGE);
    renderPlayground();

    await userEvent.click(await screen.findByRole("button", { name: "Attach a file" }));
    await screen.findByText("loss.png");

    expect(screen.queryByText("not read")).not.toBeInTheDocument();
  });

  it("does not warn when the chat's eyes can see, even though the answerer cannot", async () => {
    // The bug: the warning read the primary slot alone, so pairing a text model
    // with a vision model — the entire point of the eyes — still told the user
    // their screenshot would not be read, while the hand-off read it fine.
    stubFetch(statusWithEyes());
    pickAttachment.mockResolvedValue(IMAGE);
    renderPlayground();

    await userEvent.click(await screen.findByRole("button", { name: "Attach a file" }));
    await screen.findByText("loss.png");

    expect(screen.queryByText("not read")).not.toBeInTheDocument();
  });

  it("removes a staged attachment from the core as well as the tray", async () => {
    stubFetch(loadedStatus(false));
    pickAttachment.mockResolvedValue(PICKED);
    renderPlayground();

    await userEvent.click(await screen.findByRole("button", { name: "Attach a file" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove eval.csv" }));

    expect(deleteAttachment).toHaveBeenCalledWith("att-1");
    await waitFor(() => expect(screen.queryByText("eval.csv")).not.toBeInTheDocument());
  });

  it("offers a vision model as the chat's eyes, and other models as plain additions", async () => {
    stubFetch(loadedStatus(false));
    renderPlayground();

    await userEvent.click(await screen.findByTitle("Model selector"));

    // One model is already loaded, so the panel offers to add alongside it —
    // and only the model that can actually see is offered as eyes.
    expect(await screen.findByText("ADD ANOTHER")).toBeInTheDocument();
    expect(screen.getByTitle(/Add SmolVLM 500M Instruct as this chat's eyes/)).toBeInTheDocument();
    expect(screen.queryByTitle(/Add Qwen2.5 0.5B Instruct as this chat's eyes/)).not.toBeInTheDocument();
  });
});
