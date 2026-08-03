"""Validate the six-action Xiaohua atlas geometry, scale, anchors, transparency, and file budget."""

from pathlib import Path
from statistics import median

from PIL import Image


GAME_DIR = Path(__file__).parents[1] / "web" / "public" / "game"
ATLAS_PATH = GAME_DIR / "xiaohua-runner-atlas.webp"
CONTACT_SHEET_PATH = GAME_DIR / "qa" / "xiaohua-runner-contact-sheet.png"
CELL_SIZE = 192
ATLAS_COLUMNS = 8
ACTIONS = ("idle", "run", "jump", "crouch", "stumble", "celebrate")
FRAME_COUNTS = (4, 8, 8, 6, 6, 6)


def test_runner_puppy_atlas_contract() -> None:
    with Image.open(ATLAS_PATH) as source:
        atlas = source.convert("RGBA")

    assert atlas.size == (1536, 1152)
    assert ATLAS_PATH.stat().st_size <= 1_500_000
    row_bounds: dict[str, list[tuple[int, int, int, int]]] = {}
    row_areas: dict[str, list[int]] = {}
    for row, (action, frame_count) in enumerate(zip(ACTIONS, FRAME_COUNTS, strict=True)):
        occupied_bounds: list[tuple[int, int, int, int]] = []
        occupied_areas: list[int] = []
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
                assert bounds is not None, f"{action} frame {column} is empty"
                assert bounds[2] - bounds[0] >= 48
                assert bounds[3] - bounds[1] >= 48
                occupied_bounds.append(bounds)
                occupied_areas.append(sum(1 for value in alpha.get_flattened_data() if value))
            else:
                assert bounds is None, f"{action} unused cell {column} is not transparent"
        row_bounds[action] = occupied_bounds
        row_areas[action] = occupied_areas

    for action in ("idle", "run", "crouch"):
        bottoms = [bounds[3] for bounds in row_bounds[action]]
        assert max(bottoms) - min(bottoms) <= 1, f"{action} foot baseline drifted"
    assert 0.9 <= median(row_areas["jump"]) / median(row_areas["run"]) <= 1.1
    idle_height = median(bounds[3] - bounds[1] for bounds in row_bounds["idle"])
    crouch_heights = [bounds[3] - bounds[1] for bounds in row_bounds["crouch"]]
    assert median(crouch_heights) <= idle_height * 0.7
    assert min(crouch_heights) <= idle_height * 0.58


def test_runner_puppy_contact_sheet_has_clean_transparent_pixels() -> None:
    # PNG is the canonical lossless QA surface; WebP decoders may synthesize hidden RGB values.
    with Image.open(CONTACT_SHEET_PATH) as source:
        atlas = source.convert("RGBA")

    assert all(
        alpha != 0 or (red == 0 and green == 0 and blue == 0)
        for red, green, blue, alpha in atlas.get_flattened_data()
    )
