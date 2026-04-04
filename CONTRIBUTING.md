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
├── lib/               # Shared business logic
│   ├── common/
│   │   └── entities/  # Pydantic data models shared across all tools
│   └── <tool_name>/
│       └── services/  # Business logic for that specific tool
├── rules/             # Coding and operational standards
├── Makefile           # Build, test, lint, and tool shortcuts
├── Dockerfile         # Kali-based Docker image
└── ssx.sh             # Unified CLI wrapper (runs tools in Docker)
```

### Key Conventions

- **Entities** live in `lib/common/entities/` -- all Pydantic models shared across services go here.
- **Service logic** lives in `lib/<tool>/services/` -- each file wraps a CLI tool or external source.
- **CLI entry points** live in `apps/<tool>/` -- responsible only for arg parsing and orchestration.
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

## Standards

- Python conventions: see [rules/python.md](rules/python.md)
- Docker conventions: see [rules/docker.md](rules/docker.md)
- General tool conventions: see [rules/general.md](rules/general.md)
