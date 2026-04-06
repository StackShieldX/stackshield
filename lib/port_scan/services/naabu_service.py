import asyncio
import json
import sys

from lib.common.entities import PortEntry

DEFAULT_TIMEOUT = 120
FULL_SCAN_TIMEOUT = 900


def _parse_naabu(output: str) -> list[PortEntry]:
    entries: list[PortEntry] = []
    seen: set[tuple[str, int]] = set()

    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue

        if not isinstance(data, dict):
            continue

        host = data.get("host", "")
        ip = data.get("ip", "")
        port = data.get("port")

        if not ip or port is None:
            continue

        try:
            port_int = int(port)
        except (ValueError, TypeError):
            continue

        key = (ip, port_int)
        if key in seen:
            continue
        seen.add(key)

        entries.append(
            PortEntry(
                host=host or ip,
                ip=ip,
                port=port_int,
            )
        )

    return entries


def _is_large_scan(ports: str) -> bool:
    """Check if the port spec covers a large range (> 10000 ports)."""
    if not ports:
        return False
    count = 0
    for part in ports.split(","):
        part = part.strip()
        if "-" in part:
            bounds = part.split("-", 1)
            try:
                count += int(bounds[1]) - int(bounds[0]) + 1
            except (ValueError, IndexError):
                continue
        elif part:
            count += 1
    return count > 10000


async def scan_ports(
    targets: list[str],
    ports: str = "",
    scan_type: str = "s",
) -> list[PortEntry]:
    """Scan targets for open ports using naabu.

    Args:
        targets: List of IPs or hostnames to scan.
        ports: Port specification (e.g. "80,443" or "1-1000"). Empty uses naabu default (top 100).
        scan_type: Scan method — "s" for SYN (default), "c" for CONNECT.

    Returns:
        List of PortEntry for each open port found.
    """
    cmd: list[str] = ["naabu", "-json", "-stats", "-stats-interval", "5"]

    if ports:
        cmd.extend(["-p", ports])

    if scan_type and scan_type != "s":
        cmd.extend(["-s", scan_type])

    timeout = FULL_SCAN_TIMEOUT if _is_large_scan(ports) else DEFAULT_TIMEOUT

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=None,
        )
        target_input = "\n".join(targets).encode()
        stdout, _ = await asyncio.wait_for(
            proc.communicate(input=target_input),
            timeout=timeout,
        )
        return _parse_naabu(stdout.decode(errors="replace"))
    except asyncio.TimeoutError:
        print(f"[naabu] timeout scanning {len(targets)} target(s)", file=sys.stderr)
        proc.kill()
        await proc.wait()
        return []
    except Exception as e:
        print(f"[naabu] error: {e}", file=sys.stderr)
        return []
