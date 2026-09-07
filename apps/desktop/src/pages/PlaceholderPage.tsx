import { EmptyState } from "../components/ui/EmptyState";

interface PlaceholderPageProps {
  title: string;
  phase: string;
}

/** Honest "not built yet" screen — see spec section 51 (never fake a feature). */
export function PlaceholderPage({ title, phase }: PlaceholderPageProps) {
  return (
    <div className="flex h-full flex-col gap-6">
      <EmptyState title="Not built yet" description={`${title} lands in ${phase}.`} />
    </div>
  );
}
