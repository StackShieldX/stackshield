/**
 * Pipeline builder page.
 *
 * Interactive canvas for building compound scan strategies using react-flow.
 * Users drag tool nodes from the palette onto the canvas, connect them to
 * define data flow (e.g. DNS -> Ports -> Certs), configure parameters per
 * node, validate the graph, and launch the pipeline.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import ToolNodeComponent from "../components/pipeline/ToolNode";
import ToolPalette from "../components/pipeline/ToolPalette";
import ParamPanel from "../components/pipeline/ParamPanel";
import PipelineManager from "../components/pipeline/PipelineManager";
import { validatePipeline } from "../components/pipeline/validation";
import { savePipeline } from "../components/pipeline/storage";
import {
  TOOLS,
  VALID_CONNECTIONS,
  DOMAIN_KEYS,
  type ToolName,
  type ToolNodeData,
  type NodeStatus,
  type SavedPipeline,
} from "../components/pipeline/types";

// ---------------------------------------------------------------------------
// react-flow custom node type mapping
// ---------------------------------------------------------------------------

const nodeTypes = { tool: ToolNodeComponent };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nodeCounter = 0;

function makeNodeId(): string {
  nodeCounter += 1;
  return `node-${nodeCounter}`;
}

function generatePipelineId(): string {
  return `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Safely extract ToolNodeData from a react-flow Node. */
