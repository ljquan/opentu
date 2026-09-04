from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import http.client
import ipaddress
import socket
import ssl
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Callable, Iterable
from urllib.parse import SplitResult, urljoin, urlsplit

from PIL import Image, UnidentifiedImageError
from starlette.datastructures import UploadFile

from .config import Settings
from .errors import InvalidImage, InvalidRequest, PayloadTooLarge, UnsafeImageUrl

_CHUNK_SIZE = 64 * 1024
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


@dataclass(frozen=True, slots=True)
class ImageAsset:
    path: Path
    width: int
    height: int
    content_type: str
    sha256: str


async def materialize_json_image(source: str, destination: Path, settings: Settings) -> ImageAsset:
    if source.startswith("data:"):
        await asyncio.to_thread(_write_data_url, source, destination, settings.max_image_bytes)
    else:
        if len(source) > 8_192:
            raise InvalidRequest("image URL is too long")
        await asyncio.to_thread(_download_url, source, destination, settings)
    return await asyncio.to_thread(_inspect_image, destination, settings)


async def materialize_upload(upload: UploadFile, destination: Path, settings: Settings) -> ImageAsset:
    try:
        await asyncio.to_thread(_copy_limited, upload.file, destination, settings.max_image_bytes)
    finally:
        await upload.close()
    return await asyncio.to_thread(_inspect_image, destination, settings)


def _copy_limited(source: BinaryIO, destination: Path, limit: int) -> None:
    size = 0
    with destination.open("wb") as output:
        while chunk := source.read(_CHUNK_SIZE):
            size += len(chunk)
            if size > limit:
                raise PayloadTooLarge(f"image exceeds the {limit}-byte limit")
            output.write(chunk)
    if size == 0:
        raise InvalidImage("image is empty")


