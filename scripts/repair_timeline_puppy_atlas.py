#!/usr/bin/env python3
"""Reassemble the Timeline puppy atlas with one centered sprite per 256px cell."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CELL_SIZE = 256
ATLAS_COLUMNS = 6
ATLAS_ROWS = 4
ALPHA_THRESHOLD = 16
SPRITE_PADDING = 4
MIN_SPRITE_WIDTH = 80


def _occupied_columns(row: Image.Image) -> list[bool]:
    alpha = row.getchannel("A")
    pixels = alpha.load()
    return [
        any(pixels[x, y] > ALPHA_THRESHOLD for y in range(alpha.height))
        for x in range(alpha.width)
    ]


def _sprite_runs(row: Image.Image) -> list[tuple[int, int]]:
    occupied = _occupied_columns(row)
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x, present in enumerate((*occupied, False)):
        if present and start is None:
            start = x
        elif not present and start is not None:
            if x - start >= MIN_SPRITE_WIDTH:
                runs.append((start, x))
            start = None
    return runs


def repair_atlas(source: Image.Image) -> Image.Image:
    rgba = source.convert("RGBA")
    expected_size = (CELL_SIZE * ATLAS_COLUMNS, CELL_SIZE * ATLAS_ROWS)
    if rgba.size != expected_size:
        raise ValueError(f"expected atlas size {expected_size}, got {rgba.size}")

    repaired = Image.new("RGBA", expected_size, (0, 0, 0, 0))
    for row_index in range(ATLAS_ROWS):
        row_top = row_index * CELL_SIZE
        row = rgba.crop((0, row_top, rgba.width, row_top + CELL_SIZE))
        runs = _sprite_runs(row)
        if len(runs) != ATLAS_COLUMNS:
            raise ValueError(
                f"row {row_index} contains {len(runs)} sprite runs; expected {ATLAS_COLUMNS}: {runs}"
            )

        for column_index, (left, right) in enumerate(runs):
            crop_left = max(0, left - SPRITE_PADDING)
            crop_right = min(row.width, right + SPRITE_PADDING)
            sprite = row.crop((crop_left, 0, crop_right, CELL_SIZE))
            if sprite.width > CELL_SIZE - SPRITE_PADDING * 2:
                raise ValueError(
                    f"row {row_index}, column {column_index} is too wide: {sprite.width}px"
                )
            target_left = column_index * CELL_SIZE + (CELL_SIZE - sprite.width) // 2
            repaired.alpha_composite(sprite, (target_left, row_top))

    return repaired


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    with Image.open(args.input) as opened:
        repaired = repair_atlas(opened)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    repaired.save(args.output, format="WEBP", quality=92, method=6)
    print(f"repaired Timeline puppy atlas: {args.output} ({args.output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
