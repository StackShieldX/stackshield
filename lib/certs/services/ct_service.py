"""Certificate Transparency log discovery via crt.sh."""

from __future__ import annotations

import asyncio
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime

from lib.common.entities import CTEntry

_CRT_SH_URL = "https://crt.sh/?q=%25.{domain}&output=json"

_DEFAULT_TIMEOUT = 30


def _parse_datetime(value: str) -> datetime:
    """Parse a datetime string from the crt.sh response.

    crt.sh returns timestamps in several formats:
      - "2024-01-15T12:00:00"
      - "2024-01-15T12:00:00.000"
      - "2024-01-15T12:00:00.000000"
    We try ISO 8601 first, then fall back to common patterns.
    """
    value = value.strip()
    for fmt in (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    # Last resort: let datetime.fromisoformat handle it (Python 3.11+)
    return datetime.fromisoformat(value)


def _fetch_ct_json(domain: str, timeout: int) -> list[dict]:
    """Blocking HTTP GET to crt.sh. Meant to be run in an executor."""
    url = _CRT_SH_URL.format(domain=domain)
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "StackShield/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode(errors="replace")
        return json.loads(body)
    except urllib.error.HTTPError as exc:
        print(
            f"[ct_service] HTTP {exc.code} from crt.sh for {domain}",
            file=sys.stderr,
        )
        return []
    except urllib.error.URLError as exc:
        print(
            f"[ct_service] URL error querying crt.sh for {domain}: {exc.reason}",
            file=sys.stderr,
        )
        return []
    except json.JSONDecodeError as exc:
        print(
            f"[ct_service] invalid JSON from crt.sh for {domain}: {exc}",
            file=sys.stderr,
        )
        return []
    except TimeoutError:
        print(
            f"[ct_service] timeout querying crt.sh for {domain}",
            file=sys.stderr,
        )
        return []
    except Exception as exc:
        print(
            f"[ct_service] unexpected error for {domain}: {exc}",
            file=sys.stderr,
        )
        return []


async def discover_ct_entries(
    domain: str,
    timeout: int = _DEFAULT_TIMEOUT,
) -> list[CTEntry]:
    """Query crt.sh for Certificate Transparency log entries.

    Returns a deduplicated list of CTEntry models. On any network or
    parsing error the function logs to stderr and returns an empty list.
    """
    loop = asyncio.get_running_loop()
    try:
        raw_entries: list[dict] = await loop.run_in_executor(
            None, _fetch_ct_json, domain, timeout
        )
    except Exception as exc:
        print(
            f"[ct_service] executor error for {domain}: {exc}",
            file=sys.stderr,
        )
        return []

    if not raw_entries:
        return []

    # Deduplicate by (serial_number, issuer_name)
    seen: set[tuple[str, str]] = set()
    entries: list[CTEntry] = []

    for raw in raw_entries:
        try:
            serial = str(raw.get("serial_number", "")).strip().lower()
            issuer = str(raw.get("issuer_name", "")).strip()
            dedup_key = (serial, issuer)

            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            # Parse SAN names from the newline-separated name_value field
            name_value = str(raw.get("name_value", ""))
            san_names = sorted(
                {
                    name.strip().lower()
                    for name in name_value.split("\n")
                    if name.strip()
                }
            )

            common_name = str(raw.get("common_name", "")).strip()
            not_before_raw = str(raw.get("not_before", ""))
            not_after_raw = str(raw.get("not_after", ""))

            if not common_name or not not_before_raw or not not_after_raw:
                continue

            entry = CTEntry(
                domain=common_name,
                issuer_name=issuer,
                not_before=_parse_datetime(not_before_raw),
                not_after=_parse_datetime(not_after_raw),
                san_names=san_names,
            )
            entries.append(entry)
        except Exception as exc:
            print(
                f"[ct_service] skipping malformed entry: {exc}",
                file=sys.stderr,
            )
            continue

    return entries


def extract_subdomains(entries: list[CTEntry]) -> list[str]:
    """Extract unique subdomain names from all SAN fields across entries.

    Returns a sorted list of unique lowercase subdomain/SAN values.
    """
    subdomains: set[str] = set()
    for entry in entries:
        for name in entry.san_names:
            cleaned = name.strip().lower()
            if cleaned:
                subdomains.add(cleaned)
    return sorted(subdomains)
