// 后端 API 客户端：所有路径与请求方式与现有 FastAPI 后端保持一致

let _token = "";

export function setToken(token) {
  _token = token || "";
}

export function getToken() {
  return _token;
}

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (_token) h.Authorization = `Bearer ${_token}`;
  return h;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (err) {
    throw new Error("网络异常，请检查连接");
  }
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const data = await response.json();
      if (data?.detail) message = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      if (response.statusText) message = response.statusText;
    }
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  if (response.status === 204) return null;
  const ct = response.headers.get("content-type") || "";
  if (ct.includes("application/json")) return response.json();
  return response;
}

export const api = {
  me: () => request("/auth/me", { headers: authHeaders() }),

  listEvents: () => request("/events", { headers: authHeaders() }),

  getEvent: (id) => request(`/events/${id}`, { headers: authHeaders() }),

  createEvent: (payload) =>
    request("/events", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    }),

  deleteEvent: (id) =>
    request(`/events/${id}`, { method: "DELETE", headers: authHeaders() }),

  postComment: (eventId, text) =>
    request(`/events/${eventId}/comments`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text }),
    }),

  uploadVoice: (eventId, file, durationMs) => {
    const body = new FormData();
    body.append("file", file);
    if (durationMs != null) body.append("duration_ms", String(durationMs));
    return request(`/events/${eventId}/voices`, {
      method: "POST",
      headers: authHeaders(),
      body,
    });
  },

  voiceFile: async (voiceId) => {
    const response = await fetch(`/voices/${voiceId}/file`, { headers: authHeaders() });
    if (!response.ok) {
      const msg =
        response.status === 403
          ? "语音尚未解锁"
          : response.status === 404
          ? "语音文件已不存在"
          : "语音加载失败";
      const err = new Error(msg);
      err.status = response.status;
      throw err;
    }
    return response.blob();
  },

  // Admin
  createPair: (adminKey, userA, userB) =>
    request("/admin/pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
      body: JSON.stringify({
        user_a_display_name: userA,
        user_b_display_name: userB,
      }),
    }),

  listPairs: (adminKey) =>
    request("/admin/pairs", { headers: { "X-Admin-Key": adminKey } }),
};
