"use client";

// 约会计划的日程视图（参考 Notion 日历）：见面的每一天一列，顶部“全天”行放住宿等不定时的事，下面是按小时的时间网格。
// 点空白格就地新建一件事（默认一小时，可选吃/玩/住/准备）；点卡片打开详情；鼠标可拖动卡片换时间或换天、拖底边改结束时间，按 15 分钟吸附。
// 手机一次看一天（顶部日期胶囊切换），sm 两天，lg 以上最多四天并可左右翻；同一时段重叠的卡片并排显示。网格是实体内容层，不用 backdrop-filter。

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEFAULT_DURATION,
  gridStartHour,
  layoutLanes,
  meetingDays,
  minuteLabel,
  slotLabel,
  snapMinute,
} from "@/lib/meeting-plan";
import type { PlanDay } from "@/lib/meeting-plan";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import { useMediaQuery } from "@/lib/use-media-query";
import type { TodoCategory, TodoItemOut, TodoMeetingOut } from "@/lib/types";

const HOUR_PX = 52;
const MIN_BLOCK_PX = 26;
const DRAG_THRESHOLD = 4;

export const PLAN_CATEGORY_TONE: Record<TodoCategory, { label: string; block: string; chip: string }> = {
  food: { label: "吃", block: "border-peach-deep/35 bg-peach/30 text-ink", chip: "bg-peach/34 text-peach-deep" },
  play: { label: "玩", block: "border-rose/35 bg-rose/14 text-ink", chip: "bg-rose/18 text-rose-deep" },
  stay: { label: "住", block: "border-sage/45 bg-sage/22 text-ink", chip: "bg-sage/26 text-ink-soft" },
  prep: { label: "准备", block: "border-line bg-surface-raised text-ink", chip: "bg-line/40 text-ink-soft" },
};

export interface SlotDraft {
  day: string;
  start: number | null;
  end: number | null;
}

interface DragState {
  id: number;
  mode: "move" | "resize";
  originY: number;
  originStart: number;
  originEnd: number;
  day: string;
  start: number;
  end: number;
  moved: boolean;
}

