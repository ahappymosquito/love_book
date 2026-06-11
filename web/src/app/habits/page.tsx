"use client";

// Habit page renders the authenticated pair habit dashboard with liquid-glass week/month boards,
// vertical collapsible check-in panels, popover habit color selection, green completion rows, and reduced-motion-safe feedback.

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { TimelineHeader } from "@/components/timeline-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";
import type { HabitDashboardOut, HabitDayOut, HabitTaskOut, HabitUserDayOut, UserOut } from "@/lib/types";

const COLOR_OPTIONS = [
  { key: "rose", label: "玫瑰", className: "bg-rose" },
  { key: "peach", label: "暖桃", className: "bg-peach-deep" },
  { key: "sage", label: "鼠尾草", className: "bg-sage" },
  { key: "#ff6f91", label: "亮莓", className: "" },
  { key: "#ff9f45", label: "橘光", className: "" },
  { key: "#f5c84b", label: "柠檬", className: "" },
  { key: "#4da3ff", label: "晴蓝", className: "" },
  { key: "#a978ff", label: "紫藤", className: "" },
] as const;
const COLOR_HEX_BY_KEY: Record<string, string> = {
  rose: "#c45d77",
  peach: "#cc7856",
  sage: "#74aa91",
};

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
type CalendarMode = "week" | "month";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseISODate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function monthLabel(date: Date): string {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function weekStart(date: Date): Date {
  const start = new Date(date);
  const startOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - startOffset);
  return start;
}

function weekEnd(date: Date): Date {
  const end = weekStart(date);
  end.setDate(end.getDate() + 6);
  return end;
}

function calendarRange(viewDate: Date, mode: CalendarMode): { start: Date; end: Date } {
  if (mode === "week") {
    return { start: weekStart(viewDate), end: weekEnd(viewDate) };
  }
  const start = monthStart(viewDate);
  const rangeStart = weekStart(start);
  const end = monthEnd(viewDate);
  const rangeEnd = weekEnd(end);
  return { start: rangeStart, end: rangeEnd };
}

