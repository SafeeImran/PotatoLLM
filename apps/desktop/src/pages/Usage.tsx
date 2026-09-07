import type { ReactNode } from "react";
import { EmptyState } from "../components/ui/EmptyState";
import { Sparkline } from "../components/ui/Sparkline";
import { TokenTimeseriesChart } from "../components/usage/TokenTimeseriesChart";
import { DonutChart } from "../components/usage/DonutChart";
import { RecentSessionsTable } from "../components/usage/RecentSessionsTable";
import { SessionScatter } from "../components/usage/SessionScatter";
import { buildModelColorMap, modelColorForRank, MODEL_COLOR_OTHER } from "../components/usage/modelColor";
import { useRecentSessions, useUsageByModel, useUsageSummary, useUsageTimeseries } from "../hooks/useUsage";
import type { DailyUsagePoint } from "../api/types";

const WINDOW_DAYS = 14;
const ACCENT = "var(--pot-accent-dot)";
const PROMPT_COLOR = "var(--color-chart-2)";
const COMPLETION_COLOR = "var(--color-chart-4)";

/** null when there's nothing real to compare against — never a fabricated 0%. */
function pctChange(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/* ------------------------------------------------------------------ *
 * Small shared parts. The page leans on type scale, hairline splits
 * and generous air for hierarchy rather than boxing every figure in
 * its own identical card.
 * ------------------------------------------------------------------ */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="text-[0.6875rem] font-semibold tracking-[0.02em] text-fg-soft">{children}</div>
  );
}

function Delta({
  pct,
  goodDirection = "up",
  suffix,
}: {
  pct: number | null;
  goodDirection?: "up" | "down";
  suffix?: string;
}) {
  if (pct === null) return null;
  const good = goodDirection === "up" ? pct >= 0 : pct <= 0;
  return (
    <span className={`pot-num text-xs ${good ? "text-success" : "text-danger"}`}>
      {pct >= 0 ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%{suffix ? <span className="text-fg-soft"> {suffix}</span> : null}
    </span>
  );
}

function Readout({
  label,
  value,
  unit,
  foot,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
}) {
  return (
    <div className="flex-1 px-5 py-4">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="pot-num text-2xl font-semibold text-fg">{value}</span>
        {unit && <span className="text-xs text-fg-secondary">{unit}</span>}
      </div>
      {foot && <div className="mt-1 text-[0.6875rem] text-fg-soft">{foot}</div>}
    </div>
  );
}

/** A framed surface — used only where a panel genuinely carries its own
 *  weight (the chart, the session log). The bento tiles below deliberately
 *  skip the frame and lean on the grid gap instead. */
function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`pot-fade-up rounded-lg border border-border bg-surface ${className}`}>{children}</section>;
}

