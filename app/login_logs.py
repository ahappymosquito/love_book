"""登录指纹采集 & IP 地理信息查询。"""
from __future__ import annotations

import ipaddress
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import LoginLog

logger = logging.getLogger(__name__)

_PRIVATE_HOSTS = {"localhost", "::1"}


def client_ip(request: Request) -> str:
    """从请求头中尽力取出客户端 IP。"""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return ""


def _is_private(ip: str) -> bool:
    if not ip or ip in _PRIVATE_HOSTS:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return addr.is_private or addr.is_loopback or addr.is_link_local


def parse_user_agent(ua: str | None) -> dict[str, str | None]:
    """从 User-Agent 中粗略推断 OS / 浏览器 / 设备。"""
    if not ua:
        return {"os": None, "browser": None, "device": None}

    os_name: str | None = None
    if "Windows NT 10" in ua:
        os_name = "Windows 10/11"
    elif "Windows NT" in ua:
        os_name = "Windows"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        os_name = "macOS"
    elif "Android" in ua:
        match = re.search(r"Android\s+([\d.]+)", ua)
        os_name = f"Android {match.group(1)}" if match else "Android"
    elif "iPhone" in ua or "iPad" in ua or "iOS" in ua:
        match = re.search(r"OS\s+([\d_]+)", ua)
        version = match.group(1).replace("_", ".") if match else ""
        device = "iPad" if "iPad" in ua else "iPhone"
        os_name = f"iOS {version}".strip() if version else "iOS"
        device_name = device
        # 提前 return 以保留 device_name
        browser = _detect_browser(ua)
        return {"os": os_name, "browser": browser, "device": device_name}
    elif "Linux" in ua:
        os_name = "Linux"

    device: str | None
    if "iPad" in ua:
        device = "iPad"
    elif "iPhone" in ua:
        device = "iPhone"
    elif "Android" in ua:
        # 试图取得设备型号 (在 "Android x.y; XXX Build/..." 中)
        match = re.search(r"Android[^;]*;\s*([^;)]+?)(?:\s+Build|;|\))", ua)
        device = match.group(1).strip() if match else "Android Device"
    elif "Mobile" in ua:
        device = "Mobile"
    else:
        device = "Desktop"

    return {"os": os_name, "browser": _detect_browser(ua), "device": device}


def _detect_browser(ua: str) -> str | None:
    patterns = [
        (r"Edg/(\d+)", "Edge"),
        (r"OPR/(\d+)", "Opera"),
        (r"Chrome/(\d+)", "Chrome"),
        (r"Firefox/(\d+)", "Firefox"),
        (r"Safari/(\d+)", "Safari"),
    ]
    # 顺序敏感：Edge/Opera 必须先匹配，Chrome 才正确。
    for pattern, name in patterns:
        m = re.search(pattern, ua)
        if m:
            return f"{name} {m.group(1)}"
    return None


def _lookup_location(ip: str) -> dict[str, Any]:
    """调用 ip-api.com 做轻量地理查询，失败时返回空字段。"""
    if _is_private(ip):
        return {}
    url = f"http://ip-api.com/json/{ip}?fields=status,country,regionName,city,isp&lang=zh-CN"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:  # noqa: S310 - external geo lookup
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
        logger.info("IP geo lookup failed for %s: %s", ip, exc)
        return {}
    if data.get("status") != "success":
        return {}
    return {
        "country": data.get("country") or None,
        "region": data.get("regionName") or None,
        "city": data.get("city") or None,
        "isp": data.get("isp") or None,
    }


def record_login(
    db: Session,
    *,
    user_id: int,
    ip: str | None,
    user_agent: str | None,
    locale: str | None,
    timezone_name: str | None,
    screen: str | None,
) -> LoginLog:
    """同步落库一条登录日志。地理信息异步补充。"""
    parsed = parse_user_agent(user_agent)
    entry = LoginLog(
        user_id=user_id,
        ip=ip or None,
        user_agent=user_agent[:500] if user_agent else None,
        device=parsed.get("device"),
        os=parsed.get("os"),
        browser=parsed.get("browser"),
        locale=locale,
        timezone_name=timezone_name,
        screen=screen,
    )
    db.add(entry)
    db.flush()
    db.refresh(entry)
    return entry


def enrich_location(log_id: int, ip: str | None) -> None:
    """在 BackgroundTasks 中调用：查 IP 归属地并更新对应记录。"""
    if not ip:
        return
    info = _lookup_location(ip)
    if not info:
        return
    session = SessionLocal()
    try:
        entry = session.get(LoginLog, log_id)
        if entry is None:
            return
        entry.country = info.get("country")
        entry.region = info.get("region")
        entry.city = info.get("city")
        entry.isp = info.get("isp")
        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("Failed to enrich login log %s", log_id)
    finally:
        session.close()
