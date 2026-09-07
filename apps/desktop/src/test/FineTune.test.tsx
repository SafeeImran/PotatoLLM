import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FineTune from "../pages/FineTune";
import type { Dataset, Hyperparameters, MLDependencyStatus, ModelSummary } from "../api/types";

const FINETUNABLE_MODEL: ModelSummary = {
  id: "tinyllama-1.1b-chat",
  name: "TinyLlama 1.1B Chat",
  family: "TinyLlama",
  parameter_count: "1.1B",
  architecture: "Llama",
  context_length: 2048,
  license: "Apache 2.0",
  source: "TinyLlama Project",
  model_url: "https://example.com",
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
};

const NOT_FINETUNABLE_MODEL: ModelSummary = { ...FINETUNABLE_MODEL, id: "no-ft", name: "No Finetune", finetune_support: false };

const DATASET: Dataset = {
  id: "dataset-1",
  name: "My Dataset",
  file_path: "C:\\data\\d.jsonl",
  format: "jsonl",
  example_count: 100,
  estimated_tokens: 5000,
  avg_tokens: 50,
  max_tokens: 200,
  duplicate_pct: 2.0,
  valid_pct: 98.0,
  created_at: "2026-08-28T00:00:00Z",
};

const DEPS_UNAVAILABLE: MLDependencyStatus = {
  available: false,
  missing: ["torch", "transformers", "peft", "trl"],
  install_hint: 'pip install -e ".[train]"',
};

const HYPERPARAMS: Hyperparameters = {
  learning_rate: 0.0001581,
  epochs: 3,
  lora_rank: 16,
  lora_alpha: 32,
  lora_dropout: 0.05,
  batch_size: 4,
  gradient_accumulation_steps: 4,
  warmup_ratio: 0.05,
  max_seq_length: 1024,
  scheduler: "cosine",
};

function renderFineTune() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FineTune />
    </QueryClientProvider>,
  );
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/models")) return new Response(JSON.stringify([FINETUNABLE_MODEL, NOT_FINETUNABLE_MODEL]), { status: 200 });
      if (url.includes("/datasets")) return new Response(JSON.stringify([DATASET]), { status: 200 });
      if (url.includes("/training/dependencies")) return new Response(JSON.stringify(DEPS_UNAVAILABLE), { status: 200 });
      if (url.includes("/training/preview")) return new Response(JSON.stringify(HYPERPARAMS), { status: 200 });
      if (url.includes("/training/jobs")) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

describe("FineTune page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only lists models with finetune_support, not every model", async () => {
    stubFetch();
    renderFineTune();

    await waitFor(() => expect(screen.getByText("TinyLlama 1.1B Chat (1.1B)")).toBeInTheDocument());
    expect(screen.queryByText("No Finetune (1.1B)")).not.toBeInTheDocument();
  });

  it("shows an honest setup-needed banner when ML dependencies aren't installed", async () => {
    stubFetch();
    renderFineTune();

    await waitFor(() => expect(screen.getByText("Setup Needed")).toBeInTheDocument());
    expect(screen.getByText(/torch, transformers, peft, trl/)).toBeInTheDocument();
  });

  it("disables Start Training until a model and dataset are both selected", async () => {
    stubFetch();
    renderFineTune();

    await waitFor(() => expect(screen.getByRole("button", { name: "Start Training" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Start Training" })).toBeDisabled();
  });

  it("reveals the real resolved hyperparameters under Show Advanced Settings, not a static mockup", async () => {
    stubFetch();
    renderFineTune();

    await waitFor(() => expect(screen.getByText("Show Advanced Settings")).toBeInTheDocument());
    screen.getByText("Show Advanced Settings").click();

    await waitFor(() => expect(screen.getByText("16")).toBeInTheDocument()); // lora_rank
    expect(screen.getByText("cosine")).toBeInTheDocument();
  });
});
