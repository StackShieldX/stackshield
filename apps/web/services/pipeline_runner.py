"""Pipeline execution service -- orchestrates multi-stage scan pipelines.

Takes a pipeline definition (nodes + edges), computes topological execution
order, runs each stage sequentially, and passes stdout JSON between connected
stages.  Reuses the same subprocess/tool-execution patterns as tool_runner.py.
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from apps.web.services.tool_runner import TOOL_REGISTRY, ScanResultWrapper

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class PipelineStatus(str, Enum):
    running = "running"
    complete = "complete"
    failed = "failed"


class StageStatus(str, Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    failed = "failed"
    skipped = "skipped"


class PipelineNode(BaseModel):
    """A single tool invocation in the pipeline graph."""

    id: str
    tool: str
    params: dict[str, str] = Field(default_factory=dict)


class PipelineEdge(BaseModel):
    """Directed edge: output of ``source`` feeds into ``target``."""

    source: str = Field(alias="from")
    target: str = Field(alias="to")

    model_config = {"populate_by_name": True}


class PipelineDefinition(BaseModel):
    """The request body for POST /api/pipelines/run."""

    nodes: list[PipelineNode]
    edges: list[PipelineEdge] = Field(default_factory=list)


class StageState(BaseModel):
    """Tracks progress for one stage within a pipeline."""

    node_id: str
    tool: str
    params: dict[str, str]
    status: StageStatus = StageStatus.pending
    started_at: datetime | None = None
    finished_at: datetime | None = None
    result_json: dict | None = None
    error: str | None = None
    stderr_lines: list[str] = Field(default_factory=list)


class PipelineState(BaseModel):
    """In-memory state for a running or finished pipeline."""

    pipeline_id: str
    status: PipelineStatus = PipelineStatus.running
    stages: dict[str, StageState] = Field(default_factory=dict)
    execution_order: list[str] = Field(default_factory=list)
    started_at: datetime
    finished_at: datetime | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Topological sort
# ---------------------------------------------------------------------------


def topological_sort(
    nodes: list[PipelineNode],
    edges: list[PipelineEdge],
) -> list[str]:
    """Return node IDs in topological order (Kahn's algorithm).

    Raises ValueError if the graph contains a cycle or references unknown nodes.
    """
    node_ids = {n.id for n in nodes}

    # Validate edges reference known nodes
    for edge in edges:
        if edge.source not in node_ids:
            raise ValueError(f"Edge references unknown source node: {edge.source!r}")
        if edge.target not in node_ids:
            raise ValueError(f"Edge references unknown target node: {edge.target!r}")

    in_degree: dict[str, int] = {nid: 0 for nid in node_ids}
    successors: dict[str, list[str]] = defaultdict(list)

    for edge in edges:
        in_degree[edge.target] += 1
        successors[edge.source].append(edge.target)

    queue: deque[str] = deque()
    for nid in node_ids:
        if in_degree[nid] == 0:
            queue.append(nid)

    # Sort the initial queue for deterministic ordering
    queue = deque(sorted(queue))

    result: list[str] = []
    while queue:
        nid = queue.popleft()
        result.append(nid)
        for succ in sorted(successors[nid]):
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    if len(result) != len(node_ids):
        raise ValueError("Pipeline graph contains a cycle")

    return result


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class PipelineRunner:
    """Manages pipeline execution with per-stage progress streaming."""

    def __init__(self) -> None:
        self._pipelines: dict[str, PipelineState] = {}
        self._ws_subscribers: dict[str, list[asyncio.Queue[dict | None]]] = {}

    # -- public API --------------------------------------------------------

    def get_pipeline(self, pipeline_id: str) -> PipelineState | None:
        """Look up a pipeline by ID."""
        return self._pipelines.get(pipeline_id)

    async def start_pipeline(self, definition: PipelineDefinition) -> PipelineState:
        """Validate the pipeline definition and start execution.

        Returns the initial state immediately; execution proceeds in the
        background.

        Raises ValueError for invalid definitions (unknown tools, cycles, etc.).
        """
        # Validate all tools exist
        for node in definition.nodes:
            if node.tool not in TOOL_REGISTRY:
                raise ValueError(
                    f"Unknown tool {node.tool!r} in node {node.id!r}. "
                    f"Available: {', '.join(TOOL_REGISTRY)}"
                )

        # Compute execution order
        order = topological_sort(definition.nodes, definition.edges)

        # Build node lookup
        node_map = {n.id: n for n in definition.nodes}

        # Build predecessor map (which nodes feed into a given node)
        predecessors: dict[str, list[str]] = defaultdict(list)
        for edge in definition.edges:
            predecessors[edge.target].append(edge.source)

        pipeline_id = str(uuid.uuid4())
        state = PipelineState(
            pipeline_id=pipeline_id,
            started_at=datetime.now(timezone.utc),
            execution_order=order,
        )

        # Initialize stage states
        for node in definition.nodes:
            state.stages[node.id] = StageState(
                node_id=node.id,
                tool=node.tool,
                params=dict(node.params),
            )

        self._pipelines[pipeline_id] = state

        # Launch background execution
        asyncio.create_task(self._execute(pipeline_id, node_map, predecessors, order))

        return state

    def subscribe(self, pipeline_id: str) -> asyncio.Queue[dict | None]:
        """Subscribe to pipeline progress events.

        Returns a queue that receives dicts with event data. None signals
        the stream has ended. Historical events are replayed on subscribe.
        """
        queue: asyncio.Queue[dict | None] = asyncio.Queue()
        self._ws_subscribers.setdefault(pipeline_id, []).append(queue)

        # Replay completed stage info
        state = self._pipelines.get(pipeline_id)
        if state is not None:
            for node_id in state.execution_order:
                stage = state.stages[node_id]
                if stage.status in (
                    StageStatus.complete,
                    StageStatus.failed,
                    StageStatus.skipped,
                ):
                    # Replay stage start
                    queue.put_nowait(
                        {
                            "type": "stage_start",
                            "stage": node_id,
                            "tool": stage.tool,
                        }
                    )
                    # Replay stderr lines
                    for line in stage.stderr_lines:
                        queue.put_nowait(
                            {
                                "type": "stderr",
                                "stage": node_id,
                                "line": line,
                            }
                        )
                    # Replay stage end
                    queue.put_nowait(
                        {
                            "type": "stage_end",
                            "stage": node_id,
                            "status": stage.status.value,
                            "error": stage.error,
                        }
                    )
                elif stage.status == StageStatus.running:
                    queue.put_nowait(
                        {
                            "type": "stage_start",
                            "stage": node_id,
                            "tool": stage.tool,
                        }
                    )
                    for line in stage.stderr_lines:
                        queue.put_nowait(
                            {
                                "type": "stderr",
                                "stage": node_id,
                                "line": line,
                            }
                        )

            # If pipeline already done, signal immediately
            if state.status != PipelineStatus.running:
                queue.put_nowait(
                    {
                        "type": "done",
                        "status": state.status.value,
                        "error": state.error,
                    }
                )
                queue.put_nowait(None)

        return queue

    def unsubscribe(
        self,
        pipeline_id: str,
        queue: asyncio.Queue[dict | None],
    ) -> None:
        """Remove a subscriber queue."""
        subs = self._ws_subscribers.get(pipeline_id, [])
        try:
            subs.remove(queue)
        except ValueError:
            pass

    # -- internals ---------------------------------------------------------

    async def _execute(
        self,
        pipeline_id: str,
        node_map: dict[str, PipelineNode],
        predecessors: dict[str, list[str]],
        order: list[str],
    ) -> None:
        """Run each stage in topological order, passing results forward."""
        state = self._pipelines[pipeline_id]

        # Collect results per node for data passing
        results: dict[str, dict] = {}

        for node_id in order:
            node = node_map[node_id]
            stage = state.stages[node_id]

            # Merge params: start with node params, then inject predecessor
            # output as stdin data
            merged_params = dict(node.params)
            stdin_data: str | None = None

            # If this node has predecessors, collect their results as input
            pred_ids = predecessors.get(node_id, [])
            if pred_ids:
                # Combine all predecessor results into a single JSON blob
                # that gets piped as stdin
                if len(pred_ids) == 1:
                    pred_result = results.get(pred_ids[0])
                    if pred_result is not None:
                        stdin_data = json.dumps(pred_result)
                else:
                    # Multiple predecessors: merge into a dict keyed by node id
                    combined: dict[str, Any] = {}
                    for pid in pred_ids:
                        pred_result = results.get(pid)
                        if pred_result is not None:
                            combined[pid] = pred_result
                    if combined:
                        stdin_data = json.dumps(combined)

            # Mark stage as running
            stage.status = StageStatus.running
            stage.started_at = datetime.now(timezone.utc)
            self._broadcast(
                pipeline_id,
                {
                    "type": "stage_start",
                    "stage": node_id,
                    "tool": node.tool,
                },
            )

            try:
                result = await self._run_stage(
                    pipeline_id, stage, node.tool, merged_params, stdin_data
                )
                results[node_id] = result
            except Exception as exc:
                # Stage failed -- mark pipeline as failed and stop
                stage.status = StageStatus.failed
                stage.finished_at = datetime.now(timezone.utc)
                stage.error = str(exc)

                self._broadcast(
                    pipeline_id,
                    {
                        "type": "stage_end",
                        "stage": node_id,
                        "status": "failed",
                        "error": str(exc),
                    },
                )

                # Mark remaining stages as skipped
                current_idx = order.index(node_id)
                for remaining_id in order[current_idx + 1 :]:
                    state.stages[remaining_id].status = StageStatus.skipped

                state.status = PipelineStatus.failed
                state.finished_at = datetime.now(timezone.utc)
                state.error = f"Stage {node_id!r} ({node.tool}) failed: {exc}"

                self._broadcast(
                    pipeline_id,
                    {
                        "type": "done",
                        "status": "failed",
                        "error": state.error,
                    },
                )
                self._broadcast_done(pipeline_id)
                return

        # All stages complete
        state.status = PipelineStatus.complete
        state.finished_at = datetime.now(timezone.utc)

        # Persist each stage result to ScanStore
        self._persist_results(state)

        self._broadcast(
            pipeline_id,
            {
                "type": "done",
                "status": "complete",
                "error": None,
            },
        )
        self._broadcast_done(pipeline_id)

    async def _run_stage(
        self,
        pipeline_id: str,
        stage: StageState,
        tool: str,
        params: dict[str, str],
        stdin_data: str | None,
    ) -> dict:
        """Execute a single tool as a subprocess and return parsed JSON result.

        Raises RuntimeError on non-zero exit or JSON parse failure.
        """
        entry = TOOL_REGISTRY[tool]
        script = entry["script"]

        try:
            cli_args = entry["args_fn"](params)
        except KeyError as exc:
            raise RuntimeError(f"Missing required parameter for {tool}: {exc}") from exc

        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            script,
            *cli_args,
            "--no-save",
            stdin=asyncio.subprocess.PIPE if stdin_data else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Feed stdin if we have predecessor data
        if stdin_data and proc.stdin:
            proc.stdin.write(stdin_data.encode())
            await proc.stdin.drain()
            proc.stdin.close()

        # Stream stderr line-by-line
        assert proc.stderr is not None
        while True:
            line_bytes = await proc.stderr.readline()
            if not line_bytes:
                break
            line = line_bytes.decode(errors="replace").rstrip("\n")
            stage.stderr_lines.append(line)
            self._broadcast(
                pipeline_id,
                {
                    "type": "stderr",
                    "stage": stage.node_id,
                    "line": line,
                },
            )

        # Wait for process to finish and capture stdout
        stdout_bytes, _ = await proc.communicate()
        stdout_text = (
            stdout_bytes.decode(errors="replace").strip() if stdout_bytes else ""
        )

        if proc.returncode != 0:
            raise RuntimeError(f"Process exited with code {proc.returncode}")

        try:
            result_data = json.loads(stdout_text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Failed to parse stdout as JSON: {exc}") from exc

        stage.result_json = result_data
        stage.status = StageStatus.complete
        stage.finished_at = datetime.now(timezone.utc)

        self._broadcast(
            pipeline_id,
            {
                "type": "stage_end",
                "stage": stage.node_id,
                "status": "complete",
                "error": None,
            },
        )

        return result_data

    def _persist_results(self, state: PipelineState) -> None:
        """Save each completed stage's result to the ScanStore."""
        try:
            from lib.common.db import get_store

            store = get_store()
            if store is None:
                return

            with store:
                for node_id in state.execution_order:
                    stage = state.stages[node_id]
                    if (
                        stage.status != StageStatus.complete
                        or stage.result_json is None
                    ):
                        continue

                    entry = TOOL_REGISTRY.get(stage.tool, {})
                    domain_key = entry.get("domain_key")
                    domain = stage.params.get(domain_key) if domain_key else None

                    targets: list[str] | None = None
                    if stage.tool == "ports" and "targets" in stage.params:
                        targets = [
                            t.strip()
                            for t in stage.params["targets"].split(",")
                            if t.strip()
                        ]

                    wrapper = ScanResultWrapper(stage.result_json)
                    saved_id = store.save_scan(
                        tool=stage.tool,
                        result=wrapper,
                        domain=domain,
                        targets=targets,
                        started_at=stage.started_at,
                    )
                    print(
                        f"[pipeline_runner] saved stage {node_id} as scan {saved_id}",
                        file=sys.stderr,
                    )
        except Exception as exc:
            print(
                f"[pipeline_runner] failed to persist pipeline {state.pipeline_id}: {exc}",
                file=sys.stderr,
            )

    def _broadcast(self, pipeline_id: str, event: dict) -> None:
        """Push an event to all subscribers for a pipeline."""
        for queue in self._ws_subscribers.get(pipeline_id, []):
            queue.put_nowait(event)

    def _broadcast_done(self, pipeline_id: str) -> None:
        """Signal end-of-stream to all subscribers."""
        for queue in self._ws_subscribers.get(pipeline_id, []):
            queue.put_nowait(None)


# Module-level singleton
pipeline_runner = PipelineRunner()
