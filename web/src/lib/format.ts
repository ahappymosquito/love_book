export function formatRelative(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 30) return "刚刚";
  if (abs < 60) return `${diffSec}秒前`;
  if (abs < 3600) return `${Math.round(diffSec / 60)}分钟前`;
  if (abs < 86400) return `${Math.round(diffSec / 3600)}小时前`;
  if (abs < 86400 * 7) return `${Math.round(diffSec / 86400)}天前`;
  return formatAbsolute(date, false);
}

export function formatAbsolute(input: string | Date, withTime = true): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  if (!withTime) return `${y}-${m}-${d}`;
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${`${s}`.padStart(2, "0")}`;
}

export function toLocalInputValue(date: Date): string {
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export function fromLocalInputValue(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}
