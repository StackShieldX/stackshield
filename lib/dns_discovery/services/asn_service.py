import asyncio
import re
import sys

from lib.common.entities import ASNInfo

# Patterns covering ARIN, RIPE, APNIC, LACNIC, AFRINIC formats
_ASN_PATTERNS = [
    re.compile(r"^OriginAS:\s*(AS\d+)", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^origin:\s*(AS\d+)", re.IGNORECASE | re.MULTILINE),
]
_ORG_PATTERNS = [
    re.compile(r"^OrgName:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^org-name:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^descr:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^netname:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
]
_COUNTRY_PATTERNS = [
    re.compile(r"^Country:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^country:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
]
_CIDR_PATTERNS = [
    re.compile(r"^CIDR:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^inetnum:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^route:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^inet6num:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^route6:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
]


def _first_match(patterns: list[re.Pattern], text: str) -> str | None:
    for pat in patterns:
        m = pat.search(text)
        if m:
            return m.group(1).strip() or None
    return None


def _parse_asn_whois(raw: str) -> ASNInfo:
    return ASNInfo(
        asn=_first_match(_ASN_PATTERNS, raw),
        organization=_first_match(_ORG_PATTERNS, raw),
        country=_first_match(_COUNTRY_PATTERNS, raw),
        network_range=_first_match(_CIDR_PATTERNS, raw),
    )


SUBPROCESS_TIMEOUT = 30


async def get_asn_info(ip: str) -> ASNInfo:
    try:
        proc = await asyncio.create_subprocess_exec(
            "whois",
            ip,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(
            proc.communicate(),
            timeout=SUBPROCESS_TIMEOUT,
        )
        return _parse_asn_whois(stdout.decode(errors="replace"))
    except asyncio.TimeoutError:
        print(f"[whois/asn] timeout for {ip}", file=sys.stderr)
        proc.kill()
        await proc.wait()
        return ASNInfo()
    except Exception as e:
        print(f"[whois/asn] error for {ip}: {e}", file=sys.stderr)
        return ASNInfo()
