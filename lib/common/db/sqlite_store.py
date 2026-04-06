"""SQLite implementation of the ScanStore interface."""

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from pydantic import BaseModel

from lib.common.db.base import ScanStore

SCHEMA_VERSION = 1

_SCHEMA_SQL = """\
CREATE TABLE IF NOT EXISTS schema_version (
    id      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
    id          TEXT PRIMARY KEY,
    tool        TEXT NOT NULL,
    domain      TEXT,
    targets     TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL DEFAULT 'complete',
    result_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scans_tool_domain ON scans(tool, domain);
CREATE INDEX IF NOT EXISTS idx_scans_started_at ON scans(started_at);
CREATE INDEX IF NOT EXISTS idx_scans_domain ON scans(domain);
"""


class SQLiteStore(ScanStore):
    """Store scan results in a local SQLite database."""

    def __init__(self, path: str = "/data/stackshield.db", **_kwargs: str) -> None:
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        # PRAGMAs must be set before executescript (which issues implicit COMMITs).
        # journal_mode returns the active mode; we intentionally discard it since
        # WAL is always preferred and there is no fallback.
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA_SQL)

        row = self._conn.execute(
            "SELECT version FROM schema_version LIMIT 1"
        ).fetchone()
        if row is None:
            self._conn.execute(
                "INSERT INTO schema_version (version) VALUES (?)",
                (SCHEMA_VERSION,),
            )
            self._conn.commit()
        else:
            stored = row["version"]
            if stored < SCHEMA_VERSION:
                self._migrate(stored)
            elif stored > SCHEMA_VERSION:
                raise RuntimeError(
                    f"Database schema version {stored} is newer than "
                    f"supported version {SCHEMA_VERSION}. "
                    f"Upgrade stackshield to use this database."
                )

    def _migrate(self, from_version: int) -> None:
        """Apply sequential migrations from from_version to SCHEMA_VERSION."""
        # Future migrations go here:
        # if from_version < 2:
        #     self._conn.execute("ALTER TABLE ...")
        #     from_version = 2
        if from_version != SCHEMA_VERSION:
            raise RuntimeError(
                f"Migration from schema v{from_version} to "
                f"v{SCHEMA_VERSION} not yet implemented"
            )
        self._conn.execute("UPDATE schema_version SET version = ?", (SCHEMA_VERSION,))
        self._conn.commit()

    def save_scan(
        self,
        tool: str,
        result: BaseModel,
        domain: str | None = None,
        targets: list[str] | None = None,
        started_at: datetime | None = None,
    ) -> str:
        scan_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            """INSERT INTO scans
               (id, tool, domain, targets, started_at, finished_at, status, result_json)
               VALUES (?, ?, ?, ?, ?, ?, 'complete', ?)""",
            (
                scan_id,
                tool,
                domain,
                json.dumps(targets) if targets is not None else None,
                started_at.isoformat() if started_at else now,
                now,
                result.model_dump_json(),
            ),
        )
        self._conn.commit()
        return scan_id

    def _load_latest_scan(
        self,
        tool: str,
        domain: str | None = None,
        target: str | None = None,
    ) -> dict | None:
        if domain is not None:
            row = self._conn.execute(
                """SELECT result_json FROM scans
                   WHERE tool = ? AND domain = ?
                   ORDER BY started_at DESC LIMIT 1""",
                (tool, domain),
            ).fetchone()
        elif target is not None:
            # NULL targets produce no rows from json_each, so they
            # correctly never match any target query.
            row = self._conn.execute(
                """SELECT result_json FROM scans
                   WHERE tool = ? AND EXISTS (
                       SELECT 1 FROM json_each(targets) WHERE value = ?
                   )
                   ORDER BY started_at DESC LIMIT 1""",
                (tool, target),
            ).fetchone()
        else:
            row = self._conn.execute(
                """SELECT result_json FROM scans
                   WHERE tool = ?
                   ORDER BY started_at DESC LIMIT 1""",
                (tool,),
            ).fetchone()

        if row is None:
            return None
        return json.loads(row["result_json"])

    def load_scan_by_id(self, scan_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT result_json FROM scans WHERE id = ?",
            (scan_id,),
        ).fetchone()
        if row is None:
            return None
        return json.loads(row["result_json"])

    def list_scans(
        self,
        tool: str | None = None,
        domain: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        clauses: list[str] = []
        params: list[str | int] = []

        if tool is not None:
            clauses.append("tool = ?")
            params.append(tool)
        if domain is not None:
            clauses.append("domain = ?")
            params.append(domain)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)

        rows = self._conn.execute(
            f"SELECT id, tool, domain, targets, started_at, finished_at, status "
            f"FROM scans {where} ORDER BY started_at DESC LIMIT ?",
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def delete_scan(self, scan_id: str) -> bool:
        cursor = self._conn.execute("DELETE FROM scans WHERE id = ?", (scan_id,))
        self._conn.commit()
        return cursor.rowcount > 0

    def purge(
        self,
        tool: str | None = None,
        domain: str | None = None,
    ) -> int:
        clauses: list[str] = []
        params: list[str] = []

        if tool is not None:
            clauses.append("tool = ?")
            params.append(tool)
        if domain is not None:
            clauses.append("domain = ?")
            params.append(domain)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        cursor = self._conn.execute(f"DELETE FROM scans {where}", params)
        self._conn.commit()
        return cursor.rowcount

    def list_targets(self, q: str | None = None) -> list[dict]:
        where = "WHERE domain IS NOT NULL"
        params: list[str] = []
        if q is not None:
            where += " AND domain LIKE ?"
            params.append(f"%{q}%")

        rows = self._conn.execute(
            f"""SELECT domain,
                       COUNT(*)              AS scan_count,
                       GROUP_CONCAT(DISTINCT tool) AS tools_csv,
                       MAX(started_at)        AS last_scanned_at
                FROM scans
                {where}
                GROUP BY domain
                ORDER BY last_scanned_at DESC""",
            params,
        ).fetchall()

        return [
            {
                "domain": row["domain"],
                "scan_count": row["scan_count"],
                "tools": row["tools_csv"].split(",") if row["tools_csv"] else [],
                "last_scanned_at": row["last_scanned_at"],
            }
            for row in rows
        ]

    def load_scans_by_domain(
        self,
        domain: str,
        tool: str | None = None,
    ) -> list[dict]:
        clauses = ["domain = ?"]
        params: list[str] = [domain]

        if tool is not None:
            clauses.append("tool = ?")
            params.append(tool)

        where = "WHERE " + " AND ".join(clauses)

        rows = self._conn.execute(
            f"""SELECT id, tool, domain, targets, started_at, finished_at,
                       status, result_json
                FROM scans
                {where}
                ORDER BY started_at DESC""",
            params,
        ).fetchall()

        results: list[dict] = []
        for row in rows:
            entry = dict(row)
            # Parse result_json from string to dict for the response
            raw = entry.pop("result_json", None)
            entry["result_json"] = json.loads(raw) if raw else None
            results.append(entry)

        return results

    def close(self) -> None:
        self._conn.close()
