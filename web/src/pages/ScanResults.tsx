import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DnsResults from "../components/results/DnsResults";
import PortResults from "../components/results/PortResults";
import CertResults from "../components/results/CertResults";
import JsonTreeView from "../components/results/JsonTreeView";

type ToolType = "dns" | "ports" | "certs" | "unknown";

/** Detect tool type from the result data shape. */
function detectToolType(data: Record<string, unknown>): ToolType {
  if ("subdomains" in data && "name" in data) {
    return "dns";
  }
  if ("ct_entries" in data || "tls_results" in data) {
    return "certs";
  }
  if ("scan_type" in data && "results" in data) {
    return "ports";
  }
  return "unknown";
}

function toolLabel(tool: ToolType): string {
  switch (tool) {
    case "dns":
      return "DNS Discovery";
    case "ports":
      return "Port Scan";
    case "certs":
      return "Certificate Analysis";
    default:
      return "Scan";
  }
}

function LoadingState() {
  return (
    <div className="p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-surface-800" />
        <div className="h-4 w-72 rounded bg-surface-800" />
        <div className="mt-8 space-y-3">
          <div className="h-20 rounded-lg bg-surface-800" />
          <div className="h-32 rounded-lg bg-surface-800" />
          <div className="h-48 rounded-lg bg-surface-800" />
        </div>
      </div>
    </div>
  );
}

function NotFoundState({ scanId }: { scanId: string }) {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-md rounded-lg border border-surface-700 bg-surface-900 p-8 text-center mt-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-status-danger/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-6 w-6 text-status-danger"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-surface-100">Scan not found</h2>
        <p className="mt-2 text-sm text-surface-400">
          No scan result exists for ID{" "}
          <code className="rounded bg-surface-800 px-1.5 py-0.5 font-mono text-xs text-surface-300">
            {scanId}
          </code>
        </p>
        <Link
          to="/history"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 transition-colors"
        >
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
          Browse scan history
        </Link>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-md rounded-lg border border-status-danger/40 bg-status-danger/5 p-6 text-center mt-12">
        <h2 className="text-lg font-semibold text-status-danger">Error loading scan</h2>
        <p className="mt-2 text-sm text-surface-400">{message}</p>
      </div>
    </div>
  );
}

export default function ScanResults() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setNotFound(false);
    setError(null);

    fetch(`/api/scans/${encodeURIComponent(id)}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (json !== null) {
          setData(json as Record<string, unknown>);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load scan");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  if (loading) return <LoadingState />;
  if (notFound) return <NotFoundState scanId={id || ""} />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="No data received" />;

  const toolType = detectToolType(data);
  const domain =
    (data.name as string) || (data.domain as string) || "";

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/history"
          className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors mb-3"
        >
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
          Back to history
        </Link>
        <h1 className="text-2xl font-semibold text-surface-100">
          {toolLabel(toolType)}
        </h1>
        {domain && (
          <p className="mt-1 text-sm text-surface-400">
            Target:{" "}
            <span className="font-mono text-surface-300">{domain}</span>
          </p>
        )}
        {id && (
          <p className="mt-0.5 text-xs text-surface-500">
            Scan ID: <span className="font-mono">{id}</span>
          </p>
        )}
      </div>

      {/* Tool-specific results */}
      {toolType === "dns" && <DnsResults data={data as never} />}
      {toolType === "ports" && <PortResults data={data as never} />}
      {toolType === "certs" && <CertResults data={data as never} />}
      {toolType === "unknown" && (
        <div className="rounded-lg border border-surface-700 bg-surface-900 p-6">
          <p className="text-sm text-surface-400">
            Unrecognized scan type. View the raw JSON below for details.
          </p>
        </div>
      )}

      {/* Collapsible raw JSON view */}
      <JsonTreeView data={data} />
    </div>
  );
}
