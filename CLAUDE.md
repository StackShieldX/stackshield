# StackShield — Claude Code Guide

## Project Vision

StackShield is an open-source cybersecurity platform designed to commoditize security tooling. The goal is to let companies perform comprehensive security assessments without paying for expensive SaaS products or proprietary vendors.

The approach is **outside-in**: tools start from passive external recon and progressively move inward:

1. **Recon** — DNS discovery, WHOIS, subdomain enumeration (current)
2. **Enumeration** — port scanning, service fingerprinting, banner grabbing
3. **Cloud Security** — S3 bucket exposure, IAM misconfigurations, public asset audits
4. **App Security** — web vulnerability scanning, exposed secrets, API analysis

Each tool produces JSON output so results can be piped and composed.

---

## Architecture

```
stackshield/
├── apps/              # CLI entry points — one folder per tool
├── lib/               # Shared business logic
│   ├── common/
│   │   ├── entities/  # Pydantic data models shared across all tools
│   │   └── db/        # Persistence layer (ScanStore interface + backends)
│   └── <tool_name>/
│       └── services/  # Business logic for that specific tool
├── rules/             # Coding and operational standards
├── Dockerfile         # Kali-based Docker image
└── ssx.sh             # Unified CLI wrapper (runs tools in Docker)
```

### Key Conventions

- **Entities live in `lib/common/entities/`** — all Pydantic models that are shared across services go here.
- **Persistence lives in `lib/common/db/`** — abstract `ScanStore` interface (`base.py`), SQLite default (`sqlite_store.py`), and factory/config logic (`__init__.py`).
- **Service logic lives in `lib/<tool>/services/`** — each file wraps a CLI tool or external source.
- **CLI entry points live in `apps/<tool>/`** — responsible only for arg parsing and orchestration.
- **All output goes to stdout as JSON.** Logs, warnings, and errors go to stderr.
- **Everything runs in Docker** via `ssx.sh`. No tool should require local installation.

### Persistence

Tools can persist scan results to a pluggable store (SQLite by default). Configuration lives in `~/.stackshield/config.toml` (mounted to `/data/config.toml` in the container). Key settings:

- `store.enabled` — set to `false` to disable persistence entirely
- `store.auto_save` — when `true` (default), tools auto-save results after every run
- `store.backend` — `"sqlite"` by default; new backends implement `ScanStore` in `lib/common/db/`

CLI flags `--save` and `--no-save` override `auto_save` per run. The certs tool automatically looks up prior DNS and port scan results from the store to discover TLS targets (skip with `--no-db`, `--stdin`, or `-p`).

---

## Running Tools

```bash
# Build and run via Make
make build
make dns DOMAIN=example.com

# Or directly via ssx.sh
./ssx.sh dns -d example.com
```

Run `make help` for all available targets.

---

## Adding a New Tool

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full checklist. In short:

1. Create `apps/<tool_name>/` with a CLI entry point (e.g. `certs.py`)
2. Create `lib/<tool_name>/services/` with service files wrapping external tools
3. Add new entities to `lib/common/entities/` if they are shared; otherwise keep them local to the service
4. Add a new `case` to `ssx.sh` mapping the subcommand to the Python file
5. Add a `make` target in the Makefile under the Tool Shortcuts section
6. Update the root `README.md` tools table with the new subcommand
7. Add a `README.md` in `apps/<tool_name>/` documenting Quick Start and Output Schema
8. Add `--save`/`--no-save` flags and call `should_save()` + `get_store()` after `asyncio.run()` for persistence support

## Adding a New Store Backend

1. Create `lib/common/db/<backend>_store.py` implementing the `ScanStore` ABC from `lib/common/db/base.py`
2. Register the class in the `_BACKENDS` dict in `lib/common/db/__init__.py`
3. Add a `[store.<backend>]` section to the default config template in `lib/common/db/__init__.py`
4. Add the backend's dependencies to `pyproject.toml`

---

## Standards

- Python conventions: see [rules/python.md](rules/python.md)
- Docker conventions: see [rules/docker.md](rules/docker.md)
- General tool conventions: see [rules/general.md](rules/general.md)
