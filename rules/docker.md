# Docker Standards

## Base Image

All StackShield tool images use `kalilinux/kali-rolling` as the base. Kali provides the security tooling ecosystem and a rolling Debian base that keeps tools up to date.

## Layer Discipline

- Combine all `apt-get` installs into a single `RUN` layer and clean the package cache in the same layer:
  ```dockerfile
  RUN apt-get update && apt-get install -y --no-install-recommends \
      <package1> \
      <package2> \
      && rm -rf /var/lib/apt/lists/*
  ```
- Always use `--no-install-recommends` to keep image size down.

## Binary Tools (subfinder, dnsx, etc.)

- Install binaries from GitHub releases when not available in apt, or when a specific version must be pinned.
- Pin to a specific release version (e.g. `v2.6.6`) for reproducible builds.
- Download, extract, chmod, and clean up the archive in a single `RUN` layer.
- Install binaries to `/usr/local/bin/`.

## Python / uv

- Install `uv` via pip: `pip3 install uv --break-system-packages`
- Copy `pyproject.toml` before source code so the dependency layer is cached independently.
- Run `uv sync --frozen` to install dependencies into `/app/.venv`.
- Add the venv to PATH: `ENV PATH="/app/.venv/bin:$PATH"` so `python` resolves without `uv run`.

## Working Directory

`WORKDIR /app` — all source code is copied here. Python imports resolve from `/app` as the root.

## Runtime

- `ssx.sh` always passes `--rm` — containers are ephemeral.
- No `ENTRYPOINT` or `CMD` — the full invocation is provided by `ssx.sh`.
- Do not run as root unless a specific tool requires it. Document any exception.

## Rebuilding

After changing `pyproject.toml` or Dockerfile: `docker build -t stackshield .`

Code-only changes reuse the cached dependency layer automatically.
