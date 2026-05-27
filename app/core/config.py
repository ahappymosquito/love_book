"""Environment-backed application settings for database, media limits, SMTP, and public URLs."""

from functools import lru_cache
from pathlib import Path
import os

from dotenv import load_dotenv
from pydantic import BaseModel

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = PROJECT_ROOT / ".env"


class Settings(BaseModel):
    app_name: str = "Pair Events API"
    database_url: str = "sqlite:///./pair_events.db"
    admin_key: str = "change-me"
    max_voice_bytes: int = 10 * 1024 * 1024
    max_image_bytes: int = 10 * 1024 * 1024
    allowed_voice_mime_types: set[str] = {
        "audio/mpeg",
        "audio/mp3",
        "audio/mp4",
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
        "audio/ogg",
        "audio/aac",
    }
    allowed_image_mime_types: set[str] = {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    }

    # SMTP
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_from: str = ""
    smtp_from_name: str = "我们之间的小事"
    smtp_use_ssl: bool = True
    app_web_url: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    load_dotenv(ENV_FILE)
    defaults = Settings()
    return Settings(
        database_url=os.getenv("DATABASE_URL", defaults.database_url),
        admin_key=os.getenv("ADMIN_KEY", defaults.admin_key),
        max_voice_bytes=int(os.getenv("MAX_VOICE_BYTES", str(defaults.max_voice_bytes))),
        max_image_bytes=int(os.getenv("MAX_IMAGE_BYTES", str(defaults.max_image_bytes))),
        smtp_host=os.getenv("SMTP_HOST", defaults.smtp_host),
        smtp_port=int(os.getenv("SMTP_PORT", str(defaults.smtp_port))),
        smtp_user=os.getenv("SMTP_USER", defaults.smtp_user),
        smtp_pass=os.getenv("SMTP_PASS", defaults.smtp_pass),
        smtp_from=os.getenv("SMTP_FROM", os.getenv("SMTP_USER", defaults.smtp_from)),
        smtp_from_name=os.getenv("SMTP_FROM_NAME", defaults.smtp_from_name),
        smtp_use_ssl=os.getenv("SMTP_USE_SSL", "1") not in {"0", "false", "False"},
        app_web_url=os.getenv("APP_WEB_URL", defaults.app_web_url),
    )
