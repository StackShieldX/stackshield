/**
 * localStorage persistence for pipeline definitions.
 */

import type { SavedPipeline } from "./types";

const STORAGE_KEY = "stackshield:pipelines";

/**
 * Load all saved pipelines from localStorage.
 */
export function loadPipelines(): SavedPipeline[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedPipeline[];
  } catch {
    return [];
  }
}

/**
 * Save a pipeline definition. If a pipeline with the same id exists,
 * it is replaced; otherwise a new entry is appended.
 */
export function savePipeline(pipeline: SavedPipeline): void {
  const existing = loadPipelines();
  const idx = existing.findIndex((p) => p.id === pipeline.id);
  if (idx >= 0) {
    existing[idx] = pipeline;
  } else {
    existing.push(pipeline);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

/**
 * Delete a pipeline by id.
 */
export function deletePipeline(id: string): void {
  const existing = loadPipelines();
  const filtered = existing.filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}
