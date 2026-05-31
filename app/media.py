"""Media processing helpers for MP3 voice normalization, event thumbnails, and square JPEG avatars."""

from io import BytesIO
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageOps, UnidentifiedImageError


class MediaProcessingError(RuntimeError):
    pass


def normalize_voice_to_mp3(data: bytes, mime_type: str) -> bytes:
    if not data:
        raise MediaProcessingError("Voice audio is empty")

    suffix = {
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/mp4": ".m4a",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/aac": ".aac",
    }.get(mime_type, ".audio")

    with tempfile.TemporaryDirectory() as tmp_dir:
        source = Path(tmp_dir) / f"source{suffix}"
        target = Path(tmp_dir) / "voice.mp3"
        source.write_bytes(data)
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ar",
            "44100",
            "-ac",
            "1",
            "-b:a",
            "96k",
            str(target),
        ]
        try:
            result = subprocess.run(command, capture_output=True, check=False, timeout=30)
        except FileNotFoundError as exc:
            raise MediaProcessingError("ffmpeg is not installed") from exc
        except subprocess.TimeoutExpired as exc:
            raise MediaProcessingError("Voice conversion timed out") from exc

        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="ignore").strip()
            raise MediaProcessingError(detail or "Voice conversion failed")
        output = target.read_bytes() if target.exists() else b""
        if not output:
            raise MediaProcessingError("Voice conversion produced empty audio")
        return output


def make_image_thumbnail(data: bytes, max_size: int = 360, quality: int = 78) -> bytes:
    if not data:
        raise MediaProcessingError("Image data is empty")
    try:
        with Image.open(BytesIO(data)) as raw:
            image = ImageOps.exif_transpose(raw)
            image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            if image.mode in {"RGBA", "LA"}:
                background = Image.new("RGB", image.size, (255, 255, 255))
                alpha = image.getchannel("A")
                background.paste(image.convert("RGBA"), mask=alpha)
                image = background
            elif image.mode != "RGB":
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=quality, optimize=True)
            thumbnail = output.getvalue()
    except (OSError, UnidentifiedImageError) as exc:
        raise MediaProcessingError("Image thumbnail generation failed") from exc

    if not thumbnail:
        raise MediaProcessingError("Image thumbnail generation produced empty data")
    return thumbnail


def make_avatar_image(data: bytes, size: int = 256, quality: int = 84) -> bytes:
    if not data:
        raise MediaProcessingError("Avatar image data is empty")
    try:
        with Image.open(BytesIO(data)) as raw:
            image = ImageOps.exif_transpose(raw)
            image = ImageOps.fit(image, (size, size), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
            if image.mode in {"RGBA", "LA"}:
                background = Image.new("RGB", image.size, (255, 255, 255))
                alpha = image.getchannel("A")
                background.paste(image.convert("RGBA"), mask=alpha)
                image = background
            elif image.mode != "RGB":
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=quality, optimize=True)
            avatar = output.getvalue()
    except (OSError, UnidentifiedImageError) as exc:
        raise MediaProcessingError("Avatar image generation failed") from exc

    if not avatar:
        raise MediaProcessingError("Avatar image generation produced empty data")
    return avatar
