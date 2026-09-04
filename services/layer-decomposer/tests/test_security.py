from __future__ import annotations

import socket

import pytest

from layer_decomposer.errors import UnsafeImageUrl
from layer_decomposer.image_input import validate_and_resolve_url


def _resolver(*addresses: str):
    def resolve(host: str, port: int, **_: object) -> list[tuple]:
        del host
        return [
            (socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))
            for address in addresses
        ]

    return resolve


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://localhost/image.png",
        "http://user:password@example.com/image.png",
        "https://example.com:8443/image.png",
        "https://example.com/image.png#fragment",
    ],
)
def test_unsafe_url_shapes_are_rejected(url: str) -> None:
    with pytest.raises(UnsafeImageUrl):
        validate_and_resolve_url(url, _resolver("93.184.216.34"))


@pytest.mark.parametrize(
    "address",
    ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.2", "::1", "fc00::1", "224.0.0.1", "ff02::1"],
)
def test_non_public_dns_answers_are_rejected(address: str) -> None:
    with pytest.raises(UnsafeImageUrl):
        validate_and_resolve_url(
            "https://images.example.com/source.png", _resolver(address)
        )


def test_mixed_public_and_private_dns_answers_are_rejected() -> None:
    with pytest.raises(UnsafeImageUrl):
        validate_and_resolve_url(
            "https://images.example.com/source.png",
            _resolver("93.184.216.34", "127.0.0.1"),
        )


def test_public_address_is_resolved_for_pinned_connection() -> None:
    parsed, addresses = validate_and_resolve_url(
        "https://images.example.com/source.png",
        _resolver("93.184.216.34"),
    )
    assert parsed.hostname == "images.example.com"
    assert addresses == ("93.184.216.34",)
