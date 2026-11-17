// 约会计划日程的纯函数：见面日期展开成一天天、分钟和 "HH:MM" 互转、按 15 分钟吸附、日程网格起止小时，
// 以及同一天时间重叠的事项按 Notion 日历的方式分列（lane）并排显示。

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const MAX_PLAN_DAYS = 31;
export const SNAP_MINUTES = 15;
export const DEFAULT_DURATION = 60;

export interface PlanDay {
  key: string;
  month: number;
  day: number;
  weekday: string;
  index: number;
}

function dayToKey(value: number): string {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

function keyToDay(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function meetingDays(startedOn: string, endedOn: string): PlanDay[] {
  const first = keyToDay(startedOn);
  const last = Math.min(keyToDay(endedOn), first + MAX_PLAN_DAYS - 1);
  const days: PlanDay[] = [];
  for (let value = first; value <= last; value += 1) {
    const key = dayToKey(value);
    days.push({
      key,
      month: Number(key.slice(5, 7)),
      day: Number(key.slice(8, 10)),
      weekday: WEEKDAYS[new Date(value * 86_400_000).getUTCDay()],
      index: value - first,
    });
  }
  return days;
}

export function minuteLabel(minute: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(minute)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export function parseMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

export function snapMinute(minute: number, step = SNAP_MINUTES): number {
  return Math.max(0, Math.min(1440, Math.round(minute / step) * step));
}

export function slotLabel(start: number | null, end: number | null): string {
  if (start == null) return "全天";
  return `${minuteLabel(start)}–${minuteLabel(end ?? Math.min(start + DEFAULT_DURATION, 1440))}`;
}

/** 网格从 8 点开始，有更早的安排就往前扩到那个整点；总是画到 24 点。 */
export function gridStartHour(starts: number[], defaultHour = 8): number {
  const earliest = starts.length ? Math.min(...starts) : Infinity;
  return Math.max(0, Math.min(defaultHour, Math.floor(earliest / 60)));
}

export interface TimedEntry {
  id: number;
  start: number;
  end: number;
}

export interface LaneSlot {
  lane: number;
  lanes: number;
}

/** 重叠的一簇事项依次放进最左边空着的列，整簇共用列数，让卡片并排而不是叠在一起。 */
export function layoutLanes(entries: TimedEntry[]): Map<number, LaneSlot> {
  const sorted = [...entries].sort((left, right) => left.start - right.start || right.end - left.end || left.id - right.id);
  const result = new Map<number, LaneSlot>();
  let cluster: Array<{ id: number; lane: number }> = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const entry of cluster) result.set(entry.id, { lane: entry.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const entry of sorted) {
    if (entry.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= entry.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(entry.end);
    } else {
      laneEnds[lane] = entry.end;
    }
    cluster.push({ id: entry.id, lane });
    clusterEnd = Math.max(clusterEnd, entry.end);
  }
  flush();
  return result;
}
