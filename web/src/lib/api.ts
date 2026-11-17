"use client";

// Browser API client for authentication, closed-pair farewells, runner rankings, profiles, timelines, wrapped gifts (wrap, open, receiver response), private media, the meeting todo plan (write into the journal), habits, cycles and their mail reminder, quotes, and admin workflows.
// Failure toasts use friendly, status-based Chinese copy instead of raw server detail; background polls can opt into silent mode.
// In production it uses the host Nginx same-origin /api reverse proxy; in development it can fall back locally.

import { toast } from "sonner";
import { useAppStore } from "./store";
import type {
  AnniversaryOut,
  CommentOut,
  CommentReactionType,
  ContentsOut,
  CycleDashboardOut,
  CycleReminderSettingOut,
  DailyLog,
  DailyLogInput,
  DefaultQuoteOut,
  EventDetail,
  EventKind,
  EventSummary,
  GiftFeeling,
  GiftWrapStyle,
  HabitDashboardOut,
  HabitTaskOut,
  HabitToggleOut,
  ImageOut,
  GameLeaderboardOut,
  GameScoreSubmitOut,
  LoginLogOut,
  LoginRecordCreate,
  PasswordSessionOut,
  LoveReceiptOut,
  MeetingSessionOut,
  MeOut,
  PairCreated,
  PairDissolvedOut,
  PairOut,
  QuoteOut,
  QuoteSampleOut,
  SecurityPasswordOut,
  SecurityPasswordUpdateOut,
  TodoCategory,
  TodoCommentOut,
  TodoImageOut,
  TodoItemDetail,
  TodoItemOut,
  TodoJournalOut,
  TodoPlanOut,
  UserOut,
  VisibilityMode,
} from "./types";

// 生产环境下通过主机 Nginx 同源反代，前端使用相对路径（NEXT_PUBLIC_API_BASE="/api"）。
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

export function pairDissolvedFromUnknown(detail: unknown): PairDissolvedOut | null {
  if (!detail || typeof detail !== "object") return null;
  const record = detail as Record<string, unknown>;
  if (record.code !== "pair_dissolved" || typeof record.message !== "string") return null;
  return {
    code: "pair_dissolved",
    message: record.message,
    from_display_name: typeof record.from_display_name === "string" ? record.from_display_name : "",
  };
}

export function pairDissolvedFromError(error: unknown): PairDissolvedOut | null {
  return error instanceof APIError ? pairDissolvedFromUnknown(error.detail) : null;
}

const CJK_PATTERN = /[\u3400-\u9fff]/;

function friendlyStatusMessage(status: number, message: string): string {
  if (message && CJK_PATTERN.test(message) && message.length <= 80) return message;
  if (status === 0) return "网络好像断开了，检查一下网络再试试";
  if (status === 401) return "登录状态过期了，请重新进入";
  if (status === 403) return "这一步只有创建的人可以操作";
  if (status === 404) return "这条内容已经找不到了";
  if (status === 409) return "内容刚刚有变化，刷新后再试一次";
  if (status === 413) return "文件有点大，换一张小一点的试试";
  if (status === 422 || status === 400) return "填写的内容有点问题，检查一下再试";
  if (status === 429) return "操作有点频繁，稍等一会儿再试";
  if (status >= 500) return "这会儿没能完成，请稍后再试";
  return "没能完成，请稍后再试";
}

