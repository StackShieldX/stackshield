/** Certificate scan result display component.
 *
 * Expected data shape matches CertsResult:
 *   { domain, mode, ct_entries: [...], tls_results: [...] }
 */

import CertTimeline from "./CertTimeline";
import CertChainTree from "./CertChainTree";

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
}

interface CTEntry {
  domain: string;
  issuer_name: string;
  not_before: string;
  not_after: string;
  san_names?: string[];
}

interface CertsData {
  domain?: string;
  mode?: string;
  ct_entries?: CTEntry[];
  tls_results?: TLSCertInfo[];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

function StatusBadge({ label, variant }: { label: string; variant: "danger" | "warning" }) {
  const colors =
    variant === "danger"
      ? "bg-status-danger/15 text-status-danger border-status-danger/30"
      : "bg-status-warning/15 text-status-warning border-status-warning/30";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${colors}`}>
      {label}
    </span>
  );
}

function TLSCertCard({ cert }: { cert: TLSCertInfo }) {
  const hasWarnings = cert.is_expired || cert.is_self_signed || cert.hostname_mismatch;

  return (
    <div
      className={`rounded-lg border p-4 ${
        hasWarnings
          ? "border-status-danger/40 bg-status-danger/5"
          : "border-surface-700 bg-surface-900"
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-surface-200 truncate">
            {cert.host}:{cert.port}
          </div>
          <div className="text-xs text-surface-400 mt-0.5 truncate">
            {cert.subject}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {cert.is_expired && <StatusBadge label="Expired" variant="danger" />}
          {cert.is_self_signed && <StatusBadge label="Self-Signed" variant="warning" />}
          {cert.hostname_mismatch && <StatusBadge label="Hostname Mismatch" variant="warning" />}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-surface-400">Issuer</dt>
        <dd className="text-surface-200 truncate">{cert.issuer}</dd>

        <dt className="text-surface-400">Valid From</dt>
        <dd className="text-surface-200">{formatDate(cert.not_before)}</dd>

        <dt className="text-surface-400">Valid Until</dt>
        <dd className={cert.is_expired ? "text-status-danger font-medium" : "text-surface-200"}>
          {formatDate(cert.not_after)}
        </dd>

        <dt className="text-surface-400">Key</dt>
        <dd className="text-surface-200">
          {cert.key_type} {cert.key_size}-bit
        </dd>

        <dt className="text-surface-400">Chain Depth</dt>
        <dd className="text-surface-200">{cert.chain_depth}</dd>

        {cert.san_names && cert.san_names.length > 0 && (
          <>
            <dt className="text-surface-400">SANs</dt>
            <dd className="text-surface-200 text-xs font-mono">
              {cert.san_names.length <= 3
                ? cert.san_names.join(", ")
                : `${cert.san_names.slice(0, 3).join(", ")} +${cert.san_names.length - 3} more`}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

interface CertResultsProps {
  data: CertsData;
}

export default function CertResults({ data }: CertResultsProps) {
  const tlsResults = data.tls_results || [];
  const ctEntries = data.ct_entries || [];
  const totalCerts = tlsResults.length + ctEntries.length;
  const expiredCount = tlsResults.filter((c) => c.is_expired).length;
  const selfSignedCount = tlsResults.filter((c) => c.is_self_signed).length;

  return (
    <div className="space-y-6">
      {/* Key metrics */}
      <div className="flex flex-wrap gap-4">
        <div className="rounded-lg border border-surface-700 bg-surface-900 px-5 py-3">
          <div className="text-2xl font-bold text-surface-100">{totalCerts}</div>
          <div className="text-xs text-surface-400 mt-0.5">
            Total {totalCerts === 1 ? "Certificate" : "Certificates"}
          </div>
        </div>
        {tlsResults.length > 0 && (
          <div className="rounded-lg border border-surface-700 bg-surface-900 px-5 py-3">
            <div className="text-2xl font-bold text-surface-100">{tlsResults.length}</div>
            <div className="text-xs text-surface-400 mt-0.5">TLS Certs</div>
          </div>
        )}
        {ctEntries.length > 0 && (
          <div className="rounded-lg border border-surface-700 bg-surface-900 px-5 py-3">
            <div className="text-2xl font-bold text-surface-100">{ctEntries.length}</div>
            <div className="text-xs text-surface-400 mt-0.5">CT Log Entries</div>
          </div>
        )}
        {expiredCount > 0 && (
          <div className="rounded-lg border border-status-danger/40 bg-status-danger/5 px-5 py-3">
            <div className="text-2xl font-bold text-status-danger">{expiredCount}</div>
            <div className="text-xs text-status-danger/70 mt-0.5">Expired</div>
          </div>
        )}
        {selfSignedCount > 0 && (
          <div className="rounded-lg border border-status-warning/40 bg-status-warning/5 px-5 py-3">
            <div className="text-2xl font-bold text-status-warning">{selfSignedCount}</div>
            <div className="text-xs text-status-warning/70 mt-0.5">Self-Signed</div>
          </div>
        )}
      </div>

      {/* Certificate timeline visualization */}
      {totalCerts > 0 && (
        <CertTimeline tlsResults={tlsResults} ctEntries={ctEntries} />
      )}

      {/* TLS chain tree visualization */}
      {tlsResults.length > 0 && (
        <CertChainTree tlsResults={tlsResults} />
      )}

      {/* TLS certificates */}
      {tlsResults.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-surface-200 mb-3">TLS Certificates</h3>
          <div className="space-y-3">
            {tlsResults.map((cert, i) => (
              <TLSCertCard key={`${cert.host}-${cert.port}-${i}`} cert={cert} />
            ))}
          </div>
        </div>
      )}

      {/* CT log entries */}
      {ctEntries.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-surface-200 mb-3">
            Certificate Transparency Log Entries
          </h3>
          <div className="rounded-lg border border-surface-700 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-surface-800/60">
                <tr>
                  <th className="py-2.5 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Domain
                  </th>
                  <th className="py-2.5 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Issuer
                  </th>
                  <th className="py-2.5 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Valid From
                  </th>
                  <th className="py-2.5 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Valid Until
                  </th>
                </tr>
              </thead>
              <tbody className="bg-surface-900">
                {ctEntries.map((entry, i) => (
                  <tr
                    key={i}
                    className="border-t border-surface-800 hover:bg-surface-800/30 transition-colors"
                  >
                    <td className="py-2 px-4 text-sm font-mono text-accent-300">
                      {entry.domain}
                    </td>
                    <td className="py-2 px-4 text-sm text-surface-300 truncate max-w-[200px]">
                      {entry.issuer_name}
                    </td>
                    <td className="py-2 px-4 text-sm text-surface-300">
                      {formatDate(entry.not_before)}
                    </td>
                    <td className="py-2 px-4 text-sm text-surface-300">
                      {formatDate(entry.not_after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalCerts === 0 && (
        <div className="rounded-lg border border-surface-700 bg-surface-900 p-8 text-center">
          <p className="text-sm text-surface-400">No certificates found.</p>
        </div>
      )}
    </div>
  );
}
