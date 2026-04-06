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

# Persistent data directory (config + database).
# Override with SSX_DATA_DIR to use a custom location.
DATA_DIR="${SSX_DATA_DIR:-$HOME/.stackshield}"

# Detect if we're already inside the container (/.dockerenv exists in Docker).
# If so, run commands directly instead of wrapping in docker run.
if [[ -f /.dockerenv ]]; then
    RUN=""
    RUN_STDIN=""
else
    mkdir -p "$DATA_DIR"
    VOLUME="-v $DATA_DIR:/data"
    RUN="docker run --rm $VOLUME $IMAGE"
    RUN_STDIN="docker run --rm -i $VOLUME $IMAGE"
fi

if [[ $# -eq 0 ]]; then
    echo "Usage: ssx.sh <subcommand> [args...]"
    echo ""
    echo "Available subcommands:"
    echo "  dns   DNS discovery — subdomains, WHOIS, DNS records"
    echo "  ports Port scanning — discover open ports on targets"
    echo "  certs Certificate discovery — CT logs and TLS connections"
    echo "  db    Query, delete, or purge stored scan results"
    echo "  web   Launch the StackShield web UI on port 8080"
    echo ""
    echo "Example:"
    echo "  ./ssx.sh dns -d example.com"
    exit 1
fi

SUBCOMMAND="$1"
shift

case "$SUBCOMMAND" in
    dns)
        $RUN python apps/dns_discovery/dns.py "$@"
        ;;
    ports)
        $RUN python apps/port_scan/port.py "$@"
        ;;
    certs)
        ${RUN_STDIN:-$RUN} python apps/certs/certs.py "$@"
        ;;
    db)
        $RUN python apps/db_query/query.py "$@"
        ;;
    web)
        if [[ -f /.dockerenv ]]; then
            python apps/web/server.py "$@"
        else
            mkdir -p "$DATA_DIR"
            docker run --rm -p 8080:8080 -v "$DATA_DIR:/data" "$IMAGE" python apps/web/server.py "$@"
        fi
        ;;
    *)
        echo "Unknown subcommand: $SUBCOMMAND"
        echo ""
        echo "Available subcommands: dns, ports, certs, db, web"
        exit 1
        ;;
esac
