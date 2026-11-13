"""Journal export tests: all/range/meeting scopes, month grouping, locked and wrapped-gift masking, and validation."""

from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image as PILImage

from tests.conftest import auth


def png_bytes() -> bytes:
    output = BytesIO()
    PILImage.new("RGB", (20, 20), color=(180, 200, 170)).save(output, format="PNG")
    return output.getvalue()


def entries(journal: dict) -> list[dict]:
    return [entry for month in journal["months"] for entry in month["entries"]]


def seed(client: TestClient, pair_tokens: dict) -> dict[str, int]:
    a, b = auth(str(pair_tokens["user_a_token"])), auth(str(pair_tokens["user_b_token"]))
    meeting = client.post(
        "/meeting-sessions",
        headers=a,
        json={"title": "七月见面", "started_on": "2026-07-20", "ended_on": "2026-07-22"},
    ).json()
    early = client.post(
        "/events", headers=a, json={"title": "六月的小事", "description": "公开", "occurred_at": "2026-06-10T04:00:00Z"}
    ).json()
    client.post(f"/events/{early['id']}/comments", headers=b, json={"text": "好呀"})
    client.post(
        f"/events/{early['id']}/images",
        headers=a,
        data={"width": "20", "height": "20"},
        files={"file": ("a.png", png_bytes(), "image/png")},
    )
    in_meeting = client.post(
        "/events", headers=b, json={"title": "见面那天", "occurred_at": "2026-07-21T04:00:00Z"}
    ).json()
    locked = client.post(
        "/events",
        headers=a,
        json={"title": "秘密小事", "description": "秘密", "visibility_mode": "mutual_submit", "occurred_at": "2026-07-21T05:00:00Z"},
    ).json()
    client.post(f"/events/{locked['id']}/comments", headers=a, json={"text": "我先写"})
    gift = client.post(
        "/events/gifts/wrap",
        headers=a,
        data={"title": "秘密礼物", "message": "秘密的话", "teaser": "软软的", "occurred_at": "2026-07-22T03:00:00Z"},
        files=[("files", ("g.png", png_bytes(), "image/png"))],
    ).json()
    return {"meeting": meeting["id"], "early": early["id"], "in_meeting": in_meeting["id"], "locked": locked["id"], "gift": gift["id"]}


def test_journal_all_scope_groups_months_and_masks_for_everyone(client: TestClient, pair_tokens: dict) -> None:
    ids = seed(client, pair_tokens)
    for token in (pair_tokens["user_a_token"], pair_tokens["user_b_token"]):
        response = client.get("/journal", headers=auth(str(token)))
        assert response.status_code == 200
        journal = response.json()
        assert journal["scope"] == "all"
        assert journal["title"] == "我们的手账"
        assert journal["start"] == "2026-06-10" and journal["end"] == "2026-07-22"
        assert [month["month"] for month in journal["months"]] == ["2026-06", "2026-07"]
        assert journal["months"][1]["label"] == "2026年7月"
        assert len(journal["pair"]["users"]) == 2
        assert journal["pair"]["users"][0]["id"] in {pair_tokens["user_a"]["id"], pair_tokens["user_b"]["id"]}
        assert journal["pair"]["together_days"] >= 1
        assert [meeting["title"] for meeting in journal["meetings"]] == ["七月见面"]

        by_id = {entry["id"]: entry for entry in entries(journal)}
        assert [entry["id"] for entry in entries(journal)] == [ids["early"], ids["in_meeting"], ids["locked"], ids["gift"]]
        early = by_id[ids["early"]]
        assert early["locked"] is False
        assert early["images"][0]["width"] == 20
        assert early["comments"][0]["content"] == "好呀"
        assert by_id[ids["in_meeting"]]["meeting_title"] == "七月见面"

        locked = by_id[ids["locked"]]
        assert locked["locked"] is True
        assert locked["title"] == "还没解锁的小事"
        assert locked["description"] is None and locked["comments"] == [] and locked["images"] == []

        gift = by_id[ids["gift"]]
        assert gift["kind"] == "gift"
        assert gift["title"] == "一份还没拆的礼物"
        assert gift["description"] is None and gift["images"] == []
        assert gift["gift"]["state"] == "wrapped"
        assert gift["gift"]["teaser"] == "软软的"
        assert gift["gift"]["sender_id"] == pair_tokens["user_a"]["id"]
        assert gift["gift"]["receiver_id"] == pair_tokens["user_b"]["id"]
        assert "秘密" not in response.text

        assert journal["stats"] == {"entry_count": 4, "image_count": 1, "gift_count": 1, "meeting_count": 1}

    client.post(f"/events/{ids['gift']}/gift/open", headers=auth(str(pair_tokens["user_b_token"])))
    opened = {entry["id"]: entry for entry in entries(client.get("/journal", headers=auth(str(pair_tokens["user_a_token"]))).json())}
    assert opened[ids["gift"]]["title"] == "秘密礼物"
    assert opened[ids["gift"]]["gift"]["state"] == "opened"
    assert len(opened[ids["gift"]]["images"]) == 1


def test_journal_range_and_meeting_scopes(client: TestClient, pair_tokens: dict) -> None:
    ids = seed(client, pair_tokens)
    headers = auth(str(pair_tokens["user_a_token"]))

    ranged = client.get("/journal", headers=headers, params={"scope": "range", "start": "2026-07-01", "end": "2026-07-21"})
    assert ranged.status_code == 200
    body = ranged.json()
    assert body["title"] == "2026.07.01 - 2026.07.21"
    assert body["start"] == "2026-07-01" and body["end"] == "2026-07-21"
    assert [entry["id"] for entry in entries(body)] == [ids["in_meeting"], ids["locked"]]
    assert body["stats"]["meeting_count"] == 1

    june = client.get("/journal", headers=headers, params={"scope": "range", "start": "2026-06-10", "end": "2026-06-10"}).json()
    assert [entry["id"] for entry in entries(june)] == [ids["early"]]
    assert june["meetings"] == []

    meeting = client.get("/journal", headers=headers, params={"scope": "meeting", "meeting_id": ids["meeting"]})
    assert meeting.status_code == 200
    meeting_body = meeting.json()
    assert meeting_body["title"] == "七月见面"
    assert meeting_body["start"] == "2026-07-20" and meeting_body["end"] == "2026-07-22"
    assert {entry["id"] for entry in entries(meeting_body)} == {ids["in_meeting"], ids["locked"], ids["gift"]}


def test_journal_validation_and_cross_pair(client: TestClient, pair_tokens: dict) -> None:
    ids = seed(client, pair_tokens)
    headers = auth(str(pair_tokens["user_a_token"]))
    assert client.get("/journal", headers=headers, params={"scope": "range", "start": "2026-07-02", "end": "2026-07-01"}).status_code == 422
    assert client.get("/journal", headers=headers, params={"scope": "range", "start": "2026-07-01"}).status_code == 422
    assert client.get("/journal", headers=headers, params={"scope": "range", "start": "bad", "end": "2026-07-01"}).status_code == 422
    assert client.get("/journal", headers=headers, params={"scope": "meeting"}).status_code == 422
    assert client.get("/journal", headers=headers, params={"scope": "weird"}).status_code == 422
    assert client.get("/journal", headers=headers, params={"scope": "meeting", "meeting_id": 99999}).status_code == 404
    assert client.get("/journal").status_code == 401

    other = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    other_headers = auth(other["user_a_token"])
    assert client.get("/journal", headers=other_headers, params={"scope": "meeting", "meeting_id": ids["meeting"]}).status_code == 404
    assert entries(client.get("/journal", headers=other_headers).json()) == []
