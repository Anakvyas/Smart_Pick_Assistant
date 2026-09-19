"""Shared FastAPI dependencies — currently just "who is making this
request", read from the same JWT cookie login/signup already set.
"""
from __future__ import annotations  # for `User | None` below, on Python 3.9

import uuid

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from core.config import get_settings
from core.security import decode_access_token
from db.session import get_db
from exceptions.app_exceptions import AuthRequiredError
from models.user import User
from repositories.user_repository import UserRepository

settings = get_settings()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise AuthRequiredError()

    try:
        payload = decode_access_token(token)
        # create_access_token stores the id as str(user.id) (a JWT claim
        # has to be JSON-serializable) — the User.id column is a real
        # Uuid(as_uuid=True), which needs an actual uuid.UUID instance for
        # binding, not its string form.
        user_id = uuid.UUID(payload["id"])
    except Exception:
        raise AuthRequiredError()

    user = UserRepository(db).find_by_id(user_id)
    if not user or not user.is_active:
        raise AuthRequiredError()
    return user


def get_current_user_optional(request: Request, db: Session = Depends(get_db)) -> User | None:
    """Same as get_current_user, but returns None instead of raising when
    there's no valid session — for routes that accept a logged-in picker
    *or* a QR scan-token (see routes/orders.py's items/verify), where the
    absence of a cookie isn't itself an error, just "try the other way".
    """
    try:
        return get_current_user(request, db)
    except AuthRequiredError:
        return None
