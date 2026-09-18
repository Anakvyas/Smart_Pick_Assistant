from fastapi import Response
from sqlalchemy.orm import Session

from core.config import get_settings
from models.user import User
from schemas.auth import LoginRequest, SignupRequest, UserPublic
from schemas.response import SuccessResponse
from services.auth_service import AuthService

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


def me(user: User) -> SuccessResponse[dict]:
    return SuccessResponse(data={"user": UserPublic.model_validate(user)})


def logout(response: Response) -> SuccessResponse[dict]:
    response.delete_cookie(key=settings.cookie_name, path="/")
    return SuccessResponse(message="Logged out.")
