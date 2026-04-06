/**
 * Save / load pipeline manager.
 *
 * Provides a UI for saving the current pipeline to localStorage and loading
 * previously saved pipeline definitions.
 */

import { useCallback, useState } from "react";
import type { SavedPipeline } from "./types";
import { loadPipelines, deletePipeline } from "./storage";

interface PipelineManagerProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  onLoad: (pipeline: SavedPipeline) => void;
}

export default function PipelineManager({
  open,
  onClose,
  onSave,
  onLoad,
}: PipelineManagerProps) {
  const [tab, setTab] = useState<"save" | "load">("load");
  const [saveName, setSaveName] = useState("");
  const [pipelines, setPipelines] = useState<SavedPipeline[]>(() =>
    loadPipelines(),
  );

  const handleSave = useCallback(() => {
    const name = saveName.trim();
    if (!name) return;
    onSave(name);
    setSaveName("");
    // Refresh the list
    setPipelines(loadPipelines());
    setTab("load");
  }, [saveName, onSave]);

  const handleLoad = useCallback(
    (pipeline: SavedPipeline) => {
      onLoad(pipeline);
      onClose();
    },
    [onLoad, onClose],
  );

  const handleDelete = useCallback((id: string) => {
    deletePipeline(id);
    setPipelines(loadPipelines());
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-surface-100">
            Pipeline Manager
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700">
          <button
            onClick={() => {
              setTab("load");
              setPipelines(loadPipelines());
            }}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              tab === "load"
                ? "border-b-2 border-accent-500 text-accent-400"
                : "text-surface-400 hover:text-surface-200"
            }`}
          >
            Load
          </button>
          <button
            onClick={() => setTab("save")}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              tab === "save"
                ? "border-b-2 border-accent-500 text-accent-400"
                : "text-surface-400 hover:text-surface-200"
            }`}
          >
            Save As
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {tab === "save" && (
            <div className="space-y-3">
              <label
                htmlFor="pipeline-name"
                className="block text-xs font-medium text-surface-300"
              >
                Pipeline Name
              </label>
              <input
                id="pipeline-name"
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. Full Recon Pipeline"
                className="block w-full rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder:text-surface-500 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/40"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="w-full rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save Pipeline
              </button>
            </div>
          )}

          {tab === "load" && (
            <div className="space-y-2">
              {pipelines.length === 0 && (
                <p className="py-6 text-center text-sm text-surface-500">
                  No saved pipelines yet.
                </p>
              )}
              {pipelines.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-surface-200 truncate">
                      {p.name}
                    </p>
                    <p className="text-xs text-surface-500">
                      {p.nodes.length} node{p.nodes.length !== 1 ? "s" : ""} --{" "}
                      {new Date(p.savedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => handleLoad(p)}
                      className="rounded px-2.5 py-1 text-xs font-medium text-accent-400 hover:bg-accent-600/10 transition-colors"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="rounded px-2 py-1 text-xs text-surface-500 hover:bg-surface-700 hover:text-status-danger transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-5 w-5"
    >
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}
