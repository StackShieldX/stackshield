/** Interactive force-directed graph for DNS discovery results.
 *
 * Renders domain -> subdomain -> IP/CNAME relationships using react-force-graph-2d
 * (canvas-based for performance with large result sets).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph, {
  type ForceGraphMethods,
  type NodeObject,
  type LinkObject,
} from "react-force-graph-2d";

// -- Data types matching DnsResults.tsx interfaces --

interface ARecord {
  ip_address: string;
  asn_info?: {
    asn?: string;
    organization?: string;
    country?: string;
    network_range?: string;
  } | null;
}

interface AAAARecord {
  ipv6_address: string;
  asn_info?: {
    asn?: string;
    organization?: string;
    country?: string;
    network_range?: string;
  } | null;
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

interface DnsData {
  name: string;
  subdomains?: Subdomain[];
}

// -- Graph node/link types --

type DnsNodeType = "domain" | "subdomain" | "ipv4" | "ipv6" | "cname";

interface DnsNode {
  id: string;
  label: string;
  nodeType: DnsNodeType;
  /** Extra metadata for detail panel */
  meta?: Record<string, unknown>;
}

type DnsLink = {
  source: string;
  target: string;
  edgeType: string;
};

// -- Color and size constants --

const NODE_COLORS: Record<DnsNodeType, string> = {
  domain: "#818cf8",   // accent-400 (indigo)
  subdomain: "#3b82f6", // status-info (blue)
  ipv4: "#22c55e",      // status-success (green)
  ipv6: "#f59e0b",      // status-warning (amber)
  cname: "#a78bfa",     // violet-400
};

const NODE_SIZES: Record<DnsNodeType, number> = {
  domain: 6,
  subdomain: 3,
  ipv4: 2,
  ipv6: 2,
  cname: 2,
};

const DIMMED_OPACITY = 0.08;

/** Maximum number of nodes to display before collapsing into an expand-on-click mode. */
const LARGE_GRAPH_THRESHOLD = 200;

// -- Graph data builder --

interface GraphData {
  nodes: DnsNode[];
  links: DnsLink[];
}