function calendarLabel(viewDate: Date, mode: CalendarMode): string {
  if (mode === "month") return monthLabel(viewDate);
  const start = weekStart(viewDate);
  const end = weekEnd(viewDate);
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月 ${start.getDate()}-${end.getDate()} 日`;
  return `${start.getFullYear()} 年 ${start.getMonth() + 1} 月 ${start.getDate()} 日 - ${end.getFullYear()} 年 ${end.getMonth() + 1} 月 ${end.getDate()} 日`;
}

function daysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function colorClass(color: string): string {
  if (isHexColor(color)) return "";
  return COLOR_OPTIONS.find((option) => option.key === color)?.className ?? "bg-rose";
}

function isHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

function colorStyle(color: string): CSSProperties | undefined {
  return isHexColor(color) ? { backgroundColor: color } : undefined;
}

function nativeColorValue(color: string): string {
  return isHexColor(color) ? color : (COLOR_HEX_BY_KEY[color] ?? COLOR_HEX_BY_KEY.rose);
}

export default function HabitsPage() {
  return (
    <AuthGate>
      <HabitsInner />
    </AuthGate>
  );
}

function HabitsInner() {
  const me = useAppStore((s) => s.me)!;
  const [viewDate, setViewDate] = useState(() => new Date());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("week");
  const [selectedDate, setSelectedDate] = useState(() => toISODate(new Date()));
  const [dashboard, setDashboard] = useState<HabitDashboardOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newColor, setNewColor] = useState("rose");
  const [ownOpen, setOwnOpen] = useState(true);
  const [otherOpen, setOtherOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const queryDate = new URLSearchParams(window.location.search).get("date");
    if (!queryDate || !/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) return;
    const parsed = parseISODate(queryDate);
    setSelectedDate(queryDate);
    setViewDate(parsed);
  }, []);

  const range = useMemo(() => {
    const { start, end } = calendarRange(viewDate, calendarMode);
    return { start: toISODate(start), end: toISODate(end) };
  }, [calendarMode, viewDate]);

  const calendarDays = useMemo(() => {
    const { start, end } = calendarRange(viewDate, calendarMode);
    return daysBetween(start, end);
  }, [calendarMode, viewDate]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      setDashboard(await api.getHabitDashboard(range));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const daysByDate = useMemo(() => {
    const map = new Map<string, HabitDayOut>();
    dashboard?.days.forEach((day) => map.set(day.date, day));
    return map;
  }, [dashboard]);

  const ownTasks = useMemo(
    () => (dashboard?.tasks ?? []).filter((task) => task.owner_id === me.user.id),
    [dashboard?.tasks, me.user.id],
  );
  const counterpartTasks = useMemo(
    () => (dashboard?.tasks ?? []).filter((task) => task.owner_id === me.counterpart.id),
    [dashboard?.tasks, me.counterpart.id],
  );

  const selectedDay = daysByDate.get(selectedDate);
  const selectedOwn = selectedDay?.users.find((item) => item.user_id === me.user.id);
  const selectedOther = selectedDay?.users.find((item) => item.user_id === me.counterpart.id);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      await api.createHabitTask({ title, color: newColor });
      setNewTitle("");
      toast.success("习惯已新增");
      await loadDashboard();
    } finally {
      setSaving(false);
    }
  }

  async function updateTask(task: HabitTaskOut, payload: { title?: string; color?: string }) {
    await api.updateHabitTask(task.id, payload);
    await loadDashboard();
  }

  async function deleteTask(task: HabitTaskOut) {
    await api.deleteHabitTask(task.id);
    toast.success("习惯已停用");
    await loadDashboard();
  }

  async function toggleTask(task: HabitTaskOut) {
    const result = await api.toggleHabitTask(task.id, { target_date: selectedDate, ...range });
    setDashboard(result.dashboard);
  }

  function selectDate(date: Date, isoDate: string) {
    setSelectedDate(isoDate);
    if (calendarMode === "week") {
      setViewDate(date);
    } else if (date.getMonth() !== viewDate.getMonth() || date.getFullYear() !== viewDate.getFullYear()) {
      setViewDate(monthStart(date));
    }
  }

  const headerAvatar = (
    <Link href="/me" className="grid h-10 w-10 place-items-center rounded-full focus-ring" aria-label="打开设置">
      <Avatar user={me.user} size="sm" />
    </Link>
  );

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader title="习惯" rightSlot={headerAvatar} />

      <main className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 scroll-pad-bottom">
        <section className="min-w-0 space-y-5">
          <Card className="liquid-habit-panel overflow-hidden">
            <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>习惯打卡</CardTitle>
                <CardDescription>默认按周查看，点日期补记，点自己的事项完成或取消。</CardDescription>
              </div>
              <CalendarToolbar
                viewDate={viewDate}
                mode={calendarMode}
                onMode={setCalendarMode}
                onPrev={() =>
                  setViewDate((current) => {
                    const next = new Date(current);
                    next.setDate(next.getDate() + (calendarMode === "week" ? -7 : 0));
                    if (calendarMode === "month") return new Date(current.getFullYear(), current.getMonth() - 1, 1);
                    return next;
                  })
                }
                onNext={() =>
                  setViewDate((current) => {
                    const next = new Date(current);
                    next.setDate(next.getDate() + (calendarMode === "week" ? 7 : 0));
                    if (calendarMode === "month") return new Date(current.getFullYear(), current.getMonth() + 1, 1);
                    return next;
                  })
                }
                onToday={() => {
                  const today = new Date();
                  setViewDate(today);
                  setSelectedDate(toISODate(today));
                }}
              />
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid grid-cols-7 gap-y-1 text-center font-sc text-xs text-ink-muted">
                {WEEK_LABELS.map((label) => (
                  <div key={label} className="py-2">
                    {label}
                  </div>
                ))}
              </div>
              <div className="liquid-calendar-grid grid grid-cols-7 gap-y-1 overflow-hidden p-1">
                {calendarDays.map((day) => {
                  const key = toISODate(day);
                  return (
                    <DayCell
                      key={key}
                      date={day}
                      isoDate={key}
                      currentMonth={calendarMode === "week" || day.getMonth() === viewDate.getMonth()}
                      today={key === toISODate(new Date())}
                      selected={key === selectedDate}
                      day={daysByDate.get(key)}
                      tasks={dashboard?.tasks ?? []}
                      users={[me.user, me.counterpart] as [UserOut, UserOut]}
                      reducedMotion={reducedMotion}
                      onSelect={() => selectDate(day, key)}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <SelectedDateSummary
            selectedDate={selectedDate}
            ownUser={me.user}
            otherUser={me.counterpart}
            ownDay={selectedOwn}
            otherDay={selectedOther}
            pairDone={Boolean(selectedDay?.pair_all_completed)}
          />

          <section className="space-y-3">
            <HabitPanel
              title="我的打卡"
              user={me.user}
              tasks={ownTasks}
              userDay={selectedOwn}
              selectedDate={selectedDate}
              open={ownOpen}
              editable
              saving={saving}
              newTitle={newTitle}
              newColor={newColor}
              onToggleOpen={() => setOwnOpen((value) => !value)}
              onNewTitle={setNewTitle}
              onNewColor={setNewColor}
              onCreate={createTask}
              onToggleTask={(task) => void toggleTask(task)}
              onUpdateTask={(task, payload) => void updateTask(task, payload)}
              onDeleteTask={(task) => void deleteTask(task)}
            />
            <HabitPanel
              title="对方打卡"
              user={me.counterpart}
              tasks={counterpartTasks}
              userDay={selectedOther}
              selectedDate={selectedDate}
              open={otherOpen}
              editable={false}
              saving={false}
              newTitle=""
              newColor="rose"
              onToggleOpen={() => setOtherOpen((value) => !value)}
              onNewTitle={() => undefined}
              onNewColor={() => undefined}
              onCreate={(event) => event.preventDefault()}
              onToggleTask={() => undefined}
              onUpdateTask={() => undefined}
              onDeleteTask={() => undefined}
            />
          </section>

          {loading && (
            <div className="flex items-center justify-center gap-2 rounded-2xl bg-surface/80 py-4 font-sc text-sm text-ink-soft hairline">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取习惯记录
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function CalendarToolbar({
  viewDate,
  mode,
  onMode,
  onPrev,
  onNext,
  onToday,
}: {
  viewDate: Date;
  mode: CalendarMode;
  onMode: (mode: CalendarMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:items-end">
      <div className="liquid-chip grid grid-cols-2 rounded-full p-1">
        {(["week", "month"] as CalendarMode[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onMode(item)}
            className={cn(
              "min-h-9 rounded-full px-4 font-sc text-xs font-medium text-ink-soft transition focus-ring",
              mode === item && "bg-surface-raised text-ink shadow-[0_8px_18px_-14px_rgb(var(--rose-deep)/0.6)]",
            )}
          >
            {item === "week" ? "周" : "月"}
          </button>
        ))}
      </div>
      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
        <Button variant="outline" size="icon" onClick={onPrev} aria-label={mode === "week" ? "上一周" : "上个月"}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-32 flex-1 text-center font-sc text-sm font-medium text-ink sm:min-w-44 sm:flex-none">
          {calendarLabel(viewDate, mode)}
        </div>
        <Button variant="outline" size="icon" onClick={onNext} aria-label={mode === "week" ? "下一周" : "下个月"}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" onClick={onToday}>
          今天
        </Button>
      </div>
    </div>
  );
}

function SelectedDateSummary({
  selectedDate,
  ownUser,
  otherUser,
  ownDay,
  otherDay,
  pairDone,
}: {
  selectedDate: string;
  ownUser: UserOut;
  otherUser: UserOut;
  ownDay?: HabitUserDayOut;
  otherDay?: HabitUserDayOut;
  pairDone: boolean;
}) {
  return (
    <Card className="liquid-habit-panel p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-sc text-xs text-ink-muted">当前日期</p>
          <p className="mt-1 font-display text-xl font-semibold leading-tight text-ink">{selectedDate}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ProgressChip user={ownUser} day={ownDay} label="我" />
          <ProgressChip user={otherUser} day={otherDay} label="对方" />
          {pairDone && (
            <span className="inline-flex min-h-10 items-center rounded-full bg-sage/16 px-3 font-sc text-xs font-medium text-sage">
              双方完成
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function ProgressChip({ user, day, label }: { user: UserOut; day?: HabitUserDayOut; label: string }) {
  return (
    <span className="liquid-chip inline-flex min-h-10 items-center gap-2 rounded-full px-3 font-sc text-xs text-ink-soft">
      <Avatar user={user} size="sm" />
      <span className="font-medium text-ink">{label}</span>
      <span>
        {day?.completed_count ?? 0}/{day?.tasks_total ?? 0}
      </span>
    </span>
  );
}

function DayCell({
  date,
  isoDate,
  currentMonth,
  today,
  selected,
  day,
  tasks,
  users,
  reducedMotion,
  onSelect,
}: {
  date: Date;
  isoDate: string;
  currentMonth: boolean;
  today: boolean;
  selected: boolean;
  day?: HabitDayOut;
  tasks: HabitTaskOut[];
  users: [UserOut, UserOut];
  reducedMotion: boolean | null;
  onSelect: () => void;
}) {
  const pairDone = Boolean(day?.pair_all_completed);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "liquid-day-cell group relative min-h-[74px] rounded-2xl p-1 text-left transition focus-ring sm:min-h-[96px]",
        selected && "liquid-day-cell-selected",
        !selected && "hover:-translate-y-0.5",
        !currentMonth && "opacity-45",
      )}
      aria-label={`${isoDate} 习惯记录`}
    >
      <span className="relative z-10 flex h-full min-h-[66px] flex-col justify-between rounded-2xl p-2 sm:min-h-[88px]">
        <span className="flex items-center justify-between gap-1">
          <span className={cn("font-sc text-sm font-semibold text-ink", today && "text-rose-deep")}>{date.getDate()}</span>
          {today && <span className="rounded-full bg-rose px-1.5 py-0.5 text-[10px] font-medium text-white">今</span>}
        </span>

        <span className="grid h-8 grid-rows-2 gap-1 overflow-hidden rounded-xl border border-white/55 bg-cream/54 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)] sm:h-11">
          {users.map((user) => {
            const userDay = day?.users.find((item) => item.user_id === user.id);
            const userTasks = tasks.filter((task) => task.owner_id === user.id);
            const completed = new Set(userDay?.completed_task_ids ?? []);
            return (
              <span
                key={user.id}
                className="grid gap-0.5"
                style={{ gridTemplateColumns: `repeat(${Math.max(userTasks.length, 1)}, minmax(0, 1fr))` }}
              >
                {userTasks.length ? (
                  userTasks.map((task) => (
                    <span
                      key={task.id}
                      className={cn("min-w-0 rounded-[4px] transition-colors", completed.has(task.id) ? colorClass(task.color) : "bg-line/35")}
                      style={completed.has(task.id) ? colorStyle(task.color) : undefined}
                      aria-hidden="true"
                    />
                  ))
                ) : (
                  <span className="rounded-[4px] bg-line/20" aria-hidden="true" />
                )}
              </span>
            );
          })}
        </span>
      </span>

      <AnimatePresence>
        {pairDone && (
          <motion.span
            className="pointer-events-none absolute inset-1 rounded-2xl bg-sage/10 ring-2 ring-sage/35"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: [0, 1, 0.7], scale: [0.98, 1.02, 1] }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? { duration: 0.01 } : { duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
    </button>
  );
}

function HabitPanel({
  title,
  user,
  tasks,
  userDay,
  selectedDate,
  open,
  editable,
  saving,
  newTitle,
  newColor,
  onToggleOpen,
  onNewTitle,
  onNewColor,
  onCreate,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
}: {
  title: string;
  user: UserOut;
  tasks: HabitTaskOut[];
  userDay?: HabitUserDayOut;
  selectedDate: string;
  open: boolean;
  editable: boolean;
  saving: boolean;
  newTitle: string;
  newColor: string;
  onToggleOpen: () => void;
  onNewTitle: (value: string) => void;
  onNewColor: (value: string) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onToggleTask: (task: HabitTaskOut) => void;
  onUpdateTask: (task: HabitTaskOut, payload: { title?: string; color?: string }) => void;
  onDeleteTask: (task: HabitTaskOut) => void;
}) {
  const completed = new Set(userDay?.completed_task_ids ?? []);
  return (
    <Card className="liquid-habit-panel overflow-visible">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-white/35 focus-ring sm:px-5"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Avatar user={user} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-display text-lg font-semibold text-ink">{title}</span>
            <span className="block font-sc text-xs text-ink-muted">
              {selectedDate} · {userDay?.completed_count ?? 0}/{userDay?.tasks_total ?? tasks.length}
            </span>
          </span>
        </span>
        <span
          className={cn(
            "liquid-chip grid h-10 w-10 flex-none place-items-center rounded-full",
            userDay?.all_completed ? "text-sage" : "text-ink-soft",
          )}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="border-t border-line/60"
          >
            <div className="space-y-4 p-4 sm:p-5">
              {editable && (
                <form onSubmit={onCreate} className="liquid-subpanel p-3">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <ColorPicker value={newColor} onChange={onNewColor} />
                    <input
                      value={newTitle}
                      onChange={(event) => onNewTitle(event.target.value)}
                      className="input-field min-h-11 text-sm"
                      placeholder="新增一个每天想做的习惯"
                      maxLength={120}
                    />
                    <Button type="submit" disabled={saving || !newTitle.trim()} className="col-span-2 rounded-2xl sm:col-span-1">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      新增习惯
                    </Button>
                  </div>
                </form>
              )}

              <div className="grid gap-2">
                {tasks.length === 0 ? (
                  <p className="liquid-subpanel px-4 py-3 font-sc text-sm text-ink-muted">
                    {editable ? "还没有习惯，先添加一个小目标。" : "对方还没有添加习惯。"}
                  </p>
                ) : (
                  tasks.map((task) => (
                    <HabitTaskRow
                      key={task.id}
                      task={task}
                      checked={completed.has(task.id)}
                      editable={editable}
                      onToggle={() => onToggleTask(task)}
                      onUpdate={(payload) => onUpdateTask(task, payload)}
                      onDelete={() => onDeleteTask(task)}
                    />
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function ColorPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="liquid-color-button grid h-11 w-11 place-items-center rounded-2xl focus-ring"
        aria-label="选择习惯颜色"
        aria-expanded={open}
      >
        <span className={cn("block h-6 w-6 rounded-full", colorClass(value))} style={colorStyle(value)} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="liquid-color-popover absolute left-0 top-12 z-20 w-[244px] p-3"
          >
            <div className="grid grid-cols-4 gap-2">
              {COLOR_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    onChange(option.key);
                    setOpen(false);
                  }}
                  className={cn("grid h-10 place-items-center rounded-2xl border transition focus-ring", value === option.key ? "border-rose-deep bg-white/48" : "border-white/40 bg-white/18")}
                  aria-label={`选择${option.label}`}
                  title={option.label}
                >
                  <span className={cn("block h-6 w-6 rounded-full", colorClass(option.key))} style={colorStyle(option.key)} />
                </button>
              ))}
            </div>
            <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/45 bg-white/22 px-3 py-2">
              <span className="font-sc text-xs text-ink-muted">自定义</span>
              <input
                type="color"
                value={nativeColorValue(value)}
                onChange={(event) => onChange(event.target.value)}
                className="h-8 w-10 cursor-pointer rounded-xl border-0 bg-transparent p-0"
                aria-label="自定义习惯颜色"
              />
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InlineColorPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {COLOR_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={cn("grid h-9 w-9 place-items-center rounded-full border-2 focus-ring", value === option.key ? "border-rose-deep" : "border-transparent")}
          aria-label={`选择${option.label}`}
          title={option.label}
        >
          <span className={cn("block h-6 w-6 rounded-full", colorClass(option.key))} style={colorStyle(option.key)} />
        </button>
      ))}
      <label className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border-2 border-transparent focus-within:border-rose-deep">
        <input
          type="color"
          value={nativeColorValue(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
          aria-label="自定义习惯颜色"
        />
      </label>
    </div>
  );
}

function HabitTaskRow({
  task,
  checked,
  editable,
  onToggle,
  onUpdate,
  onDelete,
}: {
  task: HabitTaskOut;
  checked: boolean;
  editable: boolean;
  onToggle: () => void;
  onUpdate: (payload: { title?: string; color?: string }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [color, setColor] = useState(task.color);

  useEffect(() => {
    setTitle(task.title);
    setColor(task.color);
  }, [task.color, task.title]);

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = title.trim();
    if (!next) return;
    onUpdate({ title: next, color });
    setEditing(false);
  }

  function cancelEdit() {
    setTitle(task.title);
    setColor(task.color);
    setEditing(false);
  }

  return (
    <motion.div
      layout
      className={cn("liquid-habit-row relative flex min-w-0 items-center gap-3 overflow-hidden px-3 py-2.5", checked && "liquid-habit-row-done")}
      animate={checked ? { scale: [1, 1.008, 1] } : { scale: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      <span
        className={cn("h-8 w-1.5 flex-none rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]", checked ? "bg-sage" : colorClass(task.color))}
        style={checked ? undefined : colorStyle(task.color)}
      />
      {editing ? (
        <form onSubmit={submitEdit} className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="input-field min-h-10 min-w-0 py-2 text-sm"
              maxLength={120}
              autoFocus
            />
            <InlineColorPicker value={color} onChange={setColor} className="mt-2" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
              取消
            </Button>
            <Button type="submit" size="sm">
              保存
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={editable ? onToggle : undefined}
          disabled={!editable}
          className={cn("min-w-0 flex-1 rounded-xl px-1 py-2 text-left focus-ring", editable && "cursor-pointer", !editable && "cursor-default")}
          aria-label={checked ? "取消完成" : "标记完成"}
        >
          <span className="block truncate font-sc text-sm font-medium text-ink">{task.title}</span>
          <span className={cn("mt-0.5 block font-sc text-xs", checked ? "text-sage" : "text-ink-muted")}>
            {checked ? "已完成" : editable ? "点一下完成" : "未完成"}
          </span>
        </button>
      )}

      {editable && !editing && (
        <>
          <Button type="button" variant="ghost" size="icon" onClick={() => setEditing(true)} aria-label="编辑习惯">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onDelete} className="text-rose-deep" aria-label="停用习惯">
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      )}
      <AnimatePresence>
        {checked && (
          <motion.span
            className="pointer-events-none grid h-9 w-9 flex-none place-items-center rounded-full bg-sage text-white shadow-[0_10px_22px_-14px_rgb(var(--sage)/0.82),inset_0_1px_0_rgba(255,255,255,0.5)]"
            initial={{ opacity: 0, scale: 0.72, rotate: -18 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.72, rotate: 12 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            aria-hidden="true"
          >
            <Check className="h-4 w-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
