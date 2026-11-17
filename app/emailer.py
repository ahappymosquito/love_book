"""SMTP helpers for privacy-aware timeline event/comment notifications, content-free gift wrap/open notices, daily habit reminders, gentle pre-period cycle reminders, and the "meeting date is set, come plan it" invite (plan items themselves never email)."""
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


def _habit_link(target_date: date, recipient_token: str | None = None) -> str:
    """Build a habit-board link, optionally through token login."""
    base = (get_settings().app_web_url or "").rstrip("/")
    target = f"/habits?date={target_date.isoformat()}"
    if not base:
        return target
    if recipient_token:
        from urllib.parse import quote

        return f"{base}/?token={quote(recipient_token, safe='')}&next={quote(target, safe='/?=&')}"
    return f"{base}{target}"


def notify_habit_reminder(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    target_date: date,
    total_count: int,
    completed_count: int,
) -> bool:
    if not recipient_email:
        return False
    link = _habit_link(target_date, recipient_token)
    safe_recipient_name = escape(recipient_name)
    safe_date = escape(target_date.isoformat())
    safe_link = escape(link, quote=True)
    subject = "【我们之间的小事】昨天的习惯记录还差一点点"
    text_body = (
        f"{recipient_name}，你好：\n\n"
        f"昨天（{target_date.isoformat()}）的习惯记录还有未完成项：{completed_count}/{total_count}。\n"
        f"可以点开日期补一下记录：{link}\n\n"
        f"-- 我们之间的小事"
    )
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
      <p>{safe_recipient_name}，你好：</p>
      <p>昨天（<strong>{safe_date}</strong>）的习惯记录还有未完成项：<strong>{completed_count}/{total_count}</strong>。</p>
      <div style="background:#fdf6f1;border:1px solid #e9ddd3;border-radius:12px;padding:16px 18px;margin:12px 0;color:#6b605a;">
        点开日期就可以补记，不会影响今天的记录。
      </div>
      <p><a href="{safe_link}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">补记习惯</a></p>
      <p style="color:#a09489;font-size:12px;margin-top:24px;">-- 我们之间的小事</p>
    </div>
    """
    return send_email(recipient_email, subject, text_body, html_body)


def _cycle_link(recipient_token: str | None = None) -> str:
    base = (get_settings().app_web_url or "").rstrip("/")
    target = "/cycle"
    if not base:
        return target
    if recipient_token:
        from urllib.parse import quote

        return f"{base}/?token={quote(recipient_token, safe='')}&next={quote(target, safe='/')}"
    return f"{base}{target}"


def _plan_link(meeting_id: int, recipient_token: str | None = None) -> str:
    base = (get_settings().app_web_url or "").rstrip("/")
    target = f"/todo?meeting={meeting_id}"
    if not base:
        return target
    if recipient_token:
        from urllib.parse import quote

        return f"{base}/?token={quote(recipient_token, safe='')}&next={quote(target, safe='/?=&')}"
    return f"{base}{target}"


def _day_label(value: date) -> str:
    return f"{value.month}月{value.day}日"


def notify_meeting_planned(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    actor_name: str,
    meeting_id: int,
    meeting_title: str,
    started_on: date,
    ended_on: date,
) -> bool:
    """Tell the partner a meeting date is set and invite them to fill in what to eat / play / where to stay."""
    if not recipient_email:
        return False
    link = _plan_link(meeting_id, recipient_token)
    days = (ended_on - started_on).days + 1
    when = _day_label(started_on) if days == 1 else f"{_day_label(started_on)} – {_day_label(ended_on)}（{days} 天）"
    subject = f"【我们之间的小事】{actor_name} 定好了下次见面：{when}"
    line = f"{actor_name} 把「{meeting_title}」定在了 {when}。"
    invite = "想吃什么、去哪儿玩、住在哪里、出发前要准备什么，一起排进每一天吧。"
    text_body = f"{recipient_name}，你好：\n\n{line}\n{invite}\n\n一起排计划：{link}\n\n—— 我们之间的小事"
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
      <p>{escape(recipient_name)}，你好：</p>
      <p>{escape(line)}</p>
      <div style="background:#fdf6f1;border:1px solid #e9ddd3;border-radius:12px;padding:16px 18px;margin:12px 0;color:#6b605a;">
        {escape(invite)}
      </div>
      <p><a href="{escape(link, quote=True)}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">一起排计划</a></p>
      <p style="color:#a09489;font-size:12px;margin-top:24px;">—— 我们之间的小事</p>
    </div>
    """
    return send_email(recipient_email, subject, text_body, html_body)


