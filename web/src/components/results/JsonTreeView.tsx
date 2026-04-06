import { useCallback, useState } from "react";

interface JsonNodeProps {
  keyName: string | null;
  value: unknown;
  depth: number;
  defaultExpanded: boolean;
}

function JsonNode({ keyName, value, depth, defaultExpanded }: JsonNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (value === null) {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
        {keyName !== null && (
          <span className="text-accent-300">{`"${keyName}": `}</span>
        )}
        <span className="text-surface-500">null</span>
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
        {keyName !== null && (
          <span className="text-accent-300">{`"${keyName}": `}</span>
        )}
        <span className="text-status-warning">{value ? "true" : "false"}</span>
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
        {keyName !== null && (
          <span className="text-accent-300">{`"${keyName}": `}</span>
        )}
        <span className="text-status-info">{String(value)}</span>
      </div>
    );
  }

  if (typeof value === "string") {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
        {keyName !== null && (
          <span className="text-accent-300">{`"${keyName}": `}</span>
        )}
        <span className="text-status-success">{`"${value}"`}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
          {keyName !== null && (
            <span className="text-accent-300">{`"${keyName}": `}</span>
          )}
          <span className="text-surface-400">{"[]"}</span>
        </div>
      );
    }

    return (
      <div style={{ paddingLeft: depth * 16 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-baseline gap-1 text-left hover:bg-surface-800/50 rounded px-1 -ml-1"
        >
          <span className="text-surface-500 w-3 shrink-0 text-xs">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
          {keyName !== null && (
            <span className="text-accent-300">{`"${keyName}": `}</span>
          )}
          <span className="text-surface-400">
            {expanded ? "[" : `[ ... ${value.length} items ]`}
          </span>
        </button>
        {expanded && (
          <>
            {value.map((item, i) => (
              <JsonNode
                key={i}
                keyName={null}
                value={item}
                depth={depth + 1}
                defaultExpanded={depth < 1}
              />
            ))}
            <div style={{ paddingLeft: depth * 16 }}>
              <span className="text-surface-400">{"]"}</span>
            </div>
          </>
        )}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
          {keyName !== null && (
            <span className="text-accent-300">{`"${keyName}": `}</span>
          )}
          <span className="text-surface-400">{"{}"}</span>
        </div>
      );
    }

    return (
      <div style={{ paddingLeft: depth * 16 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-baseline gap-1 text-left hover:bg-surface-800/50 rounded px-1 -ml-1"
        >
          <span className="text-surface-500 w-3 shrink-0 text-xs">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
          {keyName !== null && (
            <span className="text-accent-300">{`"${keyName}": `}</span>
          )}
          <span className="text-surface-400">
            {expanded ? "{" : `{ ... ${entries.length} keys }`}
          </span>
        </button>
        {expanded && (
          <>
            {entries.map(([k, v]) => (
              <JsonNode
                key={k}
                keyName={k}
                value={v}
                depth={depth + 1}
                defaultExpanded={depth < 1}
              />
            ))}
            <div style={{ paddingLeft: depth * 16 }}>
              <span className="text-surface-400">{"}"}</span>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <span className="text-surface-400">{String(value)}</span>
    </div>
  );
}

interface JsonTreeViewProps {
  data: unknown;
}

export default function JsonTreeView({ data }: JsonTreeViewProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  return (
    <div className="mt-6 rounded-lg border border-surface-700 bg-surface-900">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-800/50 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <span className="text-surface-500 text-xs">
            {collapsed ? "\u25B6" : "\u25BC"}
          </span>
          <span className="text-sm font-medium text-surface-200">Raw JSON</span>
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          className="flex items-center gap-1.5 rounded-md border border-surface-600 bg-surface-800 px-2.5 py-1 text-xs text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors cursor-pointer"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              handleCopy();
            }
          }}
        >
          {copied ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-status-success">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
                <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
              </svg>
              Copy JSON
            </>
          )}
        </div>
      </button>
      {!collapsed && (
        <div className="border-t border-surface-700 p-4 overflow-x-auto font-mono text-xs leading-relaxed">
          <JsonNode keyName={null} value={data} depth={0} defaultExpanded={true} />
        </div>
      )}
    </div>
  );
}
