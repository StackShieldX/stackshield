import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  listScans,
  listRunningScans,
  type ScanMeta,
  type RunningScanEntry,
} from "../api/client";

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

interface ToolInfo {
  label: string;
  color: string;
  bgColor: string;
  description: string;
}

const TOOL_MAP: Record<string, ToolInfo> = {
  dns: {
    label: "DNS",
    color: "text-blue-400",
    bgColor: "bg-blue-500/15",
    description: "DNS discovery and subdomain enumeration",
  },
  ports: {
    label: "Ports",
    color: "text-amber-400",
    bgColor: "bg-amber-500/15",
    description: "Port scanning and service detection",
  },
  certs: {
    label: "Certs",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/15",
    description: "TLS certificate analysis",
  },
};

const ALL_TOOLS = Object.keys(TOOL_MAP);

function getToolInfo(tool: string): ToolInfo {
  return (
    TOOL_MAP[tool] ?? {
      label: tool,
      color: "text-surface-400",
      bgColor: "bg-surface-700/50",
      description: "Security scan",
    }
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (Heroicons mini style, 20x20)
// ---------------------------------------------------------------------------

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className ?? "h-5 w-5"}
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-1.5 0a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0zM10 3.5a.75.75 0 01.75.75v.008c1.612.718 2.916 2.327 3.529 4.406a.75.75 0 01-1.439.424C12.36 7.34 11.3 6 10 5.605V5.5a.75.75 0 01-.75-.75V4.25A.75.75 0 0110 3.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
    >
      <path
        fillRule="evenodd"
        d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
    </svg>
  );
}

function RocketIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-10 w-10"
    >
      <path
        fillRule="evenodd"
        d="M4.606 12.97a.75.75 0 01-.134 1.051 2.494 2.494 0 00-.93 2.437 2.494 2.494 0 002.437-.93.75.75 0 111.186.918 3.995 3.995 0 01-4.482 1.332.75.75 0 01-.461-.461 3.994 3.994 0 011.332-4.482.75.75 0 011.052.134z"
        clipRule="evenodd"
      />
      <path
        fillRule="evenodd"
        d="M13.703 1.645a.75.75 0 01.597.362 16.455 16.455 0 01.762 1.396c1.537 3.09 2.188 6.806 1.553 9.4a.75.75 0 01-.4.48l-3.265 1.498a.75.75 0 01-.814-.122l-1.098-1.016a.75.75 0 01.526-1.287h.736l.268-.135A10.27 10.27 0 0013.37 8.63c-.4-1.065-.945-2.01-1.547-2.806L10 8.056l-1.92-1.776A12.636 12.636 0 006.5 8.63a10.27 10.27 0 00.802 3.591l.268.135h.736a.75.75 0 01.526 1.287l-1.098 1.016a.75.75 0 01-.814.122L3.655 13.28a.75.75 0 01-.4-.48c-.635-2.594.016-6.31 1.553-9.4.276-.554.502-1.003.762-1.396a.75.75 0 01.597-.362c.864-.086 2.18-.118 3.833-.118s2.97.032 3.833.118z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
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
  return date.toLocaleDateString();
}

function extractTarget(scan: ScanMeta): string {
  if (scan.domain) return scan.domain;
  if (scan.targets) {
    try {
      const parsed = JSON.parse(scan.targets);
      if (Array.isArray(parsed)) return parsed.join(", ");
    } catch {
      return scan.targets;
    }
  }
  return "---";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScanActivityCard({ scans }: { scans: ScanMeta[] }) {
  const total = scans.length;
  const completed = scans.filter((s) => s.status === "complete").length;
  const failed = scans.filter((s) => s.status === "failed").length;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const mostRecent = scans[0];

  // Ring chart values
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const successOffset = circumference - (circumference * successRate) / 100;

  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-surface-500">
            Scan activity
          </p>
          <p className="mt-1 text-3xl font-bold text-surface-100">{total}</p>
          <p className="mt-0.5 text-xs text-surface-500">total scans</p>
        </div>
        <div className="relative flex h-[72px] w-[72px] items-center justify-center">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              className="text-surface-800"
            />
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeDasharray={circumference}
              strokeDashoffset={successOffset}
              strokeLinecap="round"
              className="text-status-success transition-all duration-500"
            />
          </svg>
          <span className="absolute text-xs font-bold text-surface-200">
            {successRate}%
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-status-success" />
          <span className="text-surface-400">{completed} passed</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-status-danger" />
          <span className="text-surface-400">{failed} failed</span>
        </span>
      </div>
      {mostRecent && (
        <p className="mt-3 border-t border-surface-800 pt-3 text-xs text-surface-500">
          Last scan {formatTimestamp(mostRecent.started_at)}
        </p>
      )}
    </div>
  );
}

