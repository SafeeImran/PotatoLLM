import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TokenTimeseriesChart } from "../components/usage/TokenTimeseriesChart";
import type { DailyUsagePoint } from "../api/types";

describe("TokenTimeseriesChart", () => {
  it("renders nothing rather than crashing on an empty data array", () => {
    const { container } = render(<TokenTimeseriesChart data={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one smooth line per series, sharing one axis", () => {
    const data: DailyUsagePoint[] = [
      { date: "2026-08-27", tokens: 100, prompt_tokens: 40, completion_tokens: 60, generations: 3, avg_tokens_per_sec: 20, avg_ttft_seconds: 0.2 },
      { date: "2026-08-28", tokens: 200, prompt_tokens: 80, completion_tokens: 120, generations: 5, avg_tokens_per_sec: 22, avg_ttft_seconds: 0.3 },
    ];
    const { container } = render(<TokenTimeseriesChart data={data} />);
    const chart = container.querySelector("svg[viewBox]")!;
    expect(chart.querySelectorAll("path[stroke='var(--color-fg)']")).toHaveLength(1);
    expect(chart.querySelectorAll("path[stroke='var(--color-chart-2)']")).toHaveLength(1);
    expect(chart.querySelectorAll("path[stroke='var(--color-chart-4)']")).toHaveLength(1);
  });

  it("shows a hover tooltip with the exact per-series values for that day", () => {
    const data: DailyUsagePoint[] = [
      { date: "2026-08-27", tokens: 100, prompt_tokens: 40, completion_tokens: 60, generations: 3, avg_tokens_per_sec: 20, avg_ttft_seconds: 0.2 },
    ];
    const { container, getByText } = render(<TokenTimeseriesChart data={data} />);
    const chart = container.querySelector("svg[viewBox]")!;
    const hitTarget = chart.querySelector("rect[fill='transparent']");
    expect(hitTarget).toBeTruthy();

    fireEvent.mouseEnter(hitTarget!);
    expect(getByText("100 total")).toBeInTheDocument();
    expect(getByText("40 prompt")).toBeInTheDocument();
    expect(getByText("60 completion")).toBeInTheDocument();

    fireEvent.mouseLeave(hitTarget!);
    expect(() => getByText("100 total")).toThrow();
  });

  it("still draws one continuous line through a zero-usage day", () => {
    const data: DailyUsagePoint[] = [
      { date: "2026-08-27", tokens: 0, prompt_tokens: 0, completion_tokens: 0, generations: 0, avg_tokens_per_sec: null, avg_ttft_seconds: null },
      { date: "2026-08-28", tokens: 100, prompt_tokens: 40, completion_tokens: 60, generations: 3, avg_tokens_per_sec: 20, avg_ttft_seconds: 0.2 },
    ];
    const { container } = render(<TokenTimeseriesChart data={data} />);
    const chart = container.querySelector("svg[viewBox]")!;
    expect(chart.querySelectorAll("path[stroke='var(--color-fg)']")).toHaveLength(1);
  });
});
