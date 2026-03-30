#!/usr/bin/env python3
"""Certificate Transparency and TLS certificate discovery CLI."""

import argparse
import asyncio
import json
import sys


async def main(domain: str, mode: str, ports: str, use_stdin: bool) -> None:
    """Discover certificates for a domain via CT logs and/or TLS connections.

    This is a placeholder implementation that outputs an empty CertsResult.
    Services will be wired in by subsequent features.
    """
    print(
        f"[certs] scanning {domain} (mode={mode})",
        file=sys.stderr,
    )

    if use_stdin:
        stdin_data = sys.stdin.read()
        print(
            f"[certs] read {len(stdin_data)} bytes from stdin",
            file=sys.stderr,
        )

    if ports:
        print(
            f"[certs] port spec: {ports}",
            file=sys.stderr,
        )

    result = {
        "domain": domain,
        "mode": mode,
        "ct_entries": [],
        "tls_results": [],
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Discover certificates via CT logs and TLS connections.",
    )
    parser.add_argument(
        "-d", "--domain",
        required=True,
        help="Target domain to scan for certificates",
    )
    parser.add_argument(
        "--mode",
        choices=["ct", "tls", "all"],
        default="all",
        help="Scan mode: ct (CT logs only), tls (TLS grab only), all (default)",
    )
    parser.add_argument(
        "-p", "--ports",
        default="",
        help="Port specification for TLS scanning (e.g. '443', '443,8443')",
    )
    parser.add_argument(
        "--stdin",
        action="store_true",
        dest="use_stdin",
        help="Read port scan JSON from stdin for TLS target discovery",
    )
    args = parser.parse_args()

    try:
        asyncio.run(main(args.domain, args.mode, args.ports, args.use_stdin))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(1)
