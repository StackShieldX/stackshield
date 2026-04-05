"""Scan persistence — factory, config, and public helpers."""

from __future__ import annotations

import importlib
import os
import sys

from lib.common.db.base import ScanStore

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore[no-redef]

CONFIG_PATH = os.environ.get("SSX_CONFIG", "/data/config.toml")

DEFAULT_CONFIG = """\
[store]
# Set to false to disable persistence entirely.
# When disabled, --save/--no-save and --from-db flags are ignored.
# Tools will only output to stdout (original behavior).
enabled = true

# When true, tools automatically save results after every run.
# Use --no-save on a specific command to skip saving for that run.
# When false, results are not saved unless you pass --save explicitly.
auto_save = true

backend = "sqlite"

[store.sqlite]
path = "/data/stackshield.db"

# Example for future backends:
# [store.neo4j]
# uri = "bolt://localhost:7687"
# user = "neo4j"
# password = ""
"""

_BACKENDS = {
    "sqlite": "lib.common.db.sqlite_store.SQLiteStore",
}


def _read_config(config_path: str = CONFIG_PATH) -> dict:
    """Read the TOML config file, creating a default if it doesn't exist."""
    if not os.path.exists(config_path):
        os.makedirs(os.path.dirname(config_path) or ".", exist_ok=True)
        with open(config_path, "w") as f:
            f.write(DEFAULT_CONFIG)
        print(f"[db] created default config at {config_path}", file=sys.stderr)

    with open(config_path, "rb") as f:
        return tomllib.load(f)


def get_store(
    config_path: str = CONFIG_PATH,
    _config: dict | None = None,
) -> ScanStore | None:
    """Read config and return the configured ScanStore, or None if disabled.

    Pass _config to reuse an already-parsed config dict (avoids re-reading
    the TOML file when called right after should_save).
    """
    config = _config if _config is not None else _read_config(config_path)
    store_config = config.get("store", {})

    if not store_config.get("enabled", True):
        return None

    backend = store_config.get("backend", "sqlite")
    backend_class_path = _BACKENDS.get(backend)
    if backend_class_path is None:
        print(
            f"[db] unknown store backend: {backend!r}. "
            f"Available: {', '.join(_BACKENDS)}",
            file=sys.stderr,
        )
        sys.exit(1)

    module_path, class_name = backend_class_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    store_class = getattr(module, class_name)

    backend_opts = store_config.get(backend, {})

    # Ensure parent directory exists for file-based backends
    if "path" in backend_opts:
        os.makedirs(os.path.dirname(backend_opts["path"]) or ".", exist_ok=True)

    return store_class(**backend_opts)


def should_save(
    save_flag: bool = False,
    no_save_flag: bool = False,
    config_path: str = CONFIG_PATH,
) -> tuple[bool, dict]:
    """Resolve whether a scan result should be persisted.

    Priority: no_save flag > save flag > config auto_save.
    Returns (should_save, parsed_config) so the caller can pass the config
    to get_store() without re-reading the file.
    """
    if no_save_flag:
        # Config is not read; callers must check the boolean before using it.
        return False, {}

    config = _read_config(config_path)

    if save_flag:
        return True, config

    store_config = config.get("store", {})

    if not store_config.get("enabled", True):
        return False, config

    return bool(store_config.get("auto_save", True)), config


__all__ = [
    "ScanStore",
    "get_store",
    "should_save",
    "CONFIG_PATH",
    "DEFAULT_CONFIG",
]
