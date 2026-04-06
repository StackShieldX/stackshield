/**
 * Pipeline results page.
 *
 * Fetches a completed pipeline's state from GET /api/pipelines/{id},
 * extracts result_json from each stage, and renders them using
 * CombinedResultsPanel. Shows a metadata header and visual flow summary.
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getPipeline, type PipelineDetail } from "../api/client";
import CombinedResultsPanel, {
  type ToolResult,
} from "../components/results/CombinedResultsPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "--";
  try {
    return new Date(value).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return value;
  }
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    complete: {
      bg: "bg-status-success/10",
      text: "text-status-success",
      label: "Complete",
    },
    failed: {
      bg: "bg-status-danger/10",
      text: "text-status-danger",
      label: "Failed",
    },
    running: {
      bg: "bg-accent-500/10",
      text: "text-accent-400",
      label: "Running",
    },
  };
  const style = map[status] ?? {
    bg: "bg-surface-700",
    text: "text-surface-300",
    label: status,
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

function toolDisplayName(tool: string): string {
  switch (tool) {
    case "dns":
      return "DNS Discovery";
    case "ports":
      return "Port Scan";
    case "certs":
      return "Certificate Analysis";
    default:
      return tool.charAt(0).toUpperCase() + tool.slice(1);
  }
}

function toolColor(tool: string): string {
  switch (tool) {
    case "dns":
      return "#3b82f6";
    case "ports":
      return "#22c55e";
    case "certs":
      return "#f59e0b";
    default:
      return "#6366f1";
  }
}

function stageStatusIcon(status: string) {
  switch (status) {
    case "complete":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-status-success"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "failed":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-status-danger"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "skipped":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-surface-500"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
            clipRule="evenodd"
          />
        </svg>
      );
    default:
      return (
        <div className="h-4 w-4 rounded-full border-2 border-surface-600" />
      );
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetadataHeader({ pipeline }: { pipeline: PipelineDetail }) {
  const stageCount = Object.keys(pipeline.stages).length;

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-surface-100">
              Pipeline Results
            </h1>
            {statusBadge(pipeline.status)}
          </div>
          <p className="mt-1 text-xs text-surface-500 font-mono">
            {pipeline.pipeline_id}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-6 text-sm">
        <div>
          <span className="text-surface-500">Started</span>
          <p className="text-surface-200">
            {formatTimestamp(pipeline.started_at)}
          </p>
        </div>
        <div>
          <span className="text-surface-500">Finished</span>
          <p className="text-surface-200">
            {formatTimestamp(pipeline.finished_at)}
          </p>
        </div>
        <div>
          <span className="text-surface-500">Stages</span>
          <p className="text-surface-200">{stageCount}</p>
        </div>
      </div>
      {pipeline.error && (
        <div className="mt-3 rounded border border-status-danger/30 bg-status-danger/5 px-3 py-2">
          <p className="text-xs text-status-danger">{pipeline.error}</p>
        </div>
      )}
    </div>
  );
}

function FlowSummary({ pipeline }: { pipeline: PipelineDetail }) {
  const stages = pipeline.execution_order.map(
    (nodeId) => pipeline.stages[nodeId],
  );

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900 p-4">
      <h2 className="text-sm font-semibold text-surface-300 mb-3">
        Pipeline Flow
      </h2>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {stages.map((stage, index) => (
          <div key={stage.node_id} className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800/60 px-3 py-2">
              {stageStatusIcon(stage.status)}
              <div>
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: toolColor(stage.tool) }}
                  />
                  <span className="text-xs font-medium text-surface-200">
                    {toolDisplayName(stage.tool)}
                  </span>
                </div>
                {stage.status === "failed" && stage.error && (
                  <p className="mt-0.5 text-[10px] text-status-danger max-w-[150px] truncate">
                    {stage.error}
                  </p>
                )}
              </div>
            </div>
            {index < stages.length - 1 && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 text-surface-600 shrink-0"
              >
                <path
                  fillRule="evenodd"
                  d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-40 rounded bg-surface-800" />
        <div className="h-28 rounded-lg bg-surface-800" />
        <div className="h-16 rounded-lg bg-surface-800" />
        <div className="mt-4 space-y-3">
          <div className="h-12 rounded-lg bg-surface-800" />
          <div className="h-32 rounded-lg bg-surface-800" />
          <div className="h-48 rounded-lg bg-surface-800" />
        </div>
      </div>
    </div>
  );
}

function NotFoundState({ pipelineId }: { pipelineId: string }) {
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
        <h2 className="text-lg font-semibold text-surface-100">
          Pipeline not found
        </h2>
        <p className="mt-2 text-sm text-surface-400">
          No pipeline exists for ID{" "}
          <code className="rounded bg-surface-800 px-1.5 py-0.5 font-mono text-xs text-surface-300">
            {pipelineId}
          </code>
        </p>
        <Link
          to="/pipelines"
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
          Back to Pipeline Builder
        </Link>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-md rounded-lg border border-status-danger/40 bg-status-danger/5 p-6 text-center mt-12">
        <h2 className="text-lg font-semibold text-status-danger">
          Error loading pipeline
        </h2>
        <p className="mt-2 text-sm text-surface-400">{message}</p>
        <Link
          to="/pipelines"
          className="mt-4 inline-flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors"
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
          Back to Pipeline Builder
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PipelineResults() {
  const { id } = useParams<{ id: string }>();
  const [pipeline, setPipeline] = useState<PipelineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setNotFound(false);
    setError(null);

    getPipeline(id)
      .then((data) => {
        setPipeline(data);
      })
      .catch((err: unknown) => {
        const status = (err as { status?: number }).status;
        if (status === 404) {
          setNotFound(true);
        } else {
          setError(
            err instanceof Error ? err.message : "Failed to load pipeline",
          );
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  if (loading) return <LoadingState />;
  if (notFound) return <NotFoundState pipelineId={id || ""} />;
  if (error) return <ErrorState message={error} />;
  if (!pipeline) return <ErrorState message="No data received" />;

  // Extract ToolResult array from completed stages in execution order
  const toolResults: ToolResult[] = pipeline.execution_order
    .map((nodeId) => pipeline.stages[nodeId])
    .filter((stage) => stage.status === "complete" && stage.result_json)
    .map((stage) => ({
      tool: stage.tool,
      data: stage.result_json as Record<string, unknown>,
      scanId: stage.node_id,
      scannedAt: stage.finished_at ?? undefined,
    }));

  return (
    <div className="p-6 space-y-6">
      {/* Back link */}
      <Link
        to="/pipelines"
        className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors"
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
        Back to Pipeline Builder
      </Link>

      {/* Metadata header */}
      <MetadataHeader pipeline={pipeline} />

      {/* Visual flow summary */}
      <FlowSummary pipeline={pipeline} />

      {/* Stage results via CombinedResultsPanel */}
      <div>
        <h2 className="text-sm font-semibold text-surface-300 mb-3">
          Stage Results
        </h2>
        <CombinedResultsPanel results={toolResults} />
      </div>
    </div>
  );
}