function buildGraphData(data: DnsData): GraphData {
  const nodes = new Map<string, DnsNode>();
  const links: DnsLink[] = [];

  // Root domain node
  const domainId = `domain:${data.name}`;
  nodes.set(domainId, {
    id: domainId,
    label: data.name,
    nodeType: "domain",
  });

  const subdomains = data.subdomains || [];

  for (const sub of subdomains) {
    const subId = `sub:${sub.name}`;

    if (!nodes.has(subId)) {
      nodes.set(subId, {
        id: subId,
        label: sub.name,
        nodeType: "subdomain",
        meta: {
          sources: sub.sources,
        },
      });
    }

    // Domain -> subdomain edge
    links.push({
      source: domainId,
      target: subId,
      edgeType: "subdomain",
    });

    const records = sub.dns_records;
    if (!records) continue;

    // A records (IPv4)
    for (const rec of records.a || []) {
      const ipId = `ipv4:${rec.ip_address}`;
      if (!nodes.has(ipId)) {
        nodes.set(ipId, {
          id: ipId,
          label: rec.ip_address,
          nodeType: "ipv4",
          meta: rec.asn_info ? { asn_info: rec.asn_info } : undefined,
        });
      }
      links.push({
        source: subId,
        target: ipId,
        edgeType: "A",
      });
    }

    // AAAA records (IPv6)
    for (const rec of records.aaaa || []) {
      const ipId = `ipv6:${rec.ipv6_address}`;
      if (!nodes.has(ipId)) {
        nodes.set(ipId, {
          id: ipId,
          label: rec.ipv6_address,
          nodeType: "ipv6",
          meta: rec.asn_info ? { asn_info: rec.asn_info } : undefined,
        });
      }
      links.push({
        source: subId,
        target: ipId,
        edgeType: "AAAA",
      });
    }

    // CNAME records
    for (const rec of records.cname || []) {
      const cnameId = `cname:${rec.canonical_name}`;
      if (!nodes.has(cnameId)) {
        nodes.set(cnameId, {
          id: cnameId,
          label: rec.canonical_name,
          nodeType: "cname",
        });
      }
      links.push({
        source: subId,
        target: cnameId,
        edgeType: "CNAME",
      });
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    links,
  };
}

// -- Detail panel helpers --

interface AsnInfo {
  asn?: string;
  organization?: string;
  country?: string;
  network_range?: string;
}

function renderAsnInfo(raw: unknown): React.ReactNode {
  if (!raw || typeof raw !== "object") return null;
  const info = raw as AsnInfo;
  if (!info.asn && !info.organization && !info.country && !info.network_range) {
    return null;
  }
  return (
    <div>
      <div className="text-xs text-surface-500 mb-1">ASN Info</div>
      <dl className="space-y-1 text-xs">
        {info.asn && (
          <div className="flex gap-2">
            <dt className="text-surface-500 shrink-0">ASN</dt>
            <dd className="text-surface-300 font-mono">{info.asn}</dd>
          </div>
        )}
        {info.organization && (
          <div className="flex gap-2">
            <dt className="text-surface-500 shrink-0">Org</dt>
            <dd className="text-surface-300">{info.organization}</dd>
          </div>
        )}
        {info.country && (
          <div className="flex gap-2">
            <dt className="text-surface-500 shrink-0">Country</dt>
            <dd className="text-surface-300">{info.country}</dd>
          </div>
        )}
        {info.network_range && (
          <div className="flex gap-2">
            <dt className="text-surface-500 shrink-0">Range</dt>
            <dd className="text-surface-300 font-mono">{info.network_range}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function renderSources(raw: unknown): React.ReactNode {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const sources = raw as { strategy: string; source: string }[];
  return (
    <div>
      <div className="text-xs text-surface-500 mb-1">Discovery Sources</div>
      <div className="flex flex-wrap gap-1">
        {sources.map((s, i) => (
          <span
            key={i}
            className="rounded bg-surface-800 px-1.5 py-0.5 text-xs text-surface-400"
          >
            {s.source}
          </span>
        ))}
      </div>
    </div>
  );
}

// -- Detail panel --

function NodeDetailPanel({
  node,
  connectedNodes,
  onClose,
}: {
  node: DnsNode;
  connectedNodes: DnsNode[];
  onClose: () => void;
}) {
  const typeLabels: Record<DnsNodeType, string> = {
    domain: "Root Domain",
    subdomain: "Subdomain",
    ipv4: "IPv4 Address",
    ipv6: "IPv6 Address",
    cname: "CNAME Target",
  };

  return (
    <div className="absolute top-3 right-3 w-72 max-h-[calc(100%-24px)] overflow-y-auto rounded-lg border border-surface-700 bg-surface-900/95 backdrop-blur-sm shadow-lg z-10">
      <div className="flex items-center justify-between p-3 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: NODE_COLORS[node.nodeType] }}
          />
          <span className="text-xs font-semibold text-surface-300 uppercase tracking-wider">
            {typeLabels[node.nodeType]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-surface-500 hover:text-surface-200 transition-colors"
          aria-label="Close detail panel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs text-surface-500 mb-0.5">Name</div>
          <div className="text-sm font-mono text-surface-100 break-all">
            {node.label}
          </div>
        </div>

        {/* ASN info for IP nodes */}
        {renderAsnInfo(node.meta?.asn_info)}

        {/* Sources for subdomains */}
        {renderSources(node.meta?.sources)}

        {/* Connected nodes */}
        {connectedNodes.length > 0 && (
          <div>
            <div className="text-xs text-surface-500 mb-1">
              Connected ({connectedNodes.length})
            </div>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {connectedNodes.map((cn) => (
                <div key={cn.id} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: NODE_COLORS[cn.nodeType] }}
                  />
                  <span className="text-xs font-mono text-surface-300 truncate">
                    {cn.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Legend component --

function GraphLegend() {
  const items: { type: DnsNodeType; label: string }[] = [
    { type: "domain", label: "Root Domain" },
    { type: "subdomain", label: "Subdomain" },
    { type: "ipv4", label: "IPv4" },
    { type: "ipv6", label: "IPv6" },
    { type: "cname", label: "CNAME" },
  ];

  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-md bg-surface-900/90 backdrop-blur-sm px-3 py-1.5 border border-surface-700 z-10">
      {items.map((item) => (
        <div key={item.type} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: NODE_COLORS[item.type] }}
          />
          <span className="text-[10px] text-surface-400">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// -- Main component --

interface DnsGraphProps {
  data: DnsData;
}

export default function DnsGraph({ data }: DnsGraphProps) {
  const graphRef = useRef<ForceGraphMethods<NodeObject<DnsNode>, LinkObject<DnsNode, DnsLink>>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Build graph data
  const graphData = useMemo(() => buildGraphData(data), [data]);

  // For large graphs, only show the root domain and subdomains initially;
  // IP/CNAME nodes are revealed on subdomain click.
  const isLargeGraph = graphData.nodes.length > LARGE_GRAPH_THRESHOLD;
  const [expandedSubdomains, setExpandedSubdomains] = useState<Set<string>>(
    new Set()
  );

  // When graph is small enough, all nodes are visible
  const visibleGraphData = useMemo(() => {
    if (!isLargeGraph) return graphData;

    const visibleNodeIds = new Set<string>();

    // Always show domain node
    for (const n of graphData.nodes) {
      if (n.nodeType === "domain" || n.nodeType === "subdomain") {
        visibleNodeIds.add(n.id);
      }
    }

    // Show leaf nodes for expanded subdomains
    for (const link of graphData.links) {
      const srcId = typeof link.source === "string" ? link.source : (link.source as DnsNode).id;
      if (expandedSubdomains.has(srcId)) {
        const tgtId = typeof link.target === "string" ? link.target : (link.target as DnsNode).id;
        visibleNodeIds.add(tgtId);
      }
    }

    return {
      nodes: graphData.nodes.filter((n) => visibleNodeIds.has(n.id)),
      links: graphData.links.filter((l) => {
        const srcId = typeof l.source === "string" ? l.source : (l.source as DnsNode).id;
        const tgtId = typeof l.target === "string" ? l.target : (l.target as DnsNode).id;
        return visibleNodeIds.has(srcId) && visibleNodeIds.has(tgtId);
      }),
    };
  }, [graphData, isLargeGraph, expandedSubdomains]);

  // Connectivity index for highlight mode
  const connectedMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of visibleGraphData.links) {
      const srcId =
        typeof link.source === "string"
          ? link.source
          : (link.source as DnsNode).id;
      const tgtId =
        typeof link.target === "string"
          ? link.target
          : (link.target as DnsNode).id;

      if (!map.has(srcId)) map.set(srcId, new Set());
      if (!map.has(tgtId)) map.set(tgtId, new Set());
      map.get(srcId)!.add(tgtId);
      map.get(tgtId)!.add(srcId);
    }
    return map;
  }, [visibleGraphData.links]);

  // Selected node and its connected nodes for the detail panel
  const selectedNode = useMemo(
    () =>
      selectedNodeId
        ? visibleGraphData.nodes.find((n) => n.id === selectedNodeId) ?? null
        : null,
    [selectedNodeId, visibleGraphData.nodes]
  );

  const selectedConnectedNodes = useMemo(() => {
    if (!selectedNodeId) return [];
    const ids = connectedMap.get(selectedNodeId);
    if (!ids) return [];
    return visibleGraphData.nodes.filter((n) => ids.has(n.id));
  }, [selectedNodeId, connectedMap, visibleGraphData.nodes]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ width, height: 500 });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Zoom to fit after initial render
  useEffect(() => {
    const timeout = setTimeout(() => {
      graphRef.current?.zoomToFit(400, 40);
    }, 600);
    return () => clearTimeout(timeout);
  }, [visibleGraphData]);

  // Node click handler
  const handleNodeClick = useCallback(
    (node: NodeObject<DnsNode>) => {
      const nodeId = node.id as string;

      // In large-graph mode, clicking a subdomain toggles expansion
      if (isLargeGraph && node.nodeType === "subdomain") {
        setExpandedSubdomains((prev) => {
          const next = new Set(prev);
          if (next.has(nodeId)) {
            next.delete(nodeId);
          } else {
            next.add(nodeId);
          }
          return next;
        });
      }

      // Toggle selection
      setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
    },
    [isLargeGraph]
  );

  // Background click deselects
  const handleBgClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Custom node canvas renderer
  const drawNode = useCallback(
    (
      node: NodeObject<DnsNode>,
      ctx: CanvasRenderingContext2D,
      globalScale: number
    ) => {
      const nodeId = node.id as string;
      const nodeType = node.nodeType || "subdomain";
      const size = NODE_SIZES[nodeType];
      const color = NODE_COLORS[nodeType];
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      // Determine opacity based on selection state
      let opacity = 1;
      if (selectedNodeId) {
        const isSelected = nodeId === selectedNodeId;
        const isConnected = connectedMap.get(selectedNodeId)?.has(nodeId);
        if (!isSelected && !isConnected) {
          opacity = DIMMED_OPACITY;
        }
      }

      ctx.globalAlpha = opacity;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Draw ring for domain node
      if (nodeType === "domain") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, size + 2, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // Draw expand indicator for large graphs with collapsed subdomains
      if (
        isLargeGraph &&
        nodeType === "subdomain" &&
        !expandedSubdomains.has(nodeId)
      ) {
        // Check if this subdomain has child nodes
        const hasChildren = graphData.links.some((l) => {
          const srcId =
            typeof l.source === "string"
              ? l.source
              : (l.source as DnsNode).id;
          return srcId === nodeId && l.edgeType !== "subdomain";
        });
        if (hasChildren) {
          ctx.fillStyle = "#94a3b8"; // surface-400
          ctx.font = `${Math.max(5, 7 / globalScale)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("+", x, y);
        }
      }

      // Draw label for domain nodes always, and for others when zoomed in enough
      const label = node.label || "";
      const showLabel =
        nodeType === "domain" ||
        globalScale > 1.5 ||
        (selectedNodeId &&
          (nodeId === selectedNodeId ||
            connectedMap.get(selectedNodeId)?.has(nodeId)));

      if (showLabel && label) {
        const fontSize = Math.max(6, 8 / globalScale);
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle =
          opacity < 1 ? `rgba(226, 232, 240, ${opacity})` : "#e2e8f0"; // surface-200
        ctx.fillText(label, x, y + size + 2);
      }

      ctx.globalAlpha = 1;
    },
    [
      selectedNodeId,
      connectedMap,
      isLargeGraph,
      expandedSubdomains,
      graphData.links,
    ]
  );

  // Hit area for node interaction (must match the visible area)
  const paintNodeArea = useCallback(
    (
      node: NodeObject<DnsNode>,
      color: string,
      ctx: CanvasRenderingContext2D
    ) => {
      const nodeType = node.nodeType || "subdomain";
      const size = NODE_SIZES[nodeType] + 2; // slightly larger hit area
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, size, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  // Link color with selection dimming
  const linkColor = useCallback(
    (link: LinkObject<DnsNode, DnsLink>) => {
      if (!selectedNodeId) return "rgba(100, 116, 139, 0.35)"; // surface-500 at 35%

      const srcId =
        typeof link.source === "string"
          ? link.source
          : (link.source as NodeObject<DnsNode>)?.id;
      const tgtId =
        typeof link.target === "string"
          ? link.target
          : (link.target as NodeObject<DnsNode>)?.id;

      const connected =
        srcId === selectedNodeId || tgtId === selectedNodeId;
      return connected
        ? "rgba(148, 163, 184, 0.6)" // surface-400 at 60%
        : `rgba(100, 116, 139, ${DIMMED_OPACITY})`;
    },
    [selectedNodeId]
  );

  // Graceful fallback: skip graph if fewer than 3 nodes
  if (visibleGraphData.nodes.length < 3) {
    return null;
  }

  return (
    <div className="rounded-lg border border-surface-700 overflow-hidden bg-surface-950 relative">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-900 border-b border-surface-700">
        <h3 className="text-sm font-semibold text-surface-200">
          Network Graph
        </h3>
        <div className="flex items-center gap-3 text-xs text-surface-400">
          <span>
            {visibleGraphData.nodes.length} nodes
          </span>
          <span>
            {visibleGraphData.links.length} edges
          </span>
          {isLargeGraph && (
            <span className="text-status-warning">
              Large graph -- click subdomains to expand
            </span>
          )}
        </div>
      </div>

      {/* Graph canvas */}
      <div ref={containerRef} className="relative" style={{ height: 500 }}>
        <ForceGraph
          ref={graphRef}
          graphData={visibleGraphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#020617"
          nodeCanvasObject={drawNode}
          nodeCanvasObjectMode={() => "replace"}
          nodePointerAreaPaint={paintNodeArea}
          linkColor={linkColor}
          linkWidth={1}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBgClick}
          enableZoomInteraction={true}
          enablePanInteraction={true}
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={50}
        />

        {/* Legend */}
        <GraphLegend />

        {/* Detail panel */}
        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            connectedNodes={selectedConnectedNodes}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}
