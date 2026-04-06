/** DNS scan result display component.
 *
 * Expected data shape matches the Domain entity:
 *   { name, whois_info?, subdomains: [{ name, sources, dns_records: { a, aaaa, cname, ... } }] }
 */

import DnsGraph from "./DnsGraph";

interface ARecord {
  ip_address: string;
  asn_info?: { asn?: string; organization?: string; country?: string; network_range?: string } | null;
}

interface AAAARecord {
  ipv6_address: string;
  asn_info?: { asn?: string; organization?: string; country?: string; network_range?: string } | null;
}

interface CNAMERecord {
  canonical_name: string;
}

interface DnsRecords {
  a?: ARecord[];
  aaaa?: AAAARecord[];
  cname?: CNAMERecord[];
  mx?: { priority: number; exchange: string }[];
  ns?: { nameserver: string }[];
  txt?: { values: string[] }[];
  soa?: unknown[];
  ptr?: { ptrdname: string }[];
}

interface Subdomain {
  name: string;
  sources?: { strategy: string; source: string }[];
  dns_records?: DnsRecords;
}

interface WhoisInfo {
  registrar?: string | null;
  registrant?: string | null;
  creation_date?: string | null;
  expiration_date?: string | null;
  updated_date?: string | null;
  name_servers?: string[];
  status?: string[];
  emails?: string[];
  org?: string | null;
  country?: string | null;
}

interface DnsData {
  name: string;
  whois_info?: WhoisInfo | null;
  subdomains?: Subdomain[];
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

function WhoisCard({ whois }: { whois: WhoisInfo }) {
  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900 p-4">
      <h3 className="text-sm font-semibold text-surface-200 mb-3">WHOIS Summary</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-surface-400">Registrar</dt>
        <dd className="text-surface-200">{whois.registrar || "N/A"}</dd>

        <dt className="text-surface-400">Organization</dt>
        <dd className="text-surface-200">{whois.org || "N/A"}</dd>

        <dt className="text-surface-400">Country</dt>
        <dd className="text-surface-200">{whois.country || "N/A"}</dd>

        <dt className="text-surface-400">Created</dt>
        <dd className="text-surface-200">{formatDate(whois.creation_date)}</dd>

        <dt className="text-surface-400">Expires</dt>
        <dd className="text-surface-200">{formatDate(whois.expiration_date)}</dd>

        <dt className="text-surface-400">Updated</dt>
        <dd className="text-surface-200">{formatDate(whois.updated_date)}</dd>

        {whois.name_servers && whois.name_servers.length > 0 && (
          <>
            <dt className="text-surface-400">Name Servers</dt>
            <dd className="text-surface-200">{whois.name_servers.join(", ")}</dd>
          </>
        )}

        {whois.emails && whois.emails.length > 0 && (
          <>
            <dt className="text-surface-400">Contacts</dt>
            <dd className="text-surface-200">{whois.emails.join(", ")}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function SubdomainRow({ sub }: { sub: Subdomain }) {
  const records = sub.dns_records;
  const aRecords = records?.a || [];
  const aaaaRecords = records?.aaaa || [];
  const cnameRecords = records?.cname || [];

  return (
    <tr className="border-t border-surface-800 hover:bg-surface-800/30 transition-colors">
      <td className="py-2.5 px-4 text-sm font-mono text-accent-300">{sub.name}</td>
      <td className="py-2.5 px-4 text-sm text-surface-300">
        {aRecords.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {aRecords.map((r, i) => (
              <span key={i} className="font-mono text-xs">{r.ip_address}</span>
            ))}
          </div>
        ) : (
          <span className="text-surface-500">--</span>
        )}
      </td>
      <td className="py-2.5 px-4 text-sm text-surface-300">
        {aaaaRecords.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {aaaaRecords.map((r, i) => (
              <span key={i} className="font-mono text-xs">{r.ipv6_address}</span>
            ))}
          </div>
        ) : (
          <span className="text-surface-500">--</span>
        )}
      </td>
      <td className="py-2.5 px-4 text-sm text-surface-300">
        {cnameRecords.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {cnameRecords.map((r, i) => (
              <span key={i} className="font-mono text-xs">{r.canonical_name}</span>
            ))}
          </div>
        ) : (
          <span className="text-surface-500">--</span>
        )}
      </td>
    </tr>
  );
}

interface DnsResultsProps {
  data: DnsData;
}

export default function DnsResults({ data }: DnsResultsProps) {
  const subdomains = data.subdomains || [];

  return (
    <div className="space-y-6">
      {/* Interactive network graph (skipped for trivially small results) */}
      <DnsGraph data={data} />

      {/* Key metric */}
      <div className="flex gap-4">
        <div className="rounded-lg border border-surface-700 bg-surface-900 px-5 py-3">
          <div className="text-2xl font-bold text-surface-100">{subdomains.length}</div>
          <div className="text-xs text-surface-400 mt-0.5">
            {subdomains.length === 1 ? "Subdomain" : "Subdomains"}
          </div>
        </div>
      </div>

      {/* WHOIS card */}
      {data.whois_info && <WhoisCard whois={data.whois_info} />}

      {/* Subdomains table */}
      {subdomains.length > 0 && (
        <div className="rounded-lg border border-surface-700 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-surface-800/60">
              <tr>
                <th className="py-2.5 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                  Subdomain
                </th>
                <th className="py-2.5 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                  A Records
                </th>
                <th className="py-2.5 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                  AAAA Records
                </th>
                <th className="py-2.5 px-4 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                  CNAME
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface-900">
              {subdomains.map((sub) => (
                <SubdomainRow key={sub.name} sub={sub} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
