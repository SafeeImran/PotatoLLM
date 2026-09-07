import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LiveMonitor } from "../components/layout/LiveMonitor";
import { PlaygroundProvider } from "../playground/PlaygroundProvider";
import type { AvailableModel, InferenceStatus, RuntimeDefaults } from "../api/types";

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

const LOADED: InferenceStatus = {
  loaded: true,
  model_artifact_id: "artifact-1",
  model_name: "Qwen2.5 0.5B Instruct",
  context_length: 4096,
  multimodal: false,
  runtime: {
    context_length: 4096,
    threads: 8,
    gpu_layers: "auto",
    batch_size: null,
    flash_attention: "auto",
    kv_cache_type: "f16",
  },
};

const DEFAULTS: RuntimeDefaults = {
  threads: 8,
  cpu_cores: 8,
  cpu_threads: 16,
  gpu_layers: "auto",
  gpu_available: true,
  gpu_detected: true,
  backend_devices: ["CUDA0"],
  gpu_model: "GeForce RTX 4060",
  vram_mb: 8192,
  compute_backend: "CUDA",
  batch_size: null,
  flash_attention: "auto",
  kv_cache_type: "f16",
  context_length: 4096,
};

const UNLOADED: InferenceStatus = {
  loaded: false,
  model_artifact_id: null,
  model_name: null,
  context_length: null,
  multimodal: false,
  runtime: null,
};

/** Bodies of every POST /inference/load, so we can assert what was sent. */
let loadBodies: Record<string, unknown>[] = [];
/** Flips the detection response to "GPU present, but this binary can't use it". */
let cpuOnlyBuild = false;
/** Serves the "no model" status, so the drawer's disabled state can be tested. */
let noModel = false;
/** The runtime sections are Developer Mode territory; most tests need it on. */
let developerMode = true;

