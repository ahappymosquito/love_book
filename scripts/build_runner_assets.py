"""Build and validate the generated Xiaohua runner sprite and scenery assets."""

from __future__ import annotations

import argparse
import math
from collections import deque
from pathlib import Path
from statistics import median

from PIL import Image, ImageDraw


CELL = 192
ATLAS_COLUMNS = 8
ACTION_SPECS = {
    "idle": (2, 2, 4),
    "run": (4, 2, 8),
    "jump": (4, 2, 8),
    "crouch": (3, 2, 6),
    "stumble": (3, 2, 6),
    "celebrate": (3, 2, 6),
}


def is_chroma(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, _ = pixel
    return blue > 120 and blue - red > 45 and blue - green > 35


def remove_chroma(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    cleaned = []
    for pixel in rgba.get_flattened_data():
        cleaned.append((0, 0, 0, 0) if is_chroma(pixel) else pixel)
    rgba.putdata(cleaned)
    return rgba


def zero_transparent_rgb(image: Image.Image) -> Image.Image:
    pixels = [(0, 0, 0, 0) if pixel[3] == 0 else pixel for pixel in image.get_flattened_data()]
    image.putdata(pixels)
    return image


def keep_largest_component(image: Image.Image) -> Image.Image:
    """Discard detached generation artifacts while preserving the connected subject."""
    alpha = image.getchannel("A")
    width, height = image.size
    opaque = bytearray(1 if value > 16 else 0 for value in alpha.get_flattened_data())
    seen = bytearray(width * height)
    largest: list[int] = []
    for start, value in enumerate(opaque):
        if not value or seen[start]:
            continue
        component: list[int] = []
        queue = deque([start])
        seen[start] = 1
        while queue:
            index = queue.popleft()
            component.append(index)
            x, y = index % width, index // width
            for adjacent in (index - 1, index + 1, index - width, index + width):
                if adjacent < 0 or adjacent >= width * height or seen[adjacent] or not opaque[adjacent]:
                    continue
                adjacent_x = adjacent % width
                if abs(adjacent_x - x) > 1:
                    continue
                seen[adjacent] = 1
                queue.append(adjacent)
        if len(component) > len(largest):
            largest = component
    keep = bytearray(width * height)
    for index in largest:
        keep[index] = 255
    image.putalpha(Image.frombytes("L", image.size, bytes(keep)))
    return image


def split_grid(path: Path, columns: int, rows: int, frame_count: int) -> list[Image.Image]:
    source = Image.open(path).convert("RGBA")
    frames: list[Image.Image] = []
    for index in range(frame_count):
        column, row = index % columns, index // columns
        box = (
            column * source.width // columns,
            row * source.height // rows,
            (column + 1) * source.width // columns,
            (row + 1) * source.height // rows,
        )
        frame = keep_largest_component(remove_chroma(source.crop(box)))
        bbox = frame.getbbox()
        if bbox is None:
            raise ValueError(f"Empty frame {index} in {path}")
        frames.append(frame.crop(bbox))
    return frames


def row_scale(frames: list[Image.Image], target_area: int = 12_500, max_extent: int = 176) -> float:
    areas = [sum(1 for value in frame.getchannel("A").get_flattened_data() if value) for frame in frames]
    scale = math.sqrt(target_area / median(areas))
    return min(scale, max_extent / max(max(frame.size) for frame in frames))


def place_frame(frame: Image.Image, scale: float, *, centered: bool) -> Image.Image:
    width = max(1, round(frame.width * scale))
    height = max(1, round(frame.height * scale))
    resized = frame.resize((width, height), Image.Resampling.NEAREST)
    output = Image.new("RGBA", (CELL, CELL))
    x = (CELL - width) // 2
    y = (CELL - height) // 2 if centered else CELL - 8 - height
    output.alpha_composite(resized, (x, y))
    return output


def build_character_atlas(source_dir: Path, output_dir: Path, qa_dir: Path) -> None:
    atlas = Image.new("RGBA", (CELL * ATLAS_COLUMNS, CELL * len(ACTION_SPECS)))
    normalized: dict[str, list[Image.Image]] = {}
    for row, (action, (columns, rows, count)) in enumerate(ACTION_SPECS.items()):
        frames = split_grid(source_dir / f"{action}.png", columns, rows, count)
        scale = row_scale(frames, max_extent=184 if action == "crouch" else 176)
        action_frames = [place_frame(frame, scale, centered=action == "jump") for frame in frames]
        normalized[action] = action_frames
        for column, frame in enumerate(action_frames):
            atlas.alpha_composite(frame, (column * CELL, row * CELL))

    zero_transparent_rgb(atlas)
    atlas.save(output_dir / "xiaohua-runner-atlas.webp", "WEBP", lossless=True, method=6, exact=True)
    atlas.save(qa_dir / "xiaohua-runner-contact-sheet.png")
    for action, frames in normalized.items():
        frames[0].save(
            qa_dir / f"{action}.gif",
            save_all=True,
            append_images=frames[1:],
            duration=90 if action == "run" else 120,
            loop=0,
            disposal=2,
            transparency=0,
        )


def crop_ratio(image: Image.Image, ratio: float) -> Image.Image:
    current = image.width / image.height
    if current > ratio:
        width = round(image.height * ratio)
        left = (image.width - width) // 2
        return image.crop((left, 0, left + width, image.height))
    height = round(image.width / ratio)
    top = (image.height - height) // 2
    return image.crop((0, top, image.width, top + height))


def build_scenery(source_dir: Path, output_dir: Path) -> None:
    for source_name, output_name, transparent in (
        ("scene-far.png", "runner-scene-far.webp", False),
        ("scene-mid.png", "runner-scene-mid.webp", True),
        ("scene-ground.png", "runner-scene-ground.webp", True),
    ):
        image = Image.open(source_dir / source_name).convert("RGBA")
        if transparent:
            image = remove_chroma(image)
        image = crop_ratio(image, 16 / 9).resize((1536, 864), Image.Resampling.LANCZOS)
        zero_transparent_rgb(image)
        image.save(output_dir / output_name, "WEBP", lossless=True, method=6, exact=True)


def fit_subject(frame: Image.Image, target_width: int, target_height: int, cell_size: int) -> Image.Image:
    scale = min(target_width / frame.width, target_height / frame.height)
    resized = frame.resize((round(frame.width * scale), round(frame.height * scale)), Image.Resampling.NEAREST)
    output = Image.new("RGBA", (cell_size, cell_size))
    output.alpha_composite(resized, ((cell_size - resized.width) // 2, cell_size - 10 - resized.height))
    return output


def build_obstacles(source_dir: Path, output_dir: Path, qa_dir: Path) -> None:
    frames = split_grid(source_dir / "obstacles.png", 2, 2, 4)
    targets = ((210, 154), (214, 164), (230, 120), (230, 92))
    atlas = Image.new("RGBA", (256 * 4, 256))
    for index, (frame, target) in enumerate(zip(frames, targets, strict=True)):
        atlas.alpha_composite(fit_subject(frame, *target, 256), (index * 256, 0))
    zero_transparent_rgb(atlas)
    atlas.save(output_dir / "runner-obstacles.webp", "WEBP", lossless=True, method=6, exact=True)
    atlas.save(qa_dir / "runner-obstacles-contact-sheet.png")

    bird_frames = split_grid(source_dir / "bird.png", 3, 2, 6)
    scale = row_scale(bird_frames, target_area=8_500, max_extent=176)
    normalized = [place_frame(frame, scale, centered=True) for frame in bird_frames]
    bird_atlas = Image.new("RGBA", (CELL * 6, CELL))
    for index, frame in enumerate(normalized):
        bird_atlas.alpha_composite(frame, (index * CELL, 0))
    zero_transparent_rgb(bird_atlas)
    bird_atlas.save(output_dir / "runner-bird.webp", "WEBP", lossless=True, method=6, exact=True)
    normalized[0].save(
        qa_dir / "bird.gif",
        save_all=True,
        append_images=normalized[1:],
        duration=100,
        loop=0,
        disposal=2,
        transparency=0,
    )


def validate_assets(output_dir: Path, qa_dir: Path) -> None:
    atlas = Image.open(qa_dir / "xiaohua-runner-contact-sheet.png").convert("RGBA")
    if atlas.size != (1536, 1152):
        raise ValueError(f"Unexpected character atlas size: {atlas.size}")
    row_stats: dict[str, list[tuple[tuple[int, int, int, int], int]]] = {}
    for row, (action, (_, _, count)) in enumerate(ACTION_SPECS.items()):
        stats: list[tuple[tuple[int, int, int, int], int]] = []
        for column in range(ATLAS_COLUMNS):
            cell = atlas.crop((column * CELL, row * CELL, (column + 1) * CELL, (row + 1) * CELL))
            populated = cell.getbbox() is not None
            if populated != (column < count):
                raise ValueError(f"Invalid cell occupancy at row {row}, column {column}")
            if populated:
                bbox = cell.getbbox()
                assert bbox is not None
                area = sum(1 for value in cell.getchannel("A").get_flattened_data() if value)
                stats.append((bbox, area))
        row_stats[action] = stats
    run_area = median(area for _, area in row_stats["run"])
    jump_area = median(area for _, area in row_stats["jump"])
    if not 0.9 <= jump_area / run_area <= 1.1:
        raise ValueError("Jump body area drifted away from the run identity scale")
    idle_height = median(box[3] - box[1] for box, _ in row_stats["idle"])
    crouch_heights = [box[3] - box[1] for box, _ in row_stats["crouch"]]
    if median(crouch_heights) > idle_height * 0.7 or min(crouch_heights) > idle_height * 0.58:
        raise ValueError("Crouch pose is not visibly low enough")
    for action in ("idle", "run", "crouch"):
        bottoms = [box[3] for box, _ in row_stats[action]]
        if max(bottoms) - min(bottoms) > 1:
            raise ValueError(f"{action} foot baseline drifted")
    for pixel in atlas.get_flattened_data():
        if pixel[3] == 0 and pixel[:3] != (0, 0, 0):
            raise ValueError("Transparent character pixels must have zeroed RGB channels")
    if (output_dir / "xiaohua-runner-atlas.webp").stat().st_size > 1_500_000:
        raise ValueError("Character atlas exceeds the 1.5 MB budget")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("qa_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.qa_dir.mkdir(parents=True, exist_ok=True)
    build_character_atlas(args.source_dir, args.output_dir, args.qa_dir)
    build_scenery(args.source_dir, args.output_dir)
    build_obstacles(args.source_dir, args.output_dir, args.qa_dir)
    validate_assets(args.output_dir, args.qa_dir)


if __name__ == "__main__":
    main()
