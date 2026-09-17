from fastapi import Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.auth import LoginRequest, SignupRequest, UserPublic
from app.schemas.response import SuccessResponse
from app.services.auth_service import AuthService

settings = get_settings()


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/",
        max_age=settings.jwt_expire_minutes * 60,
    )


def signup(
    payload: SignupRequest, response: Response, db: Session
) -> SuccessResponse[dict]:
    service = AuthService(db)
    user, token = service.signup(payload)

    _set_auth_cookie(response, token)

    return SuccessResponse(
        message="Picker account created successfully.",
        data={"user": UserPublic.model_validate(user)},
    )


def login(payload: LoginRequest, response: Response, db: Session) -> SuccessResponse[dict]:
    service = AuthService(db)
    user, token = service.login(payload)

    _set_auth_cookie(response, token)

    return SuccessResponse(
        message="Login successful.",
        data={"user": UserPublic.model_validate(user)},
    )
