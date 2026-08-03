"""Validate the login runner puppy atlas geometry, transparency, and used cells."""

from pathlib import Path

from PIL import Image


ATLAS_PATH = Path(__file__).parents[1] / "web" / "public" / "game" / "xiaohua-runner-atlas.webp"
CELL_SIZE = 128
ATLAS_COLUMNS = 8
FRAME_COUNTS = (4, 8, 6, 6, 6)


def test_runner_puppy_atlas_contract() -> None:
    with Image.open(ATLAS_PATH) as source:
        atlas = source.convert("RGBA")

    assert atlas.size == (CELL_SIZE * ATLAS_COLUMNS, CELL_SIZE * len(FRAME_COUNTS))
    assert atlas.getpixel((0, 0))[3] == 0

    for row, frame_count in enumerate(FRAME_COUNTS):
        occupied_bounds: list[tuple[int, int, int, int]] = []
        for column in range(ATLAS_COLUMNS):
            cell = atlas.crop(
                (
                    column * CELL_SIZE,
                    row * CELL_SIZE,
                    (column + 1) * CELL_SIZE,
                    (row + 1) * CELL_SIZE,
                )
            )
            alpha = cell.getchannel("A")
            bounds = alpha.getbbox()
            if column < frame_count:
                assert bounds is not None, f"row {row} frame {column} is empty"
                assert bounds[2] - bounds[0] >= 32
                assert bounds[3] - bounds[1] >= 32
                occupied_bounds.append(bounds)
            else:
                assert bounds is None, f"row {row} unused cell {column} is not transparent"

        if row in (0, 1, 3):
            bottoms = [bounds[3] for bounds in occupied_bounds]
            assert max(bottoms) - min(bottoms) <= 14, f"row {row} has an unstable foot baseline"


def test_runner_puppy_atlas_has_clean_transparent_pixels() -> None:
    with Image.open(ATLAS_PATH) as source:
        atlas = source.convert("RGBA")

    assert all(
        alpha != 0 or (red == 0 and green == 0 and blue == 0)
        for red, green, blue, alpha in atlas.get_flattened_data()
    )
