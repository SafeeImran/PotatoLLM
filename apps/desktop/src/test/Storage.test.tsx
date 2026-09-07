import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Storage from "../pages/Storage";
import type { OrphanReport, StorageSummary, StoredModel } from "../api/types";

const SUMMARY: StorageSummary = {
  models_bytes: 3 * 1024 ** 3,
  datasets_bytes: 1024 ** 3,
  attachments_bytes: 256 * 1024 * 1024,
  cache_bytes: 512 * 1024,
  logs_bytes: 128 * 1024,
  database_bytes: 64 * 1024,
  total_bytes: 4 * 1024 ** 3 + 512 * 1024 + 128 * 1024 + 64 * 1024 + 256 * 1024 * 1024,
  models_gb: 3.0,
  datasets_gb: 1.0,
  attachments_gb: 0.25,
  cache_gb: 0.0,
  logs_gb: 0.0,
  database_gb: 0.0,
  total_gb: 4.25,
  data_dir: "C:/Users/x/AppData/Roaming/PotatoLLM",
  models_dir: "C:/Users/x/AppData/Roaming/PotatoLLM/models",
  datasets_dir: "C:/Users/x/AppData/Roaming/PotatoLLM/datasets",
  attachments_dir: "C:/Users/x/AppData/Roaming/PotatoLLM/attachments",
  cache_dir: "C:/Users/x/AppData/Roaming/PotatoLLM/cache",
  logs_dir: "C:/Users/x/AppData/Roaming/PotatoLLM/logs",
  disk_total_bytes: 500 * 1024 ** 3,
  disk_free_bytes: 40 * 1024 ** 3,
  disk_used_bytes: 460 * 1024 ** 3,
  disk_total_gb: 500,
  disk_free_gb: 40,
  disk_status: "ok",
  low_disk_warning_gb: 10,
  low_disk_critical_gb: 2,
};

const MODELS: StoredModel[] = [
  {
    artifact_id: "artifact-1",
    model_id: "qwen2.5-0.5b-instruct",
    model_name: "Qwen2.5 0.5B Instruct",
    quantization: "Q4_K_M",
    format: "gguf",
    status: "verified",
    file_path: "C:/potato/models/qwen/model.gguf",
    exists: true,
    size_bytes: 491 * 1024 ** 2,
    created_at: "2026-08-28T10:00:00+00:00",
    in_use: false,
    used_by_builds: [],
  },
  {
    artifact_id: "artifact-2",
    model_id: "llama-3.2-3b-instruct",
    model_name: "Llama 3.2 3B Instruct",
    quantization: "Q4_K_M",
    format: "gguf",
    status: "verified",
    file_path: "C:/potato/models/llama/model.gguf",
    exists: true,
    size_bytes: 2 * 1024 ** 3,
    created_at: "2026-08-27T10:00:00+00:00",
    in_use: true,
    used_by_builds: ["Daily Driver"],
  },
];

const ORPHANS: OrphanReport = {
  untracked_files: [
    { file_path: "C:/potato/models/stray.gguf", relative_path: "stray.gguf", size_bytes: 4096, is_partial_download: false },
    {
      file_path: "C:/potato/models/half.gguf.part",
      relative_path: "half.gguf.part",
      size_bytes: 2048,
      is_partial_download: true,
    },
  ],
  missing_artifacts: [
    {
      artifact_id: "artifact-gone",
      model_id: "phi-3.5-mini-instruct",
      model_name: "Phi-3.5 Mini Instruct",
      quantization: "Q4_K_M",
      file_path: "C:/potato/models/phi/model.gguf",
      recorded_size_bytes: 1024 ** 3,
    },
  ],
  untracked_bytes: 6144,
};

const EMPTY_ORPHANS: OrphanReport = { untracked_files: [], missing_artifacts: [], untracked_bytes: 0 };

function renderStorage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Storage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubFetch({
  models = MODELS,
  orphans = ORPHANS,
  summary = SUMMARY,
  onDelete,
}: {
  models?: StoredModel[];
  orphans?: OrphanReport;
  summary?: StorageSummary;
  onDelete?: (url: string) => Response;
} = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "DELETE" && onDelete) return onDelete(url);
      if (url.includes("/storage/models")) return new Response(JSON.stringify(models), { status: 200 });
      if (url.includes("/storage/orphans")) return new Response(JSON.stringify(orphans), { status: 200 });
      if (url.includes("/storage/summary")) return new Response(JSON.stringify(summary), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
  return calls;
}

