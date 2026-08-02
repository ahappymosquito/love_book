"""Regression checks for stable per-frame alignment in the Timeline puppy atlas."""

from pathlib import Path

from PIL import Image


ATLAS_PATH = Path(__file__).parents[1] / "web" / "public" / "pets" / "xiaohua-home-atlas.webp"
CELL_SIZE = 256
ATLAS_COLUMNS = 6
ATLAS_ROWS = 4


def test_timeline_puppy_frames_keep_a_stable_horizontal_anchor() -> None:
    with Image.open(ATLAS_PATH) as source:
        atlas = source.convert("RGBA")

    assert atlas.size == (CELL_SIZE * ATLAS_COLUMNS, CELL_SIZE * ATLAS_ROWS)

    centers: list[float] = []
    for row in range(ATLAS_ROWS):
        for column in range(ATLAS_COLUMNS):
            frame = atlas.crop(
                (
                    column * CELL_SIZE,
                    row * CELL_SIZE,
                    (column + 1) * CELL_SIZE,
                    (row + 1) * CELL_SIZE,
                )
            )
            bbox = frame.getchannel("A").getbbox()
            assert bbox is not None, f"frame {row},{column} is empty"
            assert bbox[0] > 2 and bbox[2] < CELL_SIZE - 2, (
                f"frame {row},{column} touches a horizontal cell edge: {bbox}"
            )
            centers.append((bbox[0] + bbox[2]) / 2)

    assert max(abs(center - CELL_SIZE / 2) for center in centers) <= 2, centers
