// 手账导出范围的查询串解析与拼装：从 /journal?scope=… 读取初始范围，校验日期和见面 id，生成后端 /journal 请求路径与页面地址。

import type { JournalQuery, JournalScope } from "./journal-types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseScope(value: string | null): JournalScope {
  return value === "range" || value === "meeting" ? value : "all";
}

function parseMeetingId(value: string | null): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

export function parseJournalQuery(params: Pick<URLSearchParams, "get">): JournalQuery {
  const start = params.get("start");
  const end = params.get("end");
  return {
    scope: parseScope(params.get("scope")),
    start: isIsoDate(start) ? start : "",
    end: isIsoDate(end) ? end : "",
    meetingId: parseMeetingId(params.get("meeting_id")),
  };
}

/** 返回该范围还缺什么；完整时返回 null。 */
export function journalQueryProblem(query: JournalQuery): string | null {
  if (query.scope === "range") {
    if (!query.start || !query.end) return "选好开始和结束日期，就能翻开这一段";
    if (query.start > query.end) return "开始日期要早于结束日期哦";
  }
  if (query.scope === "meeting" && !query.meetingId) return "挑一次见面，把那几天装进手账";
  return null;
}

function queryPairs(query: JournalQuery): Array<[string, string]> {
  const pairs: Array<[string, string]> = [["scope", query.scope]];
  if (query.scope === "range") {
    if (query.start) pairs.push(["start", query.start]);
    if (query.end) pairs.push(["end", query.end]);
  }
  if (query.scope === "meeting" && query.meetingId) pairs.push(["meeting_id", String(query.meetingId)]);
  return pairs;
}

export function journalApiPath(query: JournalQuery): string {
  return `/journal?${new URLSearchParams(queryPairs(query)).toString()}`;
}

export function journalPageSearch(query: JournalQuery): string {
  if (query.scope === "all") return "";
  return `?${new URLSearchParams(queryPairs(query)).toString()}`;
}