function getNodeData(node: Node): ToolNodeData {
  return node.data as ToolNodeData;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type PipelinePhase = "editing" | "running" | "complete" | "failed";

export default function Pipelines() {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [phase, setPhase] = useState<PipelinePhase>("editing");
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const isRunning = phase === "running";
  const isEditing = phase === "editing";

  // -----------------------------------------------------------------------
  // Selected node data (for param panel)
  // -----------------------------------------------------------------------

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  // -----------------------------------------------------------------------
  // Keep upstreamTools in sync on each node whenever edges change
  // -----------------------------------------------------------------------

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const incoming = edges
          .filter((e) => e.target === n.id)
          .map((e) => {
            const src = nds.find((s) => s.id === e.source);
            return src ? getNodeData(src).tool : null;
          })
          .filter((t): t is ToolName => t !== null);

        const current = (n.data as ToolNodeData).upstreamTools;
        if (
          current?.length === incoming.length &&
          current.every((t, i) => t === incoming[i])
        ) {
          return n;
        }

        return { ...n, data: { ...n.data, upstreamTools: incoming } };
      }),
    );
  }, [edges, setNodes]);

  // Upstream tools for the currently selected node (for ParamPanel)
  const upstreamTools = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges
      .filter((e) => e.target === selectedNodeId)
      .map((e) => {
        const sourceNode = nodes.find((n) => n.id === e.source);
        return sourceNode ? getNodeData(sourceNode).tool : null;
      })
      .filter((t): t is ToolName => t !== null);
  }, [selectedNodeId, edges, nodes]);

  // -----------------------------------------------------------------------
  // Node selection
  // -----------------------------------------------------------------------

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      if (selected.length === 1) {
        setSelectedNodeId(selected[0].id);
      } else {
        setSelectedNodeId(null);
      }
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Connection validation and creation
  // -----------------------------------------------------------------------

  const isValidConnection = useCallback(
    (connection: Connection | Edge): boolean => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      const sourceTool = getNodeData(sourceNode).tool;
      const targetTool = getNodeData(targetNode).tool;

      // Check that the source tool can connect to the target tool
      const allowed = VALID_CONNECTIONS[sourceTool];
      if (!allowed.includes(targetTool)) return false;

      // Prevent duplicate edges
      const exists = edges.some(
        (e) => e.source === connection.source && e.target === connection.target,
      );
      if (exists) return false;

      // Prevent self-loops
      if (connection.source === connection.target) return false;

      return true;
    },
    [nodes, edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: "#6366f1", strokeWidth: 2 },
          },
          eds,
        ),
      );

      // Auto-populate target's domain/target from the source node
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      const sourceData = getNodeData(sourceNode);
      const targetData = getNodeData(targetNode);
      const sourceKey = DOMAIN_KEYS[sourceData.tool];
      const targetKey = DOMAIN_KEYS[targetData.tool];
      const sourceValue = sourceData.params[sourceKey];

      if (sourceValue && !targetData.params[targetKey]) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === connection.target
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    params: {
                      ...getNodeData(n).params,
                      [targetKey]: sourceValue,
                    },
                  },
                }
              : n,
          ),
        );
      }
    },
    [setEdges, nodes, setNodes],
  );

  // -----------------------------------------------------------------------
  // Drag-and-drop from palette onto canvas
  // -----------------------------------------------------------------------

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!isEditing) return;

      const tool = event.dataTransfer.getData("application/pipeline-tool") as ToolName;
      if (!tool || !TOOLS[tool]) return;

      const instance = rfInstance.current;
      if (!instance) return;

      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const toolDef = TOOLS[tool];
      const id = makeNodeId();

      const data: ToolNodeData = {
        tool,
        label: toolDef.label,
        params: {},
        status: "idle",
      };

      const newNode: Node = {
        id,
        type: "tool",
        position,
        data,
      };

      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(id);
      setValidationErrors([]);
    },
    [setNodes, isEditing],
  );

  // -----------------------------------------------------------------------
  // Parameter updates from the panel
  // -----------------------------------------------------------------------

  const handleParamUpdate = useCallback(
    (nodeId: string, params: Record<string, string>) => {
      setNodes((nds) => {
        // Update the edited node
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, params } } : n,
        );

        // Propagate domain/target to downstream nodes with empty fields
        const node = updated.find((n) => n.id === nodeId);
        if (!node) return updated;

        const tool = getNodeData(node).tool;
        const sourceKey = DOMAIN_KEYS[tool];
        const sourceValue = params[sourceKey];
        if (!sourceValue) return updated;

        const downstream = edges.filter((e) => e.source === nodeId);
        if (downstream.length === 0) return updated;

        return updated.map((n) => {
          if (!downstream.some((e) => e.target === n.id)) return n;
          const targetData = getNodeData(n);
          const targetKey = DOMAIN_KEYS[targetData.tool];
          if (targetData.params[targetKey]) return n;
          return {
            ...n,
            data: {
              ...n.data,
              params: { ...targetData.params, [targetKey]: sourceValue },
            },
          };
        });
      });
    },
    [setNodes, edges],
  );

  // -----------------------------------------------------------------------
  // Node deletion
  // -----------------------------------------------------------------------

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
      setValidationErrors([]);
    },
    [setNodes, setEdges, selectedNodeId],
  );

  // -----------------------------------------------------------------------
  // Update node statuses from WebSocket events
  // -----------------------------------------------------------------------

  const updateNodeStatus = useCallback(
    (nodeId: string, status: NodeStatus) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, status } }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const resetNodeStatuses = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, status: "idle" as NodeStatus },
      })),
    );
  }, [setNodes]);

  // -----------------------------------------------------------------------
  // WebSocket connection for pipeline progress
  // -----------------------------------------------------------------------

  const connectWs = useCallback(
    (id: string) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/pipelines/${id}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "stage_start") {
            updateNodeStatus(msg.stage, "running");
          } else if (msg.type === "stage_end") {
            const status: NodeStatus =
              msg.status === "complete"
                ? "complete"
                : msg.status === "skipped"
                  ? "skipped"
                  : "failed";
            updateNodeStatus(msg.stage, status);
          } else if (msg.type === "done") {
            setPhase(msg.status === "complete" ? "complete" : "failed");
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        setPhase("failed");
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
      };
    },
    [updateNodeStatus],
  );

  // Clean up WS on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Run pipeline
  // -----------------------------------------------------------------------

  const handleRun = useCallback(async () => {
    setValidationErrors([]);
    setLaunchError(null);

    // Validate -- cast nodes to the typed form for validation
    const typedNodes = nodes as Node<ToolNodeData>[];
    const result = validatePipeline(typedNodes, edges);
    if (!result.valid) {
      setValidationErrors(result.errors);
      return;
    }

    // Prepare API payload
    const apiNodes = nodes.map((n) => {
      const nd = getNodeData(n);
      // Build params: only include non-empty values
      const params: Record<string, string> = {};
      for (const [key, val] of Object.entries(nd.params)) {
        if (val.trim()) {
          params[key] = val.trim();
        }
      }
      return { id: n.id, tool: nd.tool, params };
    });

    const apiEdges = edges.map((e) => ({
      from: e.source,
      to: e.target,
    }));

    // Reset node statuses and set running state
    resetNodeStatuses();
    setPhase("running");

    try {
      const resp = await fetch("/api/pipelines/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: apiNodes, edges: apiEdges }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body.detail ?? `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      setPipelineId(data.pipeline_id);
      connectWs(data.pipeline_id);
    } catch (err) {
      setPhase("failed");
      setLaunchError(err instanceof Error ? err.message : String(err));
    }
  }, [nodes, edges, connectWs, resetNodeStatuses]);

  // -----------------------------------------------------------------------
  // Reset pipeline (back to editing)
  // -----------------------------------------------------------------------

  const handleReset = useCallback(() => {
    resetNodeStatuses();
    setPhase("editing");
    setPipelineId(null);
    setValidationErrors([]);
    setLaunchError(null);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [resetNodeStatuses]);

  // -----------------------------------------------------------------------
  // Clear canvas
  // -----------------------------------------------------------------------

  const handleClear = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setValidationErrors([]);
    setLaunchError(null);
  }, [setNodes, setEdges]);

  // -----------------------------------------------------------------------
  // Save / Load
  // -----------------------------------------------------------------------

  const handleSave = useCallback(
    (name: string) => {
      const pipeline: SavedPipeline = {
        id: generatePipelineId(),
        name,
        savedAt: new Date().toISOString(),
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type ?? "tool",
          position: n.position,
          data: getNodeData(n),
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        })),
      };
      savePipeline(pipeline);
    },
    [nodes, edges],
  );

  const handleLoad = useCallback(
    (pipeline: SavedPipeline) => {
      // Reset state
      handleReset();

      // Restore nodes with idle status
      const restored: Node[] = pipeline.nodes.map((n) => ({
        id: n.id,
        type: "tool",
        position: n.position,
        data: {
          ...n.data,
          status: "idle" as NodeStatus,
        },
      }));

      // Update the counter so new nodes don't clash
      const maxNum = pipeline.nodes.reduce((max, n) => {
        const m = n.id.match(/^node-(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      if (maxNum >= nodeCounter) {
        nodeCounter = maxNum;
      }

      // Restore edges
      const restoredEdges: Edge[] = pipeline.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: true,
        style: { stroke: "#6366f1", strokeWidth: 2 },
      }));

      setNodes(restored);
      setEdges(restoredEdges);
      setSelectedNodeId(null);
    },
    [setNodes, setEdges, handleReset],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex h-full">
      {/* Left sidebar: palette + param panel */}
      <div className="flex w-64 shrink-0 flex-col border-r border-surface-700 bg-surface-900">
        {/* Header */}
        <div className="border-b border-surface-700 px-4 py-3">
          <h1 className="text-lg font-semibold text-surface-100">
            Pipeline Builder
          </h1>
          <p className="mt-0.5 text-xs text-surface-400">
            Drag tools onto the canvas and connect them.
          </p>
        </div>

        {/* Tool palette */}
        <div className="border-b border-surface-700 px-4 py-3">
          <ToolPalette disabled={!isEditing} />
        </div>

        {/* Param panel for selected node */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {selectedNode ? (
            <ParamPanel
              nodeId={selectedNode.id}
              data={getNodeData(selectedNode)}
              onUpdate={handleParamUpdate}
              onDelete={handleDeleteNode}
              disabled={!isEditing}
              upstreamTools={upstreamTools}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-surface-500 text-center">
                Click a node to configure its parameters.
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="border-t border-surface-700 px-4 py-3 space-y-2">
          {isEditing && (
            <>
              <button
                onClick={handleRun}
                disabled={nodes.length === 0}
                className="w-full rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Run Pipeline
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setManagerOpen(true)}
                  className="flex-1 rounded-lg border border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-800"
                >
                  Save / Load
                </button>
                <button
                  onClick={handleClear}
                  disabled={nodes.length === 0}
                  className="flex-1 rounded-lg border border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>
            </>
          )}

          {(phase === "complete" || phase === "failed") && (
            <>
              {phase === "complete" && pipelineId && (
                <Link
                  to={`/pipelines/${pipelineId}/results`}
                  className="block w-full rounded-lg bg-accent-600 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-accent-500"
                >
                  View Results
                </Link>
              )}
              <button
                onClick={handleReset}
                className="w-full rounded-lg border border-surface-700 px-4 py-2 text-sm font-medium text-surface-300 transition-colors hover:bg-surface-800"
              >
                Back to Editor
              </button>
            </>
          )}

          {isRunning && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Spinner />
              <span className="text-sm text-surface-300">
                Pipeline running...
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main canvas area */}
      <div className="relative flex-1">
        {/* Validation / error messages */}
        {(validationErrors.length > 0 || launchError) && (
          <div className="absolute left-4 top-4 z-10 max-w-md rounded-lg border border-status-danger/30 bg-surface-900/95 p-3 shadow-lg backdrop-blur-sm">
            <div className="flex items-start gap-2">
              <ErrorIcon />
              <div className="space-y-1">
                {validationErrors.map((err, i) => (
                  <p key={i} className="text-xs text-status-danger">
                    {err}
                  </p>
                ))}
                {launchError && (
                  <p className="text-xs text-status-danger">
                    Launch error: {launchError}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setValidationErrors([]);
                  setLaunchError(null);
                }}
                className="shrink-0 rounded p-0.5 text-surface-500 hover:text-surface-300"
              >
                <DismissIcon />
              </button>
            </div>
          </div>
        )}

        {/* Pipeline status banner */}
        {phase === "complete" && (
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-status-success/30 bg-surface-900/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
            <SuccessIcon />
            <p className="text-sm font-medium text-status-success">
              Pipeline completed successfully.
            </p>
          </div>
        )}

        {phase === "failed" && !launchError && (
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-status-danger/30 bg-surface-900/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
            <ErrorIcon />
            <p className="text-sm font-medium text-status-danger">
              Pipeline failed. Check node statuses for details.
            </p>
          </div>
        )}

        {/* Pipeline ID indicator */}
        {pipelineId && phase !== "editing" && (
          <div className="absolute right-4 top-4 z-10 rounded-md bg-surface-900/90 px-3 py-1.5 text-xs text-surface-500 backdrop-blur-sm">
            Pipeline: {pipelineId.slice(0, 8)}...
          </div>
        )}

        {/* react-flow canvas */}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={isEditing ? onNodesChange : undefined}
          onEdgesChange={isEditing ? onEdgesChange : undefined}
          onConnect={isEditing ? onConnect : undefined}
          onInit={(instance) => {
            rfInstance.current = instance;
          }}
          onSelectionChange={onSelectionChange}
          onDrop={onDrop}
          onDragOver={onDragOver}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={isEditing ? ["Backspace", "Delete"] : []}
          className="bg-surface-950"
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: "#6366f1", strokeWidth: 2 },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#1e293b"
          />
          <Controls
            className="!bg-surface-900 !border-surface-700 !shadow-lg [&>button]:!bg-surface-800 [&>button]:!border-surface-700 [&>button]:!fill-surface-300 [&>button:hover]:!bg-surface-700"
          />
        </ReactFlow>

        {/* Empty state hint */}
        {nodes.length === 0 && isEditing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <CanvasIcon />
              <p className="mt-2 text-sm text-surface-500">
                Drag tools from the palette to get started.
              </p>
              <p className="mt-1 text-xs text-surface-600">
                Connect nodes to define the scan pipeline flow.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Pipeline manager modal */}
      <PipelineManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onSave={handleSave}
        onLoad={handleLoad}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icons
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-accent-400"
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

function ErrorIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 shrink-0 text-status-danger"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SuccessIcon() {
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

function DismissIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
    >
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

function CanvasIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="mx-auto h-12 w-12 text-surface-700"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h3M6 10.5v3M13.5 15.75h6.75" />
    </svg>
  );
}
