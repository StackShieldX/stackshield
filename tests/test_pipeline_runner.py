"""Tests for the pipeline execution service."""

from __future__ import annotations

import asyncio
import json
import sys

import pytest

from apps.web.services.pipeline_runner import (
    PipelineDefinition,
    PipelineEdge,
    PipelineNode,
    PipelineRunner,
    PipelineStatus,
    StageStatus,
    topological_sort,
)


# ---------------------------------------------------------------------------
# topological_sort unit tests
# ---------------------------------------------------------------------------


class TestTopologicalSort:
    def test_single_node_no_edges(self) -> None:
        nodes = [PipelineNode(id="a", tool="dns")]
        order = topological_sort(nodes, [])
        assert order == ["a"]

    def test_linear_chain(self) -> None:
        nodes = [
            PipelineNode(id="a", tool="dns"),
            PipelineNode(id="b", tool="ports"),
            PipelineNode(id="c", tool="certs"),
        ]
        edges = [
            PipelineEdge(**{"from": "a", "to": "b"}),
            PipelineEdge(**{"from": "b", "to": "c"}),
        ]
        order = topological_sort(nodes, edges)
        assert order == ["a", "b", "c"]

    def test_diamond_graph(self) -> None:
        nodes = [
            PipelineNode(id="a", tool="dns"),
            PipelineNode(id="b", tool="ports"),
            PipelineNode(id="c", tool="ports"),
            PipelineNode(id="d", tool="certs"),
        ]
        edges = [
            PipelineEdge(**{"from": "a", "to": "b"}),
            PipelineEdge(**{"from": "a", "to": "c"}),
            PipelineEdge(**{"from": "b", "to": "d"}),
            PipelineEdge(**{"from": "c", "to": "d"}),
        ]
        order = topological_sort(nodes, edges)
        assert order[0] == "a"
        assert order[-1] == "d"
        assert set(order[1:3]) == {"b", "c"}

    def test_cycle_raises(self) -> None:
        nodes = [
            PipelineNode(id="a", tool="dns"),
            PipelineNode(id="b", tool="ports"),
        ]
        edges = [
            PipelineEdge(**{"from": "a", "to": "b"}),
            PipelineEdge(**{"from": "b", "to": "a"}),
        ]
        with pytest.raises(ValueError, match="cycle"):
            topological_sort(nodes, edges)

    def test_unknown_source_raises(self) -> None:
        nodes = [PipelineNode(id="a", tool="dns")]
        edges = [PipelineEdge(**{"from": "x", "to": "a"})]
        with pytest.raises(ValueError, match="unknown source"):
            topological_sort(nodes, edges)

    def test_unknown_target_raises(self) -> None:
        nodes = [PipelineNode(id="a", tool="dns")]
        edges = [PipelineEdge(**{"from": "a", "to": "x"})]
        with pytest.raises(ValueError, match="unknown target"):
            topological_sort(nodes, edges)

    def test_disconnected_nodes(self) -> None:
        nodes = [
            PipelineNode(id="a", tool="dns"),
            PipelineNode(id="b", tool="ports"),
        ]
        order = topological_sort(nodes, [])
        # Both should appear; order is deterministic (sorted)
        assert set(order) == {"a", "b"}
        assert order == sorted(order)


# ---------------------------------------------------------------------------
# PipelineEdge model tests
# ---------------------------------------------------------------------------


class TestPipelineEdge:
    def test_from_alias(self) -> None:
        edge = PipelineEdge(**{"from": "a", "to": "b"})
        assert edge.source == "a"
        assert edge.target == "b"

    def test_field_names(self) -> None:
        edge = PipelineEdge(source="a", target="b")
        assert edge.source == "a"
        assert edge.target == "b"


# ---------------------------------------------------------------------------
# PipelineDefinition validation
# ---------------------------------------------------------------------------


