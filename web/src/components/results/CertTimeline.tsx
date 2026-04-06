/** Certificate validity timeline visualization.
 *
 * Renders horizontal bars for each certificate's validity period (not_before
 * to not_after). Color coded by status: green (valid), red (expired), amber
 * (expiring within 30 days). Clicking a bar shows full certificate details.
 */

import { useState, useMemo, useRef, useEffect } from "react";

// -- Data types (mirrors CertResults.tsx) -----------------------------------

interface TLSCertInfo {
  host: string;
  port: number;
  subject: string;
  issuer: string;
  serial_number: string;
  san_names?: string[];
  key_type: string;
  key_size: number;
  not_before: string;
  not_after: string;
  chain_depth: number;
  is_self_signed: boolean;
  is_expired: boolean;
  hostname_mismatch: boolean;
  error?: string | null;
}

interface CTEntry {
  domain: string;
  issuer_name: string;
  not_before: string;
  not_after: string;
  san_names?: string[];
}

// -- Normalized row used for rendering --------------------------------------

type CertStatus = "valid" | "expired" | "expiring";

interface TimelineEntry {
  id: string;
  label: string;
  notBefore: number; // epoch ms
  notAfter: number;
  status: CertStatus;
  isSelfSigned: boolean;
  hostnameMismatch: boolean;
  source: "tls" | "ct";
  detail: TLSCertInfo | CTEntry;
}

// -- Helpers ----------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function certStatus(notAfter: number, isExpired?: boolean): CertStatus {
  const now = Date.now();
  if (isExpired || notAfter < now) return "expired";
  if (notAfter - now < THIRTY_DAYS_MS) return "expiring";
  return "valid";
}

function statusColor(s: CertStatus): string {
  switch (s) {
    case "expired":
      return "#ef4444"; // status-danger
    case "expiring":
      return "#f59e0b"; // status-warning
    case "valid":
      return "#22c55e"; // status-success
  }
}

function statusBg(s: CertStatus): string {
  switch (s) {
    case "expired":
      return "rgba(239,68,68,0.15)";
    case "expiring":
      return "rgba(245,158,11,0.15)";
    case "valid":
      return "rgba(34,197,94,0.15)";
  }
}

function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isTLS(entry: TimelineEntry): entry is TimelineEntry & { detail: TLSCertInfo } {
  return entry.source === "tls";
}

// -- Sub-components ---------------------------------------------------------

