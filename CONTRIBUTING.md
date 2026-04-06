# Contributing to StackShield

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running
- [GNU Make](https://www.gnu.org/software/make/)

## Development Setup

```bash
# Build the Docker image
make build

# Start an interactive shell with local code mounted (edits reflect immediately)
make dev
```

## Makefile Targets

Run `make help` to see all targets. The key ones:

| Target | Description | Example |
|--------|-------------|---------|
| `build` | Build the Docker image | `make build` |
| `rebuild` | Rebuild without cache | `make rebuild` |
| `dev` | Interactive shell with code mounted | `make dev` |
| `test` | Run the test suite | `make test` |
| `lint` | Run ruff linter | `make lint` |
| `fmt` | Auto-format with ruff | `make fmt` |
| `dns` | Run DNS discovery | `make dns DOMAIN=example.com` |
| `ports` | Run port scan | `make ports TARGETS=10.0.0.1 PORTS=80,443` |
| `certs` | Run certificate discovery | `make certs DOMAIN=example.com MODE=all` |
| `db-list` | List stored scans | `make db-list TOOL=dns` |
| `db-latest` | Show latest scan result | `make db-latest TOOL=dns DOMAIN=example.com` |

Tools can also be invoked directly via `ssx.sh`:

```bash
./ssx.sh dns -d example.com
./ssx.sh ports -t 10.0.0.1 -p 80,443
./ssx.sh certs -d example.com --mode all
```

## Architecture

```
stackshield/
├── apps/              # CLI entry points -- one folder per tool
│   └── web/           # Web UI backend (FastAPI)
│       ├── server.py  # ASGI entry point
│       ├── routers/   # REST + WebSocket endpoints
│       └── services/  # Pipeline runner, tool runner
├── web/               # Web UI frontend (React + TypeScript + Vite)
│   └── src/
│       ├── pages/     # Route-level components (Dashboard, Pipelines, etc.)
│       ├── components/# Shared UI components (pipeline builder, result panels)
│       └── api/       # API client
├── lib/               # Shared business logic
│   ├── common/
│   │   ├── entities/  # Pydantic data models shared across all tools
│   │   └── db/        # Persistence layer (ScanStore interface + backends)
│   └── <tool_name>/
│       └── services/  # Business logic for that specific tool
├── rules/             # Coding and operational standards
├── Makefile           # Build, test, lint, and tool shortcuts
├── Dockerfile         # Kali-based Docker image
└── ssx.sh             # Unified CLI wrapper (runs tools in Docker)
```

### Key Conventions

- **Entities** live in `lib/common/entities/` -- all Pydantic models shared across services go here.
- **Persistence** lives in `lib/common/db/` -- abstract `ScanStore` interface, SQLite default backend, and factory/config logic.
- **Service logic** lives in `lib/<tool>/services/` -- each file wraps a CLI tool or external source.
- **CLI entry points** live in `apps/<tool>/` -- responsible only for arg parsing and orchestration.
- **Web backend** lives in `apps/web/` -- FastAPI server with routers for pipelines, scans, targets, and tool execution. Pipeline runner orchestrates multi-tool workflows with WebSocket progress.
- **Web frontend** lives in `web/` -- React + TypeScript + Vite app with TailwindCSS. Run `npm run dev` from `web/` for local development.
- **All output goes to stdout as JSON.** Logs, warnings, and errors go to stderr.
- **Everything runs in Docker** via `ssx.sh`. No tool should require local installation.

## Adding a New Tool

1. Create `apps/<tool_name>/` with a CLI entry point (e.g. `certs.py`)
2. Create `lib/<tool_name>/services/` with service files wrapping external tools
3. Add new entities to `lib/common/entities/` if they are shared; otherwise keep them local to the service
4. Add a new `case` to `ssx.sh` mapping the subcommand to the Python file
5. Add a `make` target in the Makefile under the Tool Shortcuts section
6. Update the root `README.md` tools table with the new subcommand
7. Add a `README.md` in `apps/<tool_name>/` documenting Quick Start and Output Schema
8. Add `--save`/`--no-save` flags and persistence support (see existing tools for the pattern)

## Adding a New Store Backend

To add a persistence backend beyond SQLite:

1. Create `lib/common/db/<backend>_store.py` implementing the `ScanStore` ABC from `lib/common/db/base.py`
2. Register the class path in the `_BACKENDS` dict in `lib/common/db/__init__.py`
3. Add a `[store.<backend>]` section to the default config template in `lib/common/db/__init__.py`
4. Add the backend's dependencies to `pyproject.toml`

## Standards

- Python conventions: see [rules/python.md](rules/python.md)
- Docker conventions: see [rules/docker.md](rules/docker.md)
- General tool conventions: see [rules/general.md](rules/general.md)
