"""Media processing helpers for event thumbnails and square JPEG avatars."""

from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError


class MediaProcessingError(RuntimeError):
    pass


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
