"""SMTP email helpers for timeline notices, food/play/stay todo schedule notices, and locked-content privacy rules."""
from __future__ import annotations

from html import escape
import logging
import smtplib
import ssl
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr
from typing import Iterable

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _normalize_recipients(recipients: str | Iterable[str]) -> list[str]:
    if isinstance(recipients, str):
        candidates = [recipients]
    else:
        candidates = list(recipients)
    return [addr.strip() for addr in candidates if addr and addr.strip()]


def send_email(
    to: str | Iterable[str],
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> bool:
    """发送一封邮件。SMTP 未配置或目标邮箱为空时静默返回 False。"""
    settings = get_settings()
    targets = _normalize_recipients(to)
    if not targets:
        return False
    if not settings.smtp_host or not settings.smtp_user or not settings.smtp_pass:
        logger.warning("SMTP not configured, skip sending email to %s", targets)
        return False

    sender = settings.smtp_from or settings.smtp_user
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.smtp_from_name or sender, sender))
    msg["To"] = ", ".join(targets)
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    try:
        if settings.smtp_use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context, timeout=15) as server:
                server.login(settings.smtp_user, settings.smtp_pass)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
                server.starttls(context=ssl.create_default_context())
                server.login(settings.smtp_user, settings.smtp_pass)
                server.send_message(msg)
        return True
    except Exception as exc:  # noqa: BLE001 - 邮件失败不应影响业务
        logger.exception("Failed to send email to %s: %s", targets, exc)
        return False


def _excerpt(text: str | None, limit: int = 60) -> str:
    if not text:
        return ""
    cleaned = text.strip().replace("\r", " ").replace("\n", " ")
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1] + "…"


def _event_link(event_id: int, recipient_token: str | None = None) -> str:
    """构造跳转链接，带 token 时返回免登链接，落地后自动跳转到事件详情。"""
    base = (get_settings().app_web_url or "").rstrip("/")
    target = f"/timeline/{event_id}"
    if not base:
        return target
    if recipient_token:
        from urllib.parse import quote

        return f"{base}/?token={quote(recipient_token, safe='')}&next={quote(target, safe='/')}"
    return f"{base}{target}"


def _todo_link(target_date: date, recipient_token: str | None = None) -> str:
    """Build a todo-board link, optionally through token login."""
    base = (get_settings().app_web_url or "").rstrip("/")
    target = f"/todo?date={target_date.isoformat()}"
    if not base:
        return target
    if recipient_token:
        from urllib.parse import quote

        return f"{base}/?token={quote(recipient_token, safe='')}&next={quote(target, safe='/?=&')}"
    return f"{base}{target}"


def notify_todo_schedule_created(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    actor_name: str,
    scheduled_on: date,
    category: str,
    item_title: str,
) -> None:
    if not recipient_email:
        return
    label = {"food": "吃饭", "play": "玩乐", "stay": "住宿"}.get(category, "清单")
    link = _todo_link(scheduled_on, recipient_token)
    safe_recipient_name = escape(recipient_name)
    safe_actor_name = escape(actor_name)
    safe_item_title = escape(item_title)
    safe_label = escape(label)
    safe_date = escape(scheduled_on.isoformat())
    safe_link = escape(link, quote=True)
    subject = f"【我们之间的小事】{actor_name} 把 {item_title} 安排到了 {scheduled_on.isoformat()}"
    text_body = (
        f"{recipient_name}，你好：\n\n"
        f"{actor_name} 在 todo 看板里新增了日期安排：\n"
        f"  日期：{scheduled_on.isoformat()}\n"
        f"  板块：{label}\n"
        f"  项目：{item_title}\n\n"
        f"查看看板：{link}\n\n"
        f"-- 我们之间的小事"
    )
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
      <p>{safe_recipient_name}，你好：</p>
      <p><strong>{safe_actor_name}</strong> 在 todo 看板里新增了日期安排。</p>
      <div style="background:#fdf6f1;border:1px solid #e9ddd3;border-radius:12px;padding:16px 18px;margin:12px 0;">
        <p style="margin:0 0 6px;"><strong>日期：</strong>{safe_date}</p>
        <p style="margin:0 0 6px;"><strong>板块：</strong>{safe_label}</p>
        <p style="margin:0;"><strong>项目：</strong>{safe_item_title}</p>
      </div>
      <p><a href="{safe_link}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">查看看板</a></p>
      <p style="color:#a09489;font-size:12px;margin-top:24px;">-- 我们之间的小事</p>
    </div>
    """
    send_email(recipient_email, subject, text_body, html_body)


def notify_event_created(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    actor_name: str,
    event_id: int,
    event_title: str,
    event_description: str | None,
    content_unlocked: bool = True,
) -> None:
    if not recipient_email:
        return
    link = _event_link(event_id, recipient_token)
    safe_recipient_name = escape(recipient_name)
    safe_actor_name = escape(actor_name)
    safe_event_title = escape(event_title)
    safe_event_description = escape(_excerpt(event_description, 160) or "(暂无描述)")
    safe_link = escape(link, quote=True)
    if not content_unlocked:
        subject = f"【我们之间的小事】{actor_name} 新建了一条待解锁事件"
        text_body = (
            f"{recipient_name}，你好：\n\n"
            f"{actor_name} 在你们的小本子里新建了一条待解锁事件。\n"
            f"为了保留神秘感，标题和摘要暂时不在邮件里显示。\n\n"
            f"查看详情：{link}\n\n"
            f"—— 我们之间的小事"
        )
        html_body = f"""
        <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
          <p>{safe_recipient_name}，你好：</p>
          <p><strong>{safe_actor_name}</strong> 在你们的小本子里新建了一条待解锁事件。</p>
          <div style="background:#fdf6f1;border:1px solid #e9ddd3;border-radius:12px;padding:16px 18px;margin:12px 0;color:#6b605a;">
            为了保留神秘感，标题和摘要暂时不在邮件里显示。
          </div>
          <p><a href="{safe_link}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">查看详情</a></p>
          <p style="color:#a09489;font-size:12px;margin-top:24px;">—— 我们之间的小事</p>
        </div>
        """
        send_email(recipient_email, subject, text_body, html_body)
        return

    subject = f"【我们之间的小事】{actor_name} 新建了事件「{_excerpt(event_title, 24)}」"
    text_body = (
        f"{recipient_name}，你好：\n\n"
        f"{actor_name} 在你们的小本子里新建了一个事件：\n"
        f"  标题：{event_title}\n"
        f"  摘要：{_excerpt(event_description, 120) or '(暂无描述)'}\n\n"
        f"查看详情：{link}\n\n"
        f"—— 我们之间的小事"
    )
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
      <p>{safe_recipient_name}，你好：</p>
      <p><strong>{safe_actor_name}</strong> 在你们的小本子里新建了一个事件：</p>
      <div style="background:#fdf6f1;border:1px solid #e9ddd3;border-radius:12px;padding:16px 18px;margin:12px 0;">
        <p style="margin:0 0 6px;"><strong>标题：</strong>{safe_event_title}</p>
        <p style="margin:0;color:#6b605a;"><strong>摘要：</strong>{safe_event_description}</p>
      </div>
      <p><a href="{safe_link}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">查看详情</a></p>
      <p style="color:#a09489;font-size:12px;margin-top:24px;">—— 我们之间的小事</p>
    </div>
    """
    send_email(recipient_email, subject, text_body, html_body)


