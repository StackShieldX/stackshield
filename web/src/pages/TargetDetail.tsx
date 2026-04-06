/** Target detail page.
 *
 * Fetches all scans for a domain and groups them by tool type. Shows the most
 * recent result per tool via CombinedResultsPanel, with a dropdown per tool
 * section to switch between historical scan runs.
 *
 * Includes filter controls: date range picker, tool-type checkboxes, and a
 * scan timeline visualization. Filter state is synced with URL query params.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { getTargetScans, type TargetScanEntry } from "../api/client";
import CombinedResultsPanel, {
  type ToolResult,
} from "../components/results/CombinedResultsPanel";

// -- Constants ---------------------------------------------------------------

const KNOWN_TOOLS = ["dns", "ports", "certs"] as const;

const TOOL_LABELS: Record<string, string> = {
  dns: "DNS Discovery",
  ports: "Port Scan",
  certs: "Certificate Analysis",
};

const TOOL_COLORS: Record<string, { text: string; bg: string; dot: string }> = {
  dns: {
    text: "text-blue-400",
    bg: "bg-blue-500/15",
    dot: "bg-blue-400",
  },
  ports: {
    text: "text-amber-400",
    bg: "bg-amber-500/15",
    dot: "bg-amber-400",
  },
  certs: {
    text: "text-emerald-400",
    bg: "bg-emerald-500/15",
    dot: "bg-emerald-400",
  },
};

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
  return TOOL_LABELS[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1);
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

/** Get the date string (YYYY-MM-DD) from an ISO timestamp. */
function toDateKey(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

/** Parse a YYYY-MM-DD string to a Date at midnight. */
function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
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

// -- Filter Controls --------------------------------------------------------

function ToolTypeCheckboxes({
  availableTools,
  enabledTools,
  onToggle,
}: {
  availableTools: string[];
  enabledTools: Set<string>;
  onToggle: (tool: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-medium text-surface-400">Tools:</span>
      {availableTools.map((tool) => {
        const checked = enabledTools.has(tool);
        const colors = TOOL_COLORS[tool] ?? {
          text: "text-surface-400",
          bg: "bg-surface-700/50",
          dot: "bg-surface-400",
        };
        return (
          <label
            key={tool}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              checked
                ? `${colors.bg} ${colors.text}`
                : "bg-surface-800/50 text-surface-500"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(tool)}
              className="sr-only"
            />
            <span
              className={`inline-block h-2 w-2 rounded-full transition-colors ${
                checked ? colors.dot : "bg-surface-600"
              }`}
            />
            {TOOL_LABELS[tool] ?? tool}
          </label>
        );
      })}
    </div>
  );
}

function DateRangeFilter({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}: {
  startDate: string;
  endDate: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-medium text-surface-400">Date range:</span>
      <input
        type="date"
        value={startDate}
        onChange={(e) => onStartChange(e.target.value)}
        className="rounded-lg border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-xs text-surface-300 outline-none transition-colors focus:border-accent-500 [color-scheme:dark]"
      />
      <span className="text-xs text-surface-500">to</span>
      <input
        type="date"
        value={endDate}
        onChange={(e) => onEndChange(e.target.value)}
        className="rounded-lg border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-xs text-surface-300 outline-none transition-colors focus:border-accent-500 [color-scheme:dark]"
      />
    </div>
  );
}

// -- Scan Timeline ----------------------------------------------------------

interface TimelineBucket {
  dateKey: string;
  date: Date;
  counts: Record<string, number>;
  total: number;
}

function buildTimelineBuckets(scans: TargetScanEntry[]): TimelineBucket[] {
  const bucketMap = new Map<string, Record<string, number>>();

  for (const scan of scans) {
    const dk = toDateKey(scan.started_at);
    if (!dk) continue;
    const counts = bucketMap.get(dk) ?? {};
    counts[scan.tool] = (counts[scan.tool] ?? 0) + 1;
    bucketMap.set(dk, counts);
  }

  const buckets: TimelineBucket[] = [];
  for (const [dateKey, counts] of bucketMap) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    buckets.push({ dateKey, date: new Date(dateKey + "T00:00:00"), counts, total });
  }

  // Sort chronologically
  buckets.sort((a, b) => a.date.getTime() - b.date.getTime());
  return buckets;
}

