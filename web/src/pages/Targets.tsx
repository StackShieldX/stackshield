import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listTargets, type TargetSummary } from "../api/client";

// ---------------------------------------------------------------------------
// Tool badge styling
// ---------------------------------------------------------------------------

interface ToolStyle {
  label: string;
  color: string;
  bgColor: string;
}

const TOOL_STYLES: Record<string, ToolStyle> = {
  dns: { label: "DNS", color: "text-blue-400", bgColor: "bg-blue-500/15" },
  ports: { label: "Ports", color: "text-amber-400", bgColor: "bg-amber-500/15" },
  certs: { label: "Certs", color: "text-emerald-400", bgColor: "bg-emerald-500/15" },
};

function getToolStyle(tool: string): ToolStyle {
  return (
    TOOL_STYLES[tool] ?? {
      label: tool,
      color: "text-surface-400",
      bgColor: "bg-surface-700/50",
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(iso);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolBadge({ tool }: { tool: string }) {
  const style = getToolStyle(tool);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bgColor} ${style.color}`}
    >
      {style.label}
    </span>
  );
}

function TargetRow({
  target,
  onClick,
}: {
  target: TargetSummary;
  onClick: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer border-b border-surface-800/50 transition-colors hover:bg-surface-800/40 last:border-0"
    >
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-surface-200">
          {target.domain}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm text-surface-300">{target.scan_count}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {target.tools.map((tool) => (
            <ToolBadge key={tool} tool={tool} />
          ))}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-sm text-surface-400" title={formatDate(target.last_scanned_at)}>
          {formatRelative(target.last_scanned_at)}
        </span>
      </td>
    </tr>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-surface-700 py-20">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="mb-4 h-12 w-12 text-surface-600"
      >
        <path
          fillRule="evenodd"
          d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03z"
          clipRule="evenodd"
        />
      </svg>
      <p className="text-sm font-medium text-surface-300">
        {hasSearch ? "No matching targets" : "No targets found"}
      </p>
      <p className="mt-1 text-xs text-surface-500">
        {hasSearch
          ? "Try adjusting your search query."
          : "Run a scan first to see your targets here."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Targets page
// ---------------------------------------------------------------------------

export default function Targets() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [targets, setTargets] = useState<TargetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The search input is synced with the ?q= query param
  const queryParam = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(queryParam);

  // Debounce ref for search input
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTargets = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTargets({ q: q || undefined });
      setTargets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch targets");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load using query param
  useEffect(() => {
    fetchTargets(queryParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced search: update URL param and fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Sync the URL search param
      if (search.trim()) {
        setSearchParams({ q: search.trim() }, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
      fetchTargets(search.trim());
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleRowClick = useCallback(
    (domain: string) => {
      navigate(`/targets/${encodeURIComponent(domain)}`);
    },
    [navigate],
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-surface-100">Targets</h1>
        <p className="mt-1 text-sm text-surface-400">
          Browse all scanned domains and their scan history.
        </p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search targets by domain..."
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

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-surface-600 border-t-accent-500" />
          <span className="ml-3 text-sm text-surface-400">
            Loading targets...
          </span>
        </div>
      ) : targets.length === 0 ? (
        <EmptyState hasSearch={search.trim().length > 0} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-surface-800">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-800 bg-surface-900/50">
                <th className="px-4 py-3 font-medium text-surface-400">
                  Domain
                </th>
                <th className="px-4 py-3 text-center font-medium text-surface-400">
                  Scans
                </th>
                <th className="px-4 py-3 font-medium text-surface-400">
                  Tools
                </th>
                <th className="px-4 py-3 font-medium text-surface-400">
                  Last Scanned
                </th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => (
                <TargetRow
                  key={target.domain}
                  target={target}
                  onClick={() => handleRowClick(target.domain)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
