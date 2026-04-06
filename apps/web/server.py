#!/usr/bin/env python3
"""FastAPI backend for the StackShield web UI."""

from __future__ import annotations

import os
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="StackShield", version="0.1.0")

# CORS: allow Vite dev server and production origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    """Return a simple health status."""
    return {"status": "ok"}


# Serve the frontend build from web/dist/ when it exists.
# Resolve relative to this file (apps/web/).
_dist_dir = os.path.join(os.path.dirname(__file__), "dist")
if os.path.isdir(_dist_dir):
    app.mount("/", StaticFiles(directory=_dist_dir, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    print("[web] starting server on port 8080", file=sys.stderr)
    uvicorn.run(app, host="0.0.0.0", port=8080)