import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Downloads from "../pages/Downloads";
import type { DownloadJob } from "../api/types";

const RUNNING_JOB: DownloadJob = {
  job_id: "job-1",
  model_id: "qwen2.5-0.5b-instruct",
  model_name: "Qwen2.5 0.5B Instruct",
  variant: "quantized",
  status: "running",
  progress: 0.42,
  bytes_downloaded: 200_000_000,
  bytes_total: 491_400_032,
  speed_bps: 12_000_000,
  error: null,
  created_at: "2026-08-24T00:00:00Z",
  updated_at: "2026-08-24T00:00:01Z",
};

function renderDownloads() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Downloads />
    </QueryClientProvider>,
  );
}

describe("Downloads page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows an honest empty state when nothing has been downloaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    renderDownloads();
    await waitFor(() => expect(screen.getByText("No downloads yet")).toBeInTheDocument());
  });

  it("renders real progress, speed, and ETA for an active download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([RUNNING_JOB]), { status: 200 })));
    renderDownloads();

    await waitFor(() => expect(screen.getByText("Qwen2.5 0.5B Instruct")).toBeInTheDocument());
    // 200,000,000 / 491,400,032 bytes, formatted via lib/format.ts (MB below 1GB)
    expect(screen.getByText(/191 MB \/ 469 MB \(42%\)/)).toBeInTheDocument();
    expect(screen.getByText(/11\.4 MB\/s/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
