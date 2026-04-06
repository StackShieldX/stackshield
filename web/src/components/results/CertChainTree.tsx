/** TLS certificate chain tree visualization.
 *
 * Renders a tree view of TLS certificate chains grouped by issuer hierarchy.
 * Each chain shows leaf -> intermediate -> root, reconstructed from the
 * subject/issuer relationships and chain_depth values in the TLS results.
 */

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

// -- Chain reconstruction ---------------------------------------------------

interface ChainNode {
  cert: TLSCertInfo;
  children: ChainNode[];
  depth: number;
}

/** Group TLS certs by host:port and build chain trees. */
function buildChains(certs: TLSCertInfo[]): { endpoint: string; chain: ChainNode[] }[] {
  // Group by host:port
  const groups = new Map<string, TLSCertInfo[]>();
  for (const cert of certs) {
    const key = `${cert.host}:${cert.port}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(cert);
    } else {
      groups.set(key, [cert]);
    }
  }

  const result: { endpoint: string; chain: ChainNode[] }[] = [];

  for (const [endpoint, group] of groups) {
    // Sort by chain_depth ascending (leaf=0 first, root last)
    const sorted = [...group].sort((a, b) => a.chain_depth - b.chain_depth);

    // Build a simple tree: each cert at depth N is a child of the cert at depth N+1
    // If there is only one cert (or all same depth), just list them flat
    const nodes: ChainNode[] = sorted.map((cert) => ({
      cert,
      children: [],
      depth: cert.chain_depth,
    }));

    // Link children: cert at depth 0 is child of cert at depth 1, etc.
    // Build from deepest to shallowest
    const roots: ChainNode[] = [];
    const byDepth = new Map<number, ChainNode>();

    // Walk from highest depth to lowest
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      byDepth.set(node.depth, node);

      const parent = byDepth.get(node.depth + 1);
      if (parent) {
        parent.children.push(node);
      }
    }

    // Roots are the nodes at the highest depth (or nodes with no parent)
    const maxDepth = nodes.length > 0 ? Math.max(...nodes.map((n) => n.depth)) : 0;
    const rootNode = byDepth.get(maxDepth);
    if (rootNode) {
      roots.push(rootNode);
    } else if (nodes.length > 0) {
      // Fallback: no chain structure, just list flat
      roots.push(...nodes);
    }

    result.push({ endpoint, chain: roots });
  }

  return result;
}

// -- Helpers ----------------------------------------------------------------

function formatDate(value: string): string {
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

function depthLabel(depth: number, maxDepth: number): string {
  if (depth === 0) return "Leaf";
  if (depth === maxDepth) return "Root";
  return "Intermediate";
}

// -- Sub-components ---------------------------------------------------------

function ChainNodeCard({ node, maxDepth }: { node: ChainNode; maxDepth: number }) {
  const cert = node.cert;
  const hasWarning = cert.is_expired || cert.is_self_signed || cert.hostname_mismatch;

  const roleLabel = depthLabel(node.depth, maxDepth);
  const roleColor =
    node.depth === 0
      ? "text-accent-400"
      : node.depth === maxDepth
        ? "text-surface-400"
        : "text-status-info";

  return (
    <div className="relative">
      {/* Node card */}
      <div
        className={`rounded-lg border p-3 ${
          hasWarning
            ? "border-status-danger/40 bg-status-danger/5"
            : "border-surface-700 bg-surface-800/50"
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          {/* Role badge */}
          <span
            className={`inline-flex items-center rounded-full border border-surface-600 bg-surface-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${roleColor}`}
          >
            {roleLabel}
          </span>

          {/* Warning badges */}
          {cert.is_self_signed && (
            <span className="inline-flex items-center rounded-full border border-status-warning/30 bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-warning">
              Self-Signed
            </span>
          )}
          {cert.is_expired && (
            <span className="inline-flex items-center rounded-full border border-status-danger/30 bg-status-danger/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-danger">
              Expired
            </span>
          )}
          {cert.hostname_mismatch && (
            <span className="inline-flex items-center gap-1 rounded-full border border-status-danger/30 bg-status-danger/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-status-danger">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              Hostname Mismatch
            </span>
          )}
        </div>

        <div className="text-sm font-medium text-surface-200 truncate">{cert.subject}</div>
        <div className="text-xs text-surface-400 mt-0.5 truncate">
          Issued by: {cert.issuer}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-surface-400">
          <span>
            {formatDate(cert.not_before)} - {formatDate(cert.not_after)}
          </span>
          <span>
            {cert.key_type} {cert.key_size}-bit
          </span>
          {cert.san_names && cert.san_names.length > 0 && (
            <span>{cert.san_names.length} SAN{cert.san_names.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>

      {/* Children (connected by a vertical + horizontal line) */}
      {node.children.length > 0 && (
        <div className="ml-6 mt-0 relative">
          {/* Vertical connector line */}
          <div className="absolute left-0 top-0 bottom-4 w-px bg-surface-700" />

          {node.children.map((child, i) => (
            <div key={`${child.cert.serial_number}-${i}`} className="relative pl-6 pt-3">
              {/* Horizontal connector */}
              <div className="absolute left-0 top-[24px] w-6 h-px bg-surface-700" />
              {/* Arrow indicator */}
              <div className="absolute left-[20px] top-[21px] w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[5px] border-l-surface-700" />
              <ChainNodeCard node={child} maxDepth={maxDepth} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -- Main component ---------------------------------------------------------

interface CertChainTreeProps {
  tlsResults: TLSCertInfo[];
}

export default function CertChainTree({ tlsResults }: CertChainTreeProps) {
  if (tlsResults.length === 0) return null;

  const chains = buildChains(tlsResults);

  if (chains.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-surface-200">TLS Certificate Chains</h3>

      <div className="space-y-4">
        {chains.map(({ endpoint, chain }) => {
          // Compute max depth for this chain
          const allDepths: number[] = [];
          function collectDepths(nodes: ChainNode[]) {
            for (const n of nodes) {
              allDepths.push(n.depth);
              collectDepths(n.children);
            }
          }
          collectDepths(chain);
          const maxDepth = allDepths.length > 0 ? Math.max(...allDepths) : 0;

          return (
            <div key={endpoint} className="rounded-lg border border-surface-700 bg-surface-900 p-4">
              {/* Endpoint header */}
              <div className="flex items-center gap-2 mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-accent-400">
                  <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-semibold font-mono text-surface-200">{endpoint}</span>
                <span className="text-xs text-surface-500">
                  ({allDepths.length} cert{allDepths.length !== 1 ? "s" : ""} in chain)
                </span>
              </div>

              {/* Chain tree */}
              <div className="space-y-2">
                {chain.map((root, i) => (
                  <ChainNodeCard key={`${root.cert.serial_number}-${i}`} node={root} maxDepth={maxDepth} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
