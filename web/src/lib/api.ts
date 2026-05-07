"use client";

import { toast } from "sonner";
import { useAppStore } from "./store";
import type {
  CommentOut,
  ContentsOut,
  EventDetail,
  EventSummary,
  ImageOut,
  MeOut,
  PairCreated,
  PairOut,
  UserOut,
  VisibilityMode,
  VoiceOut,
} from "./types";

const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) ||
  "http://127.0.0.1:8000";

export class APIError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  withAdmin?: boolean | string;
  withAuth?: boolean;
  silent?: boolean;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    json,
    body,
    headers = {},
    withAdmin = false,
    withAuth = true,
    silent = false,
    signal,
  } = options;

  const finalHeaders: Record<string, string> = { ...headers };
  let finalBody: BodyInit | null | undefined = body;

  if (json !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(json);
  }

  if (withAuth) {
    const token = useAppStore.getState().token;
    if (token) {
      finalHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  if (withAdmin) {
    const key = typeof withAdmin === "string" ? withAdmin : useAppStore.getState().adminKey;
    if (key) {
      finalHeaders["X-Admin-Key"] = key;
    }
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers: finalHeaders,
      body: finalBody,
      signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "网络错误";
    if (!silent) toast.error(`网络错误：${msg}`);
    throw new APIError(0, msg);
  }

  if (resp.status === 204) {
    return undefined as T;
  }

  const ctype = resp.headers.get("content-type") || "";
  let payload: unknown = null;
  if (ctype.includes("application/json")) {
    try {
      payload = await resp.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      payload = await resp.text();
    } catch {
      payload = null;
    }
  }

  if (!resp.ok) {
    const detail =
      (payload && typeof payload === "object" && "detail" in (payload as Record<string, unknown>)
        ? (payload as Record<string, unknown>).detail
        : payload) ?? resp.statusText;
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
    if (!silent) {
      toast.error(`请求失败：${msg}`);
    }
    throw new APIError(resp.status, msg, detail);
  }

  return payload as T;
}

export const api = {
  // Admin
  verifyAdmin: (admin_key: string) =>
    apiRequest<{ ok: boolean }>("/admin/auth", {
      method: "POST",
      json: { admin_key },
      withAuth: false,
      silent: true,
    }),
  listPairs: () => apiRequest<PairOut[]>("/admin/pairs", { withAdmin: true, withAuth: false }),
  createPair: (payload: {
    user_a_display_name: string;
    user_b_display_name: string;
    user_a_avatar?: string;
    user_b_avatar?: string;
    token_expires_at?: string | null;
  }) =>
    apiRequest<PairCreated>("/admin/pairs", {
      method: "POST",
      json: payload,
      withAdmin: true,
      withAuth: false,
    }),

  // Auth
  me: () => apiRequest<MeOut>("/auth/me"),
  patchMe: (payload: { display_name?: string; avatar?: string }) =>
    apiRequest<UserOut>("/auth/me", { method: "PATCH", json: payload }),

  // Events
  listEvents: () => apiRequest<EventSummary[]>("/events"),
  getEvent: (id: number) => apiRequest<EventDetail>(`/events/${id}`),
  createEvent: (payload: {
    title: string;
    description?: string | null;
    occurred_at?: string | null;
    visibility_mode: VisibilityMode;
  }) =>
    apiRequest<EventDetail>("/events", {
      method: "POST",
      json: payload,
    }),
  deleteEvent: (id: number) =>
    apiRequest<void>(`/events/${id}`, { method: "DELETE", silent: false }),
  getContents: (id: number) => apiRequest<ContentsOut>(`/events/${id}/contents`),

  // Contents
  postComment: (eventId: number, text: string) =>
    apiRequest<CommentOut>(`/events/${eventId}/comments`, {
      method: "POST",
      json: { text },
    }),
  postVoice: (eventId: number, file: Blob, durationMs?: number) => {
    const fd = new FormData();
    const filename = file instanceof File ? file.name : `voice-${Date.now()}.webm`;
    fd.append("file", file, filename);
    if (durationMs != null) fd.append("duration_ms", String(durationMs));
    return apiRequest<VoiceOut>(`/events/${eventId}/voices`, {
      method: "POST",
      body: fd,
    });
  },
  postImage: (eventId: number, file: File, dims?: { width?: number; height?: number }) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (dims?.width) fd.append("width", String(dims.width));
    if (dims?.height) fd.append("height", String(dims.height));
    return apiRequest<ImageOut>(`/events/${eventId}/images`, {
      method: "POST",
      body: fd,
    });
  },
};

export function fileUrl(kind: "voices" | "images", id: number): string {
  return `${API_BASE}/${kind}/${id}/file`;
}

export async function fetchFileBlob(kind: "voices" | "images", id: number): Promise<string> {
  const token = useAppStore.getState().token;
  const resp = await fetch(`${API_BASE}/${kind}/${id}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new APIError(resp.status, await resp.text());
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export { API_BASE };
