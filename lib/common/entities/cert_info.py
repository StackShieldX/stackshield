from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CTEntry(BaseModel):
    """A single Certificate Transparency log entry."""

    domain: str
    issuer_name: str
    not_before: datetime
    not_after: datetime
    san_names: list[str] = Field(default_factory=list)


class TLSCertInfo(BaseModel):
    """Live TLS certificate details retrieved from a host."""

    host: str
    port: int
    subject: str
    issuer: str
    serial_number: str
    san_names: list[str] = Field(default_factory=list)
    key_type: str
    key_size: int
    not_before: datetime
    not_after: datetime
    chain_depth: int
    is_self_signed: bool
    is_expired: bool
    hostname_mismatch: bool


class CertsResult(BaseModel):
    """Top-level output model combining CT log entries and TLS results."""

    domain: str
    mode: str
    ct_entries: list[CTEntry] = Field(default_factory=list)
    tls_results: list[TLSCertInfo] = Field(default_factory=list)
