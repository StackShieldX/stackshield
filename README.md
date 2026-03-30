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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture, and how to add new tools.

## License

Apache 2.0 — see [LICENSE](LICENSE).
