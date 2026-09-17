from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.exceptions.app_exceptions import (
    AccountInactiveError,
    EmailAlreadyExistsError,
    InvalidCredentialsError,
)
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import LoginRequest, SignupRequest


class AuthService:
    def __init__(self, db: Session) -> None:
        self.repository = UserRepository(db)

    def signup(self, payload: SignupRequest) -> tuple[User, str]:
        normalized_email = payload.email.strip().lower()

        if self.repository.find_by_email(normalized_email):
            raise EmailAlreadyExistsError()

        password_hash = hash_password(payload.password)
        user = self.repository.create(
            name=payload.name.strip(),
            email=normalized_email,
            password_hash=password_hash,
            role="PICKER",
        )

        token = create_access_token(subject=str(user.id), role=user.role)
        return user, token

    def login(self, payload: LoginRequest) -> tuple[User, str]:
        normalized_email = payload.email.strip().lower()
        user = self.repository.find_by_email(normalized_email)

        if not user or not verify_password(payload.password, user.password_hash):
            raise InvalidCredentialsError()

        if not user.is_active:
            raise AccountInactiveError()

        self.repository.update_last_login(user)

        token = create_access_token(subject=str(user.id), role=user.role)
        return user, token
