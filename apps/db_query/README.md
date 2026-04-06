# db -- Scan Result Store

Query, inspect, and manage stored scan results.

## Quick Start

```bash
# List all stored scans
./ssx.sh db list

# Show the latest DNS scan for a domain
./ssx.sh db latest --tool dns --domain example.com

# Delete all port scan results
./ssx.sh db purge --tool ports
```

## Subcommands

### list

List stored scan metadata (does not include full results).

```bash
./ssx.sh db list [--tool TOOL] [--domain DOMAIN] [--limit N]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--tool` | -- | Filter by tool name (`dns`, `ports`, `certs`) |
| `--domain` | -- | Filter by domain |
| `--limit` | 20 | Maximum number of results |

### show

Display the full JSON result for a specific scan.

```bash
./ssx.sh db show <scan-id>
```

### latest

Display the full JSON result of the most recent scan for a tool.

```bash
./ssx.sh db latest --tool TOOL [--domain DOMAIN]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--tool` | Yes | Tool name (`dns`, `ports`, `certs`) |
| `--domain` | No | Filter by domain |

### delete

Remove a single scan by ID.

```bash
./ssx.sh db delete <scan-id>
```

### purge

Bulk-delete scans. With no filters, deletes everything.

```bash
./ssx.sh db purge [--tool TOOL] [--domain DOMAIN]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--tool` | -- | Only purge scans for this tool |
| `--domain` | -- | Only purge scans for this domain |

## Output

`list`, `show`, and `latest` output JSON to stdout. `delete` and `purge` print a summary to stderr.

The output of `latest` and `show` is the same JSON format as the original tool output, so it can be piped:

```bash
# Pipe stored port scan results into the certs tool
./ssx.sh db latest --tool ports --domain example.com | ./ssx.sh certs -d example.com --stdin
```

## Configuration

The store backend and settings are configured in `~/.stackshield/config.toml`. See the root README for details. When `store.enabled = false`, all `db` subcommands print an error and exit.