def _write_data_url(source: str, destination: Path, limit: int) -> None:
    try:
        header, encoded = source.split(",", 1)
    except ValueError as exc:
        raise InvalidImage("malformed image data URL") from exc

    header_value = header.lower().strip()
    if not header_value.startswith("data:image/") or not header_value.endswith(";base64"):
        raise InvalidImage("data URL must contain a base64-encoded image")
    if len(encoded) > ((limit + 2) // 3) * 4 + 4:
        raise PayloadTooLarge(f"image exceeds the {limit}-byte limit")

    written = 0
    carry = ""
    with destination.open("wb") as output:
        for offset in range(0, len(encoded), _CHUNK_SIZE):
            carry += encoded[offset : offset + _CHUNK_SIZE]
            decode_length = len(carry) - (len(carry) % 4)
            if decode_length == 0:
                continue
            block, carry = carry[:decode_length], carry[decode_length:]
            written += _decode_base64_block(block, output)
            if written > limit:
                raise PayloadTooLarge(f"image exceeds the {limit}-byte limit")
        if carry:
            written += _decode_base64_block(carry, output)
    if written == 0:
        raise InvalidImage("image is empty")


def _decode_base64_block(block: str, output: BinaryIO) -> int:
    try:
        decoded = base64.b64decode(block, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise InvalidImage("image data URL contains invalid base64") from exc
    output.write(decoded)
    return len(decoded)


def _inspect_image(path: Path, settings: Settings) -> ImageAsset:
    try:
        with Image.open(path) as image:
            image_format = (image.format or "").upper()
            width, height = image.size
            if width <= 0 or height <= 0:
                raise InvalidImage("image dimensions must be positive")
            if width * height > settings.max_image_pixels:
                raise PayloadTooLarge(
                    f"image exceeds the {settings.max_image_pixels}-pixel limit"
                )
            image.verify()
    except InvalidImage:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise InvalidImage("image content is corrupt or unsupported") from exc

    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(_CHUNK_SIZE):
            digest.update(chunk)
    mime = Image.MIME.get(image_format, "application/octet-stream")
    if not mime.startswith("image/"):
        raise InvalidImage("image content format is not supported by the decoder")
    return ImageAsset(path, width, height, mime, digest.hexdigest())


def _download_url(source: str, destination: Path, settings: Settings) -> None:
    current = source
    initial_scheme: str | None = None
    for redirect_count in range(settings.max_redirects + 1):
        parsed, addresses = validate_and_resolve_url(current)
        initial_scheme = initial_scheme or parsed.scheme
        if initial_scheme == "https" and parsed.scheme != "https":
            raise UnsafeImageUrl("HTTPS image URL cannot redirect to HTTP")

        connection = _connect(parsed, addresses, settings.download_timeout_seconds)
        response: http.client.HTTPResponse | None = None
        try:
            target = parsed.path or "/"
            if parsed.query:
                target += f"?{parsed.query}"
            host_header = parsed.hostname or ""
            if ":" in host_header:
                host_header = f"[{host_header}]"
            if parsed.port:
                host_header = f"{host_header}:{parsed.port}"
            connection.request(
                "GET",
                target,
                headers={
                    "Host": host_header,
                    "Accept": "image/*",
                    "Accept-Encoding": "identity",
                    "User-Agent": "OpenTu-Layer-Decomposer/1.0",
                },
                skip_host=True,
            )
            response = connection.getresponse()
            if response.status in _REDIRECT_STATUSES:
                location = response.getheader("Location")
                if not location:
                    raise InvalidImage("image server returned an empty redirect")
                if redirect_count >= settings.max_redirects:
                    raise InvalidImage("image URL has too many redirects")
                current = urljoin(current, location)
                continue
            if response.status < 200 or response.status >= 300:
                raise InvalidImage(f"image server returned HTTP {response.status}")
            if response.getheader("Content-Encoding", "identity").lower() not in {"", "identity"}:
                raise InvalidImage("compressed HTTP responses are not accepted")
            content_length = response.getheader("Content-Length")
            if content_length:
                try:
                    if int(content_length) > settings.max_image_bytes:
                        raise PayloadTooLarge(
                            f"image exceeds the {settings.max_image_bytes}-byte limit"
                        )
                except ValueError as exc:
                    raise InvalidImage("image server returned an invalid Content-Length") from exc
            _copy_limited(response, destination, settings.max_image_bytes)
            return
        except (TimeoutError, socket.timeout) as exc:
            raise InvalidImage("image download timed out") from exc
        except (ssl.SSLError, http.client.HTTPException, ConnectionError, OSError) as exc:
            raise InvalidImage("image download failed") from exc
        finally:
            if response is not None:
                response.close()
            connection.close()
    raise InvalidImage("image URL has too many redirects")


Resolver = Callable[..., Iterable[tuple]]


def validate_and_resolve_url(
    source: str,
    resolver: Resolver = socket.getaddrinfo,
) -> tuple[SplitResult, tuple[str, ...]]:
    try:
        parsed = urlsplit(source)
        port = parsed.port
    except ValueError as exc:
        raise UnsafeImageUrl("image URL is malformed") from exc
    if parsed.scheme not in {"http", "https"}:
        raise UnsafeImageUrl("image URL must use HTTP or HTTPS")
    if not parsed.hostname or parsed.username is not None or parsed.password is not None:
        raise UnsafeImageUrl("image URL must not contain credentials")
    if parsed.fragment:
        raise UnsafeImageUrl("image URL must not contain a fragment")
    expected_port = 443 if parsed.scheme == "https" else 80
    if port is not None and port != expected_port:
        raise UnsafeImageUrl("image URL must use the default HTTP or HTTPS port")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise UnsafeImageUrl("local image hosts are not allowed")
    try:
        records = resolver(hostname, port or expected_port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeImageUrl("image host could not be resolved") from exc

    addresses = tuple(dict.fromkeys(record[4][0] for record in records))
    if not addresses:
        raise UnsafeImageUrl("image host did not resolve to an address")
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address)
        except ValueError as exc:
            raise UnsafeImageUrl("image host resolved to an invalid address") from exc
        if (
            not ip.is_global
            or ip.is_multicast
            or ip.is_unspecified
            or ip.is_reserved
            or ip.is_loopback
            or ip.is_link_local
        ):
            raise UnsafeImageUrl("image host resolves to a non-public address")
    return parsed, addresses


def _connect(
    parsed: SplitResult,
    addresses: tuple[str, ...],
    timeout: float,
) -> http.client.HTTPConnection:
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    last_error: OSError | None = None
    for address in addresses:
        connection: http.client.HTTPConnection
        if parsed.scheme == "https":
            connection = _PinnedHTTPSConnection(host, address, port, timeout)
        else:
            connection = http.client.HTTPConnection(address, port, timeout=timeout)
        try:
            connection.connect()
            return connection
        except OSError as exc:
            last_error = exc
            connection.close()
    raise InvalidImage("image host could not be reached") from last_error


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname: str, address: str, port: int, timeout: float) -> None:
        super().__init__(hostname, port, timeout=timeout, context=ssl.create_default_context())
        self._pinned_address = address

    def connect(self) -> None:
        raw_socket = socket.create_connection(
            (self._pinned_address, self.port),
            self.timeout,
            self.source_address,
        )
        if self._tunnel_host:
            raw_socket.close()
            raise UnsafeImageUrl("HTTP tunnels are not allowed")
        self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)
