from __future__ import annotations

import asyncio
import fnmatch
import hashlib
import ssl
import struct
import sys
from datetime import datetime, timezone

from lib.common.entities import TLSCertInfo

# Default timeout for TLS connections (seconds).
CONNECTION_TIMEOUT = 10

# Sentinel datetime used when certificate dates cannot be determined.
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# ASN.1 DER helpers (minimal, stdlib-only)
# ---------------------------------------------------------------------------
# We need to extract key_type and key_size from the DER-encoded certificate
# because the dict returned by getpeercert() does not include that info.
# A full ASN.1 parser is overkill; we only need to walk into the
# SubjectPublicKeyInfo structure and read the algorithm OID and bit-string
# length.

_OID_RSA = "1.2.840.113549.1.1.1"
_OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1"
_OID_ED25519 = "1.3.101.112"
_OID_ED448 = "1.3.101.113"
_OID_DSA = "1.2.840.10040.4.1"

_OID_TO_KEY_TYPE: dict[str, str] = {
    _OID_RSA: "RSA",
    _OID_EC_PUBLIC_KEY: "EC",
    _OID_ED25519: "Ed25519",
    _OID_ED448: "Ed448",
    _OID_DSA: "DSA",
}


def _read_der_tag_length(data: bytes, offset: int) -> tuple[int, int, int]:
    """Read an ASN.1 DER tag and length at *offset*.

    Returns (tag, content_length, offset_after_header).
    """
    if offset >= len(data):
        raise ValueError("DER: unexpected end of data at tag")
    tag = data[offset]
    offset += 1
    if offset >= len(data):
        raise ValueError("DER: unexpected end of data at length")
    first = data[offset]
    offset += 1
    if first < 0x80:
        length = first
    elif first == 0x80:
        raise ValueError("DER: indefinite length not supported")
    else:
        num_bytes = first & 0x7F
        if offset + num_bytes > len(data):
            raise ValueError("DER: truncated length")
        length = int.from_bytes(data[offset : offset + num_bytes], "big")
        offset += num_bytes
    return tag, length, offset


