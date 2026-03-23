from typing import Optional

from pydantic import BaseModel


class ASNInfo(BaseModel):
    asn: Optional[str] = None
    organization: Optional[str] = None
    country: Optional[str] = None
    network_range: Optional[str] = None


class ARecord(BaseModel):
    ip_address: str
    asn_info: Optional[ASNInfo] = None


class AAAARecord(BaseModel):
    ipv6_address: str
    asn_info: Optional[ASNInfo] = None


class CNAMERecord(BaseModel):
    canonical_name: str


class MXRecord(BaseModel):
    priority: int
    exchange: str


class NSRecord(BaseModel):
    nameserver: str


class TXTRecord(BaseModel):
    values: list[str]


class SOARecord(BaseModel):
    mname: str
    rname: str
    serial: int
    refresh: int
    retry: int
    expire: int
    minimum: int


class PTRRecord(BaseModel):
    ptrdname: str
