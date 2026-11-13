// 手账导出的后端请求：带 Bearer 读取 /journal 汇总，按 id 拉取私有事件图片和头像 Blob（可中断），只读复用 api.ts 的地址与鉴权约定。

import { APIError, apiRequest, avatarUrl, fileUrl } from "./api";
import { journalApiPath } from "./journal-query";
import type { JournalOut, JournalQuery } from "./journal-types";
import { useAppStore } from "./store";

export function fetchJournal(query: JournalQuery, signal?: AbortSignal): Promise<JournalOut> {
  return apiRequest<JournalOut>(journalApiPath(query), { signal, silent: true });
}

async function fetchAuthedBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const token = useAppStore.getState().token;
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });
  if (!resp.ok) throw new APIError(resp.status, "image unavailable");
  return resp.blob();
}

export function fetchJournalImage(id: number, size: "thumb" | "full", signal?: AbortSignal): Promise<Blob> {
  return fetchAuthedBlob(fileUrl(size === "thumb" ? "image-thumbs" : "images", id), signal);
}

export function fetchJournalAvatar(userId: number, signal?: AbortSignal): Promise<Blob> {
  return fetchAuthedBlob(avatarUrl(userId), signal);
}
