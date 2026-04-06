"""Tool execution service -- spawns CLI tools as subprocesses and tracks them."""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, RootModel

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_CONCURRENT_SCANS = 3

# Map tool names to their CLI entry-point scripts and the argument style
# each tool expects.  Each value is a dict with:
#   script  -- path to the Python file (relative to project root)
#   args_fn -- callable(params) -> list[str] that builds CLI arguments
TOOL_REGISTRY: dict[str, dict[str, Any]] = {
    "dns": {
        "script": "apps/dns_discovery/dns.py",
        "args_fn": lambda p: ["-d", p["domain"]],
        "domain_key": "domain",
    },
    # TODO: Allow the port scanner to read targets from stdin (piped DNS
    # results) so that when chained after DNS in a pipeline the "targets"
    # param becomes optional -- matching how the certs tool already infers
    # TLS targets from upstream scan data via --stdin.
    "ports": {
        "script": "apps/port_scan/port.py",
        "args_fn": lambda p: [
            "-t",
            p["targets"],
            *(["--ports", p["ports"]] if p.get("ports") else []),
            *(["--scan-type", p["scan_type"]] if p.get("scan_type") else []),
        ],
        "domain_key": None,
    },
    "certs": {
        "script": "apps/certs/certs.py",
        "args_fn": lambda p: [
            "-d",
            p["domain"],
            *(["--mode", p["mode"]] if p.get("mode") else []),
            *(["--ports", p["ports"]] if p.get("ports") else []),
        ],
        "domain_key": "domain",
    },
}

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ScanStatus(str, Enum):
    running = "running"
    complete = "complete"
    failed = "failed"


class ScanState(BaseModel):
    """In-memory state for a running or recently finished scan."""

    scan_id: str
    tool: str
    params: dict[str, str]
    status: ScanStatus = ScanStatus.running
    started_at: datetime
    finished_at: datetime | None = None
    result_json: dict | None = None
    error: str | None = None
    stderr_lines: list[str] = Field(default_factory=list)