describe("Storage page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports the real per-category usage and free disk space", async () => {
    stubFetch();
    renderStorage();

    await waitFor(() => expect(screen.getByText("40 GB")).toBeInTheDocument()); // free on disk
    // Once in the Models metric card, once in the usage breakdown legend.
    expect(screen.getAllByText("3.0 GB")).toHaveLength(2);
    expect(screen.getByText("4.3 GB")).toBeInTheDocument(); // PotatoLLM total
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText(/460 GB used of 500 GB/)).toBeInTheDocument();
  });

  it("warns when free space is under the configured threshold", async () => {
    stubFetch({ summary: { ...SUMMARY, disk_status: "low", disk_free_gb: 6, disk_free_bytes: 6 * 1024 ** 3 } });
    renderStorage();

    await waitFor(() => expect(screen.getByText("Below 10 GB")).toBeInTheDocument());
  });

  it("lists each model with its real size and what depends on it", async () => {
    stubFetch();
    renderStorage();

    await waitFor(() => expect(screen.getByText("Qwen2.5 0.5B Instruct")).toBeInTheDocument());
    expect(screen.getByText("491 MB")).toBeInTheDocument();
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
    expect(screen.getByText("Loaded")).toBeInTheDocument();
    expect(screen.getByText(/Used by 1 build: Daily Driver/)).toBeInTheDocument();
  });

  it("will not offer to delete a model that is currently loaded", async () => {
    stubFetch();
    renderStorage();

    await waitFor(() => expect(screen.getByText("Llama 3.2 3B Instruct")).toBeInTheDocument());
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    // First row (Qwen, not loaded) is deletable; the loaded Llama row is not.
    expect(deleteButtons[0]).not.toBeDisabled();
    expect(deleteButtons[1]).toBeDisabled();
  });

  it("confirms before deleting and sends the real delete request", async () => {
    const calls = stubFetch({
      onDelete: () =>
        new Response(
          JSON.stringify({ artifact_id: "artifact-1", file_deleted: true, freed_bytes: 100, deleted_builds: [] }),
          { status: 200 },
        ),
    });
    renderStorage();

    await waitFor(() => expect(screen.getByText("Qwen2.5 0.5B Instruct")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => expect(screen.getByText("Delete Qwen2.5 0.5B Instruct?")).toBeInTheDocument());
    // Nothing has been sent yet — the confirmation is a real gate.
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(calls.some((c) => c === "DELETE http://127.0.0.1:47823/storage/models/artifact-1")).toBe(true),
    );
  });

  it("warns that dependent builds will be removed and forces the delete", async () => {
    const calls = stubFetch({
      models: [{ ...MODELS[1], in_use: false }],
      onDelete: () =>
        new Response(
          JSON.stringify({
            artifact_id: "artifact-2",
            file_deleted: true,
            freed_bytes: 100,
            deleted_builds: ["Daily Driver"],
          }),
          { status: 200 },
        ),
    });
    renderStorage();

    await waitFor(() => expect(screen.getByText("Llama 3.2 3B Instruct")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    await waitFor(() => expect(screen.getByText(/will be removed too/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Delete model and builds" }));

    await waitFor(() =>
      expect(calls.some((c) => c === "DELETE http://127.0.0.1:47823/storage/models/artifact-2?force=true")).toBe(true),
    );
  });

  it("separates untracked files from database rows whose files are gone", async () => {
    stubFetch();
    renderStorage();

    await waitFor(() => expect(screen.getByText("stray.gguf")).toBeInTheDocument());
    expect(screen.getByText("Partial download")).toBeInTheDocument();
    expect(screen.getByText(/6 KB reclaimable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Purge 1" })).toBeInTheDocument();
    expect(screen.getByText(/Phi-3.5 Mini Instruct/)).toBeInTheDocument();
  });

  it("says so plainly when there is nothing to clean up", async () => {
    stubFetch({ orphans: EMPTY_ORPHANS });
    renderStorage();

    await waitFor(() => expect(screen.getByText(/Nothing stray in the models directory/)).toBeInTheDocument());
    expect(screen.getByText(/Every registered model still has its file on disk/)).toBeInTheDocument();
  });

  it("shows an honest empty state when nothing is downloaded", async () => {
    stubFetch({ models: [], orphans: EMPTY_ORPHANS });
    renderStorage();

    await waitFor(() => expect(screen.getByText("No models downloaded yet")).toBeInTheDocument());
  });
});
