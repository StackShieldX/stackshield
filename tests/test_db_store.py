"""Tests for the persistence layer (SQLiteStore and factory)."""

import os

import pytest
from pydantic import BaseModel

from lib.common.db import DEFAULT_CONFIG, get_store, should_save
from lib.common.db.sqlite_store import SQLiteStore


class FakeResult(BaseModel):
    name: str
    values: list[int]


class PortScanResult(BaseModel):
    results: list[dict]


class DnsResult(BaseModel):
    """Minimal DNS scan result shape for testing the cross-reference lookup."""

    name: str
    subdomains: list[dict]


@pytest.fixture()
def store() -> SQLiteStore:
    s = SQLiteStore(path=":memory:")
    yield s
    s.close()


@pytest.fixture()
def config_file(tmp_path):
    """Write a default config to a temp file and return its path."""
    path = tmp_path / "config.toml"
    db_path = str(tmp_path / "test.db")
    content = DEFAULT_CONFIG.replace("/data/stackshield.db", db_path)
    path.write_text(content)
    return str(path)


class TestSQLiteStore:
    def test_save_and_load_by_id(self, store: SQLiteStore) -> None:
        result = FakeResult(name="example.com", values=[1, 2, 3])
        scan_id = store.save_scan(tool="dns", result=result, domain="example.com")

        loaded = store.load_scan_by_id(scan_id)
        assert loaded is not None
        assert loaded["name"] == "example.com"
        assert loaded["values"] == [1, 2, 3]

    def test_scan_id_is_standard_uuid(self, store: SQLiteStore) -> None:
        result = FakeResult(name="x", values=[])
        scan_id = store.save_scan(tool="dns", result=result, domain="x.com")
        # Standard UUID has 4 dashes and is 36 chars
        assert len(scan_id) == 36
        assert scan_id.count("-") == 4

    def test_load_latest_scan_by_domain(self, store: SQLiteStore) -> None:
        r1 = FakeResult(name="first", values=[1])
        r2 = FakeResult(name="second", values=[2])
        store.save_scan(tool="dns", result=r1, domain="example.com")
        store.save_scan(tool="dns", result=r2, domain="example.com")

        latest = store.load_latest_scan(tool="dns", domain="example.com")
        assert latest is not None
        assert latest["name"] == "second"

    def test_load_latest_scan_by_target(self, store: SQLiteStore) -> None:
        result = FakeResult(name="scan1", values=[80, 443])
        store.save_scan(tool="ports", result=result, targets=["10.0.0.1", "10.0.0.2"])

        latest = store.load_latest_scan(tool="ports", target="10.0.0.1")
        assert latest is not None
        assert latest["name"] == "scan1"

    def test_load_latest_scan_by_target_with_comma(self, store: SQLiteStore) -> None:
        """Targets containing commas are stored and retrieved correctly."""
        result = FakeResult(name="scan1", values=[])
        store.save_scan(
            tool="ports", result=result, targets=["host,with,commas", "clean"]
        )

        latest = store.load_latest_scan(tool="ports", target="host,with,commas")
        assert latest is not None
        assert latest["name"] == "scan1"

        # Partial match must not hit
        assert store.load_latest_scan(tool="ports", target="host") is None

    def test_load_latest_scan_by_target_no_substring_match(
        self, store: SQLiteStore
    ) -> None:
        """Searching for 10.0.0.1 must not match a scan targeting 10.0.0.10."""
        result = FakeResult(name="scan1", values=[])
        store.save_scan(tool="ports", result=result, targets=["10.0.0.10"])

        assert store.load_latest_scan(tool="ports", target="10.0.0.1") is None

    def test_load_latest_scan_rejects_domain_and_target(
        self, store: SQLiteStore
    ) -> None:
        with pytest.raises(ValueError, match="domain or target, not both"):
            store.load_latest_scan(tool="dns", domain="example.com", target="10.0.0.1")

    def test_load_latest_scan_not_found(self, store: SQLiteStore) -> None:
        assert store.load_latest_scan(tool="dns", domain="nope.com") is None

    def test_load_scan_by_id_not_found(self, store: SQLiteStore) -> None:
        assert store.load_scan_by_id("nonexistent") is None

    def test_list_scans(self, store: SQLiteStore) -> None:
        r = FakeResult(name="a", values=[])
        store.save_scan(tool="dns", result=r, domain="a.com")
        store.save_scan(tool="ports", result=r, targets=["10.0.0.1"])
        store.save_scan(tool="dns", result=r, domain="b.com")

        all_scans = store.list_scans()
        assert len(all_scans) == 3

        dns_scans = store.list_scans(tool="dns")
        assert len(dns_scans) == 2

        a_scans = store.list_scans(domain="a.com")
        assert len(a_scans) == 1

    def test_list_scans_limit(self, store: SQLiteStore) -> None:
        r = FakeResult(name="x", values=[])
        for _ in range(5):
            store.save_scan(tool="dns", result=r, domain="x.com")

        scans = store.list_scans(limit=3)
        assert len(scans) == 3

    def test_list_scans_excludes_result_json(self, store: SQLiteStore) -> None:
        r = FakeResult(name="x", values=[])
        store.save_scan(tool="dns", result=r, domain="x.com")

        scans = store.list_scans()
        assert len(scans) == 1
        assert "result_json" not in scans[0]

    def test_delete_scan(self, store: SQLiteStore) -> None:
        r = FakeResult(name="x", values=[])
        scan_id = store.save_scan(tool="dns", result=r, domain="x.com")

        assert store.delete_scan(scan_id) is True
        assert store.load_scan_by_id(scan_id) is None

    def test_delete_scan_not_found(self, store: SQLiteStore) -> None:
        assert store.delete_scan("nonexistent") is False

    def test_purge_all(self, store: SQLiteStore) -> None:
        r = FakeResult(name="x", values=[])
        store.save_scan(tool="dns", result=r, domain="a.com")
        store.save_scan(tool="ports", result=r, targets=["10.0.0.1"])

        count = store.purge()
        assert count == 2
        assert store.list_scans() == []

    def test_purge_by_tool(self, store: SQLiteStore) -> None:
        r = FakeResult(name="x", values=[])
        store.save_scan(tool="dns", result=r, domain="a.com")
        store.save_scan(tool="ports", result=r, targets=["10.0.0.1"])

        count = store.purge(tool="dns")
        assert count == 1
        remaining = store.list_scans()
        assert len(remaining) == 1
        assert remaining[0]["tool"] == "ports"

    def test_purge_by_domain(self, store: SQLiteStore) -> None:
        r = FakeResult(name="x", values=[])
        store.save_scan(tool="dns", result=r, domain="a.com")
        store.save_scan(tool="dns", result=r, domain="b.com")

        count = store.purge(domain="a.com")
        assert count == 1

    def test_context_manager(self) -> None:
        with SQLiteStore(path=":memory:") as store:
            r = FakeResult(name="x", values=[1])
            scan_id = store.save_scan(tool="dns", result=r, domain="x.com")
            assert store.load_scan_by_id(scan_id) is not None

    def test_schema_version_stored(self, store: SQLiteStore) -> None:
        row = store._conn.execute("SELECT version FROM schema_version").fetchone()
        assert row is not None
        assert row["version"] == 1

    def test_future_schema_version_raises(self, tmp_path) -> None:
        db_path = str(tmp_path / "future.db")
        # Create a DB with a future schema version
        s = SQLiteStore(path=db_path)
        s._conn.execute("UPDATE schema_version SET version = 999")
        s._conn.commit()
        s.close()

        with pytest.raises(RuntimeError, match="newer than supported"):
            SQLiteStore(path=db_path)


