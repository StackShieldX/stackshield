import asyncio
import json
import sys
from abc import ABC, abstractmethod

from lib.common.entities import Subdomain, SubdomainSource


class SubdomainStrategy(ABC):
    """Base interface for subdomain discovery strategies.

    Each strategy runs independently and returns a list of Subdomain objects.
    Multiple strategies are gathered in parallel and their results merged.
    """

    @abstractmethod
    async def discover(self, domain: str) -> list[Subdomain]: ...


class SubfinderStrategy(SubdomainStrategy):
    """Discovers subdomains using subfinder (passive DNS sources)."""

    SUBPROCESS_TIMEOUT = 120

    async def discover(self, domain: str) -> list[Subdomain]:
        try:
            proc = await asyncio.create_subprocess_exec(
                "subfinder",
                "-d",
                domain,
                "-json",
                "-silent",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(
                proc.communicate(),
                timeout=self.SUBPROCESS_TIMEOUT,
            )
            return self._parse(stdout.decode(errors="replace"))
        except asyncio.TimeoutError:
            print(f"[subfinder] timeout for {domain}", file=sys.stderr)
            proc.kill()
            await proc.wait()
            return []
        except Exception as e:
            print(f"[subfinder] error for {domain}: {e}", file=sys.stderr)
            return []

    def _parse(self, output: str) -> list[Subdomain]:
        # Aggregate by host — multiple lines may share the same host with different sources
        hosts: dict[str, Subdomain] = {}

        for line in output.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            host = data.get("host", "").strip().lower()
            source = data.get("source", "unknown")

            if not host:
                continue

            if host not in hosts:
                hosts[host] = Subdomain(name=host)

            subdomain_source = SubdomainSource(strategy="subfinder", source=source)
            # Avoid duplicate sources for the same host
            existing = {(s.strategy, s.source) for s in hosts[host].sources}
            if (subdomain_source.strategy, subdomain_source.source) not in existing:
                hosts[host].sources.append(subdomain_source)

        return list(hosts.values())


def _merge_subdomains(results: list[list[Subdomain]]) -> list[Subdomain]:
    """Merge results from multiple strategies, deduplicating by subdomain name."""
    merged: dict[str, Subdomain] = {}

    for strategy_results in results:
        for subdomain in strategy_results:
            name = subdomain.name.lower()
            if name not in merged:
                merged[name] = Subdomain(name=subdomain.name)
            existing_sources = {(s.strategy, s.source) for s in merged[name].sources}
            for source in subdomain.sources:
                if (source.strategy, source.source) not in existing_sources:
                    merged[name].sources.append(source)
                    existing_sources.add((source.strategy, source.source))

    return list(merged.values())


async def discover_subdomains(
    domain: str,
    strategies: list[SubdomainStrategy] | None = None,
) -> list[Subdomain]:
    """Run all strategies in parallel and return merged, deduplicated results."""
    if strategies is None:
        strategies = [SubfinderStrategy()]

    results = await asyncio.gather(*[s.discover(domain) for s in strategies])
    return _merge_subdomains(list(results))
