import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { FIT, MemberRow, ROLE_LABEL, gb } from "../components/models/PackShelf";
import { usePacks, usePackActions, useAvailableModels, useInferenceActions } from "../hooks/useInference";

/**
 * Where a pack's own "View Pack" button leads — the focused place you
 * actually *do* something with a pack, rather than the compact card in the
 * Model Library shelf. Once every member is on disk this is also where you
 * load the whole pack into the Playground in one go, instead of loading
 * each model by hand and assigning its role yourself.
 */
export default function PackDetail() {
  const { packId } = useParams<{ packId: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = usePacks();
  const { download } = usePackActions();
  const { data: artifacts } = useAvailableModels();
  const { load } = useInferenceActions();

  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [loadingPack, setLoadingPack] = useState(false);

  const pack = data?.packs.find((p) => p.id === packId);

  if (isLoading) return <div className="text-sm text-fg-muted">Sizing up the pack...</div>;

  if (!pack) {
    return (
      <EmptyState
        title="Pack not found"
        description="It may have been renamed, or the catalog changed since you followed this link."
        action={
          <Link to="/models">
            <Button size="sm">Back to Model Library</Button>
          </Link>
        }
      />
    );
  }

  const fit = pack.compatibility ? FIT[pack.compatibility] : null;
  const complete = pack.downloaded_count === pack.member_count && pack.member_count > 0;

  async function loadPack() {
    if (!pack || !artifacts) return;
    setLoadErrors([]);
    setLoadingPack(true);
    const errors: string[] = [];
    // One at a time: each load spawns a real llama-server process, and
    // starting several at once is exactly the kind of thing that fights
    // over the same GPU/port during startup.
    for (const member of pack.members) {
      const artifact = artifacts.find((a) => a.model_id === member.model_id);
      if (!artifact) {
        errors.push(`${member.model_name}: not downloaded yet.`);
        continue;
      }
      try {
        await load.mutateAsync({ artifactId: artifact.artifact_id, role: member.role });
      } catch (err) {
        errors.push(`${member.model_name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setLoadingPack(false);
    setLoadErrors(errors);
    if (errors.length === 0) navigate("/");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/models" className="text-xs text-accent hover:underline">
          ← Back to Model Library
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-fg">{pack.name}</h1>
            {data?.recommended_pack_id === pack.id && <Badge tone="accent">Best for you</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-secondary">{pack.tagline}</p>
        </div>
        {fit && (
          <Badge tone={fit.tone} className="shrink-0">
            {fit.label}
          </Badge>
        )}
      </div>

      {!data?.has_hardware_profile && (
        <p className="text-xs text-fg-muted">Run a hardware scan to see whether this pack actually fits.</p>
      )}

      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-fg-secondary">Members</h2>
        <ul className="mt-2 divide-y divide-border">
          {pack.members.map((member) => (
            <MemberRow key={member.model_id} member={member} />
          ))}
        </ul>
        {pack.missing_from_catalog.length > 0 && (
          <p className="mt-2 text-xs text-fg-muted">
            Also references {pack.missing_from_catalog.join(", ")}, not currently in the model catalog.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-fg-secondary">
            {/* Summed, and labelled as an estimate — the benchmark engine is what produces measured numbers. */}
            <span className="font-mono text-fg">~{gb(pack.total_estimated_ram_mb)} RAM</span>
            <span className="mx-1">·</span>
            <span className="font-mono text-fg">~{gb(pack.total_estimated_vram_mb)} VRAM</span>
            <span className="ml-1 text-fg-muted">estimated, all loaded at once</span>
          </div>
          <div className="text-xs text-fg-muted">
            {pack.downloaded_count} / {pack.member_count} downloaded
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!complete && (
            <Button
              variant="primary"
              onClick={() => download.mutate(pack.id)}
              disabled={download.isPending && download.variables === pack.id}
            >
              {download.isPending && download.variables === pack.id
                ? "Queueing..."
                : pack.downloaded_count > 0
                  ? `Get the other ${pack.member_count - pack.downloaded_count}`
                  : "Download pack"}
            </Button>
          )}
          {complete && (
            <Button variant="potato" onClick={loadPack} disabled={loadingPack}>
              {loadingPack ? "Loading pack..." : "Load pack in Playground"}
            </Button>
          )}
          <span className="text-xs text-fg-muted">
            {complete
              ? `Loads each member with its role — ${pack.members.map((m) => `${m.model_name} ${ROLE_LABEL[m.role]}`).join(", ")}.`
              : "Download every member first, then load them together here."}
          </span>
        </div>

        {loadErrors.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border border-danger/30 bg-danger-muted p-2.5 text-xs text-danger">
            {loadErrors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