export function MeetingDayPlanner({
  meeting,
  items,
  today,
  highlightId,
  onOpen,
  onToggle,
  onCreate,
  onReschedule,
}: {
  meeting: TodoMeetingOut;
  items: TodoItemOut[];
  today: string;
  highlightId: number | null;
  onOpen: (id: number) => void;
  onToggle: (item: TodoItemOut) => void;
  onCreate: (title: string, category: TodoCategory, slot: SlotDraft) => Promise<boolean>;
  onReschedule: (item: TodoItemOut, slot: SlotDraft) => Promise<void>;
}) {
  const reducedMotion = useReducedMotion();
  const wide = useMediaQuery("(min-width: 1024px)");
  const medium = useMediaQuery("(min-width: 640px)");
  const days = useMemo(() => meetingDays(meeting.started_on, meeting.ended_on), [meeting.started_on, meeting.ended_on]);
  const dayKeys = useMemo(() => new Set(days.map((day) => day.key)), [days]);
  const visibleCount = Math.min(days.length, wide ? 4 : medium ? 2 : 1);
  const todayIndex = days.findIndex((day) => day.key === today);
  const [windowStart, setWindowStart] = useState(() => Math.max(0, todayIndex));
  const start = Math.max(0, Math.min(windowStart, days.length - visibleCount));
  const visible = days.slice(start, start + visibleCount);
  const [draft, setDraft] = useState<SlotDraft | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  const scheduled = useMemo(() => items.filter((item) => item.scheduled_on && dayKeys.has(item.scheduled_on)), [items, dayKeys]);
  const startHour = gridStartHour(scheduled.flatMap((item) => (item.start_minute != null ? [item.start_minute] : [])));
  const gridStart = startHour * 60;
  const gridHeight = (24 - startHour) * HOUR_PX;
  const hours = Array.from({ length: 24 - startHour }, (_, index) => startHour + index);

  useEffect(() => {
    setWindowStart(Math.max(0, todayIndex));
    setDraft(null);
  }, [meeting.id, todayIndex]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const timed = scheduled.filter((item) => item.start_minute != null).map((item) => item.start_minute!);
    const focusMinute = timed.length ? Math.min(...timed) - 30 : 9 * 60;
    container.scrollTop = Math.max(0, ((focusMinute - gridStart) / 60) * HOUR_PX);
    // 只在换一次见面时定位，之后保持用户自己的滚动位置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id]);

  const toY = (minute: number) => ((minute - gridStart) / 60) * HOUR_PX;

  function minuteAt(clientY: number): number {
    const grid = gridRef.current;
    if (!grid) return gridStart;
    const offset = clientY - grid.getBoundingClientRect().top;
    return gridStart + (offset / HOUR_PX) * 60;
  }

  function openDraftAt(day: string, clientY: number) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const begin = Math.min(snapMinute(minuteAt(clientY) - 15, 30), 1440 - 30);
    setDraft({ day, start: begin, end: Math.min(begin + DEFAULT_DURATION, 1440) });
  }

  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const dragging = drag !== null;

  useEffect(() => {
    if (!dragging) return;
    function onMove(event: PointerEvent) {
      const current = dragRef.current;
      if (!current) return;
      const deltaY = event.clientY - current.originY;
      const deltaMinutes = snapMinute((deltaY / HOUR_PX) * 60);
      if (current.mode === "resize") {
        const end = Math.max(current.originStart + 15, Math.min(1440, current.originEnd + deltaMinutes));
        setDrag({ ...current, end, moved: current.moved || Math.abs(deltaY) >= DRAG_THRESHOLD });
        return;
      }
      const length = current.originEnd - current.originStart;
      const begin = Math.max(gridStart, Math.min(1440 - length, current.originStart + deltaMinutes));
      const column = document.elementsFromPoint(event.clientX, event.clientY).find((node) => node instanceof HTMLElement && node.dataset.planDay);
      const day = (column as HTMLElement | undefined)?.dataset.planDay ?? current.day;
      const moved = current.moved || Math.abs(deltaY) >= DRAG_THRESHOLD || day !== current.day;
      setDrag({ ...current, start: begin, end: begin + length, day, moved });
    }
    function onUp() {
      const current = dragRef.current;
      setDrag(null);
      if (!current?.moved) return;
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const item = items.find((entry) => entry.id === current.id);
      if (!item || (current.day === item.scheduled_on && current.start === item.start_minute && current.end === item.end_minute)) return;
      void onReschedule(item, { day: current.day, start: current.start, end: current.end });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, gridStart, items, onReschedule]);

  function beginDrag(event: ReactPointerEvent, item: TodoItemOut, mode: DragState["mode"]) {
    if (event.pointerType !== "mouse" || event.button !== 0 || item.start_minute == null || !item.scheduled_on) return;
    event.stopPropagation();
    event.preventDefault();
    const end = item.end_minute ?? Math.min(item.start_minute + DEFAULT_DURATION, 1440);
    setDraft(null);
    setDrag({ id: item.id, mode, originY: event.clientY, originStart: item.start_minute, originEnd: end, day: item.scheduled_on, start: item.start_minute, end, moved: false });
  }

  const gridStyle = { gridTemplateColumns: `2.75rem repeat(${visible.length}, minmax(0, 1fr))` };

  return (
    <section className="content-surface min-w-0 overflow-hidden" aria-labelledby="plan-calendar-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="plan-calendar-title" className="font-display text-lg font-semibold text-ink">每天的安排</h2>
          <p className="font-sc text-xs text-ink-muted">点空白处加一件事{wide ? "，拖动卡片换时间" : ""}</p>
        </div>
        {days.length > visibleCount && visibleCount > 1 && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setWindowStart(Math.max(0, start - visibleCount))} disabled={start === 0}
              className="grid h-9 w-9 place-items-center rounded-full text-ink-soft transition hover:bg-rose/10 disabled:opacity-30 focus-ring" aria-label="往前几天">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-sc text-xs text-ink-muted">第 {start + 1}–{start + visible.length} 天 / 共 {days.length} 天</span>
            <button type="button" onClick={() => setWindowStart(Math.min(days.length - visibleCount, start + visibleCount))} disabled={start + visibleCount >= days.length}
              className="grid h-9 w-9 place-items-center rounded-full text-ink-soft transition hover:bg-rose/10 disabled:opacity-30 focus-ring" aria-label="往后几天">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {visibleCount === 1 && days.length > 1 && (
        <div className="local-x-scroll overflow-x-auto overscroll-x-contain border-b border-line/50 px-3 py-2">
          <div className="flex w-max gap-1.5" role="tablist" aria-label="选择哪一天">
            {days.map((day) => (
              <button key={day.key} type="button" role="tab" aria-selected={day.index === start} onClick={() => { setWindowStart(day.index); setDraft(null); }}
                className={cn(
                  "flex min-h-11 min-w-[3.6rem] flex-col items-center justify-center rounded-2xl px-2.5 font-sc transition focus-ring",
                  day.index === start ? "bg-rose/14 text-rose-deep ring-1 ring-rose/30" : "text-ink-soft hover:bg-peach/14",
                )}>
                <span className="text-[11px] leading-none">{day.key === today ? "今天" : day.weekday}</span>
                <span className="mt-1 text-sm font-semibold leading-none">{day.month}/{day.day}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid border-b border-line/60" style={gridStyle}>
        <span className="border-r border-line/50 py-2 text-center font-sc text-[10px] text-ink-muted">全天</span>
        {visible.map((day) => (
          <AllDayCell
            key={day.key}
            day={day}
            showHeader={visibleCount > 1 || days.length === 1}
            isToday={day.key === today}
            items={scheduled.filter((item) => item.scheduled_on === day.key && item.start_minute == null)}
            highlightId={highlightId}
            onOpen={onOpen}
            onToggle={onToggle}
            onAdd={() => setDraft({ day: day.key, start: null, end: null })}
          />
        ))}
      </div>

      <div ref={scrollRef} className="relative max-h-[min(68dvh,40rem)] overflow-y-auto overscroll-contain">
        <div ref={gridRef} className="relative grid" style={{ ...gridStyle, height: gridHeight }}>
          <div className="relative border-r border-line/50" aria-hidden="true">
            {hours.map((hour) => (
              <span key={hour} className="absolute right-1.5 -translate-y-1/2 font-sc text-[10px] tabular-nums text-ink-muted" style={{ top: (hour - startHour) * HOUR_PX }}>
                {hour === startHour ? "" : `${hour}:00`}
              </span>
            ))}
          </div>
          {visible.map((day) => {
            const active = drag && drag.moved ? drag : null;
            const shown = scheduled
              .filter((item) => item.scheduled_on === day.key && item.start_minute != null && item.id !== active?.id)
              .map((item) => ({ item, start: item.start_minute!, end: item.end_minute ?? Math.min(item.start_minute! + DEFAULT_DURATION, 1440) }));
            const draggedItem = active && active.day === day.key ? items.find((item) => item.id === active.id) : undefined;
            if (draggedItem && active) shown.push({ item: draggedItem, start: active.start, end: active.end });
            const lanes = layoutLanes(shown.map((entry) => ({ id: entry.item.id, start: entry.start, end: entry.end })));
            const nowMinute = day.key === today ? currentShanghaiMinute() : null;
            return (
              <div
                key={day.key}
                data-plan-day={day.key}
                className={cn("relative cursor-cell border-r border-line/40 last:border-r-0", day.key === today && "bg-rose/[0.035]")}
                onClick={(event) => openDraftAt(day.key, event.clientY)}
                role="presentation"
              >
                {hours.map((hour) => (
                  <span key={hour} className="pointer-events-none absolute inset-x-0 border-t border-line/45" style={{ top: (hour - startHour) * HOUR_PX }} aria-hidden="true">
                    <span className="absolute inset-x-0 top-[26px] border-t border-dashed border-line/25" />
                  </span>
                ))}
                {nowMinute != null && nowMinute >= gridStart && (
                  <span className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-rose-deep/70" style={{ top: toY(nowMinute) }} aria-hidden="true">
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-rose-deep" />
                  </span>
                )}
                {shown.map(({ item, start: begin, end }) => {
                  const lane = lanes.get(item.id) ?? { lane: 0, lanes: 1 };
                  const top = toY(begin);
                  const height = Math.max(MIN_BLOCK_PX, toY(end) - top - 2);
                  const done = Boolean(item.completed_at);
                  const tone = PLAN_CATEGORY_TONE[item.category];
                  const isDragging = drag?.id === item.id && drag.moved;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "absolute z-10 overflow-hidden rounded-xl border px-2 py-1 shadow-[0_1px_2px_rgb(var(--ink)/0.06)] transition-shadow",
                        done ? "border-sage/40 bg-sage/18 text-ink-soft" : tone.block,
                        highlightId === item.id && "ring-2 ring-peach/80",
                        isDragging ? "z-30 cursor-grabbing shadow-lg" : "cursor-pointer hover:shadow-md",
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${(lane.lane / lane.lanes) * 100}% + 3px)`,
                        width: `calc(${100 / lane.lanes}% - 6px)`,
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => beginDrag(event, item, "move")}
                    >
                      <button
                        type="button"
                        className="absolute inset-0 rounded-xl focus-ring"
                        aria-label={`${item.title}，${slotLabel(item.start_minute, item.end_minute)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!suppressClickRef.current) onOpen(item.id);
                        }}
                      />
                      <div className="pointer-events-none relative flex items-start gap-1">
                        <span className={cn("mt-px flex-none rounded px-1 font-sc text-[10px] leading-4", done ? "bg-sage/30" : tone.chip)}>{tone.label}</span>
                        <span className={cn("min-w-0 flex-1 font-sc text-xs font-medium leading-4", height < 40 ? "truncate" : "line-clamp-2", done && "line-through decoration-ink-muted/60")}>
                          {item.title}
                        </span>
                        {done && <Check className="h-3.5 w-3.5 flex-none text-ink-soft" strokeWidth={3} />}
                      </div>
                      {height >= 44 && (
                        <p className="pointer-events-none relative mt-0.5 font-sc text-[10px] tabular-nums text-ink-muted">{minuteLabel(begin)}–{minuteLabel(end)}</p>
                      )}
                      <span
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        onPointerDown={(event) => beginDrag(event, item, "resize")}
                        aria-hidden="true"
                      />
                    </div>
                  );
                })}
                <AnimatePresence>
                  {draft && draft.day === day.key && draft.start != null && (
                    <motion.div
                      key="ghost"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
                      className="pointer-events-none absolute inset-x-[3px] z-20 rounded-xl border-2 border-dashed border-rose/55 bg-rose/8"
                      style={{ top: toY(draft.start), height: Math.max(MIN_BLOCK_PX, toY(draft.end ?? draft.start + DEFAULT_DURATION) - toY(draft.start) - 2) }}
                    />
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {draft && (
          <SlotComposer
            key={`${draft.day}-${draft.start}`}
            draft={draft}
            day={days.find((day) => day.key === draft.day)}
            onClose={() => setDraft(null)}
            onChange={setDraft}
            onSubmit={async (title, category) => {
              const ok = await onCreate(title, category, draft);
              if (ok) setDraft(null);
              return ok;
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function currentShanghaiMinute(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function AllDayCell({
  day,
  showHeader,
  isToday,
  items,
  highlightId,
  onOpen,
  onToggle,
  onAdd,
}: {
  day: PlanDay;
  showHeader: boolean;
  isToday: boolean;
  items: TodoItemOut[];
  highlightId: number | null;
  onOpen: (id: number) => void;
  onToggle: (item: TodoItemOut) => void;
  onAdd: () => void;
}) {
  return (
    <div data-plan-day={day.key} className={cn("min-w-0 border-r border-line/40 p-1.5 last:border-r-0", isToday && "bg-rose/[0.035]")}>
      {showHeader && (
        <div className="mb-1 flex items-baseline gap-1.5 px-1">
          <span className={cn("font-sc text-sm font-semibold", isToday ? "text-rose-deep" : "text-ink")}>{day.month}/{day.day}</span>
          <span className="font-sc text-[11px] text-ink-muted">{isToday ? "今天" : day.weekday} · 第 {day.index + 1} 天</span>
        </div>
      )}
      <div className="space-y-1">
        {items.map((item) => {
          const done = Boolean(item.completed_at);
          const tone = PLAN_CATEGORY_TONE[item.category];
          return (
            <div key={item.id} className={cn("flex min-h-8 items-center gap-1 rounded-lg border pl-0.5 pr-1.5", done ? "border-sage/40 bg-sage/18" : tone.block, highlightId === item.id && "ring-2 ring-peach/80")}>
              <button type="button" onClick={() => onToggle(item)} aria-pressed={done} aria-label={done ? `取消完成：${item.title}` : `完成：${item.title}`}
                className="grid h-8 w-7 flex-none place-items-center rounded-md focus-ring">
                <span className={cn("grid h-4 w-4 place-items-center rounded-full border-[1.5px]", done ? "border-sage bg-sage text-white" : "border-rose/50 bg-surface")}>
                  {done && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                </span>
              </button>
              <button type="button" onClick={() => onOpen(item.id)} className={cn("min-w-0 flex-1 truncate text-left font-sc text-xs font-medium focus-ring", done && "text-ink-soft line-through decoration-ink-muted/60")}>
                {item.title}
              </button>
              <span className={cn("flex-none rounded px-1 font-sc text-[10px]", tone.chip)}>{tone.label}</span>
            </div>
          );
        })}
        <button type="button" onClick={onAdd}
          className="flex min-h-8 w-full items-center gap-1 rounded-lg px-1.5 font-sc text-[11px] text-ink-muted transition hover:bg-peach/14 hover:text-rose-deep focus-ring">
          <Plus className="h-3.5 w-3.5" />全天的事
        </button>
      </div>
    </div>
  );
}

function SlotComposer({
  draft,
  day,
  onClose,
  onChange,
  onSubmit,
}: {
  draft: SlotDraft;
  day: PlanDay | undefined;
  onClose: () => void;
  onChange: (draft: SlotDraft) => void;
  onSubmit: (title: string, category: TodoCategory) => Promise<boolean>;
}) {
  const reducedMotion = useReducedMotion();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TodoCategory>(draft.start == null ? "stay" : draft.start >= 17 * 60 || (draft.start >= 11 * 60 && draft.start < 13 * 60 + 30) ? "food" : "play");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text || saving) return;
    setSaving(true);
    const ok = await onSubmit(text, category);
    if (!ok) setSaving(false);
  }

  function shift(field: "start" | "end", delta: number) {
    if (draft.start == null) return;
    const end = draft.end ?? draft.start + DEFAULT_DURATION;
    if (field === "start") {
      const start = Math.max(0, Math.min(end - 15, draft.start + delta));
      onChange({ ...draft, start, end });
    } else {
      onChange({ ...draft, end: Math.max(draft.start + 15, Math.min(1440, end + delta)) });
    }
  }

  return (
    <motion.form
      onSubmit={submit}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
      className="border-t border-line/60 bg-surface p-3 sm:p-4"
      aria-label="加一件事"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-sc text-xs text-ink-soft">
          {day ? `${day.month}月${day.day}日 ${day.weekday}` : draft.day}
          <span className="mx-1.5 text-line" aria-hidden="true">|</span>
          {draft.start == null ? (
            "全天"
          ) : (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <TimeNudge label={minuteLabel(draft.start)} onEarlier={() => shift("start", -15)} onLater={() => shift("start", 15)} name="开始" />
              –
              <TimeNudge label={minuteLabel(draft.end ?? draft.start + DEFAULT_DURATION)} onEarlier={() => shift("end", -15)} onLater={() => shift("end", 15)} name="结束" />
            </span>
          )}
        </p>
        <button type="button" onClick={onClose} className="grid h-8 w-8 flex-none place-items-center rounded-full text-ink-muted hover:bg-ink/5 focus-ring" aria-label="不加了">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus aria-label="要做什么"
          placeholder={category === "food" ? "比如：那家火锅" : category === "stay" ? "比如：西湖边的民宿" : category === "prep" ? "比如：带充电宝" : "比如：看一场电影"}
          className="input-field min-h-11 min-w-0 flex-1 rounded-xl text-sm" />
        <button type="submit" disabled={saving || !title.trim()} className="btn-primary grid h-11 w-11 flex-none place-items-center rounded-xl disabled:opacity-50 focus-ring" aria-label="加进日程">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="分类">
        {(["food", "play", "stay", "prep"] as TodoCategory[]).map((option) => (
          <button key={option} type="button" role="radio" aria-checked={category === option} onClick={() => setCategory(option)}
            className={cn(
              "inline-flex min-h-8 items-center rounded-full px-3 font-sc text-xs transition focus-ring",
              category === option ? "bg-rose/14 text-rose-deep ring-1 ring-rose/30" : "text-ink-soft hover:bg-peach/14",
            )}>
            {PLAN_CATEGORY_TONE[option].label}
          </button>
        ))}
      </div>
    </motion.form>
  );
}

function TimeNudge({ label, name, onEarlier, onLater }: { label: string; name: string; onEarlier: () => void; onLater: () => void }) {
  return (
    <span className="inline-flex items-center rounded-full bg-peach/16">
      <button type="button" onClick={onEarlier} className="grid h-7 w-6 place-items-center rounded-full hover:text-rose-deep focus-ring" aria-label={`${name}提前 15 分钟`}>
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span className="font-medium text-ink">{label}</span>
      <button type="button" onClick={onLater} className="grid h-7 w-6 place-items-center rounded-full hover:text-rose-deep focus-ring" aria-label={`${name}推后 15 分钟`}>
        <ChevronRight className="h-3 w-3" />
      </button>
    </span>
  );
}