export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof APIError) return friendlyStatusMessage(error.status, error.message);
  return "没能完成，请稍后再试";
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
    const aborted = err instanceof DOMException && err.name === "AbortError";
    if (!silent && !aborted) toast.error(friendlyStatusMessage(0, ""));
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
    const dissolved = pairDissolvedFromUnknown(detail);
    const msg = dissolved?.message ?? (typeof detail === "string" ? detail : JSON.stringify(detail));
    if (!silent && !dissolved) {
      toast.error(withAdmin ? `请求失败：${msg}` : friendlyStatusMessage(resp.status, msg));
    }
    throw new APIError(resp.status, msg, dissolved ?? detail);
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
  me: (options?: { silent?: boolean }) => apiRequest<MeOut>("/auth/me", { silent: options?.silent }),
  dissolvePair: (payload?: { message?: string | null }) =>
    apiRequest<void>("/auth/me/dissolve", {
      method: "POST",
      json: { message: payload?.message ?? null },
      silent: true,
    }),
  getAnniversary: () => apiRequest<AnniversaryOut>("/auth/anniversary", { silent: true }),
  patchMe: (payload: { display_name?: string; avatar?: string; email?: string | null }) =>
    apiRequest<UserOut>("/auth/me", { method: "PATCH", json: payload }),
  uploadMyAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return apiRequest<UserOut>("/auth/me/avatar", {
      method: "POST",
      body: fd,
    });
  },
  deleteMyAvatar: () => apiRequest<UserOut>("/auth/me/avatar", { method: "DELETE" }),
  recordLogin: (payload: LoginRecordCreate) =>
    apiRequest<LoginLogOut>("/auth/login-record", {
      method: "POST",
      json: payload,
      silent: true,
    }),
  passwordLogin: (payload: { login_name: string; password: string }) =>
    apiRequest<PasswordSessionOut>("/auth/login/password", {
      method: "POST",
      json: payload,
      withAuth: false,
      silent: true,
    }),
  getSecurityPassword: () => apiRequest<SecurityPasswordOut>("/auth/me/security-password"),
  updateSecurityPassword: (payload: { login_name: string; password: string }) =>
    apiRequest<SecurityPasswordUpdateOut>("/auth/me/security-password", {
      method: "PUT",
      json: payload,
    }),

  // Public login runner leaderboard
  getGameLeaderboard: () =>
    apiRequest<GameLeaderboardOut>("/game/leaderboard", { withAuth: false, silent: true }),
  submitGameScore: (payload: { player_name: string; score: number }) =>
    apiRequest<GameScoreSubmitOut>("/game/leaderboard", {
      method: "POST",
      json: payload,
      withAuth: false,
      silent: true,
    }),

  // Quotes
  sampleQuotes: (limit = 5) => apiRequest<QuoteSampleOut>(`/quotes/sample?limit=${limit}`, { silent: true }),
  listQuotes: () => apiRequest<QuoteOut[]>("/quotes"),
  listDefaultQuotes: () => apiRequest<DefaultQuoteOut[]>("/quotes/defaults"),
  createQuote: (text: string) =>
    apiRequest<QuoteOut>("/quotes", {
      method: "POST",
      json: { text },
    }),
  deleteQuote: (id: number) => apiRequest<void>(`/quotes/${id}`, { method: "DELETE" }),

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
  upsertCycleLogDashboard: (date: string, params: { start: string; end: string }, payload: DailyLogInput) => {
    const search = new URLSearchParams({ start: params.start, end: params.end });
    return apiRequest<CycleDashboardOut>(`/cycles/logs/${date}/dashboard?${search.toString()}`, {
      method: "PUT",
      json: payload,
    });
  },
  deleteCycleLog: (date: string) => apiRequest<void>(`/cycles/logs/${date}`, { method: "DELETE" }),
  getCycleReminder: () => apiRequest<CycleReminderSettingOut>("/cycles/reminder", { silent: true }),
  updateCycleReminder: (payload: { enabled: boolean; days_before: number; recipient_user_id?: number | null }) =>
    apiRequest<CycleReminderSettingOut>("/cycles/reminder", { method: "PUT", json: payload }),

  // Habits
  getHabitDashboard: (params: { start: string; end: string }) => {
    const search = new URLSearchParams({ start: params.start, end: params.end });
    return apiRequest<HabitDashboardOut>(`/habits/dashboard?${search.toString()}`);
  },
  createHabitTask: (payload: { title: string; color: string }) =>
    apiRequest<HabitTaskOut>("/habits/tasks", { method: "POST", json: payload }),
  updateHabitTask: (
    id: number,
    payload: { title?: string; color?: string; sort_order?: number; is_active?: boolean },
  ) => apiRequest<HabitTaskOut>(`/habits/tasks/${id}`, { method: "PATCH", json: payload }),
  deleteHabitTask: (id: number) => apiRequest<void>(`/habits/tasks/${id}`, { method: "DELETE" }),
  toggleHabitTask: (id: number, params: { target_date: string; start: string; end: string }) => {
    const search = new URLSearchParams({
      target_date: params.target_date,
      start: params.start,
      end: params.end,
    });
    return apiRequest<HabitToggleOut>(`/habits/tasks/${id}/toggle?${search.toString()}`, { method: "POST" });
  },

  // Todo plan
  getTodoPlan: (options?: { silent?: boolean }) => apiRequest<TodoPlanOut>("/todos/plan", { silent: options?.silent }),
  createTodoItem: (payload: {
    category: TodoCategory;
    title: string;
    note?: string | null;
    meeting_session_id?: number | null;
    scheduled_on?: string | null;
    start_minute?: number | null;
    end_minute?: number | null;
  }) => apiRequest<TodoItemOut>("/todos/items", { method: "POST", json: payload }),
  updateTodoItem: (
    id: number,
    payload: {
      title?: string;
      note?: string | null;
      category?: TodoCategory;
      meeting_session_id?: number | null;
      scheduled_on?: string | null;
      start_minute?: number | null;
      end_minute?: number | null;
      completed?: boolean;
      is_archived?: boolean;
    },
  ) => apiRequest<TodoItemOut>(`/todos/items/${id}`, { method: "PATCH", json: payload }),
  deleteTodoItem: (id: number) => apiRequest<void>(`/todos/items/${id}`, { method: "DELETE" }),
  writeTodoIntoJournal: (id: number) => apiRequest<TodoJournalOut>(`/todos/items/${id}/journal`, { method: "POST" }),
  getTodoItem: (id: number, options?: { silent?: boolean }) =>
    apiRequest<TodoItemDetail>(`/todos/items/${id}`, { silent: options?.silent }),
  postTodoComment: (id: number, text: string) =>
    apiRequest<TodoCommentOut>(`/todos/items/${id}/comments`, { method: "POST", json: { text } }),
  postTodoImage: (id: number, file: File, dims?: { width?: number; height?: number }) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (dims?.width) fd.append("width", String(dims.width));
    if (dims?.height) fd.append("height", String(dims.height));
    return apiRequest<TodoImageOut>(`/todos/items/${id}/images`, { method: "POST", body: fd });
  },
  deleteTodoImage: (id: number) => apiRequest<void>(`/todo-images/${id}`, { method: "DELETE" }),

  // Events
  listMeetingSessions: () => apiRequest<MeetingSessionOut[]>("/meeting-sessions"),
  createMeetingSession: (payload: { title: string; started_on: string; ended_on: string }) =>
    apiRequest<MeetingSessionOut>("/meeting-sessions", {
      method: "POST",
      json: payload,
    }),

  // Read-only legacy receipt lookup used only to redirect historical links.
  getLoveReceipt: (id: number) => apiRequest<LoveReceiptOut>(`/love-receipts/${id}`),
  updateMeetingSession: (
    id: number,
    payload: { title?: string; started_on?: string; ended_on?: string },
  ) =>
    apiRequest<MeetingSessionOut>(`/meeting-sessions/${id}`, {
      method: "PATCH",
      json: payload,
    }),
  deleteMeetingSession: (id: number) =>
    apiRequest<void>(`/meeting-sessions/${id}`, { method: "DELETE" }),
  listEvents: () => apiRequest<EventSummary[]>("/events"),
  getEvent: (id: number) => apiRequest<EventDetail>(`/events/${id}`),
  createEvent: (payload: {
    title: string;
    description?: string | null;
    occurred_at?: string | null;
    event_kind?: EventKind;
    meeting_session_id?: number | null;
    visibility_mode: VisibilityMode;
  }) =>
    apiRequest<EventDetail>("/events", {
      method: "POST",
      json: payload,
    }),
  wrapGift: (payload: {
    title: string;
    message?: string;
    teaser?: string;
    wrapStyle: GiftWrapStyle;
    openAt?: string | null;
    occurredAt?: string | null;
    files: File[];
  }) => {
    const fd = new FormData();
    fd.append("title", payload.title);
    fd.append("message", payload.message ?? "");
    fd.append("teaser", payload.teaser ?? "");
    fd.append("wrap_style", payload.wrapStyle);
    if (payload.openAt) fd.append("open_at", payload.openAt);
    if (payload.occurredAt) fd.append("occurred_at", payload.occurredAt);
    payload.files.forEach((file) => fd.append("files", file, file.name));
    return apiRequest<EventDetail>("/events/gifts/wrap", { method: "POST", body: fd });
  },
  openGift: (id: number) =>
    apiRequest<EventDetail>(`/events/${id}/gift/open`, { method: "POST", silent: true }),
  respondGift: (id: number, payload: { feelings: GiftFeeling[]; rating: number | null; feedback: string }) =>
    apiRequest<EventDetail>(`/events/${id}/gift/response`, { method: "PUT", json: payload }),
  updateEvent: (
    id: number,
    payload: {
      title?: string;
      description?: string | null;
      occurred_at?: string | null;
      event_kind?: EventKind;
      meeting_session_id?: number | null;
      visibility_mode?: VisibilityMode;
      gift_rating?: number | null;
      gift_feelings?: GiftFeeling[];
      gift_teaser?: string | null;
      gift_wrap_style?: GiftWrapStyle;
      gift_open_at?: string | null;
    },
  ) =>
    apiRequest<EventDetail>(`/events/${id}`, {
      method: "PATCH",
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
  setCommentReaction: (commentId: number, reactionType: CommentReactionType) =>
    apiRequest<CommentOut>(`/comments/${commentId}/reaction`, {
      method: "PUT",
      json: { reaction_type: reactionType },
    }),
  deleteCommentReaction: (commentId: number) =>
    apiRequest<CommentOut>(`/comments/${commentId}/reaction`, {
      method: "DELETE",
    }),
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

export function fileUrl(kind: "images" | "image-thumbs", id: number): string {
  if (kind === "image-thumbs") return `${API_BASE}/images/${id}/thumb`;
  return `${API_BASE}/${kind}/${id}/file`;
}

export function avatarUrl(userId: number): string {
  return `${API_BASE}/users/${userId}/avatar`;
}

export function todoImageUrl(kind: "file" | "thumb", id: number): string {
  return `${API_BASE}/todo-images/${id}/${kind}`;
}

export async function fetchTodoImageBlob(kind: "file" | "thumb", id: number): Promise<string> {
  const token = useAppStore.getState().token;
  const resp = await fetch(todoImageUrl(kind, id), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new APIError(resp.status, await resp.text());
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export async function fetchFileBlob(kind: "images" | "image-thumbs", id: number): Promise<string> {
  const token = useAppStore.getState().token;
  const resp = await fetch(fileUrl(kind, id), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new APIError(resp.status, await resp.text());
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export async function fetchAvatarBlob(userId: number): Promise<string> {
  const token = useAppStore.getState().token;
  const adminKey = useAppStore.getState().adminKey;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (adminKey) headers["X-Admin-Key"] = adminKey;
  const resp = await fetch(avatarUrl(userId), { headers });
  if (!resp.ok) throw new APIError(resp.status, await resp.text());
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export { API_BASE };