function stubFetch() {
  loadBodies = [];
  cpuOnlyBuild = false;
  noModel = false;
  developerMode = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes("/inference/available-models")) {
        return new Response(JSON.stringify(MODELS), { status: 200 });
      }
      if (url.includes("/inference/runtime-defaults")) {
        const body: RuntimeDefaults = cpuOnlyBuild
          ? { ...DEFAULTS, gpu_available: false, gpu_layers: 0, backend_devices: [] }
          : DEFAULTS;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (url.includes("/inference/status")) {
        return new Response(JSON.stringify(noModel ? UNLOADED : LOADED), { status: 200 });
      }
      if (url.includes("/inference/load")) {
        loadBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(LOADED), { status: 200 });
      }
      if (url.endsWith("/settings")) {
        return new Response(
          JSON.stringify({ developer_mode: { value: developerMode, is_default: !developerMode } }),
          { status: 200 },
        );
      }
      if (url.includes("/hardware/live")) {
        return new Response(
          JSON.stringify({
            gpu: { vendor: "NVIDIA", model: "GeForce RTX 4060", vram_mb: 8192, utilization_pct: 12, temp_c: 44 },
            memory: { total_mb: 32768, available_mb: 20000 },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

function renderMonitor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlaygroundProvider>
          <LiveMonitor open onToggle={() => {}} />
        </PlaygroundProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens one of the collapsed sections and returns nothing — assertions use `screen`. */
async function openSection(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(name, "i") }));
}

describe("LiveMonitor runtime controls", () => {
  beforeEach(() => {
    localStorage.clear();
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the four familiar sampling knobs open by default", async () => {
    renderMonitor();

    for (const label of ["Temperature", "Top P", "Top K", "Max Tokens"]) {
      expect(await screen.findByRole("slider", { name: label })).toBeInTheDocument();
    }
  });

  it("files the rarely-used sampling knobs under Advanced", async () => {
    renderMonitor();

    expect(screen.queryByRole("slider", { name: "Min P" })).not.toBeInTheDocument();

    await openSection("ADVANCED");

    expect(screen.getByRole("slider", { name: "Min P" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Repeat Penalty" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Repeat Last N" })).toBeInTheDocument();
    expect(screen.getByLabelText("Seed")).toBeInTheDocument();
  });

  it("groups context and performance knobs into their own sections", async () => {
    renderMonitor();

    await openSection("CONTEXT");
    expect(screen.getByRole("slider", { name: "Context Size" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "KV Cache" })).toBeInTheDocument();

    await openSection("PERFORMANCE");
    expect(screen.getByRole("slider", { name: "GPU Layers / Offload" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "CPU Threads" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Batch Size" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Flash Attention" })).toBeInTheDocument();
  });

  it("says what Auto resolves to on this machine, on hover", async () => {
    renderMonitor();
    await openSection("PERFORMANCE");

    // The section's own note is the one thing that stays on screen: it is
    // context for the whole group, not a per-knob explanation.
    expect(await screen.findByText(/Detected: GeForce RTX 4060/i)).toBeInTheDocument();

    // The detected thread count waits to be asked for.
    expect(screen.queryByText(/8 threads of 8 cores detected/i)).not.toBeInTheDocument();

    await userEvent.hover(screen.getByRole("slider", { name: "CPU Threads" }));

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/8 threads of 8 cores detected/i);
  });

  it("does not promise GPU offload a CPU-only llama.cpp build cannot deliver", async () => {
    // The machine has the card; this binary just cannot reach it.
    cpuOnlyBuild = true;
    renderMonitor();
    await openSection("PERFORMANCE");

    await userEvent.hover(await screen.findByRole("slider", { name: "GPU Layers / Offload" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /CPU-only, so nothing offloads to your GeForce RTX 4060/i,
    );
  });

  it("explains a knob on hover instead of printing a hint under every one", async () => {
    renderMonitor();

    const temperature = await screen.findByRole("slider", { name: "Temperature" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.hover(temperature);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/allowed to surprise itself/i);

    await userEvent.unhover(temperature);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("keeps the llama.cpp plumbing out of sight until Developer Mode is on", async () => {
    developerMode = false;
    renderMonitor();

    // Generation is the whole control surface for a normal session.
    expect(await screen.findByRole("slider", { name: "Temperature" })).toBeInTheDocument();

    for (const section of ["CONTEXT", "PERFORMANCE", "ADVANCED"]) {
      expect(screen.queryByRole("button", { name: new RegExp(section, "i") })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("slider", { name: "Context Size" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "GPU Layers / Offload" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Seed")).not.toBeInTheDocument();

    // The system prompt is not plumbing, so it stays.
    expect(screen.getByLabelText("System prompt")).toBeInTheDocument();
  });

  it("greys out every control while no model is loaded", async () => {
    noModel = true;
    renderMonitor();

    // Nothing in here has anything to apply to yet, in every section.
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Temperature" })).toHaveAttribute("aria-disabled", "true"),
    );
    expect(screen.getByLabelText("System prompt")).toBeDisabled();

    await openSection("PERFORMANCE");
    expect(screen.getByRole("switch", { name: "CPU Threads automatic" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "GPU Layers / Offload" })).toHaveAttribute("aria-disabled", "true");

    await openSection("CONTEXT");
    expect(screen.getByRole("slider", { name: "Context Size" })).toHaveAttribute("aria-disabled", "true");
    expect(within(screen.getByRole("radiogroup", { name: "KV Cache" })).getByRole("radio", { name: "q8_0" })).toBeDisabled();

    await openSection("ADVANCED");
    expect(screen.getByRole("slider", { name: "Min P" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByLabelText("Seed")).toBeDisabled();
  });

  it("re-enables the controls once a model is loaded", async () => {
    renderMonitor();

    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Temperature" })).not.toHaveAttribute("aria-disabled"),
    );
    expect(screen.getByLabelText("System prompt")).not.toBeDisabled();
  });

  it("leaves the runtime knobs on Auto until the user turns one off", async () => {
    renderMonitor();
    await openSection("PERFORMANCE");

    const autoThreads = await screen.findByRole("switch", { name: "CPU Threads automatic" });
    expect(autoThreads).toBeChecked();
    expect(screen.getByRole("slider", { name: "CPU Threads" })).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(autoThreads);

    expect(autoThreads).not.toBeChecked();
    // Manual starts at the detected value rather than the slider's floor.
    expect(screen.getByRole("slider", { name: "CPU Threads" })).toHaveAttribute("aria-valuenow", "8");
  });

  it("offers a reload once a load-time knob changes, and sends the new runtime", async () => {
    renderMonitor();
    await openSection("PERFORMANCE");

    expect(screen.queryByRole("button", { name: /reload now/i })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("switch", { name: "CPU Threads automatic" }));

    const reload = await screen.findByRole("button", { name: /reload now/i });
    await userEvent.click(reload);

    await waitFor(() => expect(loadBodies).toHaveLength(1));
    expect(loadBodies[0].model_artifact_id).toBe("artifact-1");
    expect(loadBodies[0].runtime).toMatchObject({ threads: 8, gpu_layers: -1, batch_size: 0 });
  });

  it("does not ask for a reload when only a sampling knob moves", async () => {
    renderMonitor();

    const temperature = await screen.findByRole("slider", { name: "Temperature" });
    temperature.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(screen.queryByRole("button", { name: /reload now/i })).not.toBeInTheDocument();
  });

  it("switches KV cache precision through the choice row", async () => {
    renderMonitor();
    await openSection("CONTEXT");

    const group = screen.getByRole("radiogroup", { name: "KV Cache" });
    expect(within(group).getByRole("radio", { name: "f16" })).toBeChecked();

    await userEvent.click(within(group).getByRole("radio", { name: "q8_0" }));

    expect(within(group).getByRole("radio", { name: "q8_0" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "f16" })).not.toBeChecked();
  });

  it("resizes by dragging its edge handle, and remembers the width", async () => {
    renderMonitor();

    const handle = await screen.findByRole("separator", { name: "Resize live monitor" });
    fireEvent.mouseDown(handle, { clientX: 800 });
    fireEvent.mouseMove(document, { clientX: 750 }); // -50px — dragging left grows a right-docked panel
    fireEvent.mouseUp(document);

    expect(localStorage.getItem("potatollm.liveMonitorWidth")).toBe("430"); // 380 default + 50
  });
});
