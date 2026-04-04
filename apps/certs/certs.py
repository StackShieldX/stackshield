#!/usr/bin/env python3
"""Certificate Transparency and TLS certificate discovery CLI."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from lib.common.entities import CertsResult
from lib.certs.services.ct_service import discover_ct_entries, extract_subdomains
from lib.certs.services.tls_service import analyze_tls_batch


def _parse_ports(port_spec: str) -> list[int]:
    """Parse a comma-separated port specification into a list of ints.

    Returns [443] when the spec is empty.
    """
    if not port_spec:
        return [443]
    try:
        return [int(p.strip()) for p in port_spec.split(",") if p.strip()]
    except ValueError:
        print(f"[certs] invalid port specification: {port_spec}", file=sys.stderr)
        sys.exit(1)


def _parse_stdin_targets() -> list[tuple[str, int]]:
    """Read PortScanResult JSON from stdin and return unique (host, port) pairs."""
    raw = sys.stdin.read()
    if not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"[certs] invalid JSON on stdin: {exc}", file=sys.stderr)
        return []
    seen: set[tuple[str, int]] = set()
    targets: list[tuple[str, int]] = []
    for entry in data.get("results", []):
        pair = (entry["host"], entry["port"])
        if pair not in seen:
            seen.add(pair)
            targets.append(pair)
    return targets


async def main(domain: str, mode: str, ports: str, use_stdin: bool) -> None:
    """Discover certificates for a domain via CT logs and/or TLS connections."""
    ct_entries = []
    tls_results = []
    port_list = _parse_ports(ports)

    if mode in ("ct", "all"):
        print(
            f"[certs] discovering CT entries for {domain}...",
            file=sys.stderr,
        )
        ct_entries = await discover_ct_entries(domain)
        print(
            f"[certs] found {len(ct_entries)} CT entries",
            file=sys.stderr,
        )

    if mode in ("tls", "all"):
        tls_targets: list[tuple[str, int]] = []

        if use_stdin:
            stdin_targets = _parse_stdin_targets()
            print(
                f"[certs] read {len(stdin_targets)} targets from stdin",
                file=sys.stderr,
            )
            tls_targets.extend(stdin_targets)

        if mode == "tls" and not use_stdin:
            # In tls-only mode without stdin, scan the domain on specified ports
            for port in port_list:
                tls_targets.append((domain, port))

        if mode == "all":
            # Extract subdomains from CT entries and scan them
            subdomains = extract_subdomains(ct_entries)
            if not subdomains:
                # Fall back to the domain itself if no subdomains found
                subdomains = [domain]
            existing = {(h, p) for h, p in tls_targets}
            for sub in subdomains:
                for port in port_list:
                    pair = (sub, port)
                    if pair not in existing:
                        existing.add(pair)
                        tls_targets.append(pair)

        if tls_targets:
            print(
                f"[certs] scanning TLS on {len(tls_targets)} hosts",
                file=sys.stderr,
            )
            tls_results = await analyze_tls_batch(tls_targets)

    result = CertsResult(
        domain=domain,
        mode=mode,
        ct_entries=ct_entries,
        tls_results=tls_results,
    )

    print(json.dumps(result.model_dump(mode="json"), indent=2))


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
