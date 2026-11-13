"use client";

// 私有媒体 hook：按头像 / 时间线图片 / Todo 图片描述带鉴权拉取 blob 并生成 objectURL，来源切换或卸载时撤销旧地址，旧请求不会覆盖新图片。

import { useEffect, useState } from "react";
import { fetchAvatarBlob, fetchFileBlob, fetchTodoImageBlob } from "./api";

export type AuthedBlobSource =
  | { kind: "avatar"; userId: number; version?: string | null }
  | { kind: "image" | "image-thumb" | "todo-image" | "todo-thumb"; id: number };

export type AuthedBlobStatus = "idle" | "loading" | "ready" | "error";

function sourceKey(source: AuthedBlobSource): string {
  if (source.kind === "avatar") return `avatar:${source.userId}:${source.version ?? ""}`;
  return `${source.kind}:${source.id}`;
}

function loadByKey(key: string): Promise<string> {
  const [kind, rawId] = key.split(":");
  const id = Number(rawId);
  switch (kind) {
    case "avatar":
      return fetchAvatarBlob(id);
    case "image":
      return fetchFileBlob("images", id);
    case "image-thumb":
      return fetchFileBlob("image-thumbs", id);
    case "todo-image":
      return fetchTodoImageBlob("file", id);
    default:
      return fetchTodoImageBlob("thumb", id);
  }
}

interface BlobState {
  key: string | null;
  url: string | null;
  status: AuthedBlobStatus;
}

export function useAuthedBlobUrl(source: AuthedBlobSource | null): { url: string | null; status: AuthedBlobStatus } {
  const key = source ? sourceKey(source) : null;
  const [state, setState] = useState<BlobState>({ key: null, url: null, status: "idle" });

  useEffect(() => {
    if (!key) {
      setState({ key: null, url: null, status: "idle" });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ key, url: null, status: "loading" });
    loadByKey(key)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setState({ key, url, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ key, url: null, status: "error" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);

  if (state.key !== key) return { url: null, status: key ? "loading" : "idle" };
  return { url: state.url, status: state.status };
}