def notify_cycle_reminder(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    period_start: date,
    days_left: int,
) -> bool:
    """Gentle heads-up before a predicted period; reference only, no medical wording."""
    if not recipient_email:
        return False
    link = _cycle_link(recipient_token)
    day_text = f"{period_start.month}月{period_start.day}日"
    subject = f"【我们之间的小事】生理期大概还有 {days_left} 天"
    line = f"按你们一起记下的日子，下一次生理期预计在 {day_text} 左右开始，还有 {days_left} 天。"
    care = "这几天可以多一点照顾：备好热水和暖宝宝，早点休息，说话再温柔一点。预测只是参考，以身体的感受为准。"
    text_body = f"{recipient_name}，你好：\n\n{line}\n{care}\n\n去看看周期日历：{link}\n\n—— 我们之间的小事"
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
      <p>{escape(recipient_name)}，你好：</p>
      <p>{escape(line)}</p>
      <div style="background:#fdf6f1;border:1px solid #e9ddd3;border-radius:12px;padding:16px 18px;margin:12px 0;color:#6b605a;">
        {escape(care)}
      </div>
      <p><a href="{escape(link, quote=True)}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">看看周期日历</a></p>
      <p style="color:#a09489;font-size:12px;margin-top:24px;">—— 我们之间的小事</p>
    </div>
    """
    return send_email(recipient_email, subject, text_body, html_body)


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


def _notify_gift(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    event_id: int,
    subject: str,
    line: str,
    button: str,
) -> None:
    """Gift emails only carry who did it and a link; title, message, teaser and images stay in the app."""
    if not recipient_email:
        return
    link = _event_link(event_id, recipient_token)
    text_body = f"{recipient_name}，你好：\n\n{line}\n\n{button}：{link}\n\n—— 我们之间的小事"
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#2b2522;max-width:560px;margin:0 auto;padding:24px;">
      <p>{escape(recipient_name)}，你好：</p>
      <p>{escape(line)}</p>
      <p><a href="{escape(link, quote=True)}" style="display:inline-block;background:#d76679;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;">{escape(button)}</a></p>
      <p style="color:#a09489;font-size:12px;margin-top:24px;">—— 我们之间的小事</p>
    </div>
    """
    send_email(recipient_email, subject, text_body, html_body)


def notify_gift_wrapped(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    actor_name: str,
    event_id: int,
) -> None:
    _notify_gift(
        recipient_email=recipient_email,
        recipient_name=recipient_name,
        recipient_token=recipient_token,
        event_id=event_id,
        subject="【我们之间的小事】你收到一份礼物",
        line=f"{actor_name} 给你包了一份礼物，里面写了什么要你亲手拆开才知道。",
        button="去拆礼物",
    )


def notify_gift_opened(
    *,
    recipient_email: str | None,
    recipient_name: str,
    recipient_token: str | None,
    actor_name: str,
    event_id: int,
) -> None:
    _notify_gift(
        recipient_email=recipient_email,
        recipient_name=recipient_name,
        recipient_token=recipient_token,
        event_id=event_id,
        subject="【我们之间的小事】TA 拆开了你的礼物",
        line=f"{actor_name} 拆开了你送的礼物。",
        button="去看看",
    )


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
