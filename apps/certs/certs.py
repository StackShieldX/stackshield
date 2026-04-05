#!/usr/bin/env python3
"""Certificate Transparency and TLS certificate discovery CLI."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from lib.common.db import get_store, should_save
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
    return _extract_targets(data)


async def main(domain: str, mode: str, ports: str, use_stdin: bool,
               db_targets: list[tuple[str, int]] | None = None) -> CertsResult:
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

        if db_targets is not None:
            if db_targets:
                print(
                    f"[certs] loaded {len(db_targets)} targets from store",
                    file=sys.stderr,
                )
                tls_targets.extend(db_targets)
            else:
                print(
                    "[certs] port scan in store returned 0 targets",
                    file=sys.stderr,
                )
        elif use_stdin:
            stdin_targets = _parse_stdin_targets()
            print(
                f"[certs] read {len(stdin_targets)} targets from stdin",
                file=sys.stderr,
            )
            tls_targets.extend(stdin_targets)

        if mode == "tls" and not use_stdin and db_targets is None:
            # In tls-only mode without stdin/db, scan the domain on specified ports
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
    return result


def _extract_targets(data: dict) -> list[tuple[str, int]]:
    """Extract unique (host, port) pairs from scan result data."""
    seen: set[tuple[str, int]] = set()
    targets: list[tuple[str, int]] = []
    for entry in data.get("results", []):
        host = entry.get("host")
        port = entry.get("port")
        if host is None or port is None:
            print(f"[certs] skipping entry missing host/port: {entry}", file=sys.stderr)
            continue
        pair = (host, port)
        if pair not in seen:
            seen.add(pair)
            targets.append(pair)
    return targets


def _load_db_targets(domain: str) -> list[tuple[str, int]] | None:
    """Try to load port scan results from the store for use as TLS targets.

    Resolves the domain to IPs via the latest DNS scan, then finds port
    scans whose targets include any of those IPs.

    Returns None if the store is unavailable or no results are found,
    allowing the caller to fall back to default behavior.
    """
    store = get_store()
    if store is None:
        return None

    with store:
        dns_data = store.load_latest_scan(tool="dns", domain=domain)
        if dns_data is None:
            print(f"[certs] no DNS scan in store for {domain}, skipping DB lookup", file=sys.stderr)
            return None

        ips: set[str] = set()
        for sub in dns_data.get("subdomains", []):
            for a in sub.get("dns_records", {}).get("a", []):
                if a.get("ip_address"):
                    ips.add(a["ip_address"])
            for aaaa in sub.get("dns_records", {}).get("aaaa", []):
                if aaaa.get("ipv6_address"):
                    ips.add(aaaa["ipv6_address"])

        if not ips:
            print(f"[certs] DNS scan for {domain} has no A/AAAA records, skipping DB lookup", file=sys.stderr)
            return None

        print(
            f"[certs] resolved {domain} to {len(ips)} IP(s) from DNS scan",
            file=sys.stderr,
        )

        all_targets: list[tuple[str, int]] = []
        seen: set[tuple[str, int]] = set()
        for ip in sorted(ips):
            port_data = store.load_latest_scan(tool="ports", target=ip)
            if port_data is not None:
                for pair in _extract_targets(port_data):
                    if pair not in seen:
                        seen.add(pair)
                        all_targets.append(pair)

    if not all_targets:
        print(
            f"[certs] no port scan results in store for IPs of {domain}, skipping DB lookup",
            file=sys.stderr,
        )
        return None

    return all_targets


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
    parser.add_argument(
        "--no-db",
        action="store_true",
        dest="no_db",
        help="Skip automatic DB lookup of prior scan results",
    )
    save_group = parser.add_mutually_exclusive_group()
    save_group.add_argument(
        "--save", action="store_true", default=False,
        help="Force saving results to the store (overrides auto_save=false in config)",
    )
    save_group.add_argument(
        "--no-save", action="store_true", default=False,
        help="Skip saving results (overrides auto_save=true in config)",
    )
    args = parser.parse_args()

    # DB lookup is the default — skip it when stdin, explicit ports, or --no-db
    db_targets = None
    if not args.use_stdin and not args.ports and not args.no_db:
        db_targets = _load_db_targets(args.domain)

    try:
        result = asyncio.run(
            main(args.domain, args.mode, args.ports, args.use_stdin, db_targets)
        )
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(1)

    do_save, config = should_save(save_flag=args.save, no_save_flag=args.no_save)
    if do_save:
        store = get_store(_config=config)
        if store is not None:
            with store:
                scan_id = store.save_scan(
                    tool="certs", result=result, domain=args.domain,
                )
                print(f"[db] saved scan {scan_id}", file=sys.stderr)
