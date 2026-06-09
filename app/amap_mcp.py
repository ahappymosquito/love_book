"""AMap MCP subprocess client that launches npx and normalizes richer POI evidence for restaurants, activities, and stays."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from typing import Any
from urllib.parse import quote

from app.core.config import get_settings

MCP_PACKAGE = "@amap/amap-maps-mcp-server"
MCP_PROTOCOL_VERSION = "2024-11-05"


class AmapMCPError(RuntimeError):
    """Raised when the AMap MCP server cannot be called or returns an invalid response."""


def _npx_command() -> list[str]:
    command = shutil.which("npx") or shutil.which("npx.cmd")
    if not command:
        raise AmapMCPError("npx is not available on PATH")
    if sys.platform == "win32":
        return [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c", "npx"]
    return [command]


def _extract_payload(result: Any) -> Any:
    if not isinstance(result, dict):
        return result
    content = result.get("content")
    if isinstance(content, list) and content:
        first = content[0]
        if isinstance(first, dict) and isinstance(first.get("text"), str):
            text = first["text"]
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
    return result


def _normalize_poi(raw: dict[str, Any]) -> dict[str, Any]:
    city = raw.get("cityname") or raw.get("city") or raw.get("pname")
    biz_ext = raw.get("biz_ext") if isinstance(raw.get("biz_ext"), dict) else {}
    photos = raw.get("photos") if isinstance(raw.get("photos"), list) else []
    tags = _split_tags(raw.get("tag") or raw.get("tags") or raw.get("recommend") or biz_ext.get("tag"))
    name = str(raw.get("name") or "").strip()
    location = raw.get("location")
    return {
        "amap_poi_id": raw.get("id") or raw.get("poi_id") or raw.get("amap_poi_id"),
        "name": name,
        "address": raw.get("address"),
        "location": location,
        "city": city,
        "adname": raw.get("adname"),
        "pname": raw.get("pname"),
        "poi_type": raw.get("type") or raw.get("typecode"),
        "poi_typecode": raw.get("typecode"),
        "tel": raw.get("tel"),
        "business_area": raw.get("business_area") or raw.get("businessarea"),
        "rating": _optional_float(biz_ext.get("rating") or raw.get("rating")),
        "per_capita": _optional_int(biz_ext.get("cost") or raw.get("cost") or raw.get("per_capita")),
        "opening_hours": biz_ext.get("open_time") or biz_ext.get("opentime") or raw.get("open_time") or raw.get("opentime"),
        "meal_ordering": _optional_text(biz_ext.get("meal_ordering") or raw.get("meal_ordering")),
        "tags": tags,
        "signature_dishes": ", ".join(tags) if tags else None,
        "photos_count": len(photos),
        "first_photo_url": _first_photo_url(photos),
        "amap_navigation_url": _navigation_url(location, name),
        "raw": raw,
    }


def _split_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    for separator in (";", "；", "|", "、", ",", "，"):
        text = text.replace(separator, ",")
    return [part.strip() for part in text.split(",") if part.strip()]


def _optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return None


def _optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def _optional_text(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return str(value)


def _first_photo_url(photos: list[Any]) -> str | None:
    for photo in photos:
        if isinstance(photo, dict):
            url = photo.get("url") or photo.get("title")
            if url:
                return str(url)
        elif photo:
            return str(photo)
    return None


def _navigation_url(location: Any, name: str) -> str | None:
    if not location:
        return None
    text = str(location).strip()
    if "," not in text:
        return None
    return f"https://uri.amap.com/marker?position={quote(text, safe=',')}&name={quote(name)}"


def _pois_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        candidates = payload.get("pois") or payload.get("data") or payload.get("result") or []
    elif isinstance(payload, list):
        candidates = payload
    else:
        candidates = []
    if isinstance(candidates, dict):
        candidates = candidates.get("pois") or candidates.get("items") or []
    if not isinstance(candidates, list):
        return []
    return [poi for poi in (_normalize_poi(item) for item in candidates if isinstance(item, dict)) if poi["name"]]


async def _read_message(stream: asyncio.StreamReader, timeout: float) -> dict[str, Any]:
    line = await asyncio.wait_for(stream.readline(), timeout=timeout)
    if not line:
        raise AmapMCPError("MCP response stream closed")
    return json.loads(line.decode("utf-8"))


async def _send_message(stream: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
    body = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    stream.write(body)
    await stream.drain()


async def _stderr_message(process: asyncio.subprocess.Process) -> str:
    if process.stderr is None:
        return ""
    try:
        data = await asyncio.wait_for(process.stderr.read(), timeout=1)
    except Exception:
        return ""
    return data.decode("utf-8", errors="replace").strip()


async def _call_tool_async(
    tool_name: str,
    arguments: dict[str, Any],
    amap_key: str | None = None,
    timeout: float = 45.0,
) -> Any:
    settings = get_settings()
    effective_key = (amap_key or settings.amap_maps_api_key).strip()
    if not effective_key:
        raise AmapMCPError("AMAP_MAPS_API_KEY is not configured")

    env = os.environ.copy()
    env["AMAP_MAPS_API_KEY"] = effective_key
    command = _npx_command()
    process = await asyncio.create_subprocess_exec(
        *command,
        "-y",
        MCP_PACKAGE,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    request_id = 1
    try:
        await _send_message(
            process.stdin,
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "love-book", "version": "0.2.0"},
                },
            },
        )
        init_response = await _read_message(process.stdout, timeout)
        if init_response.get("error"):
            raise AmapMCPError(str(init_response["error"]))
        await _send_message(process.stdin, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        request_id += 1
        await _send_message(
            process.stdin,
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            },
        )
        response = await _read_message(process.stdout, timeout)
        if response.get("error"):
            raise AmapMCPError(str(response["error"]))
        return _extract_payload(response.get("result"))
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, OSError, json.JSONDecodeError) as exc:
        stderr = await _stderr_message(process)
        detail = f": {stderr}" if stderr else ""
        error_text = str(exc) or type(exc).__name__
        raise AmapMCPError(f"AMap MCP call failed: {error_text}{detail}") from exc
    finally:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=3)
        except Exception:
            process.kill()


def call_amap_tool(tool_name: str, arguments: dict[str, Any], amap_key: str | None = None) -> Any:
    return asyncio.run(_call_tool_async(tool_name, arguments, amap_key=amap_key))


def search_restaurants(keyword: str, city: str | None = None, amap_key: str | None = None) -> list[dict[str, Any]]:
    args: dict[str, Any] = {"keywords": keyword}
    if city:
        args["city"] = city
    return _pois_from_payload(call_amap_tool("maps_text_search", args, amap_key=amap_key))


def around_restaurants(
    location: str,
    radius_m: int,
    keyword: str = "餐厅",
    amap_key: str | None = None,
) -> list[dict[str, Any]]:
    return _pois_from_payload(
        call_amap_tool(
            "maps_around_search",
            {"location": location, "radius": str(radius_m), "keywords": keyword},
            amap_key=amap_key,
        )
    )


def restaurant_detail(amap_poi_id: str, amap_key: str | None = None) -> dict[str, Any] | None:
    payload = call_amap_tool("maps_search_detail", {"id": amap_poi_id}, amap_key=amap_key)
    if isinstance(payload, dict):
        if isinstance(payload.get("poi"), dict):
            return _normalize_poi(payload["poi"])
        if isinstance(payload.get("pois"), list) and payload["pois"]:
            first = payload["pois"][0]
            return _normalize_poi(first) if isinstance(first, dict) else None
        return _normalize_poi(payload)
    return None
