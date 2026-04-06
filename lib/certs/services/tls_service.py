from __future__ import annotations

import asyncio
import fnmatch
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
# We parse all certificate fields from the DER binary form because
# ssl.CERT_NONE is required to connect to hosts with unverifiable certs
# (self-signed, expired, incomplete chains), and getpeercert() returns
# an empty dict when verify_mode is CERT_NONE.

_OID_RSA = "1.2.840.113549.1.1.1"
_OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1"
_OID_ED25519 = "1.3.101.112"
_OID_ED448 = "1.3.101.113"
_OID_DSA = "1.2.840.10040.4.1"
_OID_SAN = "2.5.29.17"

_OID_TO_KEY_TYPE: dict[str, str] = {
    _OID_RSA: "RSA",
    _OID_EC_PUBLIC_KEY: "EC",
    _OID_ED25519: "Ed25519",
    _OID_ED448: "Ed448",
    _OID_DSA: "DSA",
}

_OID_CN = "2.5.4.3"


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


def _walk_tbs(der: bytes) -> dict[str, tuple[int, int]]:
    """Walk a DER-encoded X.509 cert and return byte offsets for TBS fields.

    Returns a dict mapping field names to (content_offset, content_length)
    tuples for: serial, issuer, validity, subject, spki, and extensions.
    """
    fields: dict[str, tuple[int, int]] = {}
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
    fields["serial"] = (so, sl)
    pos = so + sl

    # signature AlgorithmIdentifier SEQUENCE
    _, al, ao = _read_der_tag_length(der, pos)
    pos = ao + al

    # issuer SEQUENCE
    tag, il, io = _read_der_tag_length(der, pos)
    fields["issuer"] = (pos, il + (io - pos))
    pos = io + il

    # validity SEQUENCE
    _, vl2, vo2 = _read_der_tag_length(der, pos)
    fields["validity"] = (vo2, vl2)
    pos = vo2 + vl2

    # subject SEQUENCE
    tag, sbl, sbo = _read_der_tag_length(der, pos)
    fields["subject"] = (pos, sbl + (sbo - pos))
    pos = sbo + sbl

    # SubjectPublicKeyInfo SEQUENCE
    _, spki_len, spki_off = _read_der_tag_length(der, pos)
    fields["spki"] = (pos, spki_len + (spki_off - pos))
    pos = spki_off + spki_len

    # extensions (explicit tag [3], optional)
    if pos < tbs_end and der[pos] == 0xA3:
        _, el, eo = _read_der_tag_length(der, pos)
        fields["extensions"] = (eo, el)

    return fields


def _extract_cn_from_name(der: bytes, offset: int, length: int) -> str:
    """Extract the Common Name from a DER-encoded Name (subject or issuer)."""
    try:
        # Name is a SEQUENCE of RDNs (RelativeDistinguishedName)
        _, name_len, name_off = _read_der_tag_length(der, offset)
        end = name_off + name_len
        pos = name_off
        while pos < end:
            # SET (RDN)
            _, set_len, set_off = _read_der_tag_length(der, pos)
            set_end = set_off + set_len
            rdn_pos = set_off
            while rdn_pos < set_end:
                # SEQUENCE (AttributeTypeAndValue)
                _, attr_len, attr_off = _read_der_tag_length(der, rdn_pos)
                # OID
                _, oid_len, oid_off = _read_der_tag_length(der, attr_off)
                oid_str = _parse_oid(der[oid_off : oid_off + oid_len])
                if oid_str == _OID_CN:
                    # Value (UTF8String, PrintableString, etc.)
                    val_pos = oid_off + oid_len
                    _, val_len, val_off = _read_der_tag_length(der, val_pos)
                    return der[val_off : val_off + val_len].decode(errors="replace")
                rdn_pos = attr_off + attr_len
            pos = set_end
    except (ValueError, IndexError):
        pass
    return ""


def _extract_validity(
    der: bytes, offset: int, length: int
) -> tuple[datetime, datetime]:
    """Extract notBefore and notAfter from a DER-encoded Validity SEQUENCE."""
    try:
        pos = offset
        # notBefore
        nb = _parse_der_time(der, pos)
        _, t1_len, t1_off = _read_der_tag_length(der, pos)
        pos = t1_off + t1_len
        # notAfter
        na = _parse_der_time(der, pos)
        return nb, na
    except (ValueError, IndexError):
        return _EPOCH, _EPOCH


