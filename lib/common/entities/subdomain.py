from pydantic import BaseModel, Field

from .dns_records import (
    ARecord,
    AAAARecord,
    CNAMERecord,
    MXRecord,
    NSRecord,
    TXTRecord,
    SOARecord,
    PTRRecord,
)


class SubdomainSource(BaseModel):
    strategy: str  # e.g. "subfinder"
    source: str  # e.g. "certsh", "virustotal"


class DnsRecords(BaseModel):
    a: list[ARecord] = Field(default_factory=list)
    aaaa: list[AAAARecord] = Field(default_factory=list)
    cname: list[CNAMERecord] = Field(default_factory=list)
    mx: list[MXRecord] = Field(default_factory=list)
    ns: list[NSRecord] = Field(default_factory=list)
    txt: list[TXTRecord] = Field(default_factory=list)
    soa: list[SOARecord] = Field(default_factory=list)
    ptr: list[PTRRecord] = Field(default_factory=list)


class Subdomain(BaseModel):
    name: str
    sources: list[SubdomainSource] = Field(default_factory=list)
    dns_records: DnsRecords = Field(default_factory=DnsRecords)
