# StackShield

Open-source cybersecurity toolkit. No SaaS subscriptions. No heavy vendors. Just Docker.

## What is StackShield?

StackShield commoditizes security tooling so any team can perform comprehensive security assessments without expensive proprietary platforms. Tools compose via JSON stdout — the output of one tool can feed the next.

The approach is **outside-in**: start from passive external recon and work inward as needed.

## Tools

| Command | Description | Status |
|---------|-------------|--------|
| `dns`   | DNS discovery: subdomain enumeration, WHOIS, and DNS record extraction | stable |
| `ports` | Port scanning: discover open TCP ports on target hosts | stable |
| `certs` | Certificate discovery: CT log transparency and live TLS certificate analysis | stable |
| `db`    | Query, inspect, and manage stored scan results | stable |
| `web`   | Web UI dashboard for running tools and viewing results | beta |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/StackShieldX/stackshield.git
cd stackshield

# 2. Build the Docker image
make build

# 3. Run a tool
make dns DOMAIN=example.com
```

## Usage

```bash
make dns DOMAIN=example.com
make ports TARGETS=10.0.0.1 PORTS=80,443
make certs DOMAIN=example.com MODE=all
```

Output is always JSON on stdout. Redirect or pipe as needed:

```bash
# Save to a file
make dns DOMAIN=example.com > results.json

# Pretty-print with jq
./ssx.sh dns -d example.com | jq '.subdomains[].name'

# Pipe tools together
./ssx.sh ports -t 10.0.0.1 | ./ssx.sh certs -d example.com --mode tls --stdin
```

Run `make help` for all available targets. See each tool's README in `apps/<tool>/` for detailed flag documentation.

## Persistence

StackShield can automatically save scan results to a local database so downstream tools can access them without manual piping.

### Configuration

On first run, a default config is created at `~/.stackshield/config.toml`:

```toml
[store]
enabled = true       # set to false to disable persistence entirely
auto_save = true     # auto-save results after every tool run
backend = "sqlite"   # pluggable — sqlite is the default

[store.sqlite]
path = "/data/stackshield.db"
```

Override the data directory with `SSX_DATA_DIR`:

```bash
SSX_DATA_DIR=/custom/path ./ssx.sh dns -d example.com
```

### Saving Results

With `auto_save = true` (default), every tool run is saved automatically:

```bash
./ssx.sh dns -d example.com          # auto-saved
./ssx.sh dns -d example.com --no-save  # skip saving this run
```

When `auto_save = false`, use `--save` to explicitly save:

```bash
./ssx.sh ports -t 10.0.0.1 --save
```

### Querying Stored Results

```bash
# List all stored scans
./ssx.sh db list

# List scans filtered by tool and domain
./ssx.sh db list --tool dns --domain example.com

# Show the latest result for a tool
./ssx.sh db latest --tool ports --domain example.com

# Show a specific scan by ID
./ssx.sh db show <scan-id>

# Delete a single scan
./ssx.sh db delete <scan-id>

# Purge all scans for a tool
./ssx.sh db purge --tool dns

# Purge everything
./ssx.sh db purge
```

### Cross-Tool Workflows

Instead of piping, downstream tools can load results directly from the store. The certs tool automatically resolves the domain to IPs via stored DNS scans, then finds port scan results for those IPs:

```bash
# 1. Run DNS and port scans (both auto-saved)
make dns DOMAIN=example.com
make ports TARGETS=10.0.0.1

# 2. Certs automatically picks up prior results from the store
make certs DOMAIN=example.com
```

Use `--no-db` to skip the automatic DB lookup, or `--stdin` / `-p` to provide targets explicitly (which also skips the DB lookup).

## Web UI

StackShield includes a web dashboard for running tools and viewing results in the browser. Features include:

- **Dashboard** -- scan activity, target coverage, tool breakdown, and quick-launch cards
- **New Scan** -- configure and launch individual tool runs with live output
- **History** -- browse and search past scan results
- **Targets** -- view all scanned domains with drill-down into per-target scan history
- **Pipelines** -- visual DAG builder for chaining tools (e.g. DNS -> Ports -> Certs) with automatic target propagation and real-time execution progress via WebSocket

### Quick Start

```bash
# Build the Docker image (includes frontend build)
make build

# Launch the web UI
make web
```

Open [http://localhost:8080](http://localhost:8080) in your browser. The API health check is available at `/api/health`.

The web server runs on port 8080 inside the container and is mapped to the same port on the host. Scan data is persisted to `~/.stackshield/` (or the path set by `SSX_DATA_DIR`).

You can also launch the web UI directly with `ssx.sh`:

```bash
./ssx.sh web
```


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture, and how to add new tools.

## License

Apache 2.0 — see [LICENSE](LICENSE).
