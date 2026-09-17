from __future__ import annotations  # for `str | None` etc below, on Python 3.9

from typing import Generic, TypeVar

from pydantic import BaseModel

DataT = TypeVar("DataT")


class SuccessResponse(BaseModel, Generic[DataT]):
    success: bool = True
    message: str | None = None
    data: DataT | None = None


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, str] | None = None


class ErrorResponse(BaseModel):
    success: bool = False
    error: ErrorDetail