def notify_comment_created(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    actor_name: str,
    event_id: int,
    event_title: str,
    comment_text: str,
    content_unlocked: bool = True,
) -> None:
    if not recipient_email:
        return
    link = _event_link(event_id, recipient_token)
    safe_recipient_name = escape(recipient_name)
    safe_actor_name = escape(actor_name)
    safe_event_title = escape(event_title)
    safe_comment_text = escape(_excerpt(comment_text, 240))
    safe_link = escape(link, quote=True)
    if not content_unlocked:
        subject = f"【我们之间的小事】{actor_name} 留下了一条待解锁评论"
        text_body = (
            f"{recipient_name}，你好：\n\n"
            f"{actor_name} 在一条还未解锁的事件里留下了评论。\n"
            f"为了保留神秘感，事件标题和评论内容暂时不在邮件里显示。\n\n"
            f"查看详情：{link}\n\n"
            f"—— 我们之间的小事"
        )
        html_body = f"""
        <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
          <p>{safe_recipient_name}，你好：</p>
          <p><strong>{safe_actor_name}</strong> 在一条还未解锁的事件里留下了评论。</p>
          <div style="background:#fdf6f1;border:1px solid #e9ddd3;border-radius:12px;padding:16px 18px;margin:12px 0;color:#6b605a;">
            为了保留神秘感，事件标题和评论内容暂时不在邮件里显示。
          </div>
          <p><a href="{safe_link}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">查看详情</a></p>
          <p style="color:#a09489;font-size:12px;margin-top:24px;">—— 我们之间的小事</p>
        </div>
        """
        send_email(recipient_email, subject, text_body, html_body)
        return

    subject = f"【我们之间的小事】{actor_name} 在「{_excerpt(event_title, 20)}」留下了一条评论"
    text_body = (
        f"{recipient_name}，你好：\n\n"
        f"{actor_name} 在事件「{event_title}」中留下了一条评论：\n"
        f"  {_excerpt(comment_text, 160)}\n\n"
        f"查看详情：{link}\n\n"
        f"—— 我们之间的小事"
    )
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
      <p>{safe_recipient_name}，你好：</p>
      <p><strong>{safe_actor_name}</strong> 在事件「{safe_event_title}」中留下了一条评论：</p>
      <blockquote style="background:#fdf6f1;border-left:4px solid #d76679;margin:12px 0;padding:12px 16px;border-radius:8px;color:#4a4239;">
        {safe_comment_text}
      </blockquote>
      <p><a href="{safe_link}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">查看详情</a></p>
      <p style="color:#a09489;font-size:12px;margin-top:24px;">—— 我们之间的小事</p>
    </div>
    """
    send_email(recipient_email, subject, text_body, html_body)
