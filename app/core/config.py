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
    upload_dir: Path = Path("uploads")
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


@lru_cache
def get_settings() -> Settings:
    load_dotenv(ENV_FILE)
    return Settings(
        database_url=os.getenv("DATABASE_URL", Settings().database_url),
        admin_key=os.getenv("ADMIN_KEY", Settings().admin_key),
        upload_dir=Path(os.getenv("UPLOAD_DIR", str(Settings().upload_dir))),
        max_voice_bytes=int(os.getenv("MAX_VOICE_BYTES", str(Settings().max_voice_bytes))),
        max_image_bytes=int(os.getenv("MAX_IMAGE_BYTES", str(Settings().max_image_bytes))),
    )
