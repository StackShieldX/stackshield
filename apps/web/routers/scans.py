"""REST endpoints for scan CRUD operations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from lib.common.db import get_store
from lib.common.db.base import ScanStore

router = APIRouter(prefix="/api/scans", tags=["scans"])


def _get_store() -> ScanStore:
    """FastAPI dependency that provides a ScanStore instance.

    Raises 503 if persistence is disabled in config.
    """
    store = get_store()
    if store is None:
        raise HTTPException(
            status_code=503,
            detail="Scan store is disabled. Enable it in config.toml.",
        )
    return store


@router.get("")
def list_scans(
    tool: str | None = Query(default=None, description="Filter by tool name"),
    domain: str | None = Query(default=None, description="Filter by domain"),
    limit: int = Query(default=20, ge=1, le=1000, description="Max results"),
    store: ScanStore = Depends(_get_store),
) -> list[dict]:
    """Return a JSON array of scan metadata."""
    return store.list_scans(tool=tool, domain=domain, limit=limit)


@router.get("/latest")
def get_latest_scan(
    tool: str = Query(description="Tool name to look up"),
    domain: str | None = Query(default=None, description="Optional domain filter"),
    store: ScanStore = Depends(_get_store),
) -> dict:
    """Return the most recent scan for a given tool."""
    result = store.load_latest_scan(tool=tool, domain=domain)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No scan found for tool={tool!r}"
            + (f", domain={domain!r}" if domain else ""),
        )
    return result


@router.get("/{scan_id}")
def get_scan(
    scan_id: str,
    store: ScanStore = Depends(_get_store),
) -> dict:
    """Return the full scan result JSON for a given scan ID."""
    result = store.load_scan_by_id(scan_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Scan {scan_id!r} not found")
    return result


@router.delete("/{scan_id}", status_code=204)
def delete_scan(
    scan_id: str,
    store: ScanStore = Depends(_get_store),
) -> Response:
    """Delete a scan by ID. Returns 204 on success, 404 if not found."""
    deleted = store.delete_scan(scan_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Scan {scan_id!r} not found")
    return Response(status_code=204)