def _parse_der_time(der: bytes, offset: int) -> datetime:
    """Parse a DER UTCTime (tag 0x17) or GeneralizedTime (tag 0x18)."""
    tag, length, content_off = _read_der_tag_length(der, offset)
    raw = der[content_off : content_off + length].decode("ascii")
    if tag == 0x17:  # UTCTime: YYMMDDHHMMSSZ
        raw = raw.rstrip("Z")
        year = int(raw[:2])
        year += 2000 if year < 50 else 1900
        return datetime(
            year,
            int(raw[2:4]),
            int(raw[4:6]),
            int(raw[6:8]),
            int(raw[8:10]),
            int(raw[10:12]),
            tzinfo=timezone.utc,
        )
    if tag == 0x18:  # GeneralizedTime: YYYYMMDDHHMMSSZ
        raw = raw.rstrip("Z")
        return datetime(
            int(raw[:4]),
            int(raw[4:6]),
            int(raw[6:8]),
            int(raw[8:10]),
            int(raw[10:12]),
            int(raw[12:14]),
            tzinfo=timezone.utc,
        )
    return _EPOCH


def _extract_san_from_extensions(der: bytes, offset: int, length: int) -> list[str]:
    """Extract DNS SANs from DER-encoded Extensions."""
    names: list[str] = []
    try:
        # Extensions is a SEQUENCE of Extension
        _, ext_seq_len, ext_seq_off = _read_der_tag_length(der, offset)
        end = ext_seq_off + ext_seq_len
        pos = ext_seq_off
        while pos < end:
            # Extension SEQUENCE
            _, ext_len, ext_off = _read_der_tag_length(der, pos)
            ext_end = ext_off + ext_len
            # OID
            _, oid_len, oid_off = _read_der_tag_length(der, ext_off)
            oid_str = _parse_oid(der[oid_off : oid_off + oid_len])
            if oid_str == _OID_SAN:
                # Skip optional critical BOOLEAN
                val_pos = oid_off + oid_len
                if val_pos < ext_end and der[val_pos] == 0x01:  # BOOLEAN
                    _, bl, bo = _read_der_tag_length(der, val_pos)
                    val_pos = bo + bl
                # OCTET STRING wrapping the SAN value
                _, oct_len, oct_off = _read_der_tag_length(der, val_pos)
                # Inside: SEQUENCE of GeneralName
                _, san_seq_len, san_seq_off = _read_der_tag_length(der, oct_off)
                san_end = san_seq_off + san_seq_len
                san_pos = san_seq_off
                while san_pos < san_end:
                    tag, gn_len, gn_off = _read_der_tag_length(der, san_pos)
                    # context tag [2] = dNSName (implicit IA5String)
                    if tag == 0x82:
                        dns_name = der[gn_off : gn_off + gn_len].decode(
                            "ascii", errors="replace"
                        )
                        names.append(dns_name)
                    san_pos = gn_off + gn_len
                break
            pos = ext_end
    except (ValueError, IndexError):
        pass
    return names


def _extract_spki_info(der: bytes, offset: int, length: int) -> tuple[str, int]:
    """Extract key type and size from a DER-encoded SubjectPublicKeyInfo."""
    try:
        _, spki_len, spki_off = _read_der_tag_length(der, offset)
        spki_end = spki_off + spki_len

        # AlgorithmIdentifier SEQUENCE
        _, ai_len, ai_off = _read_der_tag_length(der, spki_off)
        # OID
        _, oid_len, oid_off = _read_der_tag_length(der, ai_off)
        oid_str = _parse_oid(der[oid_off : oid_off + oid_len])
        key_type = _OID_TO_KEY_TYPE.get(oid_str, oid_str)

        # BIT STRING after AlgorithmIdentifier
        bitstring_pos = ai_off + ai_len
        if bitstring_pos >= spki_end:
            return key_type, 0
        tag, bs_len, bs_off = _read_der_tag_length(der, bitstring_pos)
        if tag != 0x03:
            return key_type, 0
        if bs_len < 1:
            return key_type, 0

        unused_bits = der[bs_off]
        key_bits = (bs_len - 1) * 8 - unused_bits

        # For RSA, the BIT STRING wraps a SEQUENCE containing the modulus.
        if key_type == "RSA" and bs_len > 1:
            inner_off = bs_off + 1
            inner_tag, inner_len, inner_content = _read_der_tag_length(der, inner_off)
            if inner_tag == 0x30:
                mod_tag, mod_len, mod_off = _read_der_tag_length(der, inner_content)
                if mod_tag == 0x02 and mod_len > 0:
                    if der[mod_off] == 0x00 and mod_len > 1:
                        key_bits = (mod_len - 1) * 8
                    else:
                        key_bits = mod_len * 8

        return key_type, key_bits
    except (ValueError, IndexError, struct.error):
        return "unknown", 0