/** Detail popover shown when a bar is selected. */
function CertDetailPanel({
  entry,
  onClose,
}: {
  entry: TimelineEntry;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const color = statusColor(entry.status);

  return (
    <div
      ref={panelRef}
      className="rounded-lg border border-surface-700 bg-surface-900 p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-surface-200 truncate">
            {entry.label}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-surface-400 capitalize">{entry.status}</span>
            {entry.isSelfSigned && (
              <span className="inline-flex items-center rounded-full border border-status-warning/30 bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-warning">
                Self-Signed
              </span>
            )}
            {entry.hostnameMismatch && (
              <span className="inline-flex items-center rounded-full border border-status-danger/30 bg-status-danger/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-danger">
                Hostname Mismatch
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          aria-label="Close details"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-surface-400">Valid From</dt>
        <dd className="text-surface-200">{formatDate(entry.notBefore)}</dd>

        <dt className="text-surface-400">Valid Until</dt>
        <dd className={entry.status === "expired" ? "text-status-danger font-medium" : "text-surface-200"}>
          {formatDate(entry.notAfter)}
        </dd>

        {isTLS(entry) ? (
          <>
            <dt className="text-surface-400">Subject</dt>
            <dd className="text-surface-200 truncate">{entry.detail.subject}</dd>

            <dt className="text-surface-400">Issuer</dt>
            <dd className="text-surface-200 truncate">{entry.detail.issuer}</dd>

            <dt className="text-surface-400">Key</dt>
            <dd className="text-surface-200">
              {entry.detail.key_type} {entry.detail.key_size}-bit
            </dd>

            {entry.detail.san_names && entry.detail.san_names.length > 0 && (
              <>
                <dt className="text-surface-400">SANs</dt>
                <dd className="text-surface-200 text-xs font-mono break-all">
                  {entry.detail.san_names.length <= 5
                    ? entry.detail.san_names.join(", ")
                    : `${entry.detail.san_names.slice(0, 5).join(", ")} +${entry.detail.san_names.length - 5} more`}
                </dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt className="text-surface-400">Domain</dt>
            <dd className="text-surface-200 truncate">{(entry.detail as CTEntry).domain}</dd>

            <dt className="text-surface-400">Issuer</dt>
            <dd className="text-surface-200 truncate">{(entry.detail as CTEntry).issuer_name}</dd>

            {(entry.detail as CTEntry).san_names && (entry.detail as CTEntry).san_names!.length > 0 && (
              <>
                <dt className="text-surface-400">SANs</dt>
                <dd className="text-surface-200 text-xs font-mono break-all">
                  {(entry.detail as CTEntry).san_names!.length <= 5
                    ? (entry.detail as CTEntry).san_names!.join(", ")
                    : `${(entry.detail as CTEntry).san_names!.slice(0, 5).join(", ")} +${(entry.detail as CTEntry).san_names!.length - 5} more`}
                </dd>
              </>
            )}
          </>
        )}

        <dt className="text-surface-400">Source</dt>
        <dd className="text-surface-200">{entry.source === "tls" ? "TLS Handshake" : "CT Log"}</dd>
      </dl>
    </div>
  );
}

// -- Self-signed icon for SVG -----------------------------------------------

function SelfSignedIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <title>Self-signed certificate</title>
      <circle cx="0" cy="0" r="7" fill="#f59e0b" fillOpacity="0.2" stroke="#f59e0b" strokeWidth="1" />
      <text
        x="0"
        y="1"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#f59e0b"
        fontSize="9"
        fontWeight="700"
        fontFamily="Inter, sans-serif"
      >
        S
      </text>
    </g>
  );
}

// -- Hostname mismatch icon for SVG -----------------------------------------

function MismatchIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <title>Hostname mismatch</title>
      <circle cx="0" cy="0" r="7" fill="#ef4444" fillOpacity="0.2" stroke="#ef4444" strokeWidth="1" />
      <text
        x="0"
        y="1"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#ef4444"
        fontSize="9"
        fontWeight="700"
        fontFamily="Inter, sans-serif"
      >
        !
      </text>
    </g>
  );
}

// -- Main component ---------------------------------------------------------

interface CertTimelineProps {
  tlsResults: TLSCertInfo[];
  ctEntries: CTEntry[];
}

export default function CertTimeline({ tlsResults, ctEntries }: CertTimelineProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Normalize all certs into a flat list
  const entries: TimelineEntry[] = useMemo(() => {
    const out: TimelineEntry[] = [];

    tlsResults.forEach((cert, i) => {
      if (cert.error) return;
      const nb = new Date(cert.not_before).getTime();
      const na = new Date(cert.not_after).getTime();
      if (isNaN(nb) || isNaN(na)) return;
      out.push({
        id: `tls-${cert.host}-${cert.port}-${i}`,
        label: `${cert.host}:${cert.port}`,
        notBefore: nb,
        notAfter: na,
        status: certStatus(na, cert.is_expired),
        isSelfSigned: cert.is_self_signed,
        hostnameMismatch: cert.hostname_mismatch,
        source: "tls",
        detail: cert,
      });
    });

    ctEntries.forEach((entry, i) => {
      const nb = new Date(entry.not_before).getTime();
      const na = new Date(entry.not_after).getTime();
      if (isNaN(nb) || isNaN(na)) return;
      out.push({
        id: `ct-${entry.domain}-${i}`,
        label: entry.domain,
        notBefore: nb,
        notAfter: na,
        status: certStatus(na),
        isSelfSigned: false,
        hostnameMismatch: false,
        source: "ct",
        detail: entry,
      });
    });

    // Sort by notBefore ascending
    out.sort((a, b) => a.notBefore - b.notBefore);
    return out;
  }, [tlsResults, ctEntries]);

  // Compute timeline range
  const { minTime, maxTime } = useMemo(() => {
    if (entries.length === 0) return { minTime: 0, maxTime: 1 };
    let mn = Infinity;
    let mx = -Infinity;
    for (const e of entries) {
      if (e.notBefore < mn) mn = e.notBefore;
      if (e.notAfter > mx) mx = e.notAfter;
    }
    // Add 5% padding on each side
    const range = mx - mn || 1;
    return { minTime: mn - range * 0.05, maxTime: mx + range * 0.05 };
  }, [entries]);

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;

  if (entries.length === 0) return null;

  // Layout constants
  const labelWidth = 180;
  const chartPadding = 16;
  const rowHeight = 32;
  const barHeight = 14;
  const svgWidth = 800;
  const chartWidth = svgWidth - labelWidth - chartPadding * 2;
  const svgHeight = entries.length * rowHeight + 40; // 40 for axis

  const timeRange = maxTime - minTime;

  function timeToX(t: number): number {
    return labelWidth + chartPadding + ((t - minTime) / timeRange) * chartWidth;
  }

  // Generate axis ticks (4-6 ticks)
  const axisTicks = useMemo(() => {
    const tickCount = Math.min(6, Math.max(2, Math.floor(chartWidth / 120)));
    const ticks: number[] = [];
    for (let i = 0; i <= tickCount; i++) {
      ticks.push(minTime + (timeRange * i) / tickCount);
    }
    return ticks;
  }, [minTime, timeRange, chartWidth]);

  // "Now" marker position
  const now = Date.now();
  const nowInRange = now >= minTime && now <= maxTime;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-surface-200">Certificate Validity Timeline</h3>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-surface-400">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-5 rounded-sm" style={{ backgroundColor: statusColor("valid") }} />
          Valid
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-5 rounded-sm" style={{ backgroundColor: statusColor("expiring") }} />
          Expiring (&lt;30d)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-5 rounded-sm" style={{ backgroundColor: statusColor("expired") }} />
          Expired
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="-7 -7 14 14">
            <circle cx="0" cy="0" r="6" fill="#f59e0b" fillOpacity="0.3" stroke="#f59e0b" strokeWidth="1" />
            <text x="0" y="1" textAnchor="middle" dominantBaseline="middle" fill="#f59e0b" fontSize="8" fontWeight="700" fontFamily="Inter, sans-serif">S</text>
          </svg>
          Self-Signed
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="-7 -7 14 14">
            <circle cx="0" cy="0" r="6" fill="#ef4444" fillOpacity="0.3" stroke="#ef4444" strokeWidth="1" />
            <text x="0" y="1" textAnchor="middle" dominantBaseline="middle" fill="#ef4444" fontSize="8" fontWeight="700" fontFamily="Inter, sans-serif">!</text>
          </svg>
          Hostname Mismatch
        </div>
      </div>

      {/* SVG timeline */}
      <div className="rounded-lg border border-surface-700 bg-surface-900 p-3 overflow-x-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="select-none"
          style={{ minWidth: svgWidth }}
        >
          {/* Axis ticks and gridlines */}
          {axisTicks.map((t) => {
            const x = timeToX(t);
            return (
              <g key={t}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={svgHeight - 30}
                  stroke="#334155"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />
                <text
                  x={x}
                  y={svgHeight - 10}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="Inter, sans-serif"
                >
                  {new Date(t).toLocaleDateString("en-US", { year: "2-digit", month: "short" })}
                </text>
              </g>
            );
          })}

          {/* "Now" marker */}
          {nowInRange && (
            <g>
              <line
                x1={timeToX(now)}
                y1={0}
                x2={timeToX(now)}
                y2={svgHeight - 30}
                stroke="#818cf8"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              <text
                x={timeToX(now)}
                y={svgHeight - 10}
                textAnchor="middle"
                fill="#818cf8"
                fontSize="10"
                fontWeight="600"
                fontFamily="Inter, sans-serif"
              >
                Now
              </text>
            </g>
          )}

          {/* Certificate bars */}
          {entries.map((entry, i) => {
            const y = i * rowHeight + rowHeight / 2;
            const x1 = timeToX(entry.notBefore);
            const x2 = timeToX(entry.notAfter);
            const barW = Math.max(x2 - x1, 2); // minimum 2px width
            const isSelected = entry.id === selectedId;
            const isHovered = entry.id === hoveredId;

            return (
              <g
                key={entry.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(isSelected ? null : entry.id)}
                onMouseEnter={() => setHoveredId(entry.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Row background highlight on hover/select */}
                {(isHovered || isSelected) && (
                  <rect
                    x={0}
                    y={y - rowHeight / 2}
                    width={svgWidth}
                    height={rowHeight}
                    fill={statusBg(entry.status)}
                    rx="4"
                  />
                )}

                {/* Label */}
                <text
                  x={labelWidth - 8}
                  y={y + 1}
                  textAnchor="end"
                  fill={isSelected || isHovered ? "#e2e8f0" : "#94a3b8"}
                  fontSize="11"
                  fontFamily="JetBrains Mono, monospace"
                  className="transition-colors"
                >
                  {entry.label.length > 22 ? entry.label.slice(0, 20) + ".." : entry.label}
                </text>

                {/* Bar */}
                <rect
                  x={x1}
                  y={y - barHeight / 2}
                  width={barW}
                  height={barHeight}
                  rx="3"
                  fill={statusColor(entry.status)}
                  fillOpacity={isSelected || isHovered ? 0.9 : 0.6}
                  stroke={isSelected ? "#e2e8f0" : "none"}
                  strokeWidth={isSelected ? 1.5 : 0}
                />

                {/* Self-signed badge */}
                {entry.isSelfSigned && (
                  <SelfSignedIcon x={x2 + 12} y={y} />
                )}

                {/* Hostname mismatch badge */}
                {entry.hostnameMismatch && (
                  <MismatchIcon x={x2 + (entry.isSelfSigned ? 28 : 12)} y={y} />
                )}

                {/* Tooltip on hover (simple SVG title) */}
                <title>
                  {entry.label} ({entry.status})
                  {"\n"}Valid: {formatDate(entry.notBefore)} - {formatDate(entry.notAfter)}
                  {entry.isSelfSigned ? "\nSelf-signed" : ""}
                  {entry.hostnameMismatch ? "\nHostname mismatch" : ""}
                </title>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Detail panel for selected cert */}
      {selectedEntry && (
        <CertDetailPanel
          entry={selectedEntry}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
