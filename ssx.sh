#!/usr/bin/env bash
# ssx.sh — StackShield CLI wrapper
# Runs tools inside the stackshield Docker container.
#
# Usage:
#   ./ssx.sh <subcommand> [args...]
#
# Examples:
#   ./ssx.sh dns -d example.com
#
# Prerequisites:
#   docker build -t stackshield .

set -euo pipefail

IMAGE="stackshield"

if [[ $# -eq 0 ]]; then
    echo "Usage: ssx.sh <subcommand> [args...]"
    echo ""
    echo "Available subcommands:"
    echo "  dns   DNS discovery — subdomains, WHOIS, DNS records"
    echo "  ports Port scanning — discover open ports on targets"
    echo ""
    echo "Example:"
    echo "  ./ssx.sh dns -d example.com"
    exit 1
fi

SUBCOMMAND="$1"
shift

case "$SUBCOMMAND" in
    dns)
        docker run --rm "$IMAGE" python apps/dns_discovery/dns.py "$@"
        ;;
    ports)
        docker run --rm "$IMAGE" python apps/port_scan/port.py "$@"
        ;;
    *)
        echo "Unknown subcommand: $SUBCOMMAND"
        echo ""
        echo "Available subcommands: dns, ports"
        exit 1
        ;;
esac
