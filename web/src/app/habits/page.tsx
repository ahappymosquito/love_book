"use client";

// Habit page with a pair-visible monthly completion board, personal habit management, date backfilling, and gentle completion celebration.

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { TimelineHeader } from "@/components/timeline-header";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";
import type { HabitDashboardOut, HabitDayOut, HabitTaskOut, UserOut } from "@/lib/types";

const COLOR_OPTIONS = [
  { key: "rose", label: "玫瑰", className: "bg-rose" },
  { key: "peach", label: "暖桃", className: "bg-peach-deep" },
  { key: "sage", label: "鼠尾草", className: "bg-sage" },
  { key: "berry", label: "莓果", className: "bg-[#b85b86]" },
  { key: "honey", label: "蜂蜜", className: "bg-[#d99a54]" },
  { key: "mint", label: "薄荷", className: "bg-[#6aa88f]" },
] as const;

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

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
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function calendarDays(viewDate: Date): Date[] {
  const start = monthStart(viewDate);
  const end = monthEnd(viewDate);
  const days: Date[] = [];
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  const last = new Date(end);
  last.setDate(last.getDate() + (6 - last.getDay()));
  while (cursor <= last) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function colorClass(color: string): string {
  return COLOR_OPTIONS.find((option) => option.key === color)?.className ?? "bg-rose";
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
  const [viewDate, setViewDate] = useState(() => monthStart(new Date()));
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
    setViewDate(monthStart(parsed));
  }, []);

  const range = useMemo(
    () => ({
      start: toISODate(monthStart(viewDate)),
      end: toISODate(monthEnd(viewDate)),
    }),
    [viewDate],
  );

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
  const selectedDay = daysByDate.get(selectedDate);
  const ownTasks = useMemo(
    () => (dashboard?.tasks ?? []).filter((task) => task.owner_id === me.user.id),
    [dashboard?.tasks, me.user.id],
  );
  const counterpartTasks = useMemo(
    () => (dashboard?.tasks ?? []).filter((task) => task.owner_id === me.counterpart.id),
    [dashboard?.tasks, me.counterpart.id],
  );
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
      toast.success("习惯已添加");
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

  const headerAvatar = (
    <Link href="/me" className="grid h-10 w-10 place-items-center rounded-full focus-ring" aria-label="打开设置">
      <Avatar user={me.user} size="sm" />
    </Link>
  );

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader title="习惯" rightSlot={headerAvatar} />

      <main className="mx-auto max-w-5xl px-4 pt-5 sm:px-6 scroll-pad-bottom">
        <section className="glass-card overflow-hidden rounded-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <p className="font-sc text-xs font-semibold text-rose-deep">每日小格子</p>
              <h1 className="mt-1 font-display text-2xl font-bold leading-tight text-ink">{monthLabel(viewDate)}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                className="btn-ghost grid h-10 w-10 place-items-center rounded-2xl focus-ring"
                aria-label="上个月"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const today = new Date();
                  setViewDate(monthStart(today));
                  setSelectedDate(toISODate(today));
                }}
                className="btn-ghost min-h-10 rounded-2xl px-4 font-sc text-sm focus-ring"
              >
                今天
              </button>
              <button
                type="button"
                onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                className="btn-ghost grid h-10 w-10 place-items-center rounded-2xl focus-ring"
                aria-label="下个月"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="p-3 sm:p-5">
            <div className="grid grid-cols-7 gap-1.5 text-center font-sc text-xs font-semibold text-ink-muted sm:gap-2">
              {WEEK_LABELS.map((label) => (
                <span key={label} className="py-1">
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1.5 sm:gap-2">
              {calendarDays(viewDate).map((day) => {
                const key = toISODate(day);
                return (
                  <DayCell
                    key={key}
                    date={day}
                    isoDate={key}
                    currentMonth={day.getMonth() === viewDate.getMonth()}
                    selected={key === selectedDate}
                    day={daysByDate.get(key)}
                    tasks={dashboard?.tasks ?? []}
                    users={[me.user, me.counterpart] as [UserOut, UserOut]}
                    reducedMotion={reducedMotion}
                    onSelect={() => setSelectedDate(key)}
                  />
                );
              })}
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
          <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-surface/80 py-4 font-sc text-sm text-ink-soft hairline">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取习惯记录
          </div>
        )}
      </main>
    </div>
  );
}

