import { useMemo, useState } from "react";
import { useDownloads } from "../hooks/useDownloads";
import { useModels } from "../hooks/useModels";
import { useRecommendations } from "../hooks/useRecommendation";
import { ModelRow } from "../components/models/ModelRow";
import { PackShelf } from "../components/models/PackShelf";
import { DownloadRow } from "../components/downloads/DownloadRow";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { EmptyState } from "../components/ui/EmptyState";
import { parseParamCount } from "../lib/modelSize";
import type { CompatibilityLevel } from "../api/types";

type SortKey = "name" | "size-asc" | "size-desc" | "context" | "fit";
type Tab = "catalog" | "packs";

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-secondary";
const COL_LABEL = "text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted";
const FIT_RANK: Record<CompatibilityLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export default function ModelLibrary() {
  const [tab, setTab] = useState<Tab>("catalog");
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<string>("");
  const [capability, setCapability] = useState<string>("");
  const [fitsOnly, setFitsOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");

  const { data: models, isLoading, isError } = useModels();
  const { data: jobs } = useDownloads();

  const allModelIds = useMemo(() => (models ?? []).map((m) => m.id), [models]);
  const fitById = useRecommendations(allModelIds);

  const activeJobs = useMemo(
    () => (jobs ?? []).filter((j) => j.status === "queued" || j.status === "running" || j.status === "paused"),
    [jobs],
  );

  const families = useMemo(() => {
    if (!models) return [];
    return Array.from(new Set(models.map((m) => m.family))).sort();
  }, [models]);

  const capabilities = useMemo(() => {
    if (!models) return [];
    return Array.from(new Set(models.flatMap((m) => m.capabilities))).sort();
  }, [models]);

  const filtered = useMemo(() => {
    if (!models) return [];
    let result = models;
    if (family) result = result.filter((m) => m.family === family);
    if (capability) result = result.filter((m) => m.capabilities.includes(capability));
    if (fitsOnly) result = result.filter((m) => fitById.get(m.id) === "GREEN");
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(needle) ||
          m.description.toLowerCase().includes(needle) ||
          m.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    const sorted = [...result];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "size-asc":
        sorted.sort((a, b) => parseParamCount(a.parameter_count) - parseParamCount(b.parameter_count));
        break;
      case "size-desc":
        sorted.sort((a, b) => parseParamCount(b.parameter_count) - parseParamCount(a.parameter_count));
        break;
      case "context":
        sorted.sort((a, b) => b.context_length - a.context_length);
        break;
      case "fit":
        sorted.sort((a, b) => {
          const ra = FIT_RANK[fitById.get(a.id) as CompatibilityLevel] ?? 3;
          const rb = FIT_RANK[fitById.get(b.id) as CompatibilityLevel] ?? 3;
          return ra - rb || a.name.localeCompare(b.name);
        });
        break;
    }
    return sorted;
  }, [models, family, capability, fitsOnly, fitById, search, sort]);

  return (
    <div className="flex flex-col gap-8">
      {activeJobs.length > 0 && (
        <section aria-label="Active downloads" className="flex flex-col gap-3">
          <h2 className={SECTION_LABEL}>Downloading now</h2>
          <div className="flex flex-col gap-3">
            {activeJobs.map((job) => (
              <DownloadRow key={job.job_id} job={job} />
            ))}
          </div>
        </section>
      )}

      <div role="tablist" aria-label="Model Library sections" className="flex gap-1 border-b border-border">
        {(["catalog", "packs"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
              tab === t
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg-secondary"
            }`}
          >
            {t === "catalog" ? "Catalog" : "Packs"}
          </button>
        ))}
      </div>

      {tab === "packs" && <PackShelf />}

      {tab === "catalog" && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-base font-semibold text-fg">Full catalog</h2>
              {models && (
                <span className="pot-num text-xs text-fg-muted">
                  {filtered.length === models.length
                    ? `${models.length} models`
                    : `${filtered.length} of ${models.length}`}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56"
              />
              <Select value={family} onChange={(e) => setFamily(e.target.value)}>
                <option value="">All families</option>
                {families.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
              <Select value={capability} onChange={(e) => setCapability(e.target.value)}>
                <option value="">All capabilities</option>
                {capabilities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="name">Name</option>
                <option value="fit">Best fit</option>
                <option value="size-asc">Smallest first</option>
                <option value="size-desc">Largest first</option>
                <option value="context">Longest context</option>
              </Select>
              <button
                type="button"
                aria-pressed={fitsOnly}
                onClick={() => setFitsOnly((v) => !v)}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                  fitsOnly
                    ? "border-success/50 text-success"
                    : "border-border text-fg-secondary hover:border-border-strong"
                }`}
              >
                Fits my machine
              </button>
            </div>
          </div>

          {isLoading && <div className="text-sm text-fg-muted">Loading models…</div>}
          {isError && (
            <div className="text-sm text-danger">Couldn't reach Potato Core to load the model registry.</div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <EmptyState title="No models match" description="Try a different search term or filter." />
          )}

          {filtered.length > 0 && (
            <div role="region" aria-label="All models">
              <div className={`hidden items-center gap-5 border-b border-border px-3 pb-2 sm:flex ${COL_LABEL}`}>
                <span className="flex-1">Model</span>
                <span className="w-14 text-right">Context</span>
                <span className="w-20 text-right">Est. VRAM</span>
                <span className="w-[300px] text-right">Get · Quantize</span>
              </div>
              <div className="divide-y divide-border">
                {filtered.map((model) => (
                  <ModelRow key={model.id} model={model} level={fitById.get(model.id)} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