class TestFactory:
    def test_get_store_returns_sqlite(self, config_file: str) -> None:
        store = get_store(config_path=config_file)
        assert store is not None
        assert isinstance(store, SQLiteStore)
        store.close()

    def test_get_store_returns_none_when_disabled(self, tmp_path) -> None:
        path = tmp_path / "config.toml"
        path.write_text(
            '[store]\nenabled = false\nbackend = "sqlite"\n\n'
            '[store.sqlite]\npath = "/tmp/test.db"\n'
        )
        store = get_store(config_path=str(path))
        assert store is None

    def test_default_config_created_when_missing(self, tmp_path, monkeypatch) -> None:
        config_path = str(tmp_path / "subdir" / "config.toml")
        assert not os.path.exists(config_path)

        import lib.common.db as db_mod

        db_path = str(tmp_path / "auto.db")
        patched_config = db_mod.DEFAULT_CONFIG.replace(
            "/data/stackshield.db",
            db_path,
        )
        monkeypatch.setattr(db_mod, "DEFAULT_CONFIG", patched_config)

        store = get_store(config_path=config_path)
        assert os.path.exists(config_path)
        assert store is not None
        store.close()

    def test_get_store_accepts_preloaded_config(self, config_file: str) -> None:
        """get_store can reuse a config dict from should_save."""
        do_save, config = should_save(config_path=config_file)
        assert do_save is True

        store = get_store(_config=config)
        assert store is not None
        assert isinstance(store, SQLiteStore)
        store.close()