function DayCell({
  date,
  isoDate,
  currentMonth,
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
        "relative isolate aspect-square min-h-[46px] overflow-hidden rounded-2xl border p-1 text-left transition focus-ring sm:min-h-[70px]",
        selected ? "border-rose bg-rose/10" : "border-line/70 bg-surface/78 hover:border-rose/50",
        currentMonth ? "opacity-100" : "opacity-45",
      )}
      aria-label={`${isoDate} 习惯记录`}
    >
      <span className="relative z-10 block font-sc text-[11px] font-semibold leading-none text-ink sm:text-xs">
        {date.getDate()}
      </span>
      <div className="mt-1 grid h-[calc(100%-1rem)] grid-rows-2 gap-0.5 overflow-hidden rounded-xl bg-cream/70">
        {users.map((user) => {
          const userDay = day?.users.find((item) => item.user_id === user.id);
          const userTasks = tasks.filter((task) => task.owner_id === user.id);
          const completed = new Set(userDay?.completed_task_ids ?? []);
          return (
            <div
              key={user.id}
              className="grid gap-0.5"
              style={{ gridTemplateColumns: `repeat(${Math.max(userTasks.length, 1)}, minmax(0, 1fr))` }}
            >
              {userTasks.length ? (
                userTasks.map((task) => (
                  <span
                    key={task.id}
                    className={cn("min-w-0 rounded-[4px] transition-colors", completed.has(task.id) ? colorClass(task.color) : "bg-line/35")}
                    aria-hidden="true"
                  />
                ))
              ) : (
                <span className="rounded-[4px] bg-line/20" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
      <AnimatePresence>
        {pairDone && (
          <motion.span
            className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.72),transparent_34%),linear-gradient(135deg,rgba(196,93,119,0.18),rgba(239,180,139,0.18),rgba(116,170,145,0.2))]"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: [0, 1, 0.72], scale: [0.96, 1.04, 1] }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? { duration: 0.01 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
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
  userDay?: { completed_task_ids: number[]; completed_count: number; tasks_total: number; all_completed: boolean };
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
    <section className="glass-card overflow-hidden rounded-3xl">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-white/45 focus-ring sm:px-5"
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
        <span className={cn("grid h-10 w-10 place-items-center rounded-full", userDay?.all_completed ? "bg-sage/18 text-sage" : "bg-rose/10 text-rose-deep")}>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-line/60 p-4 sm:p-5">
          {editable && (
            <form onSubmit={onCreate} className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={newTitle}
                onChange={(event) => onNewTitle(event.target.value)}
                className="input-field text-sm"
                placeholder="添加一个每天想做的小习惯"
                maxLength={120}
              />
              <button
                type="submit"
                disabled={saving || !newTitle.trim()}
                className="btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                新增
              </button>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                {COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => onNewColor(option.key)}
                    className={cn("grid h-9 w-9 place-items-center rounded-full border-2 focus-ring", newColor === option.key ? "border-rose-deep" : "border-transparent")}
                    aria-label={`选择${option.label}`}
                  >
                    <span className={cn("block h-6 w-6 rounded-full", option.className)} />
                  </button>
                ))}
              </div>
            </form>
          )}

          <div className="grid gap-2">
            {tasks.length === 0 ? (
              <p className="rounded-2xl bg-peach/12 px-4 py-3 font-sc text-sm text-ink-muted hairline">
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
      )}
    </section>
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

  useEffect(() => {
    setTitle(task.title);
  }, [task.title]);

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = title.trim();
    if (!next) return;
    onUpdate({ title: next });
    setEditing(false);
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl bg-surface/74 px-3 py-2 hairline">
      <button
        type="button"
        onClick={editable ? onToggle : undefined}
        disabled={!editable}
        className={cn(
          "grid h-10 w-10 flex-none place-items-center rounded-full border transition focus-ring",
          checked ? `${colorClass(task.color)} border-transparent text-white` : "border-line bg-cream text-transparent",
          !editable && "cursor-default",
        )}
        aria-label={checked ? "取消完成" : "标记完成"}
      >
        <Check className="h-4 w-4" />
      </button>

      {editing ? (
        <form onSubmit={submitEdit} className="flex min-w-0 flex-1 gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="input-field min-h-10 min-w-0 flex-1 py-2 text-sm"
            maxLength={120}
            autoFocus
          />
          <button type="submit" className="btn-primary grid h-10 w-10 flex-none place-items-center rounded-2xl focus-ring" aria-label="保存习惯">
            <Check className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={editable ? onToggle : undefined}
          disabled={!editable}
          className={cn("min-w-0 flex-1 rounded-xl px-1 py-2 text-left focus-ring", editable && "hover:bg-peach/12")}
        >
          <span className={cn("block truncate font-sc text-sm text-ink", checked && "line-through decoration-rose-deep/70 decoration-2")}>
            {task.title}
          </span>
        </button>
      )}

      {editable && !editing && (
        <>
          <div className="hidden gap-1 sm:flex">
            {COLOR_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onUpdate({ color: option.key })}
                className={cn("grid h-8 w-8 place-items-center rounded-full border focus-ring", task.color === option.key ? "border-rose-deep" : "border-transparent")}
                aria-label={`改为${option.label}`}
              >
                <span className={cn("block h-4 w-4 rounded-full", option.className)} />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setEditing(true)} className="btn-ghost grid h-10 w-10 flex-none place-items-center rounded-2xl focus-ring" aria-label="编辑习惯">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDelete} className="btn-ghost grid h-10 w-10 flex-none place-items-center rounded-2xl text-rose-deep focus-ring" aria-label="停用习惯">
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
