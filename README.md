# StackShield

Open-source cybersecurity toolkit. No SaaS subscriptions. No heavy vendors. Just Docker.

## What is StackShield?

StackShield commoditizes security tooling so any team can perform comprehensive security assessments without expensive proprietary platforms. Tools compose via JSON stdout — the output of one tool can feed the next.

The approach is **outside-in**: start from passive external recon and work inward as needed.

## Tools

| Command | Description | Status |
|---------|-------------|--------|
| `dns`   | DNS discovery: subdomain enumeration, WHOIS, and DNS record extraction | stable |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/StackShieldX/stackshield.git
cd stackshield

# 2. Build the Docker image
docker build -t stackshield .

# 3. Run a tool
chmod +x ssx.sh
./ssx.sh dns -d example.com
```

## Usage

All tools are invoked through `ssx.sh`:

```
./ssx.sh <subcommand> [flags]
```

Output is always JSON on stdout. Redirect or pipe as needed:

```bash
# Save to a file
./ssx.sh dns -d example.com > results.json

# Pretty-print with jq
./ssx.sh dns -d example.com | jq '.subdomains[].name'
```

## Architecture

```
stackshield/
├── apps/          # CLI entry points (one per tool)
├── lib/           # Business logic and shared data models
│   ├── common/
│   │   └── entities/   # Pydantic models shared across tools
│   └── dns_discovery/
│       └── services/
├── rules/         # Coding and operational standards
├── Dockerfile     # Kali-based container image
└── ssx.sh         # Unified CLI wrapper
```

See [CLAUDE.md](CLAUDE.md) for contributor guidance and architecture details.

## License

Apache 2.0 — see [LICENSE](LICENSE).
