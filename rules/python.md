# Python Standards

## Language Version

Python 3.10+ is required. Use modern syntax:
- `X | Y` union types instead of `Optional[X]` / `Union[X, Y]` where possible
- `match` statements for structural pattern matching
- `list[X]`, `dict[K, V]` instead of `List[X]`, `Dict[K, V]` (no import needed in 3.10+)

## Data Models

- All data models use **Pydantic v2** (`from pydantic import BaseModel`).
- Use `Field(default_factory=list)` for mutable defaults, not `[]`.
- Serialize with `model.model_dump(mode="json")` before passing to `json.dumps` — this converts `datetime` and other types to JSON-compatible forms.
- Never pass raw dicts across service boundaries; always use typed models.

## External CLI Tools

- Invoke with `asyncio.create_subprocess_exec` — **never `shell=True`**.
- Always capture both `stdout` and `stderr` (`asyncio.subprocess.PIPE`).
- Decode output with `stdout.decode(errors="replace")` to handle encoding issues.
- Parse output defensively — malformed or empty lines must never crash the process.
- Return empty/partial models on failure, log the error to `sys.stderr`.

## Async

- Service functions that invoke subprocesses must be `async`.
- Use `asyncio.gather` to run independent operations in parallel.
- Use `asyncio.Semaphore` to cap concurrency when launching many subprocesses (default limit: 50).

## Type Annotations

- All public functions and methods must have full type annotations (parameters + return type).
- Use `Optional[X]` for fields that may be `None` (or `X | None` with `from __future__ import annotations`).

## Error Handling

- Services must not raise exceptions that propagate to the CLI layer.
- On failure: log to `sys.stderr`, return an empty or partial model.
- The CLI layer is the only place that exits with a non-zero status code.

## Imports

- Standard library imports first, then third-party, then local (`lib.*`).
- Local imports use absolute paths from the project root (e.g. `from lib.common.entities import Domain`).
