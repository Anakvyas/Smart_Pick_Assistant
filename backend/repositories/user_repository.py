from __future__ import annotations  # for `User | None` below, on Python 3.9

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.user import User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def find_by_email(self, email: str) -> User | None:
        stmt = select(User).where(func.lower(User.email) == email.lower())
        return self.db.execute(stmt).scalar_one_or_none()

    def find_by_id(self, user_id: str) -> User | None:
        return self.db.get(User, user_id)

    def create(self, *, name: str, email: str, password_hash: str, role: str = "PICKER") -> User:
        user = User(name=name, email=email, password_hash=password_hash, role=role)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def update_last_login(self, user: User) -> None:
        user.last_login_at = func.now()
        self.db.add(user)
        self.db.commit()
