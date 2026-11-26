import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config, db

TOKEN_TTL_S = 7 * 24 * 3600
bearer = HTTPBearer(auto_error=False)


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    return f"pbkdf2${salt.hex()}${h.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
    except ValueError:
        return False
    calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000)
    return hmac.compare_digest(calc.hex(), h)


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def make_token(username: str, role: str) -> str:
    body = _b64(json.dumps({"u": username, "r": role, "exp": int(time.time()) + TOKEN_TTL_S}).encode())
    sig = _b64(hmac.new(config.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(token: str) -> dict | None:
    try:
        body, sig = token.split(".")
        good = _b64(hmac.new(config.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if data["exp"] < time.time():
            return None
        return data
    except Exception:
        return None


async def ensure_admin():
    async with db.pool.acquire() as con:
        n = await con.fetchval("SELECT count(*) FROM users")
        if n == 0:
            await con.execute(
                "INSERT INTO users (username, pw_hash, role) VALUES ($1, $2, 'admin')",
                config.ADMIN_USER, hash_password(config.ADMIN_PASSWORD),
            )


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    data = read_token(cred.credentials) if cred else None
    if not data:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chưa đăng nhập hoặc phiên đã hết hạn")
    return data


def admin_user(user: dict = Depends(current_user)) -> dict:
    if user["r"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Chỉ quản trị viên được làm thao tác này")
    return user
