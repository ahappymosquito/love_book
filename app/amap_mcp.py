"""AMap MCP subprocess client that calls restaurant search/detail tools through npx at runtime."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from app.core.config import get_settings

MCP_PACKAGE = "@amap/amap-maps-mcp-server"
MCP_PROTOCOL_VERSION = "2024-11-05"


class AmapMCPError(RuntimeError):
    """Raised when the AMap MCP server cannot be called or returns an invalid response."""


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
    return {
        "amap_poi_id": raw.get("id") or raw.get("poi_id") or raw.get("amap_poi_id"),
        "name": str(raw.get("name") or "").strip(),
        "address": raw.get("address"),
        "location": raw.get("location"),
        "city": city,
        "poi_type": raw.get("type") or raw.get("typecode"),
        "tel": raw.get("tel"),
        "business_area": raw.get("business_area") or raw.get("businessarea"),
        "raw": raw,
    }


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
    header = await asyncio.wait_for(stream.readuntil(b"\r\n\r\n"), timeout=timeout)
    length = 0
    for line in header.decode("utf-8", errors="replace").split("\r\n"):
        if line.lower().startswith("content-length:"):
            length = int(line.split(":", 1)[1].strip())
            break
    if length <= 0:
        raise AmapMCPError("MCP response is missing Content-Length")
    body = await asyncio.wait_for(stream.readexactly(length), timeout=timeout)
    return json.loads(body.decode("utf-8"))


async def _send_message(stream: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    stream.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body)
    await stream.drain()


async def _call_tool_async(tool_name: str, arguments: dict[str, Any], timeout: float = 20.0) -> Any:
    settings = get_settings()
    if not settings.amap_maps_api_key:
        raise AmapMCPError("AMAP_MAPS_API_KEY is not configured")

    env = os.environ.copy()
    env["AMAP_MAPS_API_KEY"] = settings.amap_maps_api_key
    process = await asyncio.create_subprocess_exec(
        "npx",
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
    except (asyncio.TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise AmapMCPError(f"AMap MCP call failed: {exc}") from exc
    finally:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=3)
        except Exception:
            process.kill()


def call_amap_tool(tool_name: str, arguments: dict[str, Any]) -> Any:
    return asyncio.run(_call_tool_async(tool_name, arguments))


def search_restaurants(keyword: str, city: str | None = None) -> list[dict[str, Any]]:
    args: dict[str, Any] = {"keywords": keyword}
    if city:
        args["city"] = city
    return _pois_from_payload(call_amap_tool("maps_text_search", args))


def around_restaurants(location: str, radius_m: int, keyword: str = "餐厅") -> list[dict[str, Any]]:
    return _pois_from_payload(
        call_amap_tool("maps_around_search", {"location": location, "radius": str(radius_m), "keywords": keyword})
    )


def restaurant_detail(amap_poi_id: str) -> dict[str, Any] | None:
    payload = call_amap_tool("maps_search_detail", {"id": amap_poi_id})
    if isinstance(payload, dict):
        if isinstance(payload.get("poi"), dict):
            return payload["poi"]
        if isinstance(payload.get("pois"), list) and payload["pois"]:
            first = payload["pois"][0]
            return first if isinstance(first, dict) else None
        return payload
    return None