function ScanTimeline({
  buckets,
  startDate,
  endDate,
  enabledTools,
  onDateClick,
}: {
  buckets: TimelineBucket[];
  startDate: string;
  endDate: string;
  enabledTools: Set<string>;
  onDateClick: (dateKey: string) => void;
}) {
  if (buckets.length === 0) return null;

  const maxTotal = Math.max(...buckets.map((b) => b.total), 1);
  const chartHeight = 60;
  const barWidth = 24;
  const barGap = 4;
  const chartWidth = buckets.length * (barWidth + barGap) - barGap;

  const startD = parseDateInput(startDate);
  const endD = parseDateInput(endDate);

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-surface-400">
          Scan Timeline
        </span>
        <span className="text-xs text-surface-500">
          {buckets.length} day{buckets.length !== 1 ? "s" : ""} with scans
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          width={Math.max(chartWidth, 100)}
          height={chartHeight + 28}
          className="block"
        >
          {buckets.map((bucket, i) => {
            const x = i * (barWidth + barGap);
            const barHeight = Math.max(
              (bucket.total / maxTotal) * chartHeight,
              3,
            );
            const y = chartHeight - barHeight;

            // Determine if this bucket is within the selected date range
            const bucketDate = bucket.date;
            const inRange =
              (!startD || bucketDate >= startD) &&
              (!endD ||
                bucketDate <= new Date(endD.getTime() + 86400000 - 1));

            // Build stacked bar segments for each tool
            const tools = Object.keys(bucket.counts).filter((t) =>
              enabledTools.has(t),
            );
            const visibleTotal = tools.reduce(
              (sum, t) => sum + (bucket.counts[t] ?? 0),
              0,
            );
            const segments: {
              tool: string;
              segHeight: number;
              segY: number;
            }[] = [];
            let segOffset = 0;
            for (const tool of tools) {
              const count = bucket.counts[tool] ?? 0;
              const segHeight =
                visibleTotal > 0
                  ? (count / visibleTotal) * barHeight
                  : 0;
              segments.push({
                tool,
                segHeight,
                segY: y + (barHeight - segOffset - segHeight),
              });
              segOffset += segHeight;
            }

            return (
              <g
                key={bucket.dateKey}
                className="cursor-pointer"
                onClick={() => onDateClick(bucket.dateKey)}
              >
                {/* Background highlight for selected range */}
                {inRange && (
                  <rect
                    x={x - 2}
                    y={0}
                    width={barWidth + 4}
                    height={chartHeight + 2}
                    rx={3}
                    className="fill-accent-500/10"
                  />
                )}

                {/* Stacked bar segments */}
                {segments.map((seg) => {
                  const color = TOOL_COLORS[seg.tool];
                  // Map dot colors to fill colors for the SVG
                  const fillClass = color
                    ? seg.tool === "dns"
                      ? "fill-blue-400"
                      : seg.tool === "ports"
                        ? "fill-amber-400"
                        : "fill-emerald-400"
                    : "fill-surface-500";
                  return (
                    <rect
                      key={seg.tool}
                      x={x}
                      y={seg.segY}
                      width={barWidth}
                      height={Math.max(seg.segHeight, 1)}
                      rx={2}
                      className={`${fillClass} ${
                        inRange ? "opacity-100" : "opacity-40"
                      } transition-opacity hover:opacity-100`}
                    />
                  );
                })}

                {/* If no visible tools, render a dim placeholder */}
                {segments.length === 0 && (
                  <rect
                    x={x}
                    y={chartHeight - 3}
                    width={barWidth}
                    height={3}
                    rx={1}
                    className="fill-surface-700 opacity-30"
                  />
                )}

                {/* Date label */}
                <text
                  x={x + barWidth / 2}
                  y={chartHeight + 14}
                  textAnchor="middle"
                  className={`text-[9px] ${
                    inRange ? "fill-surface-300" : "fill-surface-600"
                  }`}
                >
                  {bucket.date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </text>

                {/* Count tooltip on hover */}
                <title>
                  {bucket.dateKey}: {bucket.total} scan
                  {bucket.total !== 1 ? "s" : ""}
                  {"\n"}
                  {Object.entries(bucket.counts)
                    .map(([t, c]) => `  ${toolDisplayName(t)}: ${c}`)
                    .join("\n")}
                </title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// -- Tool Group Section -----------------------------------------------------

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [scans, setScans] = useState<TargetScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track which historical run is selected per tool type (index into the
  // tool's scan array, where 0 = most recent).
  const [selectedRuns, setSelectedRuns] = useState<Record<string, number>>({});

  // Ref for scrolling to tool sections when timeline is clicked
  const toolSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // -- Initialize filter state from URL params ------------------------------

  const initToolsFromParams = useCallback((): Set<string> => {
    const toolsParam = searchParams.get("tools");
    if (toolsParam) {
      return new Set(toolsParam.split(",").filter(Boolean));
    }
    return new Set(KNOWN_TOOLS);
  }, [searchParams]);

  const [enabledTools, setEnabledTools] = useState<Set<string>>(
    initToolsFromParams,
  );
  const [startDate, setStartDate] = useState(
    searchParams.get("from") ?? "",
  );
  const [endDate, setEndDate] = useState(
    searchParams.get("to") ?? "",
  );

  // -- Data fetching --------------------------------------------------------

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

  // -- Sync filter state to URL params (debounced) --------------------------

  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      const params: Record<string, string> = {};

      // Only store tools param if not all tools are enabled
      const allEnabled =
        enabledTools.size >= KNOWN_TOOLS.length &&
        KNOWN_TOOLS.every((t) => enabledTools.has(t));
      if (!allEnabled && enabledTools.size > 0) {
        params.tools = Array.from(enabledTools).join(",");
      }

      if (startDate) params.from = startDate;
      if (endDate) params.to = endDate;

      setSearchParams(params, { replace: true });
    }, 150);

    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledTools, startDate, endDate]);

  // -- Derived data ---------------------------------------------------------

  // Discover all tool types present in the scan data
  const availableTools = useMemo(() => {
    const tools = new Set<string>();
    for (const scan of scans) {
      tools.add(scan.tool);
    }
    // Return sorted with known tools first
    const known = KNOWN_TOOLS.filter((t) => tools.has(t));
    const unknown = Array.from(tools)
      .filter((t) => !KNOWN_TOOLS.includes(t as typeof KNOWN_TOOLS[number]))
      .sort();
    return [...known, ...unknown];
  }, [scans]);

  // Filter scans by date range and tool type
  const filteredScans = useMemo(() => {
    const startD = parseDateInput(startDate);
    const endD = parseDateInput(endDate);

    return scans.filter((scan) => {
      // Tool filter
      if (!enabledTools.has(scan.tool)) return false;

      // Date range filter
      if (scan.started_at) {
        const scanDate = new Date(scan.started_at);
        if (startD && scanDate < startD) return false;
        // End date is inclusive: include scans up to end of the day
        if (endD && scanDate > new Date(endD.getTime() + 86400000 - 1)) {
          return false;
        }
      }

      return true;
    });
  }, [scans, enabledTools, startDate, endDate]);

  const toolGroups = useMemo(() => groupByTool(filteredScans), [filteredScans]);

  // Timeline buckets are built from ALL scans (unfiltered) so the full
  // history is always visible. The selected range is highlighted on top.
  const timelineBuckets = useMemo(() => buildTimelineBuckets(scans), [scans]);

  // Compute header stats (from filtered scans)
  const scanCount = filteredScans.length;
  const totalCount = scans.length;
  const dateRange = useMemo(() => {
    if (scans.length === 0) return null;
    const newest = scans[0].started_at;
    const oldest = scans[scans.length - 1].started_at;
    return { first: oldest, last: newest };
  }, [scans]);

  // -- Handlers -------------------------------------------------------------

  const handleSelectRun = (tool: string, index: number) => {
    setSelectedRuns((prev) => ({ ...prev, [tool]: index }));
  };

  const handleToolToggle = (tool: string) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) {
        next.delete(tool);
      } else {
        next.add(tool);
      }
      return next;
    });
  };

  const handleTimelineDateClick = (dateKey: string) => {
    // Set the date range to just this date
    setStartDate(dateKey);
    setEndDate(dateKey);

    // Scroll to the first tool section that has scans on this date
    requestAnimationFrame(() => {
      const firstTool = availableTools.find((t) =>
        enabledTools.has(t) &&
        scans.some(
          (s) => s.tool === t && toDateKey(s.started_at) === dateKey,
        ),
      );
      if (firstTool && toolSectionRefs.current[firstTool]) {
        toolSectionRefs.current[firstTool]?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
  };

  const hasActiveFilters =
    startDate !== "" ||
    endDate !== "" ||
    enabledTools.size !== availableTools.length ||
    !availableTools.every((t) => enabledTools.has(t));

  const handleClearFilters = () => {
    setStartDate("");
    setEndDate("");
    setEnabledTools(new Set(availableTools));
    setSelectedRuns({});
  };

  // -- Render states --------------------------------------------------------

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
            {scanCount === totalCount
              ? `${scanCount} scan${scanCount !== 1 ? "s" : ""}`
              : `${scanCount} of ${totalCount} scans`}
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

      {/* Filter controls */}
      <div className="mb-6 space-y-3 rounded-lg border border-surface-700 bg-surface-900/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="text-sm font-medium text-surface-300">Filters</span>
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1 rounded-md border border-surface-700 bg-surface-800 px-2.5 py-1 text-xs text-surface-400 transition-colors hover:border-surface-600 hover:text-surface-200"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
              Clear filters
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-6">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
          <ToolTypeCheckboxes
            availableTools={availableTools}
            enabledTools={enabledTools}
            onToggle={handleToolToggle}
          />
        </div>
      </div>

      {/* Scan timeline visualization */}
      <div className="mb-6">
        <ScanTimeline
          buckets={timelineBuckets}
          startDate={startDate}
          endDate={endDate}
          enabledTools={enabledTools}
          onDateClick={handleTimelineDateClick}
        />
      </div>

      {/* Filtered results */}
      {filteredScans.length === 0 ? (
        <div className="rounded-lg border border-dashed border-surface-700 py-12 text-center">
          <p className="text-sm text-surface-400">
            No scans match the current filters.
          </p>
          <button
            onClick={handleClearFilters}
            className="mt-2 text-xs text-accent-400 hover:text-accent-300 transition-colors"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(toolGroups.entries()).map(([tool, toolScans]) => (
            <div
              key={tool}
              ref={(el) => {
                toolSectionRefs.current[tool] = el;
              }}
            >
              <ToolGroupSection
                tool={tool}
                scans={toolScans}
                selectedIndex={selectedRuns[tool] ?? 0}
                onSelectIndex={(index) => handleSelectRun(tool, index)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
