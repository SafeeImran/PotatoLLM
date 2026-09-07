import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { useBuildActions, useBuilds } from "../hooks/useBuilds";
import { formatBytes } from "../lib/format";
import type { Build } from "../api/types";

function BuildCard({ build }: { build: Build }) {
  const { rename, duplicate, remove } = useBuildActions();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(build.name);

  function commitRename() {
    if (name.trim() && name.trim() !== build.name) {
      rename.mutate({ id: build.id, name: name.trim() });
    }
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setName(build.name);
                setEditing(false);
              }
            }}
            className="flex-1"
          />
        ) : (
          <button className="text-left text-sm font-medium text-fg hover:text-accent" onClick={() => setEditing(true)}>
            {build.name}
          </button>
        )}
        <Badge tone="neutral">{build.quantization ?? "—"}</Badge>
      </div>

      <div className="text-xs text-fg-muted">{build.base_model_name}</div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <div className="font-mono text-fg">{formatBytes(build.size_bytes)}</div>
          <div className="text-fg-muted">Size</div>
        </div>
        <div>
          <div className="font-mono text-fg">{build.context_length ?? "—"}</div>
          <div className="text-fg-muted">Context</div>
        </div>
        <div>
          <div className="font-mono text-fg">
            {build.last_benchmark_tokens_per_sec ? `${build.last_benchmark_tokens_per_sec.toFixed(1)} tok/s` : "—"}
          </div>
          <div className="text-fg-muted">Last Benchmark</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-xs">
        <Link to={`/playground?artifact=${build.model_artifact_id}`}>
          <Button size="sm" variant="primary">
            Run
          </Button>
        </Link>
        <Link to={`/benchmarks?artifact=${build.model_artifact_id}`}>
          <Button size="sm" variant="secondary">
            Benchmark
          </Button>
        </Link>
        <Button size="sm" variant="secondary" onClick={() => duplicate.mutate({ id: build.id })} disabled={duplicate.isPending}>
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (confirm(`Delete build "${build.name}"? The underlying model file is not deleted.`)) {
              remove.mutate(build.id);
            }
          }}
          disabled={remove.isPending}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

export default function Builds() {
  const { data: builds, isLoading } = useBuilds();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-secondary">Named, runnable configurations saved from a benchmark run.</p>

      {isLoading && <div className="text-sm text-fg-muted">Loading...</div>}

      {builds && builds.length === 0 && (
        <EmptyState
          title="No builds saved yet"
          description='Run a benchmark against a downloaded model and click "Save Build" to create one.'
        />
      )}

      {builds && builds.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {builds.map((b) => (
            <BuildCard key={b.id} build={b} />
          ))}
        </div>
      )}
    </div>
  );
}
