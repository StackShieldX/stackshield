#!/usr/bin/env python3
"""DNS Discovery CLI — discover subdomains, WHOIS info, and DNS records for a domain."""

import argparse
import asyncio
import json
import sys

from lib.common.entities import Domain, Subdomain, SubdomainSource
from lib.dns_discovery.services.asn_service import get_asn_info
from lib.dns_discovery.services.dns_service import get_dns_records
from lib.dns_discovery.services.subdomain_service import discover_subdomains
from lib.dns_discovery.services.whois_service import get_whois_info

# Cap concurrent processes to avoid resource exhaustion
DNS_CONCURRENCY = 20
ASN_CONCURRENCY = 30


async def main(domain: str) -> None:
    domain = domain.strip().lower()

    # Phase 1: run whois and subfinder in parallel
    whois_result, discovered_subdomains = await asyncio.gather(
        get_whois_info(domain),
        discover_subdomains(domain),
    )

    # Phase 2: merge — root domain first, then discovered subdomains.
    # If subfinder also returned the root domain, merge its sources in.
    subdomains_by_name: dict[str, Subdomain] = {domain: Subdomain(name=domain)}
    for sub in discovered_subdomains:
        name = sub.name.lower()
        if name not in subdomains_by_name:
            subdomains_by_name[name] = sub
        else:
            # Merge sources from subfinder into the existing entry
            existing = {(s.strategy, s.source) for s in subdomains_by_name[name].sources}
            for src in sub.sources:
                if (src.strategy, src.source) not in existing:
                    subdomains_by_name[name].sources.append(src)
                    existing.add((src.strategy, src.source))

    all_subdomains = list(subdomains_by_name.values())

    # Phase 3: resolve DNS records for all subdomains (bounded concurrency)
    dns_sem = asyncio.Semaphore(DNS_CONCURRENCY)

    async def bounded_dns(subdomain: Subdomain) -> None:
        async with dns_sem:
            subdomain.dns_records = await get_dns_records(subdomain.name)

    await asyncio.gather(*[bounded_dns(sub) for sub in all_subdomains])

    # Phase 4: ASN lookup for unique IPs in A and AAAA records (bounded concurrency)
    asn_sem = asyncio.Semaphore(ASN_CONCURRENCY)

    async def bounded_asn(ip: str):
        async with asn_sem:
            return await get_asn_info(ip)

    ip_to_records: dict[str, list] = {}
    for sub in all_subdomains:
        for record in sub.dns_records.a:
            ip_to_records.setdefault(record.ip_address, []).append(record)
        for record in sub.dns_records.aaaa:
            ip_to_records.setdefault(record.ipv6_address, []).append(record)

    if ip_to_records:
        unique_ips = list(ip_to_records.keys())
        results = await asyncio.gather(*[bounded_asn(ip) for ip in unique_ips])
        for ip, asn_info in zip(unique_ips, results):
            for record in ip_to_records[ip]:
                record.asn_info = asn_info

    # Phase 5: assemble and emit
    result = Domain(
        name=domain,
        whois_info=whois_result,
        subdomains=all_subdomains,
    )

    print(json.dumps(result.model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Discover subdomains, WHOIS info, and DNS records for a target domain.",
    )
    parser.add_argument(
        "-d", "--domain",
        required=True,
        help="Target domain (e.g. example.com)",
    )
    args = parser.parse_args()

    try:
        asyncio.run(main(args.domain))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(1)
