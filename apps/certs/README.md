# certs -- Certificate Discovery

Discover SSL/TLS certificates for a domain using Certificate Transparency logs and live TLS connections.

## Quick Start

```bash
# Build the Docker image (if not already done)
docker build -t stackshield .

# Run a full certificate scan (CT logs + TLS)
./ssx.sh certs -d example.com
```

## CLI Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `-d, --domain` | Yes | -- | Target domain to scan for certificates |
| `--mode` | No | `all` | Scan mode: `ct`, `tls`, or `all` |
| `-p, --ports` | No | `443` | Port specification for TLS scanning (e.g. `443`, `443,8443`) |
| `--stdin` | No | off | Read port scan JSON (`PortScanResult`) from stdin for TLS target discovery |
| `--no-db` | No | off | Skip automatic DB lookup of prior scan results |
| `--save` | No | off | Force saving results to the store (overrides `auto_save=false` in config) |
| `--no-save` | No | off | Skip saving results (overrides `auto_save=true` in config) |

### Modes

- **`ct`** -- Query Certificate Transparency logs only (via crt.sh). Returns historical and current certificates without connecting to any host.
- **`tls`** -- Perform live TLS certificate grabbing only. Connects to hosts on the specified ports and extracts certificate details.
- **`all`** -- Run both CT discovery and TLS scanning. Subdomains found in CT logs are automatically scanned via TLS.

## Examples

```bash
# CT log discovery only
./ssx.sh certs -d example.com --mode ct

# TLS certificate grab on default port (443)
./ssx.sh certs -d example.com --mode tls

# TLS on multiple ports
./ssx.sh certs -d example.com --mode tls -p 443,8443

# Full scan: CT discovery + TLS analysis
./ssx.sh certs -d example.com

# Pipeline: port scan results into TLS analysis
./ssx.sh ports -t 10.0.0.1 | ./ssx.sh certs -d example.com --mode tls --stdin

# Automatic DB lookup: if DNS and port scans are stored,
# certs picks up their results automatically (no piping needed)
./ssx.sh certs -d example.com

# Skip DB lookup explicitly
./ssx.sh certs -d example.com --no-db
```

## Output Schema

Output is JSON on stdout. The top-level object is a `CertsResult`:

```json
{
  "domain": "example.com",
  "mode": "all",
  "ct_entries": [
    {
      "domain": "example.com",
      "issuer_name": "C=US, O=Let's Encrypt, CN=R3",
      "not_before": "2024-01-15T12:00:00",
      "not_after": "2024-04-15T12:00:00",
      "san_names": ["example.com", "www.example.com"]
    }
  ],
  "tls_results": [
    {
      "host": "example.com",
      "port": 443,
      "subject": "example.com",
      "issuer": "R3",
      "serial_number": "ABC123...",
      "san_names": ["example.com", "www.example.com"],
      "key_type": "RSA",
      "key_size": 2048,
      "not_before": "2024-01-15T12:00:00",
      "not_after": "2024-04-15T12:00:00",
      "chain_depth": 1,
      "is_self_signed": false,
      "is_expired": false,
      "hostname_mismatch": false
    }
  ]
}
```

### Field Reference

**CertsResult** (top level)

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `string` | The target domain that was scanned |
| `mode` | `string` | Scan mode used (`ct`, `tls`, or `all`) |
| `ct_entries` | `CTEntry[]` | Certificate Transparency log entries (empty when mode is `tls`) |
| `tls_results` | `TLSCertInfo[]` | Live TLS certificate results (empty when mode is `ct`) |

**CTEntry**

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `string` | Domain name from the CT log entry |
| `issuer_name` | `string` | Certificate issuer distinguished name |
| `not_before` | `datetime` | Certificate validity start |
| `not_after` | `datetime` | Certificate validity end |
| `san_names` | `string[]` | Subject Alternative Names listed on the certificate |

**TLSCertInfo**

| Field | Type | Description |
|-------|------|-------------|
| `host` | `string` | Host that was connected to |
| `port` | `int` | Port used for the TLS connection |
| `subject` | `string` | Certificate subject common name |
| `issuer` | `string` | Certificate issuer common name |
| `serial_number` | `string` | Certificate serial number (hex) |
| `san_names` | `string[]` | Subject Alternative Names |
| `key_type` | `string` | Public key algorithm (e.g. `RSA`, `EC`) |
| `key_size` | `int` | Public key size in bits |
| `not_before` | `datetime` | Certificate validity start |
| `not_after` | `datetime` | Certificate validity end |
| `chain_depth` | `int` | Number of certificates in the chain |
| `is_self_signed` | `bool` | Whether the certificate is self-signed |
| `is_expired` | `bool` | Whether the certificate has expired |
| `hostname_mismatch` | `bool` | Whether the hostname does not match the certificate |
