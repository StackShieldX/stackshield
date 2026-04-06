/** Target detail page.
 *
 * Fetches all scans for a domain and groups them by tool type. Shows the most
 * recent result per tool via CombinedResultsPanel, with a dropdown per tool
 * section to switch between historical scan runs.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getTargetScans, type TargetScanEntry } from "../api/client";
import CombinedResultsPanel, {
  type ToolResult,
} from "../components/results/CombinedResultsPanel";

// -- Helpers ----------------------------------------------------------------

/** Group scans by tool name, preserving the backend's descending date order. */
function groupByTool(
  scans: TargetScanEntry[],
): Map<string, TargetScanEntry[]> {
  const groups = new Map<string, TargetScanEntry[]>();
  for (const scan of scans) {
    const existing = groups.get(scan.tool);
    if (existing) {
      existing.push(scan);
    } else {
      groups.set(scan.tool, [scan]);
    }
  }
  return groups;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function toolDisplayName(tool: string): string {
  switch (tool) {
    case "dns":
      return "DNS Discovery";
    case "ports":
      return "Port Scan";
    case "certs":
      return "Certificate Analysis";
    default:
      return tool.charAt(0).toUpperCase() + tool.slice(1);
  }
}

/** Unwrap result_json if the tool_runner wrapped it in {"data": ...}. */
function unwrapResultJson(
  raw: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!raw) return {};
  if (
    "data" in raw &&
    Object.keys(raw).length === 1 &&
    typeof raw.data === "object" &&
    raw.data !== null
  ) {
    return raw.data as Record<string, unknown>;
  }
  return raw;
}

// -- Sub-components ---------------------------------------------------------

function LoadingState() {
  return (
    <div className="p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-24 rounded bg-surface-800" />
        <div className="h-8 w-64 rounded bg-surface-800" />
        <div className="h-4 w-48 rounded bg-surface-800" />
        <div className="mt-8 space-y-3">
          <div className="h-20 rounded-lg bg-surface-800" />
          <div className="h-32 rounded-lg bg-surface-800" />
          <div className="h-48 rounded-lg bg-surface-800" />
        </div>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-6">
      <Link
        to="/targets"
        className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors mb-4"
      >
        <BackArrowIcon />
        Back to targets
      </Link>
      <div className="mx-auto max-w-md rounded-lg border border-status-danger/40 bg-status-danger/5 p-6 text-center mt-8">
        <h2 className="text-lg font-semibold text-status-danger">
          Error loading target
        </h2>
        <p className="mt-2 text-sm text-surface-400">{message}</p>
      </div>
    </div>
  );
}

function EmptyState({ domain }: { domain: string }) {
  return (
    <div className="p-6">
      <Link
        to="/targets"
        className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors mb-4"
      >
        <BackArrowIcon />
        Back to targets
      </Link>
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-surface-700 py-20 mt-4">
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
          No scans found for{" "}
          <span className="font-mono text-surface-200">{domain}</span>
        </p>
        <p className="mt-1 text-xs text-surface-500">
          Run a scan targeting this domain to see results here.
        </p>
      </div>
    </div>
  );
}

function BackArrowIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
    >
      <path
        fillRule="evenodd"
        d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
        clipRule="evenodd"
      />
    </svg>
  );
}

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