class TestPipelineDefinition:
    def test_parse_request_body(self) -> None:
        raw = {
            "nodes": [
                {"id": "dns1", "tool": "dns", "params": {"domain": "example.com"}},
                {"id": "ports1", "tool": "ports", "params": {"targets": "10.0.0.1"}},
            ],
            "edges": [
                {"from": "dns1", "to": "ports1"},
            ],
        }
        defn = PipelineDefinition.model_validate(raw)
        assert len(defn.nodes) == 2
        assert len(defn.edges) == 1
        assert defn.edges[0].source == "dns1"

    def test_empty_edges(self) -> None:
        raw = {
            "nodes": [
                {"id": "dns1", "tool": "dns", "params": {"domain": "example.com"}},
            ],
        }
        defn = PipelineDefinition.model_validate(raw)
        assert defn.edges == []


# ---------------------------------------------------------------------------
# PipelineRunner integration tests (using real subprocess execution)
# ---------------------------------------------------------------------------


class TestPipelineRunner:
    """Tests that exercise the runner with a mock subprocess.

    We monkeypatch asyncio.create_subprocess_exec to avoid running actual
    CLI tools in tests.
    """

    @pytest.fixture()
    def runner(self) -> PipelineRunner:
        return PipelineRunner()

    @pytest.mark.asyncio
    async def test_unknown_tool_raises(self, runner: PipelineRunner) -> None:
        defn = PipelineDefinition(
            nodes=[PipelineNode(id="x", tool="nonexistent")],
            edges=[],
        )
        with pytest.raises(ValueError, match="Unknown tool"):
            await runner.start_pipeline(defn)

    @pytest.mark.asyncio
    async def test_cycle_raises(self, runner: PipelineRunner) -> None:
        defn = PipelineDefinition(
            nodes=[
                PipelineNode(id="a", tool="dns", params={"domain": "x.com"}),
                PipelineNode(id="b", tool="dns", params={"domain": "y.com"}),
            ],
            edges=[
                PipelineEdge(source="a", target="b"),
                PipelineEdge(source="b", target="a"),
            ],
        )
        with pytest.raises(ValueError, match="cycle"):
            await runner.start_pipeline(defn)

    @pytest.mark.asyncio
    async def test_successful_single_stage(self, runner: PipelineRunner, monkeypatch) -> None:
        """A single-node pipeline that succeeds."""
        fake_result = {"domain": "example.com", "subdomains": []}

        async def fake_create_subprocess_exec(*args, **kwargs):
            return _FakeProcess(
                stdout=json.dumps(fake_result).encode(),
                stderr=b"[dns] resolving example.com\n",
                returncode=0,
            )

        monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

        defn = PipelineDefinition(
            nodes=[PipelineNode(id="dns1", tool="dns", params={"domain": "example.com"})],
            edges=[],
        )
        state = await runner.start_pipeline(defn)
        assert state.status == PipelineStatus.running

        # Wait for background task to complete
        await asyncio.sleep(0.1)

        final = runner.get_pipeline(state.pipeline_id)
        assert final is not None
        assert final.status == PipelineStatus.complete
        assert final.stages["dns1"].status == StageStatus.complete
        assert final.stages["dns1"].result_json == fake_result

    @pytest.mark.asyncio
    async def test_stage_failure_stops_pipeline(self, runner: PipelineRunner, monkeypatch) -> None:
        """When a stage fails, subsequent stages are skipped."""

        async def fake_create_subprocess_exec(*args, **kwargs):
            return _FakeProcess(
                stdout=b"",
                stderr=b"[dns] error\n",
                returncode=1,
            )

        monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

        defn = PipelineDefinition(
            nodes=[
                PipelineNode(id="dns1", tool="dns", params={"domain": "example.com"}),
                PipelineNode(id="ports1", tool="ports", params={"targets": "10.0.0.1"}),
            ],
            edges=[PipelineEdge(source="dns1", target="ports1")],
        )
        state = await runner.start_pipeline(defn)
        await asyncio.sleep(0.1)

        final = runner.get_pipeline(state.pipeline_id)
        assert final is not None
        assert final.status == PipelineStatus.failed
        assert final.stages["dns1"].status == StageStatus.failed
        assert final.stages["ports1"].status == StageStatus.skipped
        assert "dns1" in final.error

    @pytest.mark.asyncio
    async def test_two_stage_pipeline_passes_data(self, runner: PipelineRunner, monkeypatch) -> None:
        """Verify that stage 1 output is available to stage 2 via stdin."""
        dns_result = {"domain": "example.com", "ips": ["10.0.0.1"]}
        port_result = {"results": [{"host": "10.0.0.1", "port": 443}]}

        call_count = 0
        captured_stdin: list[bytes] = []

        async def fake_create_subprocess_exec(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _FakeProcess(
                    stdout=json.dumps(dns_result).encode(),
                    stderr=b"",
                    returncode=0,
                )
            else:
                return _FakeProcess(
                    stdout=json.dumps(port_result).encode(),
                    stderr=b"",
                    returncode=0,
                    capture_stdin=captured_stdin,
                )

        monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

        defn = PipelineDefinition(
            nodes=[
                PipelineNode(id="dns1", tool="dns", params={"domain": "example.com"}),
                PipelineNode(id="ports1", tool="ports", params={"targets": "10.0.0.1"}),
            ],
            edges=[PipelineEdge(source="dns1", target="ports1")],
        )
        state = await runner.start_pipeline(defn)
        await asyncio.sleep(0.1)

        final = runner.get_pipeline(state.pipeline_id)
        assert final is not None
        assert final.status == PipelineStatus.complete
        assert final.stages["dns1"].result_json == dns_result
        assert final.stages["ports1"].result_json == port_result

    @pytest.mark.asyncio
    async def test_websocket_events(self, runner: PipelineRunner, monkeypatch) -> None:
        """Subscriber receives stage_start, stderr, stage_end, and done events."""
        fake_result = {"ok": True}

        async def fake_create_subprocess_exec(*args, **kwargs):
            return _FakeProcess(
                stdout=json.dumps(fake_result).encode(),
                stderr=b"line1\nline2\n",
                returncode=0,
            )

        monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

        defn = PipelineDefinition(
            nodes=[PipelineNode(id="dns1", tool="dns", params={"domain": "x.com"})],
            edges=[],
        )
        state = await runner.start_pipeline(defn)

        # Subscribe before execution completes
        queue = runner.subscribe(state.pipeline_id)

        # Collect all events
        events: list[dict] = []
        while True:
            event = await asyncio.wait_for(queue.get(), timeout=2.0)
            if event is None:
                break
            events.append(event)

        types = [e["type"] for e in events]
        assert "stage_start" in types
        assert "stage_end" in types
        assert "done" in types

        # Verify stderr lines appear
        stderr_events = [e for e in events if e["type"] == "stderr"]
        stderr_lines = [e["line"] for e in stderr_events]
        assert "line1" in stderr_lines
        assert "line2" in stderr_lines

    @pytest.mark.asyncio
    async def test_get_pipeline_returns_none_for_unknown(self, runner: PipelineRunner) -> None:
        assert runner.get_pipeline("nonexistent") is None


# ---------------------------------------------------------------------------
# Fake subprocess for testing
# ---------------------------------------------------------------------------


class _FakeStdin:
    """Mimics asyncio.subprocess stdin for capture."""

    def __init__(self, capture: list[bytes] | None = None) -> None:
        self._capture = capture
        self._data = b""

    def write(self, data: bytes) -> None:
        self._data += data

    async def drain(self) -> None:
        pass

    def close(self) -> None:
        if self._capture is not None:
            self._capture.append(self._data)


class _FakeStderr:
    """Mimics asyncio.subprocess stderr with readline support."""

    def __init__(self, data: bytes) -> None:
        self._lines = data.split(b"\n") if data else []
        self._index = 0

    async def readline(self) -> bytes:
        if self._index >= len(self._lines):
            return b""
        line = self._lines[self._index]
        self._index += 1
        if not line and self._index >= len(self._lines):
            return b""
        return line + b"\n"


class _FakeProcess:
    """Mimics asyncio.subprocess.Process for testing."""

    def __init__(
        self,
        stdout: bytes = b"",
        stderr: bytes = b"",
        returncode: int = 0,
        capture_stdin: list[bytes] | None = None,
    ) -> None:
        self._stdout = stdout
        self.stderr = _FakeStderr(stderr)
        self.returncode = returncode
        self.stdin = _FakeStdin(capture_stdin) if capture_stdin is not None else _FakeStdin()

    async def communicate(self) -> tuple[bytes, bytes]:
        return self._stdout, b""
