from __future__ import annotations

# ^ needed for `str | None`-style unions below on this project's Python
# 3.9 (native support for that syntax at runtime is 3.10+); the future
# import defers annotation evaluation so it works on 3.9 too.


class AppException(Exception):
    """Base class for application exceptions with a machine-readable code."""

    status_code: int = 500
    code: str = "INTERNAL_SERVER_ERROR"
    message: str = "An unexpected server error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        fields: dict[str, str] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        self.fields = fields
        super().__init__(self.message)


class ValidationAppError(AppException):
    status_code = 400
    code = "VALIDATION_ERROR"
    message = "Please check the form and try again."


class InvalidCredentialsError(AppException):
    status_code = 401
    code = "INVALID_CREDENTIALS"
    message = "Invalid email or password."


class AuthRequiredError(AppException):
    status_code = 401
    code = "AUTH_REQUIRED"
    message = "Authentication required."


class AccountInactiveError(AppException):
    status_code = 403
    code = "ACCOUNT_INACTIVE"
    message = "This account is inactive."


class EmailAlreadyExistsError(AppException):
    status_code = 409
    code = "EMAIL_ALREADY_EXISTS"
    message = "An account with this email already exists."


class OrderNotFoundError(AppException):
    status_code = 404
    code = "ORDER_NOT_FOUND"
    message = "Order not found."
