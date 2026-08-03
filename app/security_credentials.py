"""Normalize login credentials, hash passwords with Argon2id, and throttle repeated failures."""

from dataclasses import dataclass
from threading import Lock
import time
import unicodedata

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerifyMismatchError


PASSWORD_SESSION_DAYS = 90
_PASSWORD_HASHER = PasswordHasher(
    time_cost=2,
    memory_cost=19 * 1024,
    parallelism=1,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)
_DUMMY_HASH = _PASSWORD_HASHER.hash("Love Book dummy password verification value")
_COMMON_PASSWORDS = {
    "123456789012345",
    "passwordpassword",
    "qwertyuiopasdfg",
    "iloveyouiloveyou",
    "abcdefghijklmnop",
    "密码密码密码密码密码密码密码密码",
}


def normalize_login_name(value: str) -> str:
    """Return the canonical NFKC/casefold login identifier or raise ValueError."""
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    if not 3 <= len(normalized) <= 32:
        raise ValueError("登录名长度需要为 3 到 32 个字符")
    if any(not (character.isalnum() or character in "._-") for character in normalized):
        raise ValueError("登录名只能包含 Unicode 字母、数字以及 . _ -")
    return normalized


def validate_password(value: str) -> str:
    """Validate the single-factor password policy without altering whitespace."""
    if not 15 <= len(value) <= 128:
        raise ValueError("安全密码长度需要为 15 到 128 个字符")
    normalized = unicodedata.normalize("NFKC", value).casefold()
    if normalized in _COMMON_PASSWORDS:
        raise ValueError("这个安全密码过于常见，请换一个更难猜的密码")
    return value


def hash_password(value: str) -> str:
    return _PASSWORD_HASHER.hash(validate_password(value))


def verify_password(encoded: str | None, candidate: str) -> bool:
    """Verify a password, using the same expensive path for users without a hash."""
    target = encoded or _DUMMY_HASH
    try:
        return bool(_PASSWORD_HASHER.verify(target, candidate)) and encoded is not None
    except (InvalidHashError, VerifyMismatchError):
        return False


@dataclass
class _FailureBucket:
    failures: int = 0
    blocked_until: float = 0.0


class LoginThrottle:
    """Small process-local account/IP throttle with exponential cooldowns."""

    def __init__(self) -> None:
        self._buckets: dict[str, _FailureBucket] = {}
        self._lock = Lock()

    def retry_after(self, *keys: str) -> int:
        now = time.monotonic()
        with self._lock:
            remaining = max((self._buckets.get(key, _FailureBucket()).blocked_until - now for key in keys), default=0)
        return max(0, int(remaining + 0.999))

    def fail(self, *keys: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                bucket = self._buckets.setdefault(key, _FailureBucket())
                bucket.failures += 1
                if bucket.failures >= 5:
                    cooldown = min(30 * (2 ** (bucket.failures - 5)), 15 * 60)
                    bucket.blocked_until = max(bucket.blocked_until, now + cooldown)

    def succeed(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._buckets.pop(key, None)

    def clear(self) -> None:
        """Reset process-local state, primarily for isolated application tests."""
        with self._lock:
            self._buckets.clear()


password_login_throttle = LoginThrottle()
