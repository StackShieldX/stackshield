"""REST and WebSocket endpoints for pipeline orchestration."""

from __future__ import annotations

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


@router.get("/{pipeline_id}")
async def get_pipeline(pipeline_id: str) -> PipelineDetailResponse:
    """Return the current state of a pipeline including all stage details."""
    state = pipeline_runner.get_pipeline(pipeline_id)
    if state is None:
        raise HTTPException(
            status_code=404, detail=f"Pipeline {pipeline_id!r} not found"
        )

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
