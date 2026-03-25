# port_scan

Port scanning tool. Given one or more target hosts, discovers open TCP ports using naabu.

## Quick Start

```bash
# From the repo root (image must be built first)
./ssx.sh ports -t 192.168.1.1
./ssx.sh ports -t 10.0.0.1,10.0.0.2 -p 80,443,8080
./ssx.sh ports -t targets.txt --scan-type CONNECT
```

## Build

```bash
# Run once from the repo root, then rebuild after Dockerfile or pyproject.toml changes
docker build -t stackshield .
```

## Flags

| Flag | Description |
|------|-------------|
| `-t`, `--targets` | Comma-separated IPs/hostnames, or path to a file with one target per line (required) |
| `-p`, `--ports` | Port specification (e.g. `80,443`, `1-1000`). Default: naabu top 100 |
| `--scan-type` | `SYN` (default) or `CONNECT`. SYN requires root/CAP_NET_RAW |

## How It Works

1. Parses the target list (comma-separated or file)
2. Pipes all targets to naabu via stdin
3. Naabu performs the port scan and emits JSON-lines output
4. Parser collects results into a structured model
5. Emits a single JSON object on stdout

SYN scanning (default) sends raw TCP SYN packets and is faster but requires root privileges. Docker containers run as root by default, so this works out of the box. Use `--scan-type CONNECT` for unprivileged environments.

## Output Schema

```json
{
  "targets": ["192.168.1.1"],
  "scan_type": "SYN",
  "ports_scanned": "top-100",
  "results": [
    {
      "host": "192.168.1.1",
      "ip": "192.168.1.1",
      "port": 22,
      "protocol": "tcp"
    },
    {
      "host": "192.168.1.1",
      "ip": "192.168.1.1",
      "port": 80,
      "protocol": "tcp"
    }
  ]
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `targets` | The targets that were scanned |
| `scan_type` | Scan method used (`SYN` or `CONNECT`) |
| `ports_scanned` | Port specification used (or `top-100` for default) |
| `results` | List of open ports found |
| `results[].host` | Hostname as provided to naabu |
| `results[].ip` | Resolved IP address |
| `results[].port` | Open port number |
| `results[].protocol` | Protocol (`tcp`) |

## Internals

```
apps/port_scan/port.py                  # CLI entry point + orchestration
lib/port_scan/services/
  naabu_service.py                      # naabu CLI wrapper + parser
lib/common/entities/
  port_result.py                        # PortEntry, PortScanResult models
```
