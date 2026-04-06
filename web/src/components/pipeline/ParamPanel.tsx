/**
 * Parameter editing panel that opens when a pipeline node is selected.
 *
 * Shows the same form fields as the tool launcher (from NewScan), allowing
 * users to configure tool parameters for each node in the pipeline.
 */

import { useCallback } from "react";
import { TOOLS, DOMAIN_KEYS, getHiddenFields, type ToolName, type ToolNodeData } from "./types";

interface ParamPanelProps {
  nodeId: string;
  data: ToolNodeData;
  onUpdate: (nodeId: string, params: Record<string, string>) => void;
  onDelete: (nodeId: string) => void;
  disabled?: boolean;
  upstreamTools?: ToolName[];
}

export default function ParamPanel({
  nodeId,
  data,
  onUpdate,
  onDelete,
  disabled,
  upstreamTools,
}: ParamPanelProps) {
  const toolDef = TOOLS[data.tool as ToolName];
  const hiddenFields = getHiddenFields(data.tool, upstreamTools ?? []);
  const visibleFields = toolDef?.fields.filter((f) => !hiddenFields.has(f.name)) ?? [];
  const hasUpstream = (upstreamTools ?? []).length > 0;
  const domainKey = DOMAIN_KEYS[data.tool];

  const handleFieldChange = useCallback(
    (fieldName: string, value: string) => {
      onUpdate(nodeId, { ...data.params, [fieldName]: value });
    },
    [nodeId, data.params, onUpdate],
  );

  const handleDelete = useCallback(() => {
    onDelete(nodeId);
  }, [nodeId, onDelete]);

  if (!toolDef) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: toolDef.color }}
          />
          <h3 className="text-sm font-semibold text-surface-100">
            {data.label}
          </h3>
        </div>
        <button
          onClick={handleDelete}
          disabled={disabled}
          className="rounded p-1 text-surface-500 hover:bg-surface-800 hover:text-status-danger transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete node"
        >
          <TrashIcon />
        </button>
      </div>

      <p className="text-xs text-surface-500">{toolDef.description}</p>

      {/* Parameter fields */}
      <div className="space-y-3">
        {visibleFields.map((field) => {
          const inheritedFromUpstream = hasUpstream && field.name === domainKey;
          return (
            <div key={field.name}>
              <label
                htmlFor={`param-${nodeId}-${field.name}`}
                className="mb-1 block text-xs font-medium text-surface-300"
              >
                {field.label}
                {field.required && !inheritedFromUpstream && (
                  <span className="ml-0.5 text-status-danger">*</span>
                )}
                {inheritedFromUpstream && (
                  <span className="ml-1.5 text-xs font-normal text-surface-500">
                    (set by upstream)
                  </span>
                )}
              </label>
              <input
                id={`param-${nodeId}-${field.name}`}
                type="text"
                disabled={disabled || inheritedFromUpstream}
                placeholder={field.placeholder}
                value={data.params[field.name] ?? ""}
                onChange={(e) => handleFieldChange(field.name, e.target.value)}
                className="block w-full rounded-lg border border-surface-700 bg-surface-900 px-3 py-1.5 text-sm text-surface-100 placeholder:text-surface-500 outline-none transition-colors focus:border-accent-500 focus:ring-2 focus:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
              {field.hint && !inheritedFromUpstream && (
                <p className="mt-0.5 text-xs text-surface-500">{field.hint}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Note about fields inferred from upstream */}
      {hiddenFields.size > 0 && (
        <div className="rounded-md bg-surface-800/50 border border-surface-700 px-3 py-2">
          <p className="text-xs text-surface-400">
            {Array.from(hiddenFields)
              .map((f) => toolDef.fields.find((fd) => fd.name === f)?.label ?? f)
              .join(", ")}{" "}
            will be inferred from upstream scan results.
          </p>
        </div>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}
