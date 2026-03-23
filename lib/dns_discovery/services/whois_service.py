import asyncio
import re
import sys
from typing import Optional

from dateutil import parser as dateutil_parser

from lib.common.entities import WhoisInfo


def _parse_date(value: str) -> Optional[object]:
    try:
        return dateutil_parser.parse(value.strip())
    except Exception:
        return None


def _parse_whois(raw: str) -> WhoisInfo:
    registrar: Optional[str] = None
    registrant: Optional[str] = None
    creation_date = None
    expiration_date = None
    updated_date = None
    name_servers: list[str] = []
    status: list[str] = []
    org: Optional[str] = None
    country: Optional[str] = None

    for line in raw.splitlines():
        stripped = line.strip()
        lower = stripped.lower()

        if lower.startswith("registrar:") and registrar is None:
            registrar = stripped.split(":", 1)[1].strip() or None

        elif lower.startswith("registrant name:") and registrant is None:
            registrant = stripped.split(":", 1)[1].strip() or None

        elif lower.startswith("registrant:") and registrant is None:
            value = stripped.split(":", 1)[1].strip()
            if value:
                registrant = value

        elif lower.startswith("creation date:") and creation_date is None:
            creation_date = _parse_date(stripped.split(":", 1)[1])

        elif lower.startswith("created:") and creation_date is None:
            creation_date = _parse_date(stripped.split(":", 1)[1])

        elif (lower.startswith("registry expiry date:") or lower.startswith("expiry date:") or lower.startswith("expiration date:")) and expiration_date is None:
            creation_date_str = stripped.split(":", 1)[1]
            expiration_date = _parse_date(creation_date_str)

        elif lower.startswith("updated date:") and updated_date is None:
            updated_date = _parse_date(stripped.split(":", 1)[1])

        elif lower.startswith("name server:"):
            ns = stripped.split(":", 1)[1].strip().lower()
            if ns and ns not in name_servers:
                name_servers.append(ns)

        elif lower.startswith("domain status:"):
            st = stripped.split(":", 1)[1].strip()
            # strip URL part if present (e.g., "clientTransferProhibited https://...")
            st = st.split(" ")[0]
            if st and st not in status:
                status.append(st)

        elif lower.startswith("registrant organization:") and org is None:
            org = stripped.split(":", 1)[1].strip() or None

        elif lower.startswith("registrant country:") and country is None:
            country = stripped.split(":", 1)[1].strip() or None

    emails = list(set(re.findall(r"[\w.+\-]+@[\w\-]+\.[a-zA-Z]{2,}", raw)))

    return WhoisInfo(
        registrar=registrar,
        registrant=registrant,
        creation_date=creation_date,
        expiration_date=expiration_date,
        updated_date=updated_date,
        name_servers=name_servers,
        status=status,
        emails=emails,
        org=org,
        country=country,
        raw=raw,
    )


async def get_whois_info(domain: str) -> WhoisInfo:
    try:
        proc = await asyncio.create_subprocess_exec(
            "whois", domain,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        raw = stdout.decode(errors="replace")
        return _parse_whois(raw)
    except Exception as e:
        print(f"[whois] error for {domain}: {e}", file=sys.stderr)
        return WhoisInfo()
