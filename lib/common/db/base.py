"""Abstract interface for scan result persistence."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing_extensions import Self

from pydantic import BaseModel


class ScanStore(ABC):
    """Backend-agnostic interface for storing and retrieving scan results.

    Implementations must be synchronous — DB operations happen outside the
    async event loop (after asyncio.run() for saves, before it for loads).

    Supports use as a context manager for automatic resource cleanup.

    Subclasses must override the abstract methods. For ``load_latest_scan``,
    override ``_load_latest_scan`` — the public method validates arguments
    and delegates to the private one.
    """

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:  # noqa: ANN001
        self.close()

    @abstractmethod
    def save_scan(
        self,
        tool: str,
        result: BaseModel,
        domain: str | None = None,
        targets: list[str] | None = None,
        started_at: datetime | None = None,
    ) -> str:
        """Persist a scan result. Returns the generated scan ID."""
        ...

    def load_latest_scan(
        self,
        tool: str,
        domain: str | None = None,
        target: str | None = None,
    ) -> dict | None:
        """Load the most recent scan result for a tool+domain/target.

        Pass domain OR target, not both. Raises ValueError if both are given.
        Returns the parsed result dict, or None if no match.
        """
        if domain is not None and target is not None:
            raise ValueError("load_latest_scan() accepts domain or target, not both")
        return self._load_latest_scan(tool, domain=domain, target=target)

    @abstractmethod
    def _load_latest_scan(
        self,
        tool: str,
        domain: str | None = None,
        target: str | None = None,
    ) -> dict | None:
        """Backend implementation for load_latest_scan."""
        ...

    @abstractmethod
    def load_scan_by_id(self, scan_id: str) -> dict | None:
        """Load a specific scan by ID. Returns parsed result dict or None."""
        ...

    @abstractmethod
    def list_scans(
        self,
        tool: str | None = None,
        domain: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """List scan metadata (no result_json) with optional filters."""
        ...

    @abstractmethod
    def delete_scan(self, scan_id: str) -> bool:
        """Delete a single scan by ID. Returns True if it existed."""
        ...

    @abstractmethod
    def purge(
        self,
        tool: str | None = None,
        domain: str | None = None,
    ) -> int:
        """Bulk-delete scans. No filters = delete all. Returns count deleted."""
        ...

    @abstractmethod
    def list_targets(self, q: str | None = None) -> list[dict]:
        """Return aggregated target info across all scans.

        Each entry contains: domain, scan_count, tools (list of tool names),
        and last_scanned_at.  When *q* is given, only domains containing that
        substring (case-insensitive) are returned.
        """
        ...

    @abstractmethod
    def load_scans_by_domain(
        self,
        domain: str,
        tool: str | None = None,
    ) -> list[dict]:
        """Return all scans for *domain*, ordered by started_at descending.

        Each row includes the full result_json.  When *tool* is given, only
        scans from that tool are returned.
        """
        ...

    @abstractmethod
    def close(self) -> None:
        """Release any resources held by the store."""
        ...
