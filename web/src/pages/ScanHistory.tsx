import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/** Shape returned by GET /api/scans */
interface ScanEntry {
  id: string;
  tool: string;
  domain: string | null;
  targets: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
}

/** Known tool names for the filter dropdown. */
const TOOL_OPTIONS = ["dns", "certs", "ports"] as const;

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTargets(targets: string | null): string {
  if (!targets) return "-";
  try {
    const arr: string[] = JSON.parse(targets);
    if (arr.length <= 3) return arr.join(", ");
    return `${arr.slice(0, 3).join(", ")} (+${arr.length - 3})`;
  } catch {
    return targets;
  }
}

/** Status badge component. */
function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    complete: "bg-status-success/15 text-status-success",
    running: "bg-status-info/15 text-status-info",
    failed: "bg-status-danger/15 text-status-danger",
  };
  const classes = colorMap[status] ?? "bg-surface-700 text-surface-300";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}
    >
      {status}
    </span>
  );
}

/** Confirmation dialog for delete actions. */
function DeleteConfirmDialog({
  scanId,
  onConfirm,
  onCancel,
}: {
  scanId: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-surface-700 bg-surface-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Confirm delete"
      >
        <h3 className="text-lg font-semibold text-surface-100">Delete scan</h3>
        <p className="mt-2 text-sm text-surface-400">
          Are you sure you want to delete scan{" "}
          <code className="rounded bg-surface-800 px-1 py-0.5 font-mono text-xs text-surface-300">
            {scanId.slice(0, 8)}
          </code>
          ? This action cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-surface-700 px-4 py-2 text-sm font-medium text-surface-300 transition-colors hover:bg-surface-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-status-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ScanHistory() {
  const navigate = useNavigate();

  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [toolFilter, setToolFilter] = useState("");
  const [domainSearch, setDomainSearch] = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Debounce timer for domain search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchScans = useCallback(
    async (append: boolean = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      if (toolFilter) params.set("tool", toolFilter);
      if (domainSearch.trim()) params.set("domain", domainSearch.trim());

      // For pagination, fetch PAGE_SIZE + existing count via offset simulation.
      // The backend doesn't support offset, so we fetch limit = existing + PAGE_SIZE
      // and slice on the client. This is acceptable for moderate data sets.
      if (append && scans.length > 0) {
        params.set("limit", String(scans.length + PAGE_SIZE));
      }

      try {
        const res = await fetch(`/api/scans?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }
        const data: ScanEntry[] = await res.json();

        if (append) {
          // The backend returns the full list up to the new limit, sorted by date.
          setScans(data);
          setHasMore(data.length >= scans.length + PAGE_SIZE);
        } else {
          setScans(data);
          setHasMore(data.length >= PAGE_SIZE);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch scans");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [toolFilter, domainSearch, scans.length],
  );

  // Initial load and filter changes
  useEffect(() => {
    fetchScans(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolFilter]);

  // Debounced domain search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchScans(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainSearch]);

  const handleLoadMore = useCallback(() => {
    fetchScans(true);
  }, [fetchScans]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/scans/${deleteTarget}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed with status ${res.status}`);
      }
      setScans((prev) => prev.filter((s) => s.id !== deleteTarget));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete scan",
      );
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  const handleRowClick = useCallback(
    (scanId: string) => {
      navigate(`/scans/${scanId}`);
    },
    [navigate],
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, scanId: string) => {
      e.stopPropagation();
      setDeleteTarget(scanId);
    },
    [],
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-surface-100">
          Scan History
        </h1>
        <p className="mt-1 text-sm text-surface-400">
          Browse and filter past scan results.
        </p>
      </div>

      {/* Filter controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Tool type dropdown */}
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-200 outline-none transition-colors focus:border-accent-500"
        >
          <option value="">All tools</option>
          {TOOL_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Domain search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="text"
            value={domainSearch}
            onChange={(e) => setDomainSearch(e.target.value)}
            placeholder="Search by domain..."
            className="w-full rounded-lg border border-surface-700 bg-surface-900 py-2 pl-9 pr-3 text-sm text-surface-200 placeholder:text-surface-500 outline-none transition-colors focus:border-accent-500"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-lg border border-status-danger/30 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-surface-600 border-t-accent-500" />
          <span className="ml-3 text-sm text-surface-400">
            Loading scans...
          </span>
        </div>
      ) : scans.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-surface-700 py-20">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="mb-4 h-12 w-12 text-surface-600"
          >
            <path
              fillRule="evenodd"
              d="M5.625 1.5H9a3.75 3.75 0 013.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 013.75 3.75v7.875c0 1.035-.84 1.875-1.875 1.875H5.625a1.875 1.875 0 01-1.875-1.875V3.375c0-1.036.84-1.875 1.875-1.875zm5.845 17.03a.75.75 0 001.06 0l3-3a.75.75 0 10-1.06-1.06l-1.72 1.72V12a.75.75 0 00-1.5 0v4.19l-1.72-1.72a.75.75 0 00-1.06 1.06l3 3z"
              clipRule="evenodd"
            />
            <path d="M14.25 5.25a5.23 5.23 0 00-1.279-3.434 9.768 9.768 0 016.963 6.963A5.23 5.23 0 0016.5 7.5h-1.875a.375.375 0 01-.375-.375V5.25z" />
          </svg>
          <p className="text-sm font-medium text-surface-300">
            No scans found
          </p>
          <p className="mt-1 text-xs text-surface-500">
            {toolFilter || domainSearch.trim()
              ? "Try adjusting your filters."
              : "Run a scan to see results here."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-surface-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-800 bg-surface-900/50">
                  <th className="px-4 py-3 font-medium text-surface-400">
                    Tool
                  </th>
                  <th className="px-4 py-3 font-medium text-surface-400">
                    Domain / Targets
                  </th>
                  <th className="px-4 py-3 font-medium text-surface-400">
                    Date
                  </th>
                  <th className="px-4 py-3 font-medium text-surface-400">
                    Status
                  </th>
                  <th className="px-4 py-3 font-medium text-surface-400">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr
                    key={scan.id}
                    onClick={() => handleRowClick(scan.id)}
                    className="cursor-pointer border-b border-surface-800/50 transition-colors hover:bg-surface-800/40 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <span className="inline-block rounded bg-accent-600/15 px-2 py-0.5 text-xs font-medium text-accent-400">
                        {scan.tool}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-surface-200">
                      {scan.domain || formatTargets(scan.targets)}
                    </td>
                    <td className="px-4 py-3 text-surface-400 whitespace-nowrap">
                      {formatDate(scan.started_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={scan.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => handleDeleteClick(e, scan.id)}
                        className="rounded-lg p-1.5 text-surface-500 transition-colors hover:bg-status-danger/10 hover:text-status-danger"
                        aria-label={`Delete scan ${scan.id.slice(0, 8)}`}
                        title="Delete scan"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="h-4 w-4"
                        >
                          <path
                            fillRule="evenodd"
                            d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination - Load More */}
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="rounded-lg border border-surface-700 px-4 py-2 text-sm font-medium text-surface-300 transition-colors hover:bg-surface-800 disabled:opacity-50"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-surface-600 border-t-accent-500" />
                    Loading...
                  </span>
                ) : (
                  "Load more"
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <DeleteConfirmDialog
          scanId={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
