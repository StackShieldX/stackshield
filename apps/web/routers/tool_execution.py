"""API endpoints for running CLI tools and streaming progress."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from apps.web.services.tool_runner import ScanStatus, runner

router = APIRouter(prefix="/api/runs", tags=["runs"])

# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class RunScanRequest(BaseModel):
    tool: str
    params: dict[str, str] = Field(default_factory=dict)


class RunScanResponse(BaseModel):
    scan_id: str
    status: str


class RunningScanEntry(BaseModel):
    scan_id: str
    tool: str
    params: dict[str, str]
    started_at: datetime


class RunningScanListResponse(BaseModel):
    running: list[RunningScanEntry]
    count: int


class ScanDetailResponse(BaseModel):
    scan_id: str
    tool: str
    params: dict[str, str]
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    result_json: dict | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------


@router.post("/run")
async def run_scan(body: RunScanRequest) -> RunScanResponse:
    """Launch a scan by spawning the corresponding CLI tool.

    Returns the generated scan_id and an initial status of 'running'.
    """
    try:
        state = await runner.start_scan(body.tool, body.params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    return RunScanResponse(scan_id=state.scan_id, status=state.status.value)


@router.get("/running")
async def list_running_scans() -> RunningScanListResponse:
    """Return all currently running scans."""
    scans = runner.running_scans()
    entries = [
        RunningScanEntry(
            scan_id=s.scan_id,
            tool=s.tool,
            params=s.params,
            started_at=s.started_at,
        )
        for s in scans
    ]
    return RunningScanListResponse(running=entries, count=len(entries))


@router.get("/{scan_id}")
async def get_scan_detail(scan_id: str) -> ScanDetailResponse:
    """Return the current state of a scan (running, complete, or failed)."""
    state = runner.get_scan(scan_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Scan {scan_id} not found")

    return ScanDetailResponse(
        scan_id=state.scan_id,
        tool=state.tool,
        params=state.params,
        status=state.status.value,
        started_at=state.started_at,
        finished_at=state.finished_at,
        result_json=state.result_json,
        error=state.error,
    )


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@router.websocket("/{scan_id}/ws")
async def scan_ws(websocket: WebSocket, scan_id: str) -> None:
    """Stream stderr lines from a running scan in real time.

    The connection stays open until the subprocess finishes (signalled by
    a None sentinel on the queue).  If the scan_id does not exist, the
    WebSocket is closed with code 4004.
    """
    state = runner.get_scan(scan_id)
    if state is None:
        await websocket.close(code=4004, reason="Scan not found")
        return

    await websocket.accept()
    queue = runner.subscribe_stderr(scan_id)

    try:
        while True:
            line = await queue.get()
            if line is None:
                # Stream finished -- send final status and close
                final_state = runner.get_scan(scan_id)
                status = final_state.status.value if final_state else "unknown"
                await websocket.send_json({"type": "done", "status": status})
                break
            await websocket.send_json({"type": "stderr", "line": line})
    except WebSocketDisconnect:
        pass
    finally:
        runner.unsubscribe_stderr(scan_id, queue)
