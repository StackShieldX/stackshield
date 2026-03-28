#!/usr/bin/env python3
"""Port Scanner CLI — discover open ports on target hosts using naabu."""

import argparse
import asyncio
import json
import os
import sys

from lib.common.entities import PortScanResult
from lib.port_scan.services.naabu_service import scan_ports

SCAN_TYPE_MAP = {
    "SYN": "s",
    "CONNECT": "c",
}


def _resolve_targets(raw: str) -> list[str]:
    """Parse a targets string into a list of hosts.

    If the string is a path to an existing file, read targets from it (one per line).
    Otherwise, split on commas.
    """
    if os.path.isfile(raw):
        with open(raw) as f:
            return [line.strip() for line in f if line.strip()]
    return [t.strip() for t in raw.split(",") if t.strip()]


async def main(targets: list[str], ports: str, scan_type: str) -> None:
    naabu_scan_type = SCAN_TYPE_MAP.get(scan_type, "s")

    port_label = ports or "top-100"
    print(
        f"[portscan] scanning {len(targets)} target(s) on ports {port_label} ({scan_type})",
        file=sys.stderr,
    )

    entries = await scan_ports(targets, ports=ports, scan_type=naabu_scan_type)

    print(
        f"[portscan] done — {len(entries)} open port(s) found",
        file=sys.stderr,
    )

    result = PortScanResult(
        targets=targets,
        scan_type=scan_type,
        ports_scanned=port_label,
        results=entries,
    )

    print(json.dumps(result.model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Discover open ports on target hosts.",
    )
    parser.add_argument(
        "-t", "--targets",
        required=True,
        help="Comma-separated IPs/hostnames, or path to a file with one target per line",
    )
    parser.add_argument(
        "-p", "--ports",
        default="",
        help="Port specification (e.g. '80,443', '1-1000'). Default: naabu top 100",
    )
    parser.add_argument(
        "--scan-type",
        choices=["SYN", "CONNECT"],
        default="SYN",
        help="Scan method (default: SYN). SYN requires root/CAP_NET_RAW",
    )
    args = parser.parse_args()

    resolved = _resolve_targets(args.targets)
    if not resolved:
        print("No targets provided.", file=sys.stderr)
        sys.exit(1)

    try:
        asyncio.run(main(resolved, args.ports, args.scan_type))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(1)
