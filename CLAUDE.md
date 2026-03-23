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
│   │   └── entities/  # Pydantic data models shared across all tools
│   └── <tool_name>/
│       └── services/  # Business logic for that specific tool
├── rules/             # Coding and operational standards
├── Dockerfile         # Kali-based Docker image
└── ssx.sh             # Unified CLI wrapper (runs tools in Docker)
```

### Key Conventions

- **Entities live in `lib/common/entities/`** — all Pydantic models that are shared across services go here.
- **Service logic lives in `lib/<tool>/services/`** — each file wraps a CLI tool or external source.
- **CLI entry points live in `apps/<tool>/`** — responsible only for arg parsing and orchestration.
- **All output goes to stdout as JSON.** Logs, warnings, and errors go to stderr.
- **Everything runs in Docker** via `ssx.sh`. No tool should require local installation.

---

## Running Tools

```bash
# Build the image once (or after dependency changes)
docker build -t stackshield .

# Run any tool
chmod +x ssx.sh
./ssx.sh dns -d example.com
```

---

## Adding a New Tool

1. Create `apps/<tool_name>/` with a CLI entry point (e.g. `port.py`)
2. Create `lib/<tool_name>/services/` with service files wrapping external tools
3. Add new entities to `lib/common/entities/` if they are shared; otherwise keep them local to the service
4. Add a new `case` to `ssx.sh` mapping the subcommand to the Python file
5. Update the root `README.md` tools table with the new subcommand
6. Add a `README.md` in `apps/<tool_name>/` documenting Quick Start and Output Schema

---

## Standards

- Python conventions: see [rules/python.md](rules/python.md)
- Docker conventions: see [rules/docker.md](rules/docker.md)
- General tool conventions: see [rules/general.md](rules/general.md)
