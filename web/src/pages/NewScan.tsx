import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolName = "dns" | "ports" | "certs";

interface FieldDef {
  name: string;
  label: string;
  placeholder: string;
  required: boolean;
  /** Optional helper text shown below the input. */
  hint?: string;
}

interface ToolDef {
  label: string;
  fields: FieldDef[];
}

type ScanPhase = "idle" | "running" | "complete" | "failed";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Record<ToolName, ToolDef> = {
  dns: {
    label: "DNS",
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

const TOOL_NAMES: ToolName[] = ["dns", "ports", "certs"];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const DOMAIN_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

/** Validate a port-range string such as "1-65535" or "80,443,8080". */
function isValidPortSpec(value: string): boolean {
  if (!value.trim()) return true; // empty is ok -- field is optional
  const parts = value.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) return false;
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo < 1 || hi > 65535 || lo > hi) return false;
      continue;
    }
    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < 1 || num > 65535 || String(num) !== trimmed) return false;
  }
  return true;
}

function validate(
  tool: ToolName,
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const def = TOOLS[tool];

  for (const field of def.fields) {
    const val = (values[field.name] ?? "").trim();
    if (field.required && !val) {
      errors[field.name] = `${field.label} is required.`;
      continue;
    }
    if (!val) continue;

    // Domain format check
    if (field.name === "domain" && !DOMAIN_RE.test(val)) {
      errors[field.name] = "Enter a valid domain (e.g. example.com).";
    }

    // Port range check
    if (field.name === "ports" && !isValidPortSpec(val)) {
      errors[field.name] =
        "Invalid port specification. Use a range (1-1024) or comma-separated list (80,443).";
    }

    // Scan type check
    if (field.name === "scan_type" && val && !["syn", "connect", "udp"].includes(val)) {
      errors[field.name] = "Scan type must be syn, connect, or udp.";
    }

    // Mode check
    if (field.name === "mode" && val && !["ct", "tls", "all"].includes(val)) {
      errors[field.name] = "Mode must be ct, tls, or all.";
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewScan() {
  const [selectedTool, setSelectedTool] = useState<ToolName>("dns");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [scanId, setScanId] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Auto-scroll terminal to bottom when new lines arrive
  useEffect(() => {
    const el = terminalRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines, finalStatus]);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Reset form state when tool changes
  const handleToolChange = useCallback((tool: ToolName) => {
    setSelectedTool(tool);
    setValues({});
    setErrors({});
    setPhase("idle");
    setScanId(null);
    setLines([]);
    setFinalStatus(null);
    setLaunchError(null);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const handleFieldChange = useCallback(
    (name: string, value: string) => {
      setValues((prev) => ({ ...prev, [name]: value }));
      // Clear the error for this field on edit
      setErrors((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    },
    [],
  );

  // Connect to the WebSocket for a running scan
  const connectWs = useCallback((id: string) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/runs/${id}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "stderr") {
          setLines((prev) => [...prev, msg.line]);
        } else if (msg.type === "done") {
          setFinalStatus(msg.status);
          setPhase(msg.status === "complete" ? "complete" : "failed");
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      setPhase("failed");
      setFinalStatus("failed");
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, []);

  const handleLaunch = useCallback(async () => {
    // Validate
    const fieldErrors = validate(selectedTool, values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setPhase("running");
    setLines([]);
    setScanId(null);
    setFinalStatus(null);
    setLaunchError(null);
    setErrors({});

    // Build params: only include non-empty values
    const params: Record<string, string> = {};
    for (const field of TOOLS[selectedTool].fields) {
      const val = (values[field.name] ?? "").trim();
      if (val) {
        params[field.name] = val;
      }
    }

    try {
      const resp = await fetch("/api/runs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: selectedTool, params }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body.detail ?? `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      setScanId(data.scan_id);
      connectWs(data.scan_id);
    } catch (err) {
      setPhase("failed");
      setLaunchError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedTool, values, connectWs]);

  const isRunning = phase === "running";
  const showTerminal = phase !== "idle";

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold text-surface-100">New Scan</h1>
      <p className="mt-1 text-sm text-surface-400">
        Select a tool, configure parameters, and launch.
      </p>

      {/* ---- Tool selector (segmented control) ---- */}
      <div className="mt-6 inline-flex rounded-lg border border-surface-700 bg-surface-900 p-1">
        {TOOL_NAMES.map((tool) => (
          <button
            key={tool}
            onClick={() => handleToolChange(tool)}
            disabled={isRunning}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              selectedTool === tool
                ? "bg-accent-600 text-white shadow-sm"
                : "text-surface-400 hover:text-surface-200"
            } ${isRunning ? "cursor-not-allowed opacity-60" : ""}`}
          >
            {TOOLS[tool].label}
          </button>
        ))}
      </div>

      {/* ---- Dynamic form ---- */}
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleLaunch();
        }}
      >
        {TOOLS[selectedTool].fields.map((field) => (
          <div key={field.name}>
            <label
              htmlFor={`field-${field.name}`}
              className="mb-1 block text-sm font-medium text-surface-200"
            >
              {field.label}
              {field.required && <span className="ml-0.5 text-status-danger">*</span>}
            </label>
            <input
              id={`field-${field.name}`}
              type="text"
              disabled={isRunning}
              placeholder={field.placeholder}
              value={values[field.name] ?? ""}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`block w-full rounded-lg border bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder:text-surface-500 outline-none transition-colors focus:ring-2 focus:ring-accent-500/40 ${
                errors[field.name]
                  ? "border-status-danger focus:border-status-danger"
                  : "border-surface-700 focus:border-accent-500"
              } ${isRunning ? "cursor-not-allowed opacity-60" : ""}`}
            />
            {errors[field.name] && (
              <p className="mt-1 text-xs text-status-danger">{errors[field.name]}</p>
            )}
            {field.hint && !errors[field.name] && (
              <p className="mt-1 text-xs text-surface-500">{field.hint}</p>
            )}
          </div>
        ))}

        {/* ---- Launch button ---- */}
        <button
          type="submit"
          disabled={isRunning}
          className={`mt-2 inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors ${
            isRunning
              ? "cursor-not-allowed bg-accent-600/50"
              : "bg-accent-600 hover:bg-accent-500 active:bg-accent-700"
          }`}
        >
          {isRunning && <Spinner />}
          {isRunning ? "Running..." : "Launch Scan"}
        </button>
      </form>

      {/* ---- Terminal output pane ---- */}
      {showTerminal && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-medium text-surface-300">Output</h2>
            {phase === "running" && (
              <span className="inline-block h-2 w-2 rounded-full bg-status-info animate-pulse" />
            )}
          </div>

          <div
            ref={terminalRef}
            className="h-80 overflow-y-auto rounded-lg border border-surface-700 bg-surface-950 p-4 font-mono text-xs leading-relaxed text-surface-300"
          >
            {lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))}

            {/* Launch-level error (e.g. network failure before WS) */}
            {launchError && (
              <div className="mt-2 whitespace-pre-wrap break-all text-status-danger">
                Error: {launchError}
              </div>
            )}

            {/* Empty state while waiting for first line */}
            {lines.length === 0 && !launchError && phase === "running" && (
              <span className="text-surface-500">Waiting for output...</span>
            )}
          </div>

          {/* ---- Status banner ---- */}
          {phase === "complete" && (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-status-success/30 bg-status-success/10 px-4 py-3">
              <CheckIcon />
              <div>
                <p className="text-sm font-medium text-status-success">
                  Scan completed successfully.
                </p>
                {scanId && (
                  <a
                    href={`/scans/${scanId}`}
                    className="mt-0.5 inline-block text-xs text-accent-400 underline underline-offset-2 hover:text-accent-300"
                  >
                    View full results
                  </a>
                )}
              </div>
            </div>
          )}

          {phase === "failed" && (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-status-danger/30 bg-status-danger/10 px-4 py-3">
              <XIcon />
              <p className="text-sm font-medium text-status-danger">
                Scan failed.{" "}
                {launchError
                  ? "Could not start the scan."
                  : "Check the output above for details."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small inline icons to avoid adding a dependency
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5 shrink-0 text-status-success"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5 shrink-0 text-status-danger"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
        clipRule="evenodd"
      />
    </svg>
  );
}