def _parse_der_cert(der: bytes) -> dict:
    """Parse all needed fields from a DER-encoded X.509 certificate.

    Returns a dict with: subject, issuer, serial_number, san_names,
    key_type, key_size, not_before, not_after.
    """
    result: dict = {
        "subject": "",
        "issuer": "",
        "serial_number": "",
        "san_names": [],
        "key_type": "unknown",
        "key_size": 0,
        "not_before": _EPOCH,
        "not_after": _EPOCH,
    }
    try:
        fields = _walk_tbs(der)

        if "serial" in fields:
            off, length = fields["serial"]
            serial_bytes = der[off : off + length]
            result["serial_number"] = serial_bytes.hex().upper()

        if "subject" in fields:
            off, length = fields["subject"]
            result["subject"] = _extract_cn_from_name(der, off, length)

        if "issuer" in fields:
            off, length = fields["issuer"]
            result["issuer"] = _extract_cn_from_name(der, off, length)

        if "validity" in fields:
            off, length = fields["validity"]
            result["not_before"], result["not_after"] = _extract_validity(
                der, off, length
            )

        if "spki" in fields:
            off, length = fields["spki"]
            result["key_type"], result["key_size"] = _extract_spki_info(
                der, off, length
            )

        if "extensions" in fields:
            off, length = fields["extensions"]
            result["san_names"] = _extract_san_from_extensions(der, off, length)

    except (ValueError, IndexError, struct.error) as exc:
        print(f"[tls] DER parse error: {exc}", file=sys.stderr)

    return result


# ---------------------------------------------------------------------------
# Certificate field helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Core analysis function
# ---------------------------------------------------------------------------


async def analyze_tls(host: str, port: int = 443) -> TLSCertInfo:
    """Connect to *host*:*port* via TLS, retrieve the certificate, and return
    a populated TLSCertInfo model.

    Uses CERT_NONE so connections succeed even with self-signed, expired, or
    otherwise unverifiable certificates.  All cert fields are parsed from the
    DER binary form.

    On connection errors or timeouts the returned model will have the host and
    port filled in with default/sentinel values for remaining fields.
    """
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=ctx),
            timeout=CONNECTION_TIMEOUT,
        )

        ssl_obj = writer.transport.get_extra_info("ssl_object")
        cert_der = ssl_obj.getpeercert(binary_form=True)

        writer.close()
        await writer.wait_closed()

        if not cert_der:
            msg = f"no certificate returned by {host}:{port}"
            print(f"[tls] {msg}", file=sys.stderr)
            return _error_result(host, port, msg)

        parsed = _parse_der_cert(cert_der)
        subject_cn = parsed["subject"]
        issuer_cn = parsed["issuer"]
        san_names = parsed["san_names"]
        not_before = parsed["not_before"]
        not_after = parsed["not_after"]

        is_self_signed = subject_cn == issuer_cn and subject_cn != ""
        is_expired = not_after < datetime.now(tz=timezone.utc)
        hostname_mismatch = _check_hostname_match(host, san_names, subject_cn)

        return TLSCertInfo(
            host=host,
            port=port,
            subject=subject_cn,
            issuer=issuer_cn,
            serial_number=parsed["serial_number"],
            san_names=san_names,
            key_type=parsed["key_type"],
            key_size=parsed["key_size"],
            not_before=not_before,
            not_after=not_after,
            chain_depth=1,
            is_self_signed=is_self_signed,
            is_expired=is_expired,
            hostname_mismatch=hostname_mismatch,
        )

    except Exception as exc:
        msg = f"error connecting to {host}:{port}: {exc}"
        print(f"[tls] {msg}", file=sys.stderr)
        return _error_result(host, port, msg)


def _error_result(host: str, port: int, error: str = "") -> TLSCertInfo:
    """Return a TLSCertInfo with sentinel/default values for error cases."""
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
        error=error or "failed to retrieve certificate",
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
