# General Tool Standards

## I/O Contract

- **stdout**: JSON only. Tools emit a single JSON object at the end of execution.
- **stderr**: Logs, warnings, and errors. Users may redirect stdout without interference.
- **Exit codes**: `0` on success (even with partial data), non-zero on unrecoverable failure (e.g. missing required argument, Docker error).

## Partial Results

Tools must produce output even when some steps fail. A partial result is better than no result:
- If WHOIS fails, emit `null` for `whois_info`.
- If a subdomain's DNS resolution fails, emit empty `dns_records`.
- Never abort the entire run because one sub-task failed.

## Composability

Tools are designed to compose via JSON piping. The output of one tool may become the input of another. Keep output schemas stable and well-documented.

## Tool README Requirements

Every tool in `apps/<tool>/` must have a `README.md` with the following sections:

1. **Overview** — what the tool does and why
2. **Quick Start** — exact command to run (using `ssx.sh`)
3. **Build** — one-time Docker build command
4. **Output Schema** — description of the JSON structure with an example
5. **Flags** — all CLI flags with descriptions

## Naming

- Subcommands in `ssx.sh` use short, lowercase names: `dns`, `ports`, `cloud`, etc.
- Python files in `apps/<tool>/` are named after the subcommand: `dns.py`, `ports.py`.
- Service files in `lib/<tool>/services/` are named `<service>_service.py`.

## Versioning

Each tool follows the monorepo version in `pyproject.toml`. Breaking changes to output schemas increment the minor version.
