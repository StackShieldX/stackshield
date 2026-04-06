# dns_discovery

Passive DNS recon tool. Given a domain, it discovers subdomains, extracts WHOIS registration data, and resolves all available DNS records for the domain and every discovered subdomain.

## Quick Start

```bash
# From the repo root (image must be built first)
./ssx.sh dns -d example.com
```

## Build

```bash
# Run once from the repo root, then rebuild after Dockerfile or pyproject.toml changes
docker build -t stackshield .
```

## Flags

| Flag | Description |
|------|-------------|
| `-d`, `--domain` | Target domain (required). Example: `gigfomo.com` |
| `--save` | Force saving results to the store (overrides `auto_save=false` in config) |
| `--no-save` | Skip saving results (overrides `auto_save=true` in config) |

## How It Works

Execution runs in two parallel phases:

**Phase 1** (concurrent):
- **WHOIS**: runs `whois <domain>` and parses registration metadata
- **Subfinder**: runs `subfinder -d <domain>` to enumerate subdomains via passive DNS sources (crt.sh, VirusTotal, etc.)

**Phase 2** (concurrent, up to 50 parallel processes):
- **dnsx**: resolves all DNS record types (`A`, `AAAA`, `CNAME`, `MX`, `NS`, `TXT`, `SOA`, `PTR`) for the root domain and each discovered subdomain

## Data Sources

Subfinder queries passive sources including: `crt.sh`, `VirusTotal`, `SecurityTrails`, `Shodan`, `dnsdumpster`, and others depending on configured API keys.

## Output Schema

The tool emits a single JSON object on stdout:

```json
{
  "name": "example.com",
  "whois_info": {
    "registrar": "Example Registrar, LLC",
    "registrant": "John Doe",
    "creation_date": "2010-01-15T00:00:00",
    "expiration_date": "2026-01-15T00:00:00",
    "updated_date": "2024-06-01T00:00:00",
    "name_servers": ["ns1.example.com", "ns2.example.com"],
    "status": ["clientTransferProhibited"],
    "emails": ["admin@example.com"],
    "org": "Example Corp",
    "country": "US",
    "raw": "..."
  },
  "subdomains": [
    {
      "name": "example.com",
      "sources": [],
      "dns_records": {
        "a": [{"ip_address": "93.184.216.34"}],
        "aaaa": [],
        "cname": [],
        "mx": [{"priority": 10, "exchange": "mail.example.com"}],
        "ns": [{"nameserver": "ns1.example.com"}],
        "txt": [{"values": ["v=spf1 include:_spf.example.com ~all"]}],
        "soa": [{"mname": "ns1.example.com", "rname": "admin.example.com", "serial": 2024010101, "refresh": 3600, "retry": 900, "expire": 604800, "minimum": 300}],
        "ptr": []
      }
    },
    {
      "name": "api.example.com",
      "sources": [
        {"strategy": "subfinder", "source": "certsh"}
      ],
      "dns_records": {
        "a": [{"ip_address": "93.184.216.35"}],
        "aaaa": [],
        "cname": [],
        "mx": [],
        "ns": [],
        "txt": [],
        "soa": [],
        "ptr": []
      }
    }
  ]
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `name` | The target domain |
| `whois_info` | Registration metadata. `null` if WHOIS failed |
| `subdomains` | List of all discovered subdomains including the root domain |
| `subdomains[].sources` | Where this subdomain was found. Empty for the root domain |
| `subdomains[].sources[].strategy` | Discovery method (e.g. `"subfinder"`) |
| `subdomains[].sources[].source` | Data source used by the strategy (e.g. `"certsh"`) |
| `subdomains[].dns_records` | All resolved DNS records for this hostname |

## Internals

```
apps/dns_discovery/dns.py              # CLI entry point + orchestration
lib/dns_discovery/services/
  subdomain_service.py                 # SubdomainStrategy ABC + SubfinderStrategy
  whois_service.py                     # whois CLI wrapper + parser
  dns_service.py                       # dnsx CLI wrapper + parser
lib/common/entities/
  domain.py                            # Domain model
  subdomain.py                         # Subdomain, SubdomainSource, DnsRecords
  whois_info.py                        # WhoisInfo
  dns_records.py                       # ARecord, AAAARecord, CNAMERecord, MXRecord, NSRecord, TXTRecord, SOARecord, PTRRecord
```

## Extending Subdomain Discovery

To add a new discovery strategy, implement `SubdomainStrategy` in `lib/dns_discovery/services/subdomain_service.py`:

```python
class AmassStrategy(SubdomainStrategy):
    async def discover(self, domain: str) -> list[Subdomain]:
        ...
```

Then pass it to `discover_subdomains`:

```python
await discover_subdomains(domain, strategies=[SubfinderStrategy(), AmassStrategy()])
```

All strategies run in parallel and their results are automatically merged and deduplicated.
