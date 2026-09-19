from __future__ import annotations  # for `str | None` below, on Python 3.9

from pydantic import BaseModel


class ScanVerifyRequest(BaseModel):
    """The subset of an /api/analyze or /ws/scan result actually needed to
    check a scan against an order's expected items — sent as-is by the
    frontend rather than re-deriving it, so this only ever has to agree
    with the scanner pipeline's field names once.
    """

    barcode: str | None = None
    gstin: str | None = None
    name: str | None = None
