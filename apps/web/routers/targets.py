"""REST endpoints for target listing and aggregation by domain."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.common.db import get_store
from lib.common.db.base import ScanStore

router = APIRouter(prefix="/api/targets", tags=["targets"])


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
def list_targets(
    q: str | None = Query(default=None, description="Substring search on domain name"),
    store: ScanStore = Depends(_get_store),
) -> list[dict]:
    """Return aggregated target info for all scanned domains.

    Each entry contains domain, scan_count, tools, and last_scanned_at.
    Returns 200 with an empty array when no targets match.
    """
    return store.list_targets(q=q)


@router.get("/{domain}/scans")
def list_scans_for_domain(
    domain: str,
    tool: str | None = Query(default=None, description="Filter by tool type"),
    store: ScanStore = Depends(_get_store),
) -> list[dict]:
    """Return all scans for a specific domain, ordered by started_at descending.

    Each entry includes the full result_json.
    Returns 200 with an empty array when no scans match.
    """
    return store.load_scans_by_domain(domain=domain, tool=tool)
