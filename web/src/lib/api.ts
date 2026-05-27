"use client";

// Browser API client for authenticated user, admin, event, cycle dashboard, media upload, and thumbnail requests.
// In production it uses the Caddy same-origin /api reverse proxy; in development it can fall back locally.

import { toast } from "sonner";
import { useAppStore } from "./store";
import type {
  AnniversaryOut,
  CommentOut,
  ContentsOut,
  CycleDashboardOut,
  DailyLog,
  DailyLogInput,
  EventDetail,
  EventSummary,
  ImageOut,
  LoginLogOut,
  LoginRecordCreate,
  MeOut,
  PairCreated,
  PairOut,
  UserOut,
  VisibilityMode,
  VoiceOut,
} from "./types";

// 生产环境下通过 Caddy 反代，前端使用相对路径（NEXT_PUBLIC_API_BASE="/api"）。
// 开发环境若未设置该变量则回落到本地后端 127.0.0.1:8000。
// 注意：空字符串视为「同源相对路径」，不再回退到 localhost。
const RAW_API_BASE =
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_BASE : undefined;
const API_BASE =
  RAW_API_BASE === undefined ? "http://127.0.0.1:8000" : RAW_API_BASE.replace(/\/+$/, "");

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
    user_a_email?: string | null;
    user_b_email?: string | null;
    love_started_on?: string | null;
    token_expires_at?: string | null;
  }) =>
    apiRequest<PairCreated>("/admin/pairs", {
      method: "POST",
      json: payload,
      withAdmin: true,
      withAuth: false,
    }),
  updatePair: (
    pairId: number,
    payload: { user_a_email?: string | null; user_b_email?: string | null; love_started_on?: string | null },
  ) =>
    apiRequest<PairOut>(`/admin/pairs/${pairId}`, {
      method: "PATCH",
      json: payload,
      withAdmin: true,
      withAuth: false,
    }),
  listLoginLogs: (params?: { limit?: number; userId?: number }) => {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.userId != null) search.set("user_id", String(params.userId));
    const qs = search.toString();
    return apiRequest<LoginLogOut[]>(`/admin/login-logs${qs ? `?${qs}` : ""}`, {
      withAdmin: true,
      withAuth: false,
    });
  },

  // Auth
  me: () => apiRequest<MeOut>("/auth/me"),
  getAnniversary: () => apiRequest<AnniversaryOut>("/auth/anniversary", { silent: true }),
  patchMe: (payload: { display_name?: string; avatar?: string }) =>
    apiRequest<UserOut>("/auth/me", { method: "PATCH", json: payload }),
  recordLogin: (payload: LoginRecordCreate) =>
    apiRequest<LoginLogOut>("/auth/login-record", {
      method: "POST",
      json: payload,
      silent: true,
    }),

  // Cycle dashboard
  getCycleDashboard: (params: { start: string; end: string }) => {
    const search = new URLSearchParams({ start: params.start, end: params.end });
    return apiRequest<CycleDashboardOut>(`/cycles/dashboard?${search.toString()}`);
  },
  upsertCycleLog: (date: string, payload: DailyLogInput) =>
    apiRequest<DailyLog>(`/cycles/logs/${date}`, {
      method: "PUT",
      json: payload,
    }),
  deleteCycleLog: (date: string) => apiRequest<void>(`/cycles/logs/${date}`, { method: "DELETE" }),
  clearCycleLogs: () => apiRequest<void>("/cycles/logs", { method: "DELETE" }),
  seedCycleExampleData: () =>
    apiRequest<DailyLog[]>("/cycles/example-data", {
      method: "POST",
    }),

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

export function fileUrl(kind: "voices" | "images" | "image-thumbs", id: number): string {
  if (kind === "image-thumbs") return `${API_BASE}/images/${id}/thumb`;
  return `${API_BASE}/${kind}/${id}/file`;
}

export async function fetchFileBlob(kind: "voices" | "images" | "image-thumbs", id: number): Promise<string> {
  const token = useAppStore.getState().token;
  const resp = await fetch(fileUrl(kind, id), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new APIError(resp.status, await resp.text());
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export { API_BASE };
