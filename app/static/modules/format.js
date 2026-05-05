// 时间 / 文本格式化辅助

const dtfFull = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dtfMD = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
});

const dtfYMD = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dtfTime = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatFull(value) {
  const d = parseDate(value);
  return d ? dtfFull.format(d) : "未填";
}

export function formatYMD(value) {
  const d = parseDate(value);
  return d ? dtfYMD.format(d) : "";
}

export function formatTime(value) {
  const d = parseDate(value);
  return d ? dtfTime.format(d) : "";
}

export function formatRelative(value) {
  const d = parseDate(value);
  if (!d) return "";
  const now = new Date();
  const diff = (now - d) / 1000;
  const sameYear = d.getFullYear() === now.getFullYear();
  const absolute = sameYear ? dtfMD.format(d) : dtfYMD.format(d);

  if (diff >= 0 && diff < 60) return "刚刚";
  if (diff >= 0 && diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff >= 0 && diff < 86400) {
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d >= startToday) return `今天 ${formatTime(d)}`;
    return `${Math.floor(diff / 3600)} 小时前`;
  }
  if (diff >= 0 && diff < 86400 * 2) return `昨天 ${formatTime(d)}`;
  if (diff >= 0 && diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前 · ${absolute}`;
  if (diff < 0) {
    const ahead = Math.abs(diff);
    if (ahead < 3600) return `${Math.floor(ahead / 60)} 分钟后`;
    if (ahead < 86400) return `今天稍晚 · ${formatTime(d)}`;
    if (ahead < 86400 * 7) return `${Math.floor(ahead / 86400)} 天后 · ${absolute}`;
  }
  return absolute;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function initials(name) {
  if (!name) return "·";
  const trimmed = String(name).trim();
  if (!trimmed) return "·";
  const codePoint = [...trimmed][0];
  return codePoint || "·";
}

export function bytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function durationFromMs(ms) {
  if (!ms || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}
