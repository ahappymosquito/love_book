// 首页手账本的纯函数：按北京时间把事件收成「每月一页」（当月即使空着也有一页，书页按时间从旧到新排），页内按天分组且最新的一天在最上；
// 另外提供周一开头的月历格、选月网格的可选范围、相邻页查找和整月起止日期（给 /journal 导出用）。

import { shanghaiDateKey, shanghaiMonthKey } from "./dates";
import type { EventSummary } from "./types";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export interface BookDay {
  dateKey: string;
  day: number;
  weekday: string;
  events: EventSummary[];
}

export interface BookMonthStats {
  entries: number;
  meetings: number;
  photos: number;
  gifts: number;
}

export interface BookMonth {
  key: string;
  year: number;
  month: number;
  days: BookDay[];
  stats: BookMonthStats;
}

export function eventDateKey(event: Pick<EventSummary, "occurred_at" | "created_at">): string {
  return shanghaiDateKey(event.occurred_at ?? event.created_at);
}

export function eventTime(event: Pick<EventSummary, "occurred_at" | "created_at">): number {
  return new Date(event.occurred_at ?? event.created_at).getTime();
}

export function weekdayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function monthParts(key: string): { year: number; month: number } {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

export function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftMonthKey(key: string, delta: number): string {
  const { year, month } = monthParts(key);
  const index = year * 12 + (month - 1) + delta;
  return monthKeyOf(Math.floor(index / 12), (index % 12) + 1);
}

export function daysInMonth(key: string): number {
  const { year, month } = monthParts(key);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthDateRange(key: string): { start: string; end: string } {
  return { start: `${key}-01`, end: `${key}-${String(daysInMonth(key)).padStart(2, "0")}` };
}

/** 若 start/end 恰好覆盖一个自然月，返回该月 key。 */
export function monthKeyForRange(start: string, end: string): string | null {
  if (!start || !end || start.slice(0, 7) !== end.slice(0, 7)) return null;
  const key = start.slice(0, 7);
  const range = monthDateRange(key);
  return range.start === start && range.end === end ? key : null;
}

export function buildBookMonths(events: EventSummary[], currentMonth: string = shanghaiMonthKey()): BookMonth[] {
  const byMonth = new Map<string, Map<string, EventSummary[]>>();
  byMonth.set(currentMonth, new Map());
  for (const event of events) {
    const dateKey = eventDateKey(event);
    const monthKey = dateKey.slice(0, 7);
    const days = byMonth.get(monthKey) ?? new Map<string, EventSummary[]>();
    days.set(dateKey, [...(days.get(dateKey) ?? []), event]);
    byMonth.set(monthKey, days);
  }

  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, dayMap]) => {
      const days = [...dayMap.entries()]
        .sort(([left], [right]) => right.localeCompare(left))
        .map(([dateKey, dayEvents]) => ({
          dateKey,
          day: Number(dateKey.slice(8, 10)),
          weekday: weekdayLabel(dateKey),
          events: [...dayEvents].sort((left, right) => eventTime(right) - eventTime(left) || right.id - left.id),
        }));
      const monthEvents = days.flatMap((day) => day.events);
      return {
        key,
        ...monthParts(key),
        days,
        stats: {
          entries: monthEvents.length,
          meetings: new Set(monthEvents.map((event) => event.meeting_session_id).filter((id) => id !== null)).size,
          photos: monthEvents.reduce((total, event) => total + (event.gift_masked ? 0 : event.image_count), 0),
          gifts: monthEvents.filter((event) => event.event_kind === "gift" || event.event_kind === "gift_received").length,
        },
      };
    });
}

export type CalendarCell = { dateKey: string; day: number } | null;

/** 周一开头的整月格子，前后用 null 补齐到整周。 */
export function monthCalendar(key: string): CalendarCell[][] {
  const total = daysInMonth(key);
  const firstWeekday = (new Date(`${key}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: CalendarCell[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= total; day += 1) {
    cells.push({ dateKey: `${key}-${String(day).padStart(2, "0")}`, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

export function neighborIndex(length: number, index: number, direction: 1 | -1): number | null {
  const next = index + direction;
  return next >= 0 && next < length ? next : null;
}

export interface MonthCell {
  key: string;
  month: number;
  count: number;
  disabled: boolean;
}

/** 选月网格：早于 minMonth、晚于 maxMonth 的月份不可选；requireEntries 时空月份也不可选（maxMonth 当月除外）。 */
export function yearMonthCells(
  year: number,
  counts: ReadonlyMap<string, number>,
  { minMonth, maxMonth, requireEntries }: { minMonth: string; maxMonth: string; requireEntries: boolean },
): MonthCell[] {
  return Array.from({ length: 12 }, (_, index) => {
    const key = monthKeyOf(year, index + 1);
    const count = counts.get(key) ?? 0;
    const outOfRange = key < minMonth || key > maxMonth;
    return {
      key,
      month: index + 1,
      count,
      disabled: outOfRange || (requireEntries && count === 0 && key !== maxMonth),
    };
  });
}
