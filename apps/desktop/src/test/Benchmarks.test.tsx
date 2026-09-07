import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Benchmarks from "../pages/Benchmarks";

function renderBenchmarks() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Benchmarks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Benchmarks page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is honest when no models are downloaded, rather than offering a fake run button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/inference/available-models")) return new Response(JSON.stringify([]), { status: 200 });
        if (url.includes("/benchmark")) return new Response(JSON.stringify([]), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    renderBenchmarks();

    await waitFor(() => expect(screen.getByText("No downloaded models yet")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Run Benchmark" })).not.toBeInTheDocument();
    expect(screen.getByText("No benchmarks run yet.")).toBeInTheDocument();
  });
});
