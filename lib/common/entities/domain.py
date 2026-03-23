from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from .whois_info import WhoisInfo
from .subdomain import Subdomain


class Domain(BaseModel):
    name: str
    whois_info: Optional[WhoisInfo] = None
    subdomains: list[Subdomain] = Field(default_factory=list)
