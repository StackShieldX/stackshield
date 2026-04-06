/** Combined results dashboard component.
 *
 * Renders multiple tool results in a unified dashboard with a summary metrics
 * bar and collapsible per-tool sections. Reuses DnsResults, PortResults, and
 * CertResults for known tool types, falling back to JsonTreeView for unknown ones.
 */

import { useState } from "react";
import DnsResults from "./DnsResults";
import PortResults from "./PortResults";
import CertResults from "./CertResults";
import JsonTreeView from "./JsonTreeView";

// -- Types ------------------------------------------------------------------

export interface ToolResult {
  tool: string;
  data: Record<string, unknown>;
  scanId?: string;
  scannedAt?: string;
}

interface CombinedResultsPanelProps {
  results: ToolResult[];
}

// -- Helpers ----------------------------------------------------------------

type KnownTool = "dns" | "ports" | "certs";

const KNOWN_TOOLS: ReadonlySet<string> = new Set<KnownTool>(["dns", "ports", "certs"]);

function isKnownTool(tool: string): tool is KnownTool {
  return KNOWN_TOOLS.has(tool);
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

function formatTimestamp(value: string | undefined): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

// -- Metrics extraction -----------------------------------------------------

interface SummaryMetrics {
  subdomains: number;
  openPorts: number;
  certificates: number;
}

function extractMetrics(results: ToolResult[]): SummaryMetrics {
  let subdomains = 0;
  let openPorts = 0;
  let certificates = 0;

  const uniqueSubdomains = new Set<string>();

  for (const { tool, data } of results) {
    if (tool === "dns") {
      const subs = data.subdomains;
      if (Array.isArray(subs)) {
        for (const s of subs) {
          const name = typeof s === "string" ? s : (s as Record<string, unknown>).name;
          if (typeof name === "string") uniqueSubdomains.add(name);
        }
      }
    } else if (tool === "ports") {
      const portResults = data.results;
      if (Array.isArray(portResults)) {
        openPorts += portResults.length;
      }
    } else if (tool === "certs") {
      const tls = data.tls_results;
      const ct = data.ct_entries;
      const rootDomain = typeof data.domain === "string" ? data.domain : "";
      if (Array.isArray(tls)) {
        certificates += tls.filter(
          (c: Record<string, unknown>) => !c.error,
        ).length;
        for (const cert of tls as Array<Record<string, unknown>>) {
          if (typeof cert.host === "string" && cert.host !== rootDomain) {
            uniqueSubdomains.add(cert.host);
          }
          const sans = cert.san_names;
          if (Array.isArray(sans)) {
            for (const san of sans) {
              if (typeof san === "string" && san !== rootDomain) {
                uniqueSubdomains.add(san);
              }
            }
          }
        }
      }
      if (Array.isArray(ct)) {
        certificates += ct.length;
        for (const entry of ct as Array<Record<string, unknown>>) {
          if (typeof entry.domain === "string" && entry.domain !== rootDomain) {
            uniqueSubdomains.add(entry.domain);
          }
          const sans = entry.san_names;
          if (Array.isArray(sans)) {
            for (const san of sans) {
              if (typeof san === "string" && san !== rootDomain) {
                uniqueSubdomains.add(san);
              }
            }
          }
        }
      }
    }
  }

  subdomains = uniqueSubdomains.size;
  return { subdomains, openPorts, certificates };
}

// -- Sub-components ---------------------------------------------------------

function MetricsBar({ metrics, tools }: { metrics: SummaryMetrics; tools: Set<string> }) {
  const items: Array<{ label: string; value: number }> = [];
  if (metrics.subdomains > 0 || tools.has("dns")) {
    items.push({ label: "Subdomains", value: metrics.subdomains });
  }
  if (metrics.openPorts > 0 || tools.has("ports")) {
    items.push({ label: "Open Ports", value: metrics.openPorts });
  }
  if (metrics.certificates > 0 || tools.has("certs")) {
    items.push({ label: "Certificates", value: metrics.certificates });
  }

  return (
    <div className="flex flex-wrap gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-surface-700 bg-surface-900 px-5 py-3"
        >
          <div className="text-2xl font-bold text-surface-100">{item.value}</div>
          <div className="text-xs text-surface-400 mt-0.5">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({
  tool,
  scannedAt,
  expanded,
  onToggle,
}: {
  tool: string;
  scannedAt?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-lg bg-surface-800/60 px-4 py-3 text-left hover:bg-surface-800 transition-colors"
    >
      <span className="text-surface-500 text-xs w-3 shrink-0">
        {expanded ? "\u25BC" : "\u25B6"}
      </span>
      <span className="text-sm font-semibold text-surface-200">
        {toolDisplayName(tool)}
      </span>
      {scannedAt && (
        <span className="ml-auto text-xs text-surface-500">
          {formatTimestamp(scannedAt)}
        </span>
      )}
    </button>
  );
}

function ToolSection({ result }: { result: ToolResult }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-surface-700 overflow-hidden">
      <SectionHeader
        tool={result.tool}
        scannedAt={result.scannedAt}
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
      />
      {expanded && (
        <div className="p-4 border-t border-surface-700">
          <ToolContent tool={result.tool} data={result.data} />
        </div>
      )}
    </div>
  );
}

function ToolContent({
  tool,
  data,
}: {
  tool: string;
  data: Record<string, unknown>;
}) {
  if (!isKnownTool(tool)) {
    return <JsonTreeView data={data} />;
  }

  switch (tool) {
    case "dns":
      return <DnsResults data={data as never} />;
    case "ports":
      return <PortResults data={data as never} />;
    case "certs":
      return <CertResults data={data as never} />;
  }
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900 p-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-800">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5 text-surface-500"
        >
          <path
            fillRule="evenodd"
            d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 0a.75.75 0 01.75-.75h13.5a.75.75 0 01.75.75v9.5a.75.75 0 01-.75.75H3.25a.75.75 0 01-.75-.75v-9.5z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-surface-300">No results available</p>
      <p className="mt-1 text-xs text-surface-500">
        Run a scan to see results here.
      </p>
    </div>
  );
}

// -- Main component ---------------------------------------------------------

export default function CombinedResultsPanel({ results }: CombinedResultsPanelProps) {
  if (results.length === 0) {
    return <EmptyState />;
  }

  const metrics = extractMetrics(results);
  const toolSet = new Set(results.map((r) => r.tool));

  return (
    <div className="space-y-6">
      <MetricsBar metrics={metrics} tools={toolSet} />
      {results.map((result, index) => (
        <ToolSection
          key={result.scanId ?? `${result.tool}-${index}`}
          result={result}
        />
      ))}
    </div>
  );
}
