/** Port scan result display component.
 *
 * Expected data shape matches PortScanResult:
 *   { targets, scan_type, ports_scanned, results: [{ host, ip, port, protocol }] }
 */

interface PortEntry {
  host: string;
  ip: string;
  port: number;
  protocol: string;
}

interface PortScanData {
  targets?: string[];
  scan_type?: string;
  ports_scanned?: string;
  results?: PortEntry[];
}

function groupByHost(entries: PortEntry[]): Map<string, PortEntry[]> {
  const groups = new Map<string, PortEntry[]>();
  for (const entry of entries) {
    const key = entry.host || entry.ip;
    const existing = groups.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  return groups;
}

interface PortResultsProps {
  data: PortScanData;
}

export default function PortResults({ data }: PortResultsProps) {
  const results = data.results || [];
  const grouped = groupByHost(results);
  const openCount = results.length;

  return (
    <div className="space-y-6">
      {/* Key metrics */}
      <div className="flex gap-4">
        <div className="rounded-lg border border-surface-700 bg-surface-900 px-5 py-3">
          <div className="text-2xl font-bold text-surface-100">{openCount}</div>
          <div className="text-xs text-surface-400 mt-0.5">
            Open {openCount === 1 ? "Port" : "Ports"}
          </div>
        </div>
        <div className="rounded-lg border border-surface-700 bg-surface-900 px-5 py-3">
          <div className="text-2xl font-bold text-surface-100">{grouped.size}</div>
          <div className="text-xs text-surface-400 mt-0.5">
            {grouped.size === 1 ? "Host" : "Hosts"}
          </div>
        </div>
        {data.scan_type && (
          <div className="rounded-lg border border-surface-700 bg-surface-900 px-5 py-3">
            <div className="text-lg font-bold text-surface-100">{data.scan_type}</div>
            <div className="text-xs text-surface-400 mt-0.5">Scan Type</div>
          </div>
        )}
      </div>

      {/* Grouped host tables */}
      {Array.from(grouped.entries()).map(([host, entries]) => (
        <div key={host} className="rounded-lg border border-surface-700 overflow-hidden">
          <div className="bg-surface-800/60 px-4 py-2.5 flex items-center gap-2">
            <span className="text-sm font-semibold text-surface-200">{host}</span>
            {entries[0]?.ip && entries[0].ip !== host && (
              <span className="text-xs text-surface-400 font-mono">({entries[0].ip})</span>
            )}
            <span className="ml-auto text-xs text-surface-400">
              {entries.length} {entries.length === 1 ? "port" : "ports"}
            </span>
          </div>
          <table className="w-full text-left">
            <thead className="bg-surface-800/30">
              <tr>
                <th className="py-2 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                  Port
                </th>
                <th className="py-2 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                  Protocol
                </th>
                <th className="py-2 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface-900">
              {entries
                .sort((a, b) => a.port - b.port)
                .map((entry, i) => (
                  <tr
                    key={i}
                    className="border-t border-surface-800 hover:bg-surface-800/30 transition-colors"
                  >
                    <td className="py-2 px-4 text-sm font-mono text-accent-300">
                      {entry.port}
                    </td>
                    <td className="py-2 px-4 text-sm text-surface-300 uppercase">
                      {entry.protocol}
                    </td>
                    <td className="py-2 px-4 text-sm font-mono text-surface-300">
                      {entry.ip}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}

      {results.length === 0 && (
        <div className="rounded-lg border border-surface-700 bg-surface-900 p-8 text-center">
          <p className="text-sm text-surface-400">No open ports found.</p>
        </div>
      )}
    </div>
  );
}
