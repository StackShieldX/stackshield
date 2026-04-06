#!/usr/bin/env python3
"""Query, inspect, and manage stored scan results."""

from __future__ import annotations

import argparse
import json
import sys

from lib.common.db import ScanStore, get_store


def _require_store() -> ScanStore:
    """Return the configured store or exit if persistence is disabled."""
    store = get_store()
    if store is None:
        print("[db] store is disabled in config.toml", file=sys.stderr)
        sys.exit(1)
    return store


def cmd_list(args: argparse.Namespace) -> None:
    store = _require_store()
    with store:
        rows = store.list_scans(
            tool=args.tool,
            domain=args.domain,
            limit=args.limit,
        )
    print(json.dumps(rows, indent=2))


def cmd_show(args: argparse.Namespace) -> None:
    store = _require_store()
    with store:
        data = store.load_scan_by_id(args.scan_id)
    if data is None:
        print(f"[db] scan {args.scan_id} not found", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(data, indent=2))


def cmd_latest(args: argparse.Namespace) -> None:
    store = _require_store()
    with store:
        data = store.load_latest_scan(tool=args.tool, domain=args.domain)
    if data is None:
        msg = f"[db] no scan found for tool={args.tool}"
        if args.domain is not None:
            msg += f" domain={args.domain}"
        print(msg, file=sys.stderr)
        sys.exit(1)
    print(json.dumps(data, indent=2))


def cmd_delete(args: argparse.Namespace) -> None:
    store = _require_store()
    with store:
        found = store.delete_scan(args.scan_id)
    if found:
        print(f"[db] deleted scan {args.scan_id}", file=sys.stderr)
    else:
        print(f"[db] scan {args.scan_id} not found", file=sys.stderr)
        sys.exit(1)


def cmd_purge(args: argparse.Namespace) -> None:
    if args.tool is None and args.domain is None and not args.yes:
        print(
            "[db] purge with no filters deletes ALL scans. Pass --yes to confirm.",
            file=sys.stderr,
        )
        sys.exit(1)

    store = _require_store()
    with store:
        count = store.purge(tool=args.tool, domain=args.domain)
    print(f"[db] deleted {count} scan(s)", file=sys.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Query, inspect, and manage stored scan results.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # list
    p_list = sub.add_parser("list", help="List stored scans")
    p_list.add_argument("--tool", help="Filter by tool name (dns, ports, certs)")
    p_list.add_argument("--domain", help="Filter by domain")
    p_list.add_argument(
        "--limit", type=int, default=20, help="Max results (default: 20)"
    )
    p_list.set_defaults(func=cmd_list)

    # show
    p_show = sub.add_parser("show", help="Show full result for a scan")
    p_show.add_argument("scan_id", help="Scan ID to display")
    p_show.set_defaults(func=cmd_show)

    # latest
    p_latest = sub.add_parser("latest", help="Show the latest scan result for a tool")
    p_latest.add_argument("--tool", required=True, help="Tool name (dns, ports, certs)")
    p_latest.add_argument("--domain", help="Filter by domain")
    p_latest.set_defaults(func=cmd_latest)

    # delete
    p_delete = sub.add_parser("delete", help="Delete a single scan by ID")
    p_delete.add_argument("scan_id", help="Scan ID to delete")
    p_delete.set_defaults(func=cmd_delete)

    # purge
    p_purge = sub.add_parser(
        "purge", help="Bulk-delete scans (no filters = delete all)"
    )
    p_purge.add_argument("--tool", help="Only purge scans for this tool")
    p_purge.add_argument("--domain", help="Only purge scans for this domain")
    p_purge.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Required when purging with no filters (deletes all scans)",
    )
    p_purge.set_defaults(func=cmd_purge)

    args = parser.parse_args()
    args.func(args)