function TargetCoverageCard({ scans }: { scans: ScanMeta[] }) {
  const domains = scans.map((s) => s.domain).filter(Boolean) as string[];
  const uniqueDomains = new Set(domains).size;

  // Top domains by scan count
  const domainCounts: Record<string, number> = {};
  for (const d of domains) {
    domainCounts[d] = (domainCounts[d] ?? 0) + 1;
  }
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const avgScans =
    uniqueDomains > 0
      ? (domains.length / uniqueDomains).toFixed(1)
      : "0";

  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-surface-500">
            Target coverage
          </p>
          <p className="mt-1 text-3xl font-bold text-surface-100">
            {uniqueDomains}
          </p>
          <p className="mt-0.5 text-xs text-surface-500">unique domains</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-600/15 text-accent-400">
          <GlobeIcon />
        </div>
      </div>
      {topDomains.length > 0 && (
        <div className="mt-4 space-y-2">
          {topDomains.map(([domain, count]) => (
            <div
              key={domain}
              className="flex items-center justify-between text-xs"
            >
              <span className="truncate font-mono text-surface-300">
                {domain}
              </span>
              <span className="ml-2 shrink-0 rounded-full bg-surface-800 px-2 py-0.5 text-surface-400">
                {count} {count === 1 ? "scan" : "scans"}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 border-t border-surface-800 pt-3 text-xs text-surface-500">
        {avgScans} avg scans per target
      </p>
    </div>
  );
}

function ToolBreakdown({ scans }: { scans: ScanMeta[] }) {
  const counts: Record<string, number> = {};
  const lastScanByTool: Record<string, string> = {};
  for (const s of scans) {
    counts[s.tool] = (counts[s.tool] ?? 0) + 1;
    if (!lastScanByTool[s.tool] || s.started_at > lastScanByTool[s.tool]) {
      lastScanByTool[s.tool] = s.started_at;
    }
  }
  const total = scans.length || 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-surface-500">
        Tool breakdown
      </p>
      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-surface-500">No data yet</p>
      ) : (
        <div className="mt-3 space-y-3">
          {sorted.map(([tool, count]) => {
            const info = getToolInfo(tool);
            const pct = Math.round((count / total) * 100);
            return (
              <div key={tool}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold ${info.bgColor} ${info.color}`}
                    >
                      {info.label.charAt(0)}
                    </span>
                    <span className={`text-sm font-medium ${info.color}`}>
                      {info.label}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-surface-300">
                    {count}
                    <span className="ml-1 text-xs font-normal text-surface-500">
                      ({pct}%)
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-800">
                  <div
                    className={`h-full rounded-full ${info.bgColor.replace("/15", "/60")} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-surface-600">
                  last run {formatTimestamp(lastScanByTool[tool])}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    complete:
      "bg-status-success/15 text-status-success border-status-success/25",
    failed: "bg-status-danger/15 text-status-danger border-status-danger/25",
    running: "bg-status-info/15 text-status-info border-status-info/25",
  };
  const cls =
    styles[status] ??
    "bg-surface-700/50 text-surface-400 border-surface-700";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

function ToolBadge({ tool }: { tool: string }) {
  const info = getToolInfo(tool);
  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${info.bgColor} ${info.color}`}
    >
      {info.label.charAt(0).toUpperCase()}
    </span>
  );
}

function RunningScanRow({ scan }: { scan: RunningScanEntry }) {
  const info = getToolInfo(scan.tool);
  const target =
    scan.params.domain ?? scan.params.targets ?? "---";
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-800/50 px-4 py-3">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-info opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-status-info" />
      </span>
      <ToolBadge tool={scan.tool} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-surface-200">
          {info.label} scan
        </p>
        <p className="truncate text-xs text-surface-500">{target}</p>
      </div>
      <span className="text-xs text-surface-500">
        {formatTimestamp(scan.started_at)}
      </span>
    </div>
  );
}

function ScanRow({
  scan,
  onClick,
}: {
  scan: ScanMeta;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-surface-800/60"
    >
      <ToolBadge tool={scan.tool} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-surface-200">
          {extractTarget(scan)}
        </p>
        <p className="text-xs text-surface-500">
          {getToolInfo(scan.tool).label}
        </p>
      </div>
      <StatusBadge status={scan.status} />
      <span className="shrink-0 text-xs text-surface-500">
        {formatTimestamp(scan.started_at)}
      </span>
    </button>
  );
}

function QuickLaunchCard({
  tool,
  info,
}: {
  tool: string;
  info: ToolInfo;
}) {
  return (
    <Link
      to={`/scan?tool=${tool}`}
      className="group flex items-center gap-3 rounded-xl border border-surface-800 bg-surface-900 p-4 transition-colors hover:border-accent-600/40 hover:bg-surface-800/70"
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${info.bgColor} ${info.color}`}
      >
        <PlayIcon />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-surface-200 group-hover:text-surface-100">
          {info.label}
        </p>
        <p className="truncate text-xs text-surface-500">
          {info.description}
        </p>
      </div>
      <span className="text-surface-600 transition-colors group-hover:text-accent-400">
        <ArrowRightIcon />
      </span>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-surface-600">
        <RocketIcon />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-surface-200">
        No scans yet
      </h2>
      <p className="mt-1 max-w-sm text-sm text-surface-500">
        Get started by launching your first security scan. Pick a tool below
        or use the New Scan page.
      </p>
      <Link
        to="/scan"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-500"
      >
        Launch a scan
        <ArrowRightIcon />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const navigate = useNavigate();

  const [scans, setScans] = useState<ScanMeta[]>([]);
  const [runningScans, setRunningScans] = useState<RunningScanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [scanList, runningList] = await Promise.all([
        listScans({ limit: 100 }),
        listRunningScans(),
      ]);
      setScans(scanList);
      setRunningScans(runningList.running);
      setError(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load data";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Poll for running scans every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Derived metrics
  const recentScans = scans.slice(0, 10);
  const isEmpty = scans.length === 0 && runningScans.length === 0;

  // Skeleton placeholder while loading
  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-surface-100">
          Dashboard
        </h1>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-surface-800 bg-surface-900"
            />
          ))}
        </div>
        <div className="mt-8 space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-surface-900"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-surface-100">
          Dashboard
        </h1>
        <div className="mt-6 rounded-xl border border-status-danger/25 bg-status-danger/10 p-6 text-center">
          <p className="text-sm text-status-danger">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 text-sm text-accent-400 hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-100">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Overview of recent scans and security posture.
          </p>
        </div>
        <Link
          to="/scan"
          className="hidden items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-500 sm:inline-flex"
        >
          New scan
          <ArrowRightIcon />
        </Link>
      </div>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {/* Metric cards */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ScanActivityCard scans={scans} />
            <TargetCoverageCard scans={scans} />
            <ToolBreakdown scans={scans} />
          </div>

          {/* Running scans */}
          {runningScans.length > 0 && (
            <section className="mt-8">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-info opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-status-info" />
                </span>
                <h2 className="text-sm font-semibold text-surface-300">
                  Running ({runningScans.length})
                </h2>
              </div>
              <div className="mt-3 space-y-2">
                {runningScans.map((rs) => (
                  <RunningScanRow key={rs.scan_id} scan={rs} />
                ))}
              </div>
            </section>
          )}

          {/* Recent scans feed */}
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-surface-300">
                Recent scans
              </h2>
              <Link
                to="/history"
                className="text-xs text-accent-400 hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="mt-3 divide-y divide-surface-800 rounded-xl border border-surface-800 bg-surface-900">
              {recentScans.map((scan) => (
                <ScanRow
                  key={scan.id}
                  scan={scan}
                  onClick={() => navigate(`/scans/${scan.id}`)}
                />
              ))}
            </div>
          </section>

          {/* Quick-launch tools */}
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-surface-300">
              Quick launch
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ALL_TOOLS.map((tool) => (
                <QuickLaunchCard
                  key={tool}
                  tool={tool}
                  info={getToolInfo(tool)}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
