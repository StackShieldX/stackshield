/**
 * Draggable tool palette for the pipeline builder.
 *
 * Users drag tools from this panel onto the react-flow canvas to create
 * new nodes. Uses the HTML5 drag-and-drop API (react-flow's recommended
 * pattern for external node creation).
 */

import { TOOLS, TOOL_NAMES, type ToolName } from "./types";

interface ToolPaletteProps {
  disabled?: boolean;
}

export default function ToolPalette({ disabled }: ToolPaletteProps) {
  const onDragStart = (event: React.DragEvent, tool: ToolName) => {
    event.dataTransfer.setData("application/pipeline-tool", tool);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">
        Tool Palette
      </h3>
      <p className="text-xs text-surface-500">
        Drag a tool onto the canvas to add it.
      </p>
      <div className="space-y-1.5 pt-1">
        {TOOL_NAMES.map((tool) => {
          const def = TOOLS[tool];
          return (
            <div
              key={tool}
              draggable={!disabled}
              onDragStart={(e) => onDragStart(e, tool)}
              className={`flex items-center gap-2.5 rounded-lg border border-surface-700 bg-surface-800/60 px-3 py-2 transition-colors ${
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-grab hover:border-surface-500 hover:bg-surface-800 active:cursor-grabbing"
              }`}
            >
              <div
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: def.color }}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-surface-200">
                  {def.label}
                </p>
                <p className="text-xs text-surface-500 truncate">
                  {def.description}
                </p>
              </div>
              <DragIcon />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DragIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 shrink-0 text-surface-600"
    >
      <path
        fillRule="evenodd"
        d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
        clipRule="evenodd"
      />
    </svg>
  );
}
