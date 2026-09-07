import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Usage from "../pages/Usage";
import type { DailyUsagePoint, RecentSession, UsageSummary } from "../api/types";

// Matches the real backend's contract: get_daily_timeseries always
// zero-fills every day in range, never returns an empty array.
const SAMPLE_TIMESERIES: DailyUsagePoint[] = Array.from({ length: 28 }, (_, i) => ({
  date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
  tokens: i === 27 ? 1234 : 0,
  prompt_tokens: i === 27 ? 500 : 0,
  completion_tokens: i === 27 ? 734 : 0,
  generations: i === 27 ? 6 : 0,
  avg_tokens_per_sec: i === 27 ? 42.5 : null,
  avg_ttft_seconds: i === 27 ? 0.31 : null,
}));

const EMPTY_SUMMARY: UsageSummary = {
  tokens_today: 0,
  prompt_tokens_today: 0,
  completion_tokens_today: 0,
  avg_tokens_per_sec_today: null,
  avg_ttft_seconds_today: null,
  generations_today: 0,
  total_tokens_all_time: 0,
  total_sessions: 0,
  total_generations: 0,
};

const REAL_SUMMARY: UsageSummary = {
  tokens_today: 1234,
  prompt_tokens_today: 500,
  completion_tokens_today: 734,
  avg_tokens_per_sec_today: 42.5,
  avg_ttft_seconds_today: 0.31,
  generations_today: 6,
  total_tokens_all_time: 9999,
  total_sessions: 3,
  total_generations: 20,
};

const SAMPLE_SESSIONS: RecentSession[] = [
  {
    session_id: "abcdef12-3456-7890",
    model_id: "tinyllama-1.1b-chat",
    model_name: "TinyLlama 1.1B Chat",
    total_tokens: 1234,
    generations: 6,
    avg_tokens_per_sec: 42.5,
    avg_ttft_seconds: 0.31,
    duration_seconds: 321,
    started_at: "2026-08-28T10:00:00+00:00",
    last_activity_at: "2026-08-28T10:05:21+00:00",
  },
];

function renderUsage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Usage />
    </QueryClientProvider>,
  );
}

function stubFetch(summary: UsageSummary) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/usage/summary")) return new Response(JSON.stringify(summary), { status: 200 });
      if (url.includes("/usage/timeseries")) return new Response(JSON.stringify(SAMPLE_TIMESERIES), { status: 200 });
      if (url.includes("/usage/by-model")) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes("/usage/sessions")) return new Response(JSON.stringify(SAMPLE_SESSIONS), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

describe("Usage page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is honest when nothing has been recorded, rather than showing a zeroed dashboard", async () => {
    stubFetch(EMPTY_SUMMARY);
    renderUsage();

    await waitFor(() => expect(screen.getByText("No usage recorded yet")).toBeInTheDocument());
    expect(screen.queryByText("Tokens Today")).not.toBeInTheDocument();
  });

  it("shows real measured stats once usage exists", async () => {
    stubFetch(REAL_SUMMARY);
    renderUsage();

    await waitFor(() => expect(screen.getAllByText("1,234").length).toBeGreaterThan(0));
    expect(screen.getByText("42.5", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Tokens Today")).toBeInTheDocument();
  });

  it("renders the recent sessions table with real session data", async () => {
    stubFetch(REAL_SUMMARY);
    renderUsage();

    await waitFor(() => expect(screen.getByText("TinyLlama 1.1B Chat")).toBeInTheDocument());
    expect(screen.getByText("Session #abcdef")).toBeInTheDocument();
  });
});
