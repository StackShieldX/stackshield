/**
 * Custom react-flow node representing a security tool in the pipeline.
 *
 * Shows the tool name/label, connection handles on left (input) and right
 * (output), and a visual status indicator during pipeline execution.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { TOOLS, VALID_CONNECTIONS, getHiddenFields, type ToolNodeData, type ToolName, type NodeStatus } from "./types";

// ---------------------------------------------------------------------------
// Status badge styles
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<NodeStatus, { bg: string; ring: string; text: string; label: string }> = {
  idle: { bg: "", ring: "", text: "", label: "" },
  running: {
    bg: "bg-status-info/10",
    ring: "ring-status-info/40",
    text: "text-status-info",
    label: "Running",
  },
  complete: {
    bg: "bg-status-success/10",
    ring: "ring-status-success/40",
    text: "text-status-success",
    label: "Complete",
  },
  failed: {
    bg: "bg-status-danger/10",
    ring: "ring-status-danger/40",
    text: "text-status-danger",
    label: "Failed",
  },
  skipped: {
    bg: "bg-surface-700/30",
    ring: "ring-surface-600/40",
    text: "text-surface-500",
    label: "Skipped",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ToolNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ToolNodeData;
  const toolDef = TOOLS[nodeData.tool];
  const status = nodeData.status ?? "idle";
  const statusStyle = STATUS_STYLES[status];
  const hasOutputConnections = VALID_CONNECTIONS[nodeData.tool].length > 0;

  // Count configured params (excluding fields hidden by upstream chaining)
  const upstreamTools = (nodeData.upstreamTools as ToolName[] | undefined) ?? [];
  const hiddenFields = getHiddenFields(nodeData.tool, upstreamTools);
  const visibleFields = toolDef.fields.filter((f) => !hiddenFields.has(f.name));
  const configuredCount = visibleFields.filter(
    (f) => (nodeData.params[f.name] ?? "").trim() !== "",
  ).length;
  const totalFields = visibleFields.length;

  return (
    <div
      className={`relative rounded-xl border bg-surface-900 shadow-lg transition-all min-w-[180px] ${
        selected
          ? "border-accent-500 ring-2 ring-accent-500/30"
          : "border-surface-700 hover:border-surface-500"
      } ${status !== "idle" ? `ring-1 ${statusStyle.ring}` : ""}`}
    >
      {/* Input handle (left side) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-surface-600 !border-2 !border-surface-400 hover:!bg-accent-500 hover:!border-accent-400 transition-colors"
      />

      {/* Header bar with tool color accent */}
      <div
        className="flex items-center gap-2 rounded-t-xl px-3 py-2"
        style={{ borderBottom: `2px solid ${toolDef.color}` }}
      >
        <div
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: toolDef.color }}
        />
        <span className="text-sm font-semibold text-surface-100">
          {nodeData.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1">
        <p className="text-xs text-surface-400">{toolDef.description}</p>
        <p className="text-xs text-surface-500">
          {configuredCount}/{totalFields} params configured
        </p>

        {/* Status badge during execution */}
        {status !== "idle" && (
          <div className={`mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
            {status === "running" && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            )}
            {status === "complete" && <CheckMark />}
            {status === "failed" && <XMark />}
            {statusStyle.label}
          </div>
        )}
      </div>

      {/* Output handle (right side) -- only if this tool can connect downstream */}
      {hasOutputConnections && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-surface-600 !border-2 !border-surface-400 hover:!bg-accent-500 hover:!border-accent-400 transition-colors"
        />
      )}
    </div>
  );
}

export default memo(ToolNodeComponent);

// ---------------------------------------------------------------------------
// Tiny inline icons
// ---------------------------------------------------------------------------

function CheckMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
      <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.739a.75.75 0 0 1 1.04-.208Z" clipRule="evenodd" />
    </svg>
  );
}

function XMark() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
      <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
    </svg>
  );
}
