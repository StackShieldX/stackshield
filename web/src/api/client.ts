/**
 * Reusable API client for the StackShield backend.
 *
 * All fetch calls go through this module so that base URL configuration,
 * error handling, and response typing live in one place.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scan metadata returned by GET /api/scans (no result_json). */
export interface ScanMeta {
  id: string;
  tool: string;
  domain: string | null;
  targets: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
}

/** A single entry in the running-scans list. */
export interface RunningScanEntry {
  scan_id: string;
  tool: string;
  params: Record<string, string>;
  started_at: string;
}

/** Response from GET /api/runs/running. */
export interface RunningScanList {
  running: RunningScanEntry[];
  count: number;
}

/** Full scan detail returned by GET /api/runs/:id. */
export interface ScanDetail {
  scan_id: string;
  tool: string;
  params: Record<string, string>;
  status: string;
  started_at: string;
  finished_at: string | null;
  result_json: Record<string, unknown> | null;
  error: string | null;
}

/** Response from POST /api/runs/run. */
export interface RunScanResponse {
  scan_id: string;
  status: string;
}

/** Health check response. */
export interface HealthResponse {
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Base URL for API requests. In dev, Vite proxies /api to the backend. */
const BASE = "";

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`API ${status}: ${detail}`);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      // Ignore JSON parse failures on error responses
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Scan endpoints (persisted scans via ScanStore)
// ---------------------------------------------------------------------------

/** List scan metadata with optional filters. */
export function listScans(opts?: {
  tool?: string;
  domain?: string;
  limit?: number;
}): Promise<ScanMeta[]> {
  const params = new URLSearchParams();
  if (opts?.tool) params.set("tool", opts.tool);
  if (opts?.domain) params.set("domain", opts.domain);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<ScanMeta[]>(`/api/scans${qs ? `?${qs}` : ""}`);
}

/** Fetch full scan result by ID. */
export function getScan(scanId: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/api/scans/${encodeURIComponent(scanId)}`);
}

/** Delete a scan by ID. */
export async function deleteScan(scanId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/scans/${encodeURIComponent(scanId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new ApiError(res.status, res.statusText);
  }
}

// ---------------------------------------------------------------------------
// Tool execution endpoints (in-memory running scans)
// ---------------------------------------------------------------------------

/** Start a new scan. */
export function runScan(
  tool: string,
  params: Record<string, string>,
): Promise<RunScanResponse> {
  return request<RunScanResponse>("/api/runs/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, params }),
  });
}

/** List currently running scans. */
export function listRunningScans(): Promise<RunningScanList> {
  return request<RunningScanList>("/api/runs/running");
}

/** Get detail for a specific run by ID. */
export function getRunDetail(scanId: string): Promise<ScanDetail> {
  return request<ScanDetail>(`/api/runs/${encodeURIComponent(scanId)}`);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Health check. */
export function healthCheck(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health");
}