class TestShouldSave:
    def test_no_save_flag_wins(self, config_file: str) -> None:
        result, _ = should_save(
            save_flag=True, no_save_flag=True, config_path=config_file
        )
        assert result is False

    def test_save_flag_forces_save(self, config_file: str) -> None:
        result, config = should_save(save_flag=True, config_path=config_file)
        assert result is True
        assert "store" in config

    def test_no_save_flag_prevents_save(self, config_file: str) -> None:
        result, _ = should_save(no_save_flag=True, config_path=config_file)
        assert result is False

    def test_auto_save_default(self, config_file: str) -> None:
        result, _ = should_save(config_path=config_file)
        assert result is True

    def test_disabled_store_returns_false(self, tmp_path) -> None:
        path = tmp_path / "config.toml"
        path.write_text(
            '[store]\nenabled = false\nauto_save = true\nbackend = "sqlite"\n\n'
            '[store.sqlite]\npath = "/tmp/test.db"\n'
        )
        result, _ = should_save(config_path=str(path))
        assert result is False

    def test_auto_save_false(self, tmp_path) -> None:
        path = tmp_path / "config.toml"
        db_path = str(tmp_path / "test.db")
        path.write_text(
            f'[store]\nenabled = true\nauto_save = false\nbackend = "sqlite"\n\n'
            f'[store.sqlite]\npath = "{db_path}"\n'
        )
        result, _ = should_save(config_path=str(path))
        assert result is False


