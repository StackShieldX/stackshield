"""REST and WebSocket endpoints for pipeline orchestration."""

from __future__ import annotations

import sys
from datetime import datetime

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from apps.web.services.pipeline_runner import (
    PipelineDefinition,
    pipeline_runner,
)

router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])

# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class PipelineRunResponse(BaseModel):
    pipeline_id: str
    status: str


class StageDetail(BaseModel):
    node_id: str
    tool: str
    params: dict[str, str]
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    result_json: dict | None = None
    error: str | None = None


class PipelineDetailResponse(BaseModel):
    pipeline_id: str
    status: str
    execution_order: list[str]
    stages: dict[str, StageDetail]
    started_at: datetime
    finished_at: datetime | None = None
    error: str | None = None


class PipelineListItem(BaseModel):
    pipeline_id: str
    status: str
    started_at: str
    finished_at: str | None = None
    error: str | None = None
    tools: list[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_pipeline_from_db(pipeline_id: str) -> PipelineDetailResponse | None:
    """Attempt to load a pipeline from the database.

    Returns a PipelineDetailResponse on success or None if not found or
    if the store is unavailable.
    """
    try:
        from lib.common.db import get_store

        store = get_store()
        if store is None:
            return None

        with store:
            run = store.load_pipeline_run(pipeline_id)
            if run is None:
                return None

            # Reconstruct stages and execution_order from DB records
            db_stages = run.get("stages", [])
            execution_order: list[str] = []
            stages: dict[str, StageDetail] = {}

            for db_stage in db_stages:
                node_id = db_stage["node_id"]
                execution_order.append(node_id)

                # Load scan result if a scan_id is linked
                result_json: dict | None = None
                if db_stage.get("scan_id"):
                    result_json = store.load_scan_by_id(db_stage["scan_id"])

                stage_status = db_stage.get("status", "complete")

                stages[node_id] = StageDetail(
                    node_id=node_id,
                    tool=db_stage["tool"],
                    params={},
                    status=stage_status,
                    result_json=result_json,
                )

            return PipelineDetailResponse(
                pipeline_id=run["pipeline_id"],
                status=run["status"],
                execution_order=execution_order,
                stages=stages,
                started_at=run["started_at"],
                finished_at=run.get("finished_at"),
                error=run.get("error"),
            )
    except Exception as exc:
        print(
            f"[pipelines] failed to load pipeline {pipeline_id} from DB: {exc}",
            file=sys.stderr,
        )
        return None


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------


@router.post("/run")
async def run_pipeline(body: PipelineDefinition) -> PipelineRunResponse:
    """Launch a multi-stage pipeline.

    Accepts a pipeline definition with nodes (tool invocations) and edges
    (data flow connections).  Returns immediately with a pipeline_id and
    status of 'running'.
    """
    try:
        state = await pipeline_runner.start_pipeline(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return PipelineRunResponse(
        pipeline_id=state.pipeline_id,
        status=state.status.value,
    )


@router.get("/", response_model=list[PipelineListItem])
async def list_pipelines(limit: int = 50) -> list[PipelineListItem]:
    """List past pipeline runs with metadata.

    Combines in-memory pipelines with historical runs from the database.
    In-memory entries take precedence for pipelines that exist in both.
    """
    seen: set[str] = set()
    items: list[PipelineListItem] = []

    # Gather in-memory pipelines first (most recent / running)
    for pid, state in pipeline_runner._pipelines.items():
        tools = list({s.tool for s in state.stages.values()})
        items.append(
            PipelineListItem(
                pipeline_id=pid,
                status=state.status.value,
                started_at=state.started_at.isoformat(),
                finished_at=(
                    state.finished_at.isoformat() if state.finished_at else None
                ),
                error=state.error,
                tools=sorted(tools),
            )
        )
        seen.add(pid)

    # Add historical runs from database
    try:
        from lib.common.db import get_store

        store = get_store()
        if store is not None:
            with store:
                db_runs = store.list_pipeline_runs(limit=limit)
                for run in db_runs:
                    if run["pipeline_id"] in seen:
                        continue
                    items.append(
                        PipelineListItem(
                            pipeline_id=run["pipeline_id"],
                            status=run["status"],
                            started_at=run["started_at"],
                            finished_at=run.get("finished_at"),
                            error=run.get("error"),
                            tools=run.get("tools", []),
                        )
                    )
    except Exception as exc:
        print(
            f"[pipelines] failed to load pipeline history from DB: {exc}",
            file=sys.stderr,
        )

    # Sort by started_at descending
    items.sort(key=lambda x: x.started_at, reverse=True)
    return items[:limit]


@router.get("/{pipeline_id}")
async def get_pipeline(pipeline_id: str) -> PipelineDetailResponse:
    """Return the current state of a pipeline including all stage details.

    Falls back to loading from the database when the pipeline is no longer
    in memory (e.g. after a server restart).
    """
    state = pipeline_runner.get_pipeline(pipeline_id)

    if state is not None:
        # In-memory pipeline found
        stages = {}
        for node_id, stage in state.stages.items():
            stages[node_id] = StageDetail(
                node_id=stage.node_id,
                tool=stage.tool,
                params=stage.params,
                status=stage.status.value,
                started_at=stage.started_at,
                finished_at=stage.finished_at,
                result_json=stage.result_json,
                error=stage.error,
            )

        return PipelineDetailResponse(
            pipeline_id=state.pipeline_id,
            status=state.status.value,
            execution_order=state.execution_order,
            stages=stages,
            started_at=state.started_at,
            finished_at=state.finished_at,
            error=state.error,
        )

    # Fall back to database
    db_result = _load_pipeline_from_db(pipeline_id)
    if db_result is not None:
        return db_result

    raise HTTPException(
        status_code=404, detail=f"Pipeline {pipeline_id!r} not found"
    )


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@router.websocket("/{pipeline_id}/ws")
async def pipeline_ws(websocket: WebSocket, pipeline_id: str) -> None:
    """Stream per-stage progress events from a running pipeline.

    Events are JSON objects with a ``type`` field:
      - stage_start: {type, stage, tool}
      - stderr:      {type, stage, line}
      - stage_end:   {type, stage, status, error}
      - done:        {type, status, error}

    The connection closes after the ``done`` event.  If the pipeline_id
    does not exist the WebSocket is closed with code 4004.
    """
    state = pipeline_runner.get_pipeline(pipeline_id)
    if state is None:
        await websocket.close(code=4004, reason="Pipeline not found")
        return

    await websocket.accept()
    queue = pipeline_runner.subscribe(pipeline_id)

    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        pipeline_runner.unsubscribe(pipeline_id, queue)
