"""Wrapped-gift API tests: receiver masking, unwrap gate, receiver response, sender edit lock, and content-free emails."""

from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image as PILImage
from sqlalchemy.orm import Session

from app.models import Event
from tests.conftest import auth


def png_bytes() -> bytes:
    output = BytesIO()
    PILImage.new("RGB", (32, 24), color=(200, 120, 140)).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def mailbox(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    sent: list[dict[str, str]] = []

    def fake_send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        sent.append({"to": to, "subject": subject, "text": text_body, "html": html_body or ""})
        return True

    monkeypatch.setattr("app.emailer.send_email", fake_send_email)
    return sent


@pytest.fixture
def emailed_pair(client: TestClient) -> dict:
    response = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "小A",
            "user_b_display_name": "小B",
            "user_a_email": "a@example.com",
            "user_b_email": "b@example.com",
        },
    )
    assert response.status_code == 200
    return response.json()


def wrap(client: TestClient, token: str, **data: str) -> dict:
    payload = {"title": "秘密礼物名", "message": "秘密的话", "teaser": "猜猜是什么", "wrap_style": "starry", **data}
    response = client.post(
        "/events/gifts/wrap",
        headers=auth(token),
        data=payload,
        files=[("files", ("gift.png", png_bytes(), "image/png"))],
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_wrap_open_respond_flow_with_masking_and_content_free_emails(
    client: TestClient, emailed_pair: dict, mailbox: list[dict[str, str]], db_session: Session
) -> None:
    sender, receiver = emailed_pair["user_a_token"], emailed_pair["user_b_token"]
    open_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    gift = wrap(client, sender, open_at=open_at)
    gift_id = gift["id"]

    assert gift["event_kind"] == "gift"
    assert gift["gift_state"] == "wrapped"
    assert gift["gift_receiver_id"] == emailed_pair["user_b"]["id"]
    assert gift["gift_wrap_style"] == "starry"
    assert gift["gift_masked"] is False
    assert gift["gift_can_open"] is False
    assert gift["title"] == "秘密礼物名"
    assert gift["visibility_mode"] == "public"
    assert len(gift["contents"]["images"]) == 1
    image_id = gift["contents"]["images"][0]["id"]

    wrap_mail = mailbox[-1]
    assert wrap_mail["to"] == "b@example.com"
    assert "你收到一份礼物" in wrap_mail["subject"]
    combined = "\n".join(wrap_mail.values())
    for secret in ("秘密礼物名", "秘密的话", "猜猜是什么"):
        assert secret not in combined
    assert f"/timeline/{gift_id}" in combined

    masked = client.get(f"/events/{gift_id}", headers=auth(receiver)).json()
    assert masked["title"] == ""
    assert masked["description"] is None
    assert masked["gift_masked"] is True
    assert masked["gift_teaser"] == "猜猜是什么"
    assert masked["image_count"] == 0
    assert masked["preview_image"] is None
    assert masked["contents"]["images"] == []
    assert masked["gift_can_open"] is False
    listed = next(item for item in client.get("/events", headers=auth(receiver)).json() if item["id"] == gift_id)
    assert listed["title"] == "" and listed["gift_masked"] is True and listed["image_count"] == 0
    assert client.get(f"/images/{image_id}/thumb", headers=auth(receiver)).status_code == 403
    assert client.get(f"/events/{gift_id}/contents", headers=auth(receiver)).json()["images"] == []

    sender_comment = client.post(f"/events/{gift_id}/comments", headers=auth(sender), json={"text": "秘密留言"})
    assert sender_comment.status_code == 201
    comment_mail = mailbox[-1]
    assert "秘密留言" not in "\n".join(comment_mail.values())
    assert "秘密礼物名" not in "\n".join(comment_mail.values())
    assert client.get(f"/events/{gift_id}", headers=auth(receiver)).json()["contents"]["comments"] == []
    assert client.post(f"/events/{gift_id}/comments", headers=auth(receiver), json={"text": "hi"}).status_code == 409
    assert client.post(f"/events/{gift_id}/gift/open", headers=auth(sender)).status_code == 403
    assert client.put(
        f"/events/{gift_id}/gift/response", headers=auth(receiver), json={"rating": 5}
    ).status_code == 409

    too_early = client.post(f"/events/{gift_id}/gift/open", headers=auth(receiver))
    assert too_early.status_code == 409
    assert too_early.json()["detail"] == "还没到拆开的时间"

    patched = client.patch(f"/events/{gift_id}", headers=auth(sender), json={"open_at": None, "teaser": "快拆"})
    assert patched.status_code == 200
    assert patched.json()["gift_open_at"] is None
    assert patched.json()["gift_teaser"] == "快拆"
    assert client.get(f"/events/{gift_id}", headers=auth(receiver)).json()["gift_can_open"] is True
    assert client.patch(f"/events/{gift_id}", headers=auth(receiver), json={"title": "改"}).status_code == 403

    mailbox.clear()
    opened = client.post(f"/events/{gift_id}/gift/open", headers=auth(receiver))
    assert opened.status_code == 200
    body = opened.json()
    assert body["gift_state"] == "opened"
    assert body["gift_masked"] is False
    assert body["gift_opened_at"] is not None
    assert body["title"] == "秘密礼物名"
    assert body["description"] == "秘密的话"
    assert len(body["contents"]["images"]) == 1
    assert len(body["contents"]["comments"]) == 1
    assert len(mailbox) == 1
    assert mailbox[0]["to"] == "a@example.com"
    assert "TA 拆开了你的礼物" in mailbox[0]["subject"]
    assert "秘密礼物名" not in "\n".join(mailbox[0].values())
    assert client.get(f"/images/{image_id}/thumb", headers=auth(receiver)).status_code == 200

    again = client.post(f"/events/{gift_id}/gift/open", headers=auth(receiver))
    assert again.status_code == 200
    assert again.json()["gift_opened_at"] == body["gift_opened_at"]
    assert len(mailbox) == 1

    response = client.put(
        f"/events/{gift_id}/gift/response",
        headers=auth(receiver),
        json={"feelings": ["happy", "touched"], "rating": 5, "feedback": "超喜欢"},
    )
    assert response.status_code == 200
    assert response.json()["gift_feedback"] == "超喜欢"
    assert response.json()["gift_responded_at"] is not None
    assert len(mailbox) == 1
    assert client.put(
        f"/events/{gift_id}/gift/response", headers=auth(receiver), json={"feelings": ["happy"] * 2}
    ).status_code == 422
    assert client.put(f"/events/{gift_id}/gift/response", headers=auth(sender), json={}).status_code == 403

    seen_by_sender = client.get(f"/events/{gift_id}", headers=auth(sender)).json()
    assert seen_by_sender["gift_feelings"] == ["happy", "touched"]
    assert seen_by_sender["gift_rating"] == 5
    assert seen_by_sender["gift_feedback"] == "超喜欢"

    locked_edit = client.patch(f"/events/{gift_id}", headers=auth(sender), json={"title": "新名字"})
    assert locked_edit.status_code == 409
    assert locked_edit.json()["detail"] == "礼物已经拆开，内容不能再改"
    assert client.patch(f"/events/{gift_id}", headers=auth(sender), json={"message": "新的话"}).status_code == 409
    assert client.post(f"/events/{gift_id}/comments", headers=auth(receiver), json={"text": "谢谢"}).status_code == 201

    stored = db_session.get(Event, gift_id)
    assert stored is not None and stored.gift_receiver_id == emailed_pair["user_b"]["id"]


def test_wrap_validation_and_cross_pair_access(client: TestClient, pair_tokens: dict) -> None:
    token = str(pair_tokens["user_a_token"])
    headers = auth(token)
    assert client.post("/events/gifts/wrap", headers=headers, data={"title": " "}).status_code == 422
    assert client.post("/events/gifts/wrap", headers=headers, data={"title": "x", "wrap_style": "neon"}).status_code == 422
    assert client.post("/events/gifts/wrap", headers=headers, data={"title": "x", "teaser": "t" * 121}).status_code == 422
    assert client.post(
        "/events/gifts/wrap",
        headers=headers,
        data={"title": "x"},
        files=[("files", (f"p{i}.png", png_bytes(), "image/png")) for i in range(7)],
    ).status_code == 422
    minimal = client.post("/events/gifts/wrap", headers=headers, data={"title": "一盒糖"})
    assert minimal.status_code == 201
    assert minimal.json()["gift_wrap_style"] == "rose"
    assert minimal.json()["occurred_at"] is not None

    memory = client.post("/events", headers=headers, json={"title": "普通小事"}).json()
    assert memory["gift_state"] is None and memory["gift_masked"] is False
    assert client.post(f"/events/{memory['id']}/gift/open", headers=auth(str(pair_tokens["user_b_token"]))).status_code == 404
    assert client.patch(f"/events/{memory['id']}", headers=headers, json={"teaser": "x"}).status_code == 422

    other = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    assert client.post(f"/events/{minimal.json()['id']}/gift/open", headers=auth(other["user_b_token"])).status_code == 404


def test_wrapped_gift_joins_meeting_without_leaking_its_name(client: TestClient, pair_tokens: dict) -> None:
    sender, receiver = str(pair_tokens["user_a_token"]), str(pair_tokens["user_b_token"])
    gift = wrap(client, sender)

    response = client.patch(f"/events/{gift['id']}", headers=auth(sender), json={"event_kind": "offline_meeting"})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["event_kind"] == "gift"
    assert updated["meeting_session"]["title"] == "一份礼物"

    masked = client.get(f"/events/{gift['id']}", headers=auth(receiver)).json()
    assert masked["gift_masked"] is True
    assert "秘密礼物名" not in str(masked)