class TestLoadDbTargets:
    """Tests for _load_db_targets in the certs CLI (DNS->IP->port traversal)."""

    def _seed_dns_and_ports(self, store: SQLiteStore) -> None:
        """Seed a DNS scan and a port scan that share an IP."""
        dns_result = DnsResult(
            name="example.com",
            subdomains=[
                {
                    "name": "example.com",
                    "dns_records": {
                        "a": [{"ip_address": "10.0.0.1"}, {"ip_address": "10.0.0.2"}],
                        "aaaa": [{"ipv6_address": "::1"}],
                    },
                }
            ],
        )
        store.save_scan(tool="dns", result=dns_result, domain="example.com")

        port_scan = PortScanResult(
            results=[
                {"host": "10.0.0.1", "port": 443},
                {"host": "10.0.0.1", "port": 8443},
            ],
        )
        store.save_scan(tool="ports", result=port_scan, targets=["10.0.0.1"])

    def test_traverses_dns_to_ports(self, monkeypatch) -> None:
        store = SQLiteStore(path=":memory:")
        self._seed_dns_and_ports(store)

        import apps.certs.certs as certs_mod

        monkeypatch.setattr(certs_mod, "get_store", lambda **kw: store)

        targets = certs_mod._load_db_targets("example.com")
        assert ("10.0.0.1", 443) in targets
        assert ("10.0.0.1", 8443) in targets
        store.close()

    def test_deduplicates_across_ips(self, monkeypatch) -> None:
        """When multiple IPs resolve to the same port scan, results are deduped."""
        store = SQLiteStore(path=":memory:")
        dns_result = DnsResult(
            name="example.com",
            subdomains=[
                {
                    "name": "example.com",
                    "dns_records": {
                        "a": [{"ip_address": "10.0.0.1"}, {"ip_address": "10.0.0.2"}],
                    },
                }
            ],
        )
        store.save_scan(tool="dns", result=dns_result, domain="example.com")

        # Both IPs appear in the same port scan
        port_scan = PortScanResult(
            results=[
                {"host": "10.0.0.1", "port": 443},
                {"host": "10.0.0.2", "port": 443},
            ],
        )
        store.save_scan(
            tool="ports", result=port_scan, targets=["10.0.0.1", "10.0.0.2"]
        )

        import apps.certs.certs as certs_mod

        monkeypatch.setattr(certs_mod, "get_store", lambda **kw: store)

        targets = certs_mod._load_db_targets("example.com")
        assert len(targets) == 2
        assert ("10.0.0.1", 443) in targets
        assert ("10.0.0.2", 443) in targets
        store.close()

    def test_returns_none_when_store_disabled(self, monkeypatch) -> None:
        import apps.certs.certs as certs_mod

        monkeypatch.setattr(certs_mod, "get_store", lambda **kw: None)

        assert certs_mod._load_db_targets("example.com") is None

    def test_returns_none_when_no_dns_scan(self, monkeypatch) -> None:
        store = SQLiteStore(path=":memory:")
        import apps.certs.certs as certs_mod

        monkeypatch.setattr(certs_mod, "get_store", lambda **kw: store)

        assert certs_mod._load_db_targets("example.com") is None
        store.close()

    def test_returns_none_when_no_port_scans_for_ips(self, monkeypatch) -> None:
        store = SQLiteStore(path=":memory:")
        dns_result = DnsResult(
            name="example.com",
            subdomains=[
                {
                    "name": "example.com",
                    "dns_records": {"a": [{"ip_address": "10.0.0.99"}]},
                }
            ],
        )
        store.save_scan(tool="dns", result=dns_result, domain="example.com")

        import apps.certs.certs as certs_mod

        monkeypatch.setattr(certs_mod, "get_store", lambda **kw: store)

        assert certs_mod._load_db_targets("example.com") is None
        store.close()


class TestCLIPersistenceRoundTrip:
    """Integration tests for save/load through the store."""

    def test_save_and_retrieve_via_store(self) -> None:
        """Full round-trip: save_scan then load_latest_scan returns same data."""
        store = SQLiteStore(path=":memory:")
        result = FakeResult(name="integration", values=[42, 99])

        scan_id = store.save_scan(
            tool="dns",
            result=result,
            domain="test.com",
            targets=["10.0.0.1", "10.0.0.2"],
        )

        loaded = store.load_latest_scan(tool="dns", domain="test.com")
        assert loaded is not None
        assert loaded["name"] == "integration"
        assert loaded["values"] == [42, 99]

        by_id = store.load_scan_by_id(scan_id)
        assert by_id == loaded

        # Verify targets are queryable individually
        by_target = store.load_latest_scan(tool="dns", target="10.0.0.2")
        assert by_target is not None
        assert by_target["name"] == "integration"

        store.close()

    def test_should_save_then_get_store_round_trip(self, config_file: str) -> None:
        """should_save config can be passed to get_store without re-reading."""
        do_save, config = should_save(config_path=config_file)
        assert do_save is True

        store = get_store(_config=config)
        assert store is not None

        result = FakeResult(name="roundtrip", values=[1])
        scan_id = store.save_scan(tool="certs", result=result, domain="rt.com")

        loaded = store.load_scan_by_id(scan_id)
        assert loaded is not None
        assert loaded["name"] == "roundtrip"
        store.close()
