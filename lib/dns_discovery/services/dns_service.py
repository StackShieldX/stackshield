import asyncio
import json
import sys

from lib.common.entities import (
    ARecord,
    AAAARecord,
    CNAMERecord,
    DnsRecords,
    MXRecord,
    NSRecord,
    PTRRecord,
    SOARecord,
    TXTRecord,
)


def _parse_dnsx(output: str) -> DnsRecords:
    records = DnsRecords()

    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue

        # A records
        for ip in data.get("a", []):
            records.a.append(ARecord(ip_address=ip))

        # AAAA records
        for ip in data.get("aaaa", []):
            records.aaaa.append(AAAARecord(ipv6_address=ip))

        # CNAME records
        for cname in data.get("cname", []):
            records.cname.append(CNAMERecord(canonical_name=cname))

        # MX records — dnsx outputs strings like "10 mail.example.com." or dicts
        for mx in data.get("mx", []):
            if isinstance(mx, dict):
                records.mx.append(
                    MXRecord(
                        priority=int(mx.get("preference", 0)),
                        exchange=mx.get("host", "").rstrip("."),
                    )
                )
            elif isinstance(mx, str):
                parts = mx.strip().split(None, 1)
                if len(parts) == 2:
                    try:
                        records.mx.append(
                            MXRecord(
                                priority=int(parts[0]),
                                exchange=parts[1].rstrip("."),
                            )
                        )
                    except ValueError:
                        records.mx.append(MXRecord(priority=0, exchange=mx.rstrip(".")))
                elif len(parts) == 1:
                    records.mx.append(
                        MXRecord(priority=0, exchange=parts[0].rstrip("."))
                    )

        # NS records
        for ns in data.get("ns", []):
            records.ns.append(NSRecord(nameserver=ns))

        # TXT records — each entry is a list of strings or a single string
        for txt in data.get("txt", []):
            if isinstance(txt, list):
                records.txt.append(TXTRecord(values=txt))
            else:
                records.txt.append(TXTRecord(values=[txt]))

        # SOA record — dict or string "ns mbox serial refresh retry expire minimum"
        soa_raw = data.get("soa")
        soa_list = (
            soa_raw if isinstance(soa_raw, list) else [soa_raw] if soa_raw else []
        )
        for soa in soa_list:
            if isinstance(soa, dict):
                try:
                    records.soa.append(
                        SOARecord(
                            mname=soa.get("ns", "").rstrip("."),
                            rname=soa.get("mbox", "").rstrip("."),
                            serial=int(soa.get("serial", 0)),
                            refresh=int(soa.get("refresh", 0)),
                            retry=int(soa.get("retry", 0)),
                            expire=int(soa.get("expire", 0)),
                            minimum=int(soa.get("minttl", 0)),
                        )
                    )
                except (ValueError, TypeError):
                    pass
            elif isinstance(soa, str):
                parts = soa.strip().split()
                if len(parts) >= 7:
                    try:
                        records.soa.append(
                            SOARecord(
                                mname=parts[0].rstrip("."),
                                rname=parts[1].rstrip("."),
                                serial=int(parts[2]),
                                refresh=int(parts[3]),
                                retry=int(parts[4]),
                                expire=int(parts[5]),
                                minimum=int(parts[6]),
                            )
                        )
                    except (ValueError, IndexError):
                        pass

        # PTR records
        for ptr in data.get("ptr", []):
            records.ptr.append(PTRRecord(ptrdname=ptr))

    return records


SUBPROCESS_TIMEOUT = 30


async def get_dns_records(hostname: str) -> DnsRecords:
    try:
        proc = await asyncio.create_subprocess_exec(
            "dnsx",
            "-a",
            "-aaaa",
            "-cname",
            "-mx",
            "-ns",
            "-txt",
            "-soa",
            "-ptr",
            "-json",
            "-silent",
            "-resp",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=hostname.encode()),
            timeout=SUBPROCESS_TIMEOUT,
        )
        raw = stdout.decode(errors="replace")
        return _parse_dnsx(raw)
    except asyncio.TimeoutError:
        print(f"[dnsx] timeout for {hostname}", file=sys.stderr)
        proc.kill()
        await proc.wait()
        return DnsRecords()
    except Exception as e:
        print(f"[dnsx] error for {hostname}: {e}", file=sys.stderr)
        return DnsRecords()