def _parse_oid(data: bytes) -> str:
    """Decode a DER-encoded OID value (content bytes only) into dotted string."""
    if not data:
        return ""
    parts: list[int] = []
    first = data[0]
    parts.append(first // 40)
    parts.append(first % 40)
    value = 0
    for b in data[1:]:
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            parts.append(value)
            value = 0
    return ".".join(str(p) for p in parts)


def _extract_spki(der: bytes) -> tuple[str, int]:
    """Extract key type and key size from a DER-encoded X.509 certificate.

    Walks the ASN.1 structure:
      Certificate -> TBSCertificate -> SubjectPublicKeyInfo
    and reads the AlgorithmIdentifier OID plus the BIT STRING payload size.

    Returns (key_type, key_size_bits).
    """
    try:
        # Certificate SEQUENCE
        _, _, off = _read_der_tag_length(der, 0)
        # TBSCertificate SEQUENCE
        _, tbs_len, tbs_off = _read_der_tag_length(der, off)
        tbs_end = tbs_off + tbs_len
        pos = tbs_off

        # version (explicit tag [0], optional)
        if pos < tbs_end and der[pos] == 0xA0:
            _, vl, vo = _read_der_tag_length(der, pos)
            pos = vo + vl

        # serialNumber INTEGER
        _, sl, so = _read_der_tag_length(der, pos)
        pos = so + sl

        # signature AlgorithmIdentifier SEQUENCE
        _, al, ao = _read_der_tag_length(der, pos)
        pos = ao + al

        # issuer SEQUENCE
        _, il, io = _read_der_tag_length(der, pos)
        pos = io + il

        # validity SEQUENCE
        _, vl2, vo2 = _read_der_tag_length(der, pos)
        pos = vo2 + vl2

        # subject SEQUENCE
        _, sbl, sbo = _read_der_tag_length(der, pos)
        pos = sbo + sbl

        # SubjectPublicKeyInfo SEQUENCE
        _, spki_len, spki_off = _read_der_tag_length(der, pos)
        spki_end = spki_off + spki_len

        # AlgorithmIdentifier SEQUENCE inside SPKI
        _, ai_len, ai_off = _read_der_tag_length(der, spki_off)
        # OID inside AlgorithmIdentifier
        _, oid_len, oid_off = _read_der_tag_length(der, ai_off)
        oid_str = _parse_oid(der[oid_off : oid_off + oid_len])
        key_type = _OID_TO_KEY_TYPE.get(oid_str, oid_str)

        # Skip past AlgorithmIdentifier to BIT STRING
        bitstring_pos = ai_off + ai_len
        if bitstring_pos >= spki_end:
            return key_type, 0
        tag, bs_len, bs_off = _read_der_tag_length(der, bitstring_pos)
        if tag != 0x03:
            return key_type, 0

        # BIT STRING: first byte is number of unused bits
        if bs_len < 1:
            return key_type, 0
        unused_bits = der[bs_off]
        key_bits = (bs_len - 1) * 8 - unused_bits

        # For RSA, the BIT STRING wraps a SEQUENCE containing the modulus.
        # The actual key size is the bit-length of the modulus INTEGER.
        if key_type == "RSA" and bs_len > 1:
            inner_off = bs_off + 1  # skip unused-bits byte
            inner_tag, inner_len, inner_content = _read_der_tag_length(
                der, inner_off
            )
            if inner_tag == 0x30:  # SEQUENCE
                # First element is the modulus INTEGER
                mod_tag, mod_len, mod_off = _read_der_tag_length(
                    der, inner_content
                )
                if mod_tag == 0x02 and mod_len > 0:  # INTEGER
                    # Leading zero byte is padding for positive integers
                    if der[mod_off] == 0x00 and mod_len > 1:
                        key_bits = (mod_len - 1) * 8
                    else:
                        key_bits = mod_len * 8

        return key_type, key_bits

    except (ValueError, IndexError, struct.error):
        return "unknown", 0


# ---------------------------------------------------------------------------
# Certificate field helpers
# ---------------------------------------------------------------------------

def _extract_cn(rdns: tuple[tuple[tuple[str, str], ...], ...]) -> str:
    """Extract the Common Name from a subject/issuer tuple-of-tuples."""
    for rdn in rdns:
        for attr_type, attr_value in rdn:
            if attr_type == "commonName":
                return attr_value
    return ""


def _extract_san_names(cert_dict: dict) -> list[str]:
    """Return a list of DNS names from the subjectAltName extension."""
    san = cert_dict.get("subjectAltName", ())
    return [value for kind, value in san if kind == "DNS"]


def _parse_cert_time(time_str: str) -> datetime:
    """Parse the date string returned by ssl.SSLSocket.getpeercert().

    Format is typically 'Mon DD HH:MM:SS YYYY GMT'.
    """
    try:
        ts = ssl.cert_time_to_seconds(time_str)
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except Exception:
        return _EPOCH


def _check_hostname_match(host: str, san_names: list[str], subject_cn: str) -> bool:
    """Return True if host does NOT match any SAN or CN (i.e. there IS a mismatch).

    Supports exact and wildcard matching (e.g. *.example.com matches
    sub.example.com but not sub.sub.example.com).
    """
    candidates = list(san_names) if san_names else []
    if subject_cn and subject_cn not in candidates:
        candidates.append(subject_cn)

    if not candidates:
        return True  # no names to match against => mismatch

    host_lower = host.lower()
    for name in candidates:
        name_lower = name.lower()
        if name_lower == host_lower:
            return False
        # Wildcard: *.example.com
        if name_lower.startswith("*."):
            # Wildcard matches exactly one label
            pattern = name_lower
            if fnmatch.fnmatch(host_lower, pattern):
                # Ensure the wildcard does not span multiple labels
                wildcard_base = name_lower[2:]  # e.g. "example.com"
                if host_lower.endswith(wildcard_base):
                    prefix = host_lower[: -len(wildcard_base)]
                    # prefix should be a single label ending with '.'
                    if prefix.count(".") == 1 and prefix.endswith("."):
                        return False
    return True


def _serial_from_der(der: bytes) -> str:
    """Extract the serial number from a DER-encoded certificate as a hex string.

    Falls back to a SHA-256 fingerprint prefix if parsing fails.
    """
    try:
        # Certificate SEQUENCE
        _, _, off = _read_der_tag_length(der, 0)
        # TBSCertificate SEQUENCE
        _, _, tbs_off = _read_der_tag_length(der, off)
        pos = tbs_off

        # version (explicit tag [0], optional)
        if pos < len(der) and der[pos] == 0xA0:
            _, vl, vo = _read_der_tag_length(der, pos)
            pos = vo + vl

        # serialNumber INTEGER
        tag, slen, soff = _read_der_tag_length(der, pos)
        if tag == 0x02:
            serial_bytes = der[soff : soff + slen]
            return serial_bytes.hex().upper()
    except (ValueError, IndexError):
        pass

    # Fallback: fingerprint-based identifier
    return hashlib.sha256(der).hexdigest()[:40].upper()


# ---------------------------------------------------------------------------
# Core analysis function
# ---------------------------------------------------------------------------

async def analyze_tls(host: str, port: int = 443) -> TLSCertInfo:
    """Connect to *host*:*port* via TLS, retrieve the certificate, and return
    a populated TLSCertInfo model.

    On connection errors or timeouts the returned model will have the host and
    port filled in with default/sentinel values for remaining fields.
    """
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_OPTIONAL

        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=ctx),
            timeout=CONNECTION_TIMEOUT,
        )

        ssl_obj = writer.transport.get_extra_info("ssl_object")
        cert_dict = ssl_obj.getpeercert()
        cert_der = ssl_obj.getpeercert(binary_form=True)

        # -- Subject / Issuer -------------------------------------------
        subject_cn = _extract_cn(cert_dict.get("subject", ()))
        issuer_cn = _extract_cn(cert_dict.get("issuer", ()))

        # -- SAN names ---------------------------------------------------
        san_names = _extract_san_names(cert_dict)

        # -- Serial number -----------------------------------------------
        serial_str = cert_dict.get("serialNumber", "")
        if not serial_str and cert_der:
            serial_str = _serial_from_der(cert_der)

        # -- Dates -------------------------------------------------------
        not_before = _parse_cert_time(cert_dict.get("notBefore", ""))
        not_after = _parse_cert_time(cert_dict.get("notAfter", ""))

        # -- Key info from DER -------------------------------------------
        key_type = "unknown"
        key_size = 0
        if cert_der:
            key_type, key_size = _extract_spki(cert_der)

        # -- Chain depth -------------------------------------------------
        # The ssl module does not expose the full chain directly.
        # We report 1 for the peer certificate; if we could verify a
        # chain we would count intermediate + root certs.
        chain_depth = 1

        # -- Misconfiguration checks ------------------------------------
        is_self_signed = subject_cn == issuer_cn and subject_cn != ""
        is_expired = not_after < datetime.now(tz=timezone.utc)
        hostname_mismatch = _check_hostname_match(host, san_names, subject_cn)

        writer.close()
        await writer.wait_closed()

        return TLSCertInfo(
            host=host,
            port=port,
            subject=subject_cn,
            issuer=issuer_cn,
            serial_number=serial_str,
            san_names=san_names,
            key_type=key_type,
            key_size=key_size,
            not_before=not_before,
            not_after=not_after,
            chain_depth=chain_depth,
            is_self_signed=is_self_signed,
            is_expired=is_expired,
            hostname_mismatch=hostname_mismatch,
        )

    except Exception as exc:
        print(f"[tls] error connecting to {host}:{port}: {exc}", file=sys.stderr)
        return TLSCertInfo(
            host=host,
            port=port,
            subject="",
            issuer="",
            serial_number="",
            san_names=[],
            key_type="unknown",
            key_size=0,
            not_before=_EPOCH,
            not_after=_EPOCH,
            chain_depth=0,
            is_self_signed=False,
            is_expired=False,
            hostname_mismatch=False,
        )


# ---------------------------------------------------------------------------
# Batch analysis with bounded concurrency
# ---------------------------------------------------------------------------

async def analyze_tls_batch(
    targets: list[tuple[str, int]],
    concurrency: int = 20,
) -> list[TLSCertInfo]:
    """Analyze multiple host:port targets with bounded concurrency.

    Returns results in the same order as *targets*.
    """
    semaphore = asyncio.Semaphore(concurrency)

    async def _limited(host: str, port: int) -> TLSCertInfo:
        async with semaphore:
            return await analyze_tls(host, port)

    tasks = [_limited(h, p) for h, p in targets]
    return list(await asyncio.gather(*tasks))
