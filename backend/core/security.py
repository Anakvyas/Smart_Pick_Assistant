from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher

from core.config import get_settings

settings = get_settings()

# bcrypt is kept as the active hasher so password hashes stay compatible with
# the existing Express/Node backend, which also hashes with bcrypt.
password_hasher = PasswordHash(hashers=[BcryptHasher()])


def hash_password(plain_password: str) -> str:
    return password_hasher.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return password_hasher.verify(plain_password, password_hash)


def create_access_token(subject: str, role: str) -> str:
    # datetime.UTC is Python 3.11+ only; timezone.utc is the same value and
    # works on this project's Python 3.9.
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"id": subject, "role": role, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


# A separate, narrower token type for the order QR-scan flow (see
# routes/orders.py's /scan-token, /items, /verify) — a phone scanning a
# picker's QR code shouldn't need to log in first, same philosophy as the
# original /scan and /display pages being open to anonymous phones (see
# AuthStatus.jsx). Distinct from create_access_token's full login session:
# it carries no identity, only "this bearer may act on this one order until
# it expires", so a leaked scan token can't be used for anything beyond
# that single order for a limited time.
SCAN_TOKEN_TYPE = "order_scan"
SCAN_TOKEN_EXPIRE_MINUTES = 12 * 60  # a full picking shift


def create_scan_token(order_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=SCAN_TOKEN_EXPIRE_MINUTES)
    payload = {"order_id": order_id, "type": SCAN_TOKEN_TYPE, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_scan_token(token: str, order_id: str) -> bool:
    """True only if `token` is a valid, unexpired scan token for exactly
    this order — any decode failure or mismatch is just "not valid",
    never an exception the caller has to handle.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except Exception:
        return False
    return payload.get("type") == SCAN_TOKEN_TYPE and payload.get("order_id") == str(order_id)