class ScanResultWrapper(RootModel[dict]):
    """Thin wrapper so raw JSON dicts can be passed to ScanStore.save_scan.

    Uses RootModel so model_dump_json() serializes as the dict itself,
    not as {"data": {...}}.
    """


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ToolRunner:
    """Manages subprocess-based tool execution with concurrency limits."""

    def __init__(self) -> None:
        self._scans: dict[str, ScanState] = {}
        self._ws_subscribers: dict[str, list[asyncio.Queue[str | None]]] = {}
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_SCANS)

    # -- public API --------------------------------------------------------

    def available_tools(self) -> list[str]:
        """Return the list of registered tool names."""
        return list(TOOL_REGISTRY.keys())

    def running_scans(self) -> list[ScanState]:
        """Return all scans that are currently running."""
        return [s for s in self._scans.values() if s.status == ScanStatus.running]

    def get_scan(self, scan_id: str) -> ScanState | None:
        """Look up a scan by ID."""
        return self._scans.get(scan_id)

    @property
    def active_count(self) -> int:
        return sum(1 for s in self._scans.values() if s.status == ScanStatus.running)

    async def start_scan(self, tool: str, params: dict[str, str]) -> ScanState:
        """Validate and launch a scan, returning the initial state.

        Raises ValueError if the tool is unknown or required params are missing.
        Raises RuntimeError if the concurrent scan limit has been reached.
        """
        if tool not in TOOL_REGISTRY:
            raise ValueError(
                f"Unknown tool: {tool!r}. Available: {', '.join(TOOL_REGISTRY)}"
            )

        if self.active_count >= MAX_CONCURRENT_SCANS:
            raise RuntimeError(
                f"Concurrent scan limit reached ({MAX_CONCURRENT_SCANS}). "
                "Wait for a running scan to finish."
            )

        # Validate required params early so we fail before spawning
        entry = TOOL_REGISTRY[tool]
        try:
            cli_args = entry["args_fn"](params)
        except KeyError as exc:
            raise ValueError(f"Missing required parameter for {tool}: {exc}") from exc

        scan_id = str(uuid.uuid4())
        state = ScanState(
            scan_id=scan_id,
            tool=tool,
            params=params,
            started_at=datetime.now(timezone.utc),
        )
        self._scans[scan_id] = state

        # Launch the subprocess in a background task
        asyncio.create_task(self._run(scan_id, entry["script"], cli_args))

        return state

    def subscribe_stderr(self, scan_id: str) -> asyncio.Queue[str | None]:
        """Create a queue that receives stderr lines for the given scan.

        Returns a queue. The caller reads from it; None signals the stream
        has ended.  Historical lines already captured are replayed first.
        """
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._ws_subscribers.setdefault(scan_id, []).append(queue)

        # Replay lines already buffered
        state = self._scans.get(scan_id)
        if state is not None:
            for line in state.stderr_lines:
                queue.put_nowait(line)
            # If the scan already finished, signal completion immediately
            if state.status != ScanStatus.running:
                queue.put_nowait(None)

        return queue

    def unsubscribe_stderr(
        self, scan_id: str, queue: asyncio.Queue[str | None]
    ) -> None:
        """Remove a subscriber queue."""
        subs = self._ws_subscribers.get(scan_id, [])
        try:
            subs.remove(queue)
        except ValueError:
            pass

    # -- internals ---------------------------------------------------------

    async def _run(self, scan_id: str, script: str, cli_args: list[str]) -> None:
        """Acquire the semaphore, spawn the process, and collect output."""
        state = self._scans[scan_id]

        async with self._semaphore:
            try:
                proc = await asyncio.create_subprocess_exec(
                    sys.executable,
                    script,
                    *cli_args,
                    "--no-save",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                # Stream stderr line-by-line
                assert proc.stderr is not None  # guaranteed by PIPE
                while True:
                    line_bytes = await proc.stderr.readline()
                    if not line_bytes:
                        break
                    line = line_bytes.decode(errors="replace").rstrip("\n")
                    state.stderr_lines.append(line)
                    self._broadcast(scan_id, line)

                # Wait for the process to finish and capture stdout
                stdout_bytes, _ = await proc.communicate()
                stdout_text = (
                    stdout_bytes.decode(errors="replace").strip()
                    if stdout_bytes
                    else ""
                )

                if proc.returncode == 0:
                    await self._handle_success(state, stdout_text)
                else:
                    self._handle_failure(
                        state,
                        f"Process exited with code {proc.returncode}",
                    )

            except Exception as exc:
                self._handle_failure(state, str(exc))

            finally:
                # Signal all WebSocket subscribers that the stream is done
                self._broadcast_done(scan_id)

    async def _handle_success(self, state: ScanState, stdout_text: str) -> None:
        """Parse stdout JSON, persist to ScanStore, mark complete."""
        try:
            result_data = json.loads(stdout_text)
        except json.JSONDecodeError as exc:
            self._handle_failure(state, f"Failed to parse stdout as JSON: {exc}")
            return

        state.result_json = result_data
        state.status = ScanStatus.complete
        state.finished_at = datetime.now(timezone.utc)

        # Persist to store
        try:
            from lib.common.db import get_store

            store = get_store()
            if store is not None:
                with store:
                    entry = TOOL_REGISTRY.get(state.tool, {})
                    domain_key = entry.get("domain_key")
                    domain = state.params.get(domain_key) if domain_key else None

                    targets: list[str] | None = None
                    if state.tool == "ports" and "targets" in state.params:
                        targets = [
                            t.strip()
                            for t in state.params["targets"].split(",")
                            if t.strip()
                        ]

                    wrapper = ScanResultWrapper(result_data)
                    saved_id = store.save_scan(
                        tool=state.tool,
                        result=wrapper,
                        domain=domain,
                        targets=targets,
                        started_at=state.started_at,
                    )
                    print(
                        f"[tool_runner] saved scan {saved_id} to store",
                        file=sys.stderr,
                    )
        except Exception as exc:
            # Persistence failure should not change the scan status -- the
            # result was successfully produced, we just failed to save it.
            print(
                f"[tool_runner] failed to persist scan {state.scan_id}: {exc}",
                file=sys.stderr,
            )

    def _handle_failure(self, state: ScanState, error_msg: str) -> None:
        """Mark a scan as failed with an error message."""
        state.status = ScanStatus.failed
        state.finished_at = datetime.now(timezone.utc)
        state.error = error_msg
        print(
            f"[tool_runner] scan {state.scan_id} failed: {error_msg}",
            file=sys.stderr,
        )

    def _broadcast(self, scan_id: str, line: str) -> None:
        """Push a stderr line to all subscribers for a scan."""
        for queue in self._ws_subscribers.get(scan_id, []):
            queue.put_nowait(line)

    def _broadcast_done(self, scan_id: str) -> None:
        """Signal end-of-stream to all subscribers."""
        for queue in self._ws_subscribers.get(scan_id, []):
            queue.put_nowait(None)


# Module-level singleton so the router and server share one instance.
runner = ToolRunner()
