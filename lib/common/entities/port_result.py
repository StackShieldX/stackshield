from pydantic import BaseModel, Field


class PortEntry(BaseModel):
    host: str
    ip: str
    port: int
    protocol: str = "tcp"


class PortScanResult(BaseModel):
    targets: list[str] = Field(default_factory=list)
    scan_type: str = "SYN"
    ports_scanned: str = ""
    results: list[PortEntry] = Field(default_factory=list)
