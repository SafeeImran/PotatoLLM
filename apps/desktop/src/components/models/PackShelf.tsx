import { Link } from "react-router-dom";
import { usePackActions, usePacks } from "../../hooks/useInference";
import { Button } from "../ui/Button";
import { Badge, type Tone } from "../ui/Badge";
import type { CompatibilityLevel, ModelPack, PackMember, SlotRole } from "../../api/types";

/**
 * The answer to "which of these 32 models should I actually download?".
 *
 * A pack is a set meant to be *loaded together*, so it is graded on the sum of
 * its members rather than the largest one — a machine that runs one 8B model
 * comfortably will not run three at once, and the verdict here has to say so.
 *
 * ROLE_LABEL/FIT/gb/MemberRow are exported so PackDetail.tsx — the page a
 * pack's own "View Pack" button leads to — presents members the same way
 * without a second copy of the same small lookups.
 */

export const ROLE_LABEL: Record<SlotRole, string> = {
  primary: "answers",
  vision: "eyes",
  code: "code",
  reasoning: "thinks",
  member: "loaded",
};

export const FIT: Record<CompatibilityLevel, { label: string; tone: Tone }> = {
  GREEN: { label: "Fits comfortably", tone: "success" },
  YELLOW: { label: "Tight fit", tone: "warning" },
  RED: { label: "Too big for this machine", tone: "danger" },
};

export function gb(mb: number): string {
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function MemberRow({ member }: { member: PackMember }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Badge className="mt-0.5 shrink-0">{ROLE_LABEL[member.role]}</Badge>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-fg">{member.model_name}</span>
          <span className="shrink-0 font-mono text-[10px] text-fg-muted">{member.parameter_count}</span>
          {member.downloaded && <Badge tone="success">on disk</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{member.why}</p>
      </div>
    </li>
  );
}

function PackCard({
  pack,
  recommended,
  onDownload,
  downloading,
}: {
  pack: ModelPack;
  recommended: boolean;
  onDownload: () => void;
  downloading: boolean;
}) {
  const fit = pack.compatibility ? FIT[pack.compatibility] : null;
  const complete = pack.downloaded_count === pack.member_count && pack.member_count > 0;

  return (
    <div
      className={`flex flex-col rounded-lg border p-4 ${
        recommended ? "border-accent/50 bg-accent-muted/20" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-fg">{pack.name}</h3>
            {recommended && <Badge tone="accent">Best for you</Badge>}
          </div>
          <p className="text-xs text-fg-secondary">{pack.tagline}</p>
        </div>
        {fit && (
          <Badge tone={fit.tone} className="shrink-0">
            {fit.label}
          </Badge>
        )}
      </div>

      <ul className="mt-3 divide-y divide-border border-t border-border">
        {pack.members.map((member) => (
          <MemberRow key={member.model_id} member={member} />
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="text-xs text-fg-muted">
          {/* Summed, and labelled as an estimate — the benchmark engine is what
              produces measured numbers. */}
          <span className="font-mono">~{gb(pack.total_estimated_ram_mb)} RAM</span>
          {" · "}
          <span className="font-mono">~{gb(pack.total_estimated_vram_mb)} VRAM</span>
          <span className="ml-1">estimated, all loaded at once</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to={`/packs/${pack.id}`}>
            <Button size="sm" variant="ghost">
              View Pack →
            </Button>
          </Link>
          <Button
            size="sm"
            variant={recommended ? "primary" : "secondary"}
            onClick={onDownload}
            disabled={downloading || complete}
          >
            {complete
              ? "Downloaded"
              : downloading
                ? "Queueing..."
                : pack.downloaded_count > 0
                  ? `Get the other ${pack.member_count - pack.downloaded_count}`
                  : "Download pack"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const PACK_FIT_RANK: Record<CompatibilityLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export function PackShelf() {
  const { data, isLoading, isError } = usePacks();
  const { download } = usePackActions();

  if (isLoading) return <div className="text-sm text-fg-muted">Sizing up the packs...</div>;
  if (isError || !data) return null;

  // What actually fits this machine leads. The tailored pack (assembled per
  // device by the backend) already sorts to the front on merit; the curated
  // ones fall in behind it by verdict.
  const packs = [...data.packs].sort((a, b) => {
    if (a.id === data.recommended_pack_id) return -1;
    if (b.id === data.recommended_pack_id) return 1;
    const ra = a.compatibility ? PACK_FIT_RANK[a.compatibility] : 3;
    const rb = b.compatibility ? PACK_FIT_RANK[b.compatibility] : 3;
    return ra - rb;
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-fg">Packs</h2>
        <p className="text-sm text-fg-secondary">
          Sets of models built to run together — one to answer, one to read images, one for code.
          The Playground can hold a whole pack at once.
          {!data.has_hardware_profile && " Run a hardware scan to see which of these fit."}
          {data.is_mock_hardware && " (Hardware is mocked, so these verdicts are not about your real machine.)"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {packs.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            recommended={pack.id === data.recommended_pack_id}
            downloading={download.isPending && download.variables === pack.id}
            onDownload={() => download.mutate(pack.id)}
          />
        ))}
      </div>

      {download.isError && (
        <div className="text-sm text-danger">{(download.error as Error).message}</div>
      )}
    </section>
  );
}
