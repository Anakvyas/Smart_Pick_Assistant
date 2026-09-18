from __future__ import annotations  # for `str | None` below, on Python 3.9

from pydantic import BaseModel


class MarkUnavailableRequest(BaseModel):
    reason: str | None = None
