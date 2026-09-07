import { useDownloads } from "../hooks/useDownloads";
import { DownloadRow } from "../components/downloads/DownloadRow";
import { EmptyState } from "../components/ui/EmptyState";

export default function Downloads() {
  const { data: jobs, isLoading, isError } = useDownloads();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-fg-secondary">Model downloads, active and past — start these from the Model Library.</p>
      </div>

      {isLoading && <div className="text-sm text-fg-muted">Loading...</div>}
      {isError && <div className="text-sm text-danger">Couldn't reach Potato Core.</div>}

      {jobs && jobs.length === 0 && (
        <EmptyState title="No downloads yet" description="Head to the Model Library and download a model to see it here." />
      )}

      {jobs && jobs.length > 0 && (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <DownloadRow key={job.job_id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