/** A tool section with a historical run selector and scan metadata. */
function ToolGroupSection({
  tool,
  scans,
  selectedIndex,
  onSelectIndex,
}: {
  tool: string;
  scans: TargetScanEntry[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const selectedScan = scans[selectedIndex];
  if (!selectedScan) return null;

  const resultData = unwrapResultJson(selectedScan.result_json);
  const toolResult: ToolResult = {
    tool: selectedScan.tool,
    data: resultData,
    scanId: selectedScan.id,
    scannedAt: selectedScan.started_at,
  };

  return (
    <div className="rounded-lg border border-surface-700 overflow-hidden">
      {/* Tool header with run selector */}
      <div className="flex flex-wrap items-center gap-3 bg-surface-800/60 px-4 py-3">
        <span className="text-sm font-semibold text-surface-200">
          {toolDisplayName(tool)}
        </span>

        {scans.length > 1 && (
          <select
            value={selectedIndex}
            onChange={(e) => onSelectIndex(Number(e.target.value))}
            className="rounded-lg border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-xs text-surface-300 outline-none transition-colors focus:border-accent-500"
          >
            {scans.map((scan, idx) => (
              <option key={scan.id} value={idx}>
                {formatTimestamp(scan.started_at)}
                {idx === 0 ? " (latest)" : ""}
              </option>
            ))}
          </select>
        )}

        <span className="ml-auto text-xs text-surface-500">
          {scans.length} run{scans.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Scan metadata bar */}
      <div className="flex flex-wrap items-center gap-4 border-t border-surface-700 bg-surface-900/40 px-4 py-2 text-xs text-surface-500">
        <span>
          ID:{" "}
          <span className="font-mono text-surface-400">
            {selectedScan.id.slice(0, 8)}
          </span>
        </span>
        <span>
          Started: {formatTimestamp(selectedScan.started_at)}
        </span>
        {selectedScan.finished_at && (
          <span>
            Finished: {formatTimestamp(selectedScan.finished_at)}
          </span>
        )}
        <StatusBadge status={selectedScan.status} />
      </div>

      {/* Results rendered via CombinedResultsPanel */}
      <div className="border-t border-surface-700 p-4">
        <CombinedResultsPanel results={[toolResult]} />
      </div>
    </div>
  );
}

// -- Main component ---------------------------------------------------------

export default function TargetDetail() {
  const { domain } = useParams<{ domain: string }>();
  const [scans, setScans] = useState<TargetScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track which historical run is selected per tool type (index into the
  // tool's scan array, where 0 = most recent).
  const [selectedRuns, setSelectedRuns] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!domain) return;

    setLoading(true);
    setError(null);
    setSelectedRuns({});

    getTargetScans(domain)
      .then((data) => {
        setScans(data);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "Failed to load scans",
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [domain]);

  const toolGroups = useMemo(() => groupByTool(scans), [scans]);

  // Compute header stats
  const scanCount = scans.length;
  const dateRange = useMemo(() => {
    if (scans.length === 0) return null;
    // Scans arrive ordered by started_at descending, so last is oldest
    const newest = scans[0].started_at;
    const oldest = scans[scans.length - 1].started_at;
    return { first: oldest, last: newest };
  }, [scans]);

  const handleSelectRun = (tool: string, index: number) => {
    setSelectedRuns((prev) => ({ ...prev, [tool]: index }));
  };

  // Render states
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!domain) return <ErrorState message="No domain specified" />;
  if (scans.length === 0) return <EmptyState domain={domain} />;

  return (
    <div className="p-6">
      {/* Back link */}
      <Link
        to="/targets"
        className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors mb-4"
      >
        <BackArrowIcon />
        Back to targets
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-surface-100 font-mono">
          {domain}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-surface-400">
          <span>
            {scanCount} scan{scanCount !== 1 ? "s" : ""}
          </span>
          <span className="text-surface-700">|</span>
          <span>
            {toolGroups.size} tool type{toolGroups.size !== 1 ? "s" : ""}
          </span>
          {dateRange && (
            <>
              <span className="text-surface-700">|</span>
              <span>
                {formatDateShort(dateRange.first)} &ndash;{" "}
                {formatDateShort(dateRange.last)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Tool sections */}
      <div className="space-y-6">
        {Array.from(toolGroups.entries()).map(([tool, toolScans]) => (
          <ToolGroupSection
            key={tool}
            tool={tool}
            scans={toolScans}
            selectedIndex={selectedRuns[tool] ?? 0}
            onSelectIndex={(index) => handleSelectRun(tool, index)}
          />
        ))}
      </div>
    </div>
  );
}