export default function Usage() {
  const { data: summary, isLoading } = useUsageSummary();
  const { data: fullSeries } = useUsageTimeseries(WINDOW_DAYS * 2);
  const { data: byModel } = useUsageByModel();
  const { data: sessions } = useRecentSessions(10);

  const hasAnyUsage = (summary?.total_generations ?? 0) > 0;

  const recentWindow = fullSeries?.slice(-WINDOW_DAYS) ?? [];
  const previousWindow = fullSeries ? fullSeries.slice(-WINDOW_DAYS * 2, -WINDOW_DAYS) : [];
  const today = recentWindow[recentWindow.length - 1];
  const yesterday = recentWindow[recentWindow.length - 2];

  const windowTotal = recentWindow.reduce((sum, p) => sum + p.tokens, 0);
  const previousWindowTotal = previousWindow.reduce((sum, p) => sum + p.tokens, 0);
  const peakDay = recentWindow.reduce<DailyUsagePoint | undefined>(
    (peak, p) => (!peak || p.tokens > peak.tokens ? p : peak),
    undefined,
  );

  const modelColors = buildModelColorMap(byModel);
  const topModels = (byModel ?? []).slice(0, 3);
  const otherModelsTotal = (byModel ?? []).slice(3).reduce((sum, m) => sum + m.total_tokens, 0);
  const modelDonutTotal = (byModel ?? []).reduce((sum, m) => sum + m.total_tokens, 0);

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-fg-secondary">
        Measured locally from real generations. Nothing leaves this machine.
      </p>

      {isLoading && <div className="text-sm text-fg-soft">Loading…</div>}

      {!isLoading && !hasAnyUsage && (
        <EmptyState
          title="No usage recorded yet"
          description="Chat with a loaded model in the Playground to start tracking real usage."
        />
      )}

      {hasAnyUsage && summary && (
        <div className="pot-stagger flex flex-col gap-6">
          {/* ---- Hero: the one figure the page is about, plus today's rail ---- */}
          <section className="pot-fade-up overflow-hidden rounded-lg border border-border">
            <div className="grid gap-px bg-border md:grid-cols-[1.7fr_1fr]">
              <div className="bg-surface p-6">
                <Eyebrow>Today</Eyebrow>
                <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
                  <span className="pot-num text-5xl font-semibold leading-none tracking-[-0.02em] text-fg">
                    {summary.tokens_today.toLocaleString()}
                  </span>
                  <span className="pb-1 text-sm text-fg-secondary">Tokens Today</span>
                </div>
                <div className="mt-2 h-4">
                  <Delta pct={pctChange(today?.tokens, yesterday?.tokens)} suffix="vs Yesterday" />
                </div>
                <div className="mt-5">
                  <Sparkline values={recentWindow.map((p) => p.tokens)} height={44} color={ACCENT} />
                  <div className="mt-1 flex justify-between text-[0.625rem] text-fg-soft">
                    <span>{WINDOW_DAYS} Days Ago</span>
                    <span>Today</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col divide-y divide-border bg-surface">
                <Readout
                  label="Avg Speed"
                  value={summary.avg_tokens_per_sec_today?.toFixed(1) ?? "—"}
                  unit="tok/s"
                  foot={<Delta pct={pctChange(today?.avg_tokens_per_sec, yesterday?.avg_tokens_per_sec)} />}
                />
                <Readout
                  label="Avg TTFT"
                  value={summary.avg_ttft_seconds_today?.toFixed(2) ?? "—"}
                  unit="s"
                  foot={
                    <Delta
                      pct={pctChange(today?.avg_ttft_seconds, yesterday?.avg_ttft_seconds)}
                      goodDirection="down"
                    />
                  }
                />
                <Readout label="Generations" value={summary.generations_today.toLocaleString()} />
              </div>
            </div>
          </section>

          {/* ---- 14-day trend ---- */}
          <Panel className="p-5 sm:p-6">
            <Eyebrow>Last {WINDOW_DAYS} Days</Eyebrow>
            <div className="mt-4 flex flex-col gap-6 lg:flex-row">
              <div className="min-w-0 flex-1">
                <TokenTimeseriesChart data={recentWindow} />
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-4 lg:w-48 lg:grid-cols-1 lg:gap-5 lg:border-l lg:border-border lg:pl-6">
                <div>
                  <Eyebrow>Total</Eyebrow>
                  <div className="pot-num mt-1 text-xl font-semibold text-fg">{windowTotal.toLocaleString()}</div>
                  <div className="mt-0.5">
                    <Delta pct={pctChange(windowTotal, previousWindowTotal)} suffix={`vs prior ${WINDOW_DAYS}d`} />
                  </div>
                </div>
                <div>
                  <Eyebrow>Daily Average</Eyebrow>
                  <div className="pot-num mt-1 text-xl font-semibold text-fg">
                    {Math.round(windowTotal / WINDOW_DAYS).toLocaleString()}
                  </div>
                </div>
                {peakDay && (
                  <div>
                    <Eyebrow>Peak Day</Eyebrow>
                    <div className="mt-1 text-sm text-fg">
                      {new Date(`${peakDay.date}T00:00:00`).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    <div className="pot-num text-[0.6875rem] text-fg-soft">{peakDay.tokens.toLocaleString()} Tokens</div>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          {/* ---- Bento: by model / prompt split / all-time, one instrument panel ---- */}
          <section className="pot-fade-up overflow-hidden rounded-lg border border-border">
            <div className="grid gap-px bg-border lg:grid-cols-[1.4fr_1.2fr_0.9fr]">
              <div className="bg-surface p-5">
                <Eyebrow>By Model</Eyebrow>
                {!byModel || byModel.length === 0 ? (
                  <p className="mt-3 text-sm text-fg-soft">No per-model data yet.</p>
                ) : (
                  <div className="mt-4 flex items-center gap-4">
                    <DonutChart
                      segments={[
                        ...topModels.map((m, i) => ({
                          label: m.model_name,
                          value: m.total_tokens,
                          color: modelColorForRank(i),
                        })),
                        ...(otherModelsTotal > 0
                          ? [{ label: "Other", value: otherModelsTotal, color: MODEL_COLOR_OTHER }]
                          : []),
                      ]}
                      size={116}
                      thickness={13}
                      centerValue={modelDonutTotal.toLocaleString()}
                      centerLabel="tok"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {topModels.map((m, i) => (
                        <div key={m.model_id} className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: modelColorForRank(i) }}
                            />
                            <span className="truncate text-fg">{m.model_name}</span>
                          </div>
                          <span className="pot-num shrink-0 text-fg-soft">
                            {share(m.total_tokens, modelDonutTotal).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                      {otherModelsTotal > 0 && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: MODEL_COLOR_OTHER }}
                            />
                            <span className="text-fg">Other</span>
                          </div>
                          <span className="pot-num shrink-0 text-fg-soft">
                            {share(otherModelsTotal, modelDonutTotal).toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-surface p-5">
                <Eyebrow>Prompt vs Completion · Today</Eyebrow>
                {summary.tokens_today === 0 ? (
                  <p className="mt-3 text-sm text-fg-soft">No tokens generated today yet.</p>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    <div className="flex h-2 overflow-hidden rounded-full bg-surface-elevated">
                      <div
                        style={{
                          width: `${share(summary.prompt_tokens_today, summary.tokens_today)}%`,
                          backgroundColor: PROMPT_COLOR,
                        }}
                      />
                      <div style={{ flex: 1, backgroundColor: COMPLETION_COLOR }} />
                    </div>
                    <div className="flex flex-col gap-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: PROMPT_COLOR }}
                          />
                          <span className="text-fg">Prompt</span>
                        </span>
                        <span className="pot-num text-fg-soft">
                          {summary.prompt_tokens_today.toLocaleString()} ·{" "}
                          {share(summary.prompt_tokens_today, summary.tokens_today).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: COMPLETION_COLOR }}
                          />
                          <span className="text-fg">Completion</span>
                        </span>
                        <span className="pot-num text-fg-soft">
                          {summary.completion_tokens_today.toLocaleString()} ·{" "}
                          {share(summary.completion_tokens_today, summary.tokens_today).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2 text-xs">
                      <span className="text-fg-secondary">Total Today</span>
                      <span className="pot-num text-fg">{summary.tokens_today.toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-surface p-5">
                <Eyebrow>All Time</Eyebrow>
                <dl className="mt-4 flex flex-col divide-y divide-border">
                  <div className="flex items-baseline justify-between pb-3">
                    <dt className="text-[0.6875rem] text-fg-soft">Tokens</dt>
                    <dd className="pot-num text-lg font-semibold text-fg">
                      {summary.total_tokens_all_time.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between py-3">
                    <dt className="text-[0.6875rem] text-fg-soft">Sessions</dt>
                    <dd className="pot-num text-lg font-semibold text-fg">
                      {summary.total_sessions.toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between pt-3">
                    <dt className="text-[0.6875rem] text-fg-soft">Generations</dt>
                    <dd className="pot-num text-lg font-semibold text-fg">
                      {summary.total_generations.toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          {/* ---- Session performance map ---- */}
          <Panel className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Eyebrow>Session Performance</Eyebrow>
              <span className="text-[0.625rem] text-fg-soft">Every Run Mapped by Speed and First-Token Time</span>
            </div>
            <div className="mt-5">
              <SessionScatter sessions={sessions ?? []} modelColors={modelColors} />
            </div>
          </Panel>

          {/* ---- Session log ---- */}
          <Panel className="p-5 sm:p-6">
            <Eyebrow>Recent Sessions</Eyebrow>
            <div className="mt-4">
              <RecentSessionsTable sessions={sessions ?? []} modelColors={modelColors} />
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
