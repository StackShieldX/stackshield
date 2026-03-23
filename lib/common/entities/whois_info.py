from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class WhoisInfo(BaseModel):
    registrar: Optional[str] = None
    registrant: Optional[str] = None
    creation_date: Optional[datetime] = None
    expiration_date: Optional[datetime] = None
    updated_date: Optional[datetime] = None
    name_servers: list[str] = []
    status: list[str] = []
    emails: list[str] = []
    org: Optional[str] = None
    country: Optional[str] = None
    raw: Optional[str] = None
