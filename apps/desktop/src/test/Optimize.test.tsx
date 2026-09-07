import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Optimize from "../pages/Optimize";
import type { ModelSummary } from "../api/types";

const MODEL_WITHOUT_FP16: ModelSummary = {
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
};

function renderOptimize() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Optimize />
    </QueryClientProvider>,
  );
}

describe("Optimize page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is honest when no model has a quantization source, rather than offering a fake control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/models")) return new Response(JSON.stringify([MODEL_WITHOUT_FP16]), { status: 200 });
        if (url.includes("/inference/available-models")) return new Response(JSON.stringify([]), { status: 200 });
        if (url.includes("/downloads")) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    renderOptimize();

    await waitFor(() =>
      expect(screen.getByText("No models support local requantization yet")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
