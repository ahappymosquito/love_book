"use client";

// Browser API client for authenticated profiles, cross-device location preferences, private avatars, customizable admin AMap-grounded AI tests with an enable switch, habits, todo candidate queues with manual category fallback, scheduling, weather hints, named meeting sessions, typed timeline events, quotes, live cycle dashboards, reactions, and media including todo image deletion.
// In production it uses the Caddy same-origin /api reverse proxy; in development it can fall back locally.

import { toast } from "sonner";
import { useAppStore } from "./store";
import type {
  AnniversaryOut,
  AdminAIConfigOut,
  AdminAIConnectionTestOut,
  AIProtocol,
  CommentOut,
  CommentReactionType,
  ContentsOut,
  CycleDashboardOut,
  DailyLog,
  DailyLogInput,
  DefaultQuoteOut,
  EventDetail,
  EventKind,
  EventSummary,
  HabitDashboardOut,
  HabitTaskOut,
  HabitToggleOut,
  ImageOut,
  LoginLogOut,
  LoginRecordCreate,
  MeetingSessionOut,
  MeOut,
  PairCreated,
  PairOut,
  QuoteOut,
  TodoCategory,
  TodoCandidateOut,
  TodoClassifyOpenOut,
  TodoCommentOut,
  TodoDashboardOut,
  TodoImageOut,
  TodoItemDetail,
  TodoItemOut,
  TodoLotteryOut,
  TodoRestaurantCandidate,
  TodoWeatherOut,
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
  getAdminAIConfig: () =>
    apiRequest<AdminAIConfigOut>("/admin/ai-config", { withAdmin: true, withAuth: false }),
  updateAdminAIConfig: (payload: {
    llm_enabled: boolean;
    protocol: AIProtocol;
    selected_model: string;
    openai_base_url: string;
    anthropic_base_url: string;
    api_key: string;
    amap_api_key: string;
  }) =>
    apiRequest<AdminAIConfigOut>("/admin/ai-config", {
      method: "PATCH",
      json: payload,
      withAdmin: true,
      withAuth: false,
    }),
  listAdminAIModels: (protocol?: AIProtocol) =>
    apiRequest<{ models: string[] }>(`/admin/ai-config/models${protocol ? `?protocol=${protocol}` : ""}`, {
      withAdmin: true,
      withAuth: false,
    }),
  testAdminAIConfig: (payload?: { keyword?: string | null; city?: string | null; expected_category?: TodoCategory | null }) =>
    apiRequest<AdminAIConnectionTestOut>("/admin/ai-config/test", {
      method: "POST",
      json: payload,
      withAdmin: true,
      withAuth: false,
    }),

  // Auth
  me: () => apiRequest<MeOut>("/auth/me"),
  getAnniversary: () => apiRequest<AnniversaryOut>("/auth/anniversary", { silent: true }),
  patchMe: (payload: { display_name?: string; avatar?: string; email?: string | null }) =>
    apiRequest<UserOut>("/auth/me", { method: "PATCH", json: payload }),
  patchMyLocation: (payload: { label?: string | null; address?: string | null; city?: string | null; coords?: string | null }) =>
    apiRequest<UserOut>("/auth/me/location", { method: "PATCH", json: payload }),
  deleteMyLocation: () => apiRequest<UserOut>("/auth/me/location", { method: "DELETE" }),
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

  // Quotes
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
  clearCycleLogs: () => apiRequest<void>("/cycles/logs", { method: "DELETE" }),
  seedCycleExampleData: () =>
    apiRequest<DailyLog[]>("/cycles/example-data", {
      method: "POST",
    }),

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

  // Todo
  getTodoDashboard: (month: string) => apiRequest<TodoDashboardOut>(`/todos/dashboard?month=${month}`),
  createTodoItem: (payload: { category: TodoCategory; title: string; note?: string | null }) =>
    apiRequest<TodoItemOut>("/todos/items", { method: "POST", json: payload }),
  updateTodoItem: (
    id: number,
    payload: {
      title?: string;
      note?: string | null;
      is_archived?: boolean;
      signature_dishes?: string | null;
      per_capita?: number | null;
    },
  ) => apiRequest<TodoItemOut>(`/todos/items/${id}`, { method: "PATCH", json: payload }),
  deleteTodoItem: (id: number) => apiRequest<void>(`/todos/items/${id}`, { method: "DELETE" }),
  scheduleTodoItem: (id: number, scheduled_on: string) =>
    apiRequest(`/todos/items/${id}/schedules`, { method: "POST", json: { scheduled_on } }),
  deleteTodoSchedule: (id: number) => apiRequest<void>(`/todos/schedules/${id}`, { method: "DELETE" }),
  classifyTodoItem: (id: number) => apiRequest<TodoItemOut>(`/todos/items/${id}/classify`, { method: "POST" }),
  classifyOpenTodoItems: () => apiRequest<TodoClassifyOpenOut>("/todos/items/classify-open", { method: "POST" }),
  listTodoCandidates: () => apiRequest<TodoCandidateOut[]>("/todos/candidates"),
  createTodoCandidate: (payload: { raw_title: string; category?: TodoCategory | null }) =>
    apiRequest<TodoCandidateOut>("/todos/candidates", { method: "POST", json: payload }),
  confirmTodoCandidate: (
    candidateId: number,
    payload: { category?: TodoCategory | null; selected_candidate?: TodoRestaurantCandidate | null },
  ) => apiRequest<TodoItemOut>(`/todos/candidates/${candidateId}/confirm`, { method: "POST", json: payload }),
  deleteTodoCandidate: (candidateId: number) => apiRequest<void>(`/todos/candidates/${candidateId}`, { method: "DELETE" }),
  searchTodoRestaurants: (payload: { keyword: string; city?: string | null }) =>
    apiRequest<{ candidates: TodoRestaurantCandidate[] }>("/todos/restaurants/search", { method: "POST", json: payload }),
  createTodoRestaurant: (payload: {
    candidate: TodoRestaurantCandidate;
    signature_dishes?: string | null;
    per_capita?: number | null;
  }) => apiRequest<TodoItemOut>("/todos/restaurants", { method: "POST", json: payload }),
  lotteryTodoRestaurant: (payload: {
    per_capita_min?: number | null;
    per_capita_max?: number | null;
    location?: string | null;
    radius_km?: number | null;
    city?: string | null;
  }) => apiRequest<TodoLotteryOut>("/todos/restaurants/lottery", { method: "POST", json: payload }),
  getTodoItem: (id: number) => apiRequest<TodoItemDetail>(`/todos/items/${id}`),
  getTodoWeather: (id: number) => apiRequest<TodoWeatherOut | null>(`/todos/items/${id}/weather`, { silent: true }),
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
  createMeetingSession: (payload: { title: string; started_on?: string | null; ended_on?: string | null }) =>
    apiRequest<MeetingSessionOut>("/meeting-sessions", {
      method: "POST",
      json: payload,
    }),
  updateMeetingSession: (
    id: number,
    payload: { title?: string; started_on?: string | null; ended_on?: string | null },
  ) =>
    apiRequest<MeetingSessionOut>(`/meeting-sessions/${id}`, {
      method: "PATCH",
      json: payload,
    }),
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
  updateEvent: (
    id: number,
    payload: {
      title?: string;
      description?: string | null;
      occurred_at?: string | null;
      event_kind?: EventKind;
      meeting_session_id?: number | null;
      visibility_mode?: VisibilityMode;
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

export async function fetchFileBlob(kind: "voices" | "images" | "image-thumbs", id: number): Promise<string> {
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
