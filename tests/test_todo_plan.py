"""Tests for the meeting-centred todo plan: empty start, pair isolation, meeting assignment, one-tap completion,
"write into the journal", meeting merge/cancel side effects, image lifecycle, and the one-time legacy backfill."""

from datetime import datetime, timedelta, timezone
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image as PILImage
from sqlalchemy import select, text
from sqlalchemy.orm import Session

import app.core.database as database
from app.models import Event, EventKind, Image as DBImage, TodoImage, TodoItem
from app.services import MEETING_TZ
from app.storage import media_path
from tests.conftest import auth


def png_bytes() -> bytes:
    buffer = BytesIO()
    PILImage.new("RGB", (8, 8), (220, 120, 140)).save(buffer, format="PNG")
    return buffer.getvalue()


def beijing_today():
    return datetime.now(MEETING_TZ).date()


def create_meeting(client: TestClient, token: str, title: str, start, end) -> dict:
    response = client.post(
        "/meeting-sessions",
        headers=auth(token),
        json={"title": title, "started_on": start.isoformat(), "ended_on": end.isoformat()},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_item(client: TestClient, token: str, **payload) -> dict:
    response = client.post("/todos/items", headers=auth(token), json={"category": "food", **payload})
    assert response.status_code == 201, response.text
    return response.json()


def other_pair(client: TestClient) -> dict:
    return client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()


def test_plan_requires_login_and_starts_empty(client: TestClient, pair_tokens: dict) -> None:
    token = str(pair_tokens["user_a_token"])
    assert client.get("/todos/plan").status_code == 401

    first = client.get("/todos/plan", headers=auth(token)).json()
    assert first == {"today": beijing_today().isoformat(), "focus_meeting_id": None, "meetings": [], "items": []}

    item = create_item(client, token, title="唱歌", category="play")
    assert client.delete(f"/todos/items/{item['id']}", headers=auth(token)).status_code == 204
    assert client.get("/todos/plan", headers=auth(token)).json()["items"] == []


def test_items_and_meetings_are_pair_isolated(client: TestClient, pair_tokens: dict) -> None:
    token = str(pair_tokens["user_a_token"])
    item = create_item(client, token, title="看展", category="play")
    meeting = create_meeting(client, token, "周末见", beijing_today() + timedelta(days=5), beijing_today() + timedelta(days=6))
    stranger = other_pair(client)

    assert client.get(f"/todos/items/{item['id']}", headers=auth(stranger["user_a_token"])).status_code == 404
    assert client.patch(
        f"/todos/items/{item['id']}", headers=auth(stranger["user_a_token"]), json={"completed": True}
    ).status_code == 404
    foreign_meeting = client.post(
        "/todos/items",
        headers=auth(stranger["user_a_token"]),
        json={"category": "food", "title": "偷偷挂过去", "meeting_session_id": meeting["id"]},
    )
    assert foreign_meeting.status_code == 404


def test_items_attach_to_the_next_meeting_and_move_back_to_the_pool(client: TestClient, pair_tokens: dict) -> None:
    token = str(pair_tokens["user_a_token"])
    today = beijing_today()
    past = create_meeting(client, token, "上次", today - timedelta(days=30), today - timedelta(days=29))
    later = create_meeting(client, token, "再下次", today + timedelta(days=20), today + timedelta(days=21))
    upcoming = create_meeting(client, token, "下次", today + timedelta(days=3), today + timedelta(days=4))

    prep = create_item(client, token, title="订高铁票", category="prep", meeting_session_id=upcoming["id"])
    wish = create_item(client, token, title="去看海", category="play")
    plan = client.get("/todos/plan", headers=auth(token)).json()

    assert plan["focus_meeting_id"] == upcoming["id"]
    assert [meeting["id"] for meeting in plan["meetings"]] == [upcoming["id"], later["id"]]
    assert past["id"] not in [meeting["id"] for meeting in plan["meetings"]]
    by_id = {item["id"]: item for item in plan["items"]}
    assert by_id[prep["id"]]["meeting_session_id"] == upcoming["id"]
    assert by_id[prep["id"]]["category"] == "prep"
    assert by_id[wish["id"]]["meeting_session_id"] is None

    moved = client.patch(f"/todos/items/{wish['id']}", headers=auth(token), json={"meeting_session_id": upcoming["id"]})
    untouched = client.patch(f"/todos/items/{wish['id']}", headers=auth(token), json={"note": "带上相机"})
    back = client.patch(f"/todos/items/{prep['id']}", headers=auth(token), json={"meeting_session_id": None})

    assert moved.json()["meeting_session_id"] == upcoming["id"]
    assert untouched.json()["meeting_session_id"] == upcoming["id"]
    assert untouched.json()["note"] == "带上相机"
    assert back.json()["meeting_session_id"] is None


def test_either_partner_completes_with_one_tap_and_can_undo(client: TestClient, pair_tokens: dict) -> None:
    item = create_item(client, str(pair_tokens["user_a_token"]), title="吃火锅")

    done = client.patch(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_b_token"])), json={"completed": True})
    again = client.patch(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_a_token"])), json={"completed": True})
    undone = client.patch(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_a_token"])), json={"completed": False})

    assert done.status_code == 200
    assert done.json()["completed_at"]
    assert done.json()["completed_by_id"] == pair_tokens["user_b"]["id"]
    assert again.json()["completed_by_id"] == pair_tokens["user_b"]["id"]
    assert again.json()["completed_at"] == done.json()["completed_at"]
    assert undone.json()["completed_at"] is None
    assert undone.json()["completed_by_id"] is None


def test_write_into_journal_creates_one_meeting_event_with_note_comments_and_photos(
    client: TestClient, pair_tokens: dict, db_session: Session
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    today = beijing_today()
    meeting = create_meeting(client, token_a, "这次见面", today, today + timedelta(days=1))
    item = create_item(client, token_a, title="江西小炒", note="靠窗的位置", meeting_session_id=meeting["id"])
    client.post(f"/todos/items/{item['id']}/comments", headers=auth(token_a), json={"text": "辣得好开心"})
    client.post(f"/todos/items/{item['id']}/comments", headers=auth(token_b), json={"text": "下次还来"})
    client.post(
        f"/todos/items/{item['id']}/images",
        headers=auth(token_b),
        files={"file": ("photo.png", png_bytes(), "image/png")},
    )

    early = client.post(f"/todos/items/{item['id']}/journal", headers=auth(token_a))
    client.patch(f"/todos/items/{item['id']}", headers=auth(token_b), json={"completed": True})
    written = client.post(f"/todos/items/{item['id']}/journal", headers=auth(token_a))
    repeated = client.post(f"/todos/items/{item['id']}/journal", headers=auth(token_b))

    assert early.status_code == 409
    assert written.status_code == 200
    assert written.json()["created"] is True
    assert repeated.json() == {"event_id": written.json()["event_id"], "created": False}

    event = client.get(f"/events/{written.json()['event_id']}", headers=auth(token_b)).json()
    assert event["title"] == "江西小炒"
    assert event["description"] == "靠窗的位置\n\nA：辣得好开心\nB：下次还来"
    assert event["event_kind"] == EventKind.offline_meeting
    assert event["meeting_session_id"] == meeting["id"]
    assert event["visibility_mode"] == "public"
    assert event["image_count"] == 1

    copied = db_session.execute(select(DBImage).where(DBImage.event_id == event["id"])).scalars().one()
    source = db_session.execute(select(TodoImage).where(TodoImage.item_id == item["id"])).scalars().one()
    assert copied.storage_key != source.storage_key
    assert copied.storage_key.startswith("images/originals/")
    assert media_path(copied.storage_key).read_bytes() == media_path(source.storage_key).read_bytes()
    assert media_path(copied.thumb_storage_key).is_file()

    plan_item = next(row for row in client.get("/todos/plan", headers=auth(token_a)).json()["items"] if row["id"] == item["id"])
    assert plan_item["journal_event_id"] == event["id"]
    assert client.delete(f"/events/{event['id']}", headers=auth(token_a)).status_code == 204
    plan_item = next(row for row in client.get("/todos/plan", headers=auth(token_a)).json()["items"] if row["id"] == item["id"])
    assert plan_item["journal_event_id"] is None


def test_journal_entry_for_item_finished_after_its_meeting_lands_on_the_meeting(
    client: TestClient, pair_tokens: dict, db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    today = beijing_today()
    last_day = today - timedelta(days=9)
    meeting = create_meeting(client, token, "上周末", today - timedelta(days=10), last_day)
    item = create_item(client, token, title="拼乐高", category="play", meeting_session_id=meeting["id"])
    client.patch(f"/todos/items/{item['id']}", headers=auth(token), json={"completed": True})

    event_id = client.post(f"/todos/items/{item['id']}/journal", headers=auth(token)).json()["event_id"]
    event = db_session.get(Event, event_id)

    occurred = event.occurred_at if event.occurred_at.tzinfo else event.occurred_at.replace(tzinfo=timezone.utc)
    assert occurred.astimezone(MEETING_TZ).date() == last_day
    assert event.meeting_session_id == meeting["id"]
    assert event.event_kind == EventKind.offline_meeting


def test_cancelling_a_meeting_returns_items_to_the_pool_and_merging_keeps_them(client: TestClient, pair_tokens: dict) -> None:
    token = str(pair_tokens["user_a_token"])
    today = beijing_today()
    first = create_meeting(client, token, "先定的", today + timedelta(days=10), today + timedelta(days=11))
    second = create_meeting(client, token, "后定的", today + timedelta(days=30), today + timedelta(days=31))
    moved = create_item(client, token, title="住一晚", category="stay", meeting_session_id=second["id"])

    merged = client.patch(
        f"/meeting-sessions/{second['id']}",
        headers=auth(token),
        json={"started_on": (today + timedelta(days=11)).isoformat(), "ended_on": (today + timedelta(days=12)).isoformat()},
    )
    assert merged.json()["id"] == first["id"]
    assert client.get(f"/todos/items/{moved['id']}", headers=auth(token)).json()["meeting_session_id"] == first["id"]

    assert client.delete(f"/meeting-sessions/{first['id']}", headers=auth(token)).status_code == 204
    assert client.get(f"/todos/items/{moved['id']}", headers=auth(token)).json()["meeting_session_id"] is None


def test_items_can_be_placed_on_a_meeting_day_and_time_slot(client: TestClient, pair_tokens: dict) -> None:
    token = str(pair_tokens["user_a_token"])
    today = beijing_today()
    meeting = create_meeting(client, token, "三天两晚", today + timedelta(days=5), today + timedelta(days=7))
    second_day = (today + timedelta(days=6)).isoformat()

    placed = create_item(
        client, token, title="火锅", meeting_session_id=meeting["id"], scheduled_on=second_day, start_minute=18 * 60 + 30
    )
    assert (placed["scheduled_on"], placed["start_minute"], placed["end_minute"]) == (second_day, 1110, 1170)

    moved = client.patch(f"/todos/items/{placed['id']}", headers=auth(token), json={"start_minute": 12 * 60, "end_minute": 13 * 60 + 30})
    assert (moved.json()["start_minute"], moved.json()["end_minute"]) == (720, 810)

    all_day = client.patch(f"/todos/items/{placed['id']}", headers=auth(token), json={"start_minute": None})
    assert all_day.json()["scheduled_on"] == second_day
    assert (all_day.json()["start_minute"], all_day.json()["end_minute"]) == (None, None)

    outside = client.patch(f"/todos/items/{placed['id']}", headers=auth(token), json={"scheduled_on": today.isoformat()})
    backwards = client.patch(
        f"/todos/items/{placed['id']}", headers=auth(token), json={"start_minute": 600, "end_minute": 540}
    )
    no_meeting = client.post(
        "/todos/items", headers=auth(token), json={"category": "food", "title": "飘着", "scheduled_on": second_day}
    )
    assert outside.status_code == backwards.status_code == no_meeting.status_code == 422

    client.patch(f"/todos/items/{placed['id']}", headers=auth(token), json={"start_minute": 600})
    unplaced = client.patch(f"/todos/items/{placed['id']}", headers=auth(token), json={"scheduled_on": None})
    assert (unplaced.json()["scheduled_on"], unplaced.json()["start_minute"], unplaced.json()["end_minute"]) == (None, None, None)

    client.patch(f"/todos/items/{placed['id']}", headers=auth(token), json={"scheduled_on": second_day, "start_minute": 600})
    assert client.delete(f"/meeting-sessions/{meeting['id']}", headers=auth(token)).status_code == 204
    detached = client.get(f"/todos/items/{placed['id']}", headers=auth(token)).json()
    assert (detached["meeting_session_id"], detached["scheduled_on"], detached["start_minute"]) == (None, None, None)


def test_wish_category_is_gone_and_old_wishes_are_purged(client: TestClient, pair_tokens: dict, db_session: Session) -> None:
    token = str(pair_tokens["user_a_token"])
    assert client.post("/todos/items", headers=auth(token), json={"category": "wish", "title": "去看海"}).status_code == 422
    kept = create_item(client, token, title="吃面", category="food")
    old = create_item(client, token, title="旧心愿", category="play")
    client.post(f"/todos/items/{old['id']}/comments", headers=auth(token), json={"text": "好想去"})
    photo = client.post(f"/todos/items/{old['id']}/images", headers=auth(token), files={"file": ("a.png", png_bytes(), "image/png")}).json()
    photo_path = media_path(db_session.get(TodoImage, photo["id"]).storage_key)
    db_session.execute(text("UPDATE todo_items SET category = 'wish' WHERE id = :id"), {"id": old["id"]})
    db_session.commit()

    assert database._purge_wish_todos(db_session.get_bind()) == 1
    db_session.expire_all()

    assert db_session.get(TodoItem, old["id"]) is None
    assert db_session.get(TodoItem, kept["id"]) is not None
    assert db_session.execute(text("SELECT COUNT(*) FROM todo_comments WHERE item_id = :id"), {"id": old["id"]}).scalar_one() == 0
    assert not photo_path.exists()
    assert database._purge_wish_todos(db_session.get_bind()) == 0


def test_new_future_meeting_invites_the_partner_by_email(client: TestClient, monkeypatch) -> None:
    sent: list[dict] = []
    monkeypatch.setattr("app.emailer.send_email", lambda to, subject, text_body, html_body=None: sent.append({"to": to, "subject": subject, "text": text_body}) or True)
    pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "小A", "user_b_display_name": "小B", "user_a_email": "a@example.com", "user_b_email": "b@example.com"},
    ).json()
    today = beijing_today()

    created = create_meeting(client, pair["user_a_token"], "周末见", today + timedelta(days=3), today + timedelta(days=5))
    create_meeting(client, pair["user_b_token"], "补上的旧见面", today - timedelta(days=40), today - timedelta(days=39))
    create_meeting(client, pair["user_b_token"], "重叠的", today + timedelta(days=4), today + timedelta(days=6))

    assert len(sent) == 1
    assert sent[0]["to"] == "b@example.com"
    assert "小A 定好了下次见面" in sent[0]["subject"]
    assert "3 天" in sent[0]["subject"]
    assert f"/todo?meeting={created['id']}" in sent[0]["text"]


def test_todo_images_are_shared_by_the_pair_and_removed_with_the_item(
    client: TestClient, pair_tokens: dict, db_session: Session
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    item = create_item(client, token_a, title="上传照片", category="play")
    first = client.post(f"/todos/items/{item['id']}/images", headers=auth(token_a), files={"file": ("a.png", png_bytes(), "image/png")}).json()
    second = client.post(f"/todos/items/{item['id']}/images", headers=auth(token_a), files={"file": ("b.png", png_bytes(), "image/png")}).json()
    first_row = db_session.get(TodoImage, first["id"])
    second_row = db_session.get(TodoImage, second["id"])
    first_paths = [media_path(first_row.storage_key), media_path(first_row.thumb_storage_key)]
    second_paths = [media_path(second_row.storage_key), media_path(second_row.thumb_storage_key)]

    full = client.get(f"/todo-images/{first['id']}/file", headers=auth(token_b))
    thumb = client.get(f"/todo-images/{first['id']}/thumb", headers=auth(token_b))
    blocked = client.delete(f"/todo-images/{first['id']}", headers=auth(other_pair(client)["user_a_token"]))
    deleted = client.delete(f"/todo-images/{first['id']}", headers=auth(token_b))

    assert full.status_code == 200 and full.headers["content-type"].startswith("image/png")
    assert thumb.status_code == 200 and thumb.headers["content-type"].startswith("image/jpeg")
    assert blocked.status_code == 404
    assert deleted.status_code == 204
    assert not any(path.exists() for path in first_paths)
    assert all(path.is_file() for path in second_paths)

    assert client.delete(f"/todos/items/{item['id']}", headers=auth(token_a)).status_code == 204
    assert not any(path.exists() for path in second_paths)


def test_deleting_an_item_clears_its_rows_in_retired_tables(client: TestClient, pair_tokens: dict, db_session: Session) -> None:
    token = str(pair_tokens["user_a_token"])
    item = create_item(client, token, title="老数据")
    db_session.execute(text("CREATE TABLE todo_schedules (id INTEGER PRIMARY KEY, pair_id INTEGER, item_id INTEGER, scheduled_on DATE)"))
    db_session.execute(
        text("INSERT INTO todo_schedules (pair_id, item_id, scheduled_on) VALUES (:pair_id, :item_id, '2026-05-01')"),
        {"pair_id": pair_tokens["pair_id"], "item_id": item["id"]},
    )
    db_session.commit()

    assert client.delete(f"/todos/items/{item['id']}", headers=auth(token)).status_code == 204
    assert db_session.execute(text("SELECT COUNT(*) FROM todo_schedules")).scalar_one() == 0


def test_backfill_marks_old_two_comment_items_done_and_joins_scheduled_meetings(
    client: TestClient, pair_tokens: dict, db_session: Session
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    today = beijing_today()
    meeting = create_meeting(client, token_a, "那次", today + timedelta(days=7), today + timedelta(days=8))
    both = create_item(client, token_a, title="两个人都打过卡")
    single = create_item(client, token_a, title="只有一个人打卡")
    client.post(f"/todos/items/{both['id']}/comments", headers=auth(token_a), json={"text": "去过啦"})
    client.post(f"/todos/items/{both['id']}/comments", headers=auth(token_b), json={"text": "我也是"})
    client.post(f"/todos/items/{single['id']}/comments", headers=auth(token_a), json={"text": "我先"})
    db_session.execute(text("CREATE TABLE todo_schedules (id INTEGER PRIMARY KEY, pair_id INTEGER, item_id INTEGER, scheduled_on DATE)"))
    db_session.execute(
        text("INSERT INTO todo_schedules (pair_id, item_id, scheduled_on) VALUES (:pair_id, :item_id, :day)"),
        {"pair_id": pair_tokens["pair_id"], "item_id": single["id"], "day": (today + timedelta(days=8)).isoformat()},
    )
    db_session.commit()

    database._backfill_todo_plan(
        db_session.get_bind(), {("todo_items", "completed_at"), ("todo_items", "meeting_session_id")}
    )
    db_session.expire_all()

    assert db_session.get(TodoItem, both["id"]).completed_at is not None
    assert db_session.get(TodoItem, single["id"]).completed_at is None
    assert db_session.get(TodoItem, single["id"]).meeting_session_id == meeting["id"]
    assert db_session.get(TodoItem, both["id"]).meeting_session_id is None
