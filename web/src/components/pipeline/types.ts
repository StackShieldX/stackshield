/**
 * Shared types and tool definitions for the pipeline builder.
 */

// ---------------------------------------------------------------------------
// Tool definitions (mirrors the definitions from NewScan.tsx)
// ---------------------------------------------------------------------------

export type ToolName = "dns" | "ports" | "certs";

export interface FieldDef {
  name: string;
  label: string;
  placeholder: string;
  required: boolean;
  hint?: string;
}

export interface ToolDef {
  label: string;
  description: string;
  color: string;
  fields: FieldDef[];
}

export const TOOLS: Record<ToolName, ToolDef> = {
  dns: {
    label: "DNS",
    description: "DNS discovery and subdomain enumeration",
    color: "#3b82f6",
    fields: [
      {
        name: "domain",
        label: "Domain",
        placeholder: "example.com",
        required: true,
        hint: "Fully qualified domain name to enumerate.",
      },
    ],
  },
  ports: {
    label: "Ports",
    description: "Port scanning and service detection",
    color: "#22c55e",
    fields: [
      {
        name: "targets",
        label: "Targets",
        placeholder: "192.168.1.0/24 or example.com",
        required: true,
        hint: "Comma-separated IPs, CIDRs, or hostnames.",
      },
      {
        name: "ports",
        label: "Ports",
        placeholder: "1-1024 or 80,443,8080",
        required: false,
        hint: "Port range or comma-separated list. Defaults to top 1000.",
      },
      {
        name: "scan_type",
        label: "Scan Type",
        placeholder: "syn, connect, or udp",
        required: false,
        hint: "Nmap scan type. Defaults to syn.",
      },
    ],
  },
  certs: {
    label: "Certs",
    description: "TLS certificate inspection and CT logs",
    color: "#f59e0b",
    fields: [
      {
        name: "domain",
        label: "Domain",
        placeholder: "example.com",
        required: true,
        hint: "Domain to inspect TLS certificates for.",
      },
      {
        name: "mode",
        label: "Mode",
        placeholder: "ct, tls, or all",
        required: false,
        hint: "Discovery mode. Defaults to all.",
      },
      {
        name: "ports",
        label: "Ports",
        placeholder: "443,8443",
        required: false,
        hint: "Ports to probe for TLS. Defaults to 443.",
      },
    ],
  },
};

export const TOOL_NAMES: ToolName[] = ["dns", "ports", "certs"];

// ---------------------------------------------------------------------------
// Node data type stored on react-flow nodes
// ---------------------------------------------------------------------------

export type NodeStatus = "idle" | "running" | "complete" | "failed" | "skipped";

export interface ToolNodeData extends Record<string, unknown> {
  tool: ToolName;
  label: string;
  params: Record<string, string>;
  status: NodeStatus;
  upstreamTools?: ToolName[];
}

// ---------------------------------------------------------------------------
// Domain key mapping -- which param carries the primary domain/target
// ---------------------------------------------------------------------------

export const DOMAIN_KEYS: Record<ToolName, string> = {
  dns: "domain",
  ports: "targets",
  certs: "domain",
};

// ---------------------------------------------------------------------------
// Chained field rules -- fields hidden when an upstream tool provides data
// ---------------------------------------------------------------------------

/** Map of target tool -> upstream tool -> fields to hide. */
const CHAINED_HIDDEN_FIELDS: Partial<Record<ToolName, Partial<Record<ToolName, string[]>>>> = {
  certs: {
    ports: ["ports"],
  },
};

/** Get the set of field names to hide for a tool given its upstream connections. */
export function getHiddenFields(tool: ToolName, upstreamTools: ToolName[]): Set<string> {
  const hidden = new Set<string>();
  const rules = CHAINED_HIDDEN_FIELDS[tool];
  if (!rules) return hidden;
  for (const upstream of upstreamTools) {
    const fields = rules[upstream];
    if (fields) fields.forEach((f) => hidden.add(f));
  }
  return hidden;
}

// ---------------------------------------------------------------------------
// Valid connection rules -- which tools can connect to which
// ---------------------------------------------------------------------------

/** Map from source tool to allowed target tools. */
export const VALID_CONNECTIONS: Record<ToolName, ToolName[]> = {
  dns: ["ports", "certs"],
  ports: ["certs"],
  certs: [],
};

// ---------------------------------------------------------------------------
// Pipeline definition for API / localStorage
// ---------------------------------------------------------------------------

export interface SavedPipeline {
  id: string;
  name: string;
  savedAt: string;
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: ToolNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
}
