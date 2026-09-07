import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DoctorPanel } from "../components/settings/DoctorPanel";
import type { DiagnosticsResponse } from "../api/types";

const RESPONSE: DiagnosticsResponse = {
  checks: [
    { name: "Python", status: "pass", message: "Python 3.13.5", fix: null },
    { name: "llama.cpp", status: "fail", message: "llama-server.exe not found", fix: "Run the setup wizard again." },
  ],
  all_pass: false,
  has_failures: true,
};

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DoctorPanel />
    </QueryClientProvider>,
  );
}

describe("DoctorPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders real check results with fix suggestions for failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 200 })),
    );
    renderPanel();

    await waitFor(() => expect(screen.getByText("Python 3.13.5")).toBeInTheDocument());
    expect(screen.getByText("llama-server.exe not found")).toBeInTheDocument();
    expect(screen.getByText(/Run the setup wizard again/)).toBeInTheDocument();
    expect(screen.getByText("pass")).toBeInTheDocument();
    expect(screen.getByText("fail")).toBeInTheDocument();
  });
});
