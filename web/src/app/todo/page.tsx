"use client";

// Four-section pair-shared todo workspace with local pending candidate queues, category override confirmation, rich AMap POI evidence, instant single-date scheduling, two-comment completion, bottom-nav-covering details, comments with authors, and folded photos.

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  ImagePlus,
  ListTodo,
  Loader2,
  MapPin,
  Menu,
  Music2,
  Plus,
  BedDouble,
  Search,
  Shuffle,
  Star,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { TodoLotteryScene } from "@/components/todo-lottery-scene";
import { APIError, api, fetchTodoImageBlob } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type {
  TodoCategory,
  TodoCandidateOut,
  TodoDashboardOut,
  TodoImageOut,
  TodoItemDetail,
  TodoItemOut,
  TodoRestaurantCandidate,
  TodoScheduleOut,
} from "@/lib/types";

type TodoView = "all" | "important" | "planned" | "food" | "play" | "stay" | "lottery";
type LocalTodoCandidate = Omit<TodoCandidateOut, "id"> & {
  client_id: string;
  is_local: true;
};
type CandidateQueueItem = TodoCandidateOut | LocalTodoCandidate;

const VIEW_META: Record<TodoView, { title: string; subtitle: string; icon: ReactNode }> = {
  all: { title: "任务", subtitle: "所有还没完成的小安排", icon: <ListTodo className="h-4 w-4" /> },
  important: { title: "重要", subtitle: "已有时间或需要留意的事项", icon: <Star className="h-4 w-4" /> },
  planned: { title: "计划内", subtitle: "已经设置要完成时间的事项", icon: <CalendarDays className="h-4 w-4" /> },
  food: { title: "吃饭", subtitle: "想尝试的餐厅和打卡记录", icon: <Utensils className="h-4 w-4" /> },
  play: { title: "玩乐", subtitle: "一起去做的快乐清单", icon: <Music2 className="h-4 w-4" /> },
  stay: { title: "住宿", subtitle: "酒店、民宿和过夜安排", icon: <BedDouble className="h-4 w-4" /> },
  lottery: { title: "随机抽奖", subtitle: "不知道吃什么时交给运气", icon: <Shuffle className="h-4 w-4" /> },
};

const TODO_CATEGORY_LABELS: Record<TodoCategory, string> = {
  food: "吃喝",
  play: "玩乐",
  stay: "住宿",
  wish: "许愿",
};

const TODO_SECTIONS: Array<{ category: TodoCategory; title: string; subtitle: string; icon: ReactNode }> = [
  { category: "food", title: "今天想吃点", subtitle: "餐厅、甜品、咖啡和想打卡的味道", icon: <Utensils className="h-4 w-4" /> },
  { category: "play", title: "出去玩一玩", subtitle: "电影、台球、展览和临时起意的活动", icon: <Music2 className="h-4 w-4" /> },
  { category: "stay", title: "住一晚也好", subtitle: "酒店、民宿和过夜小计划", icon: <BedDouble className="h-4 w-4" /> },
  { category: "wish", title: "悄悄许个愿", subtitle: "还没定下来的愿望和小期待", icon: <Star className="h-4 w-4" /> },
];
const TODO_CATEGORY_OPTIONS: TodoCategory[] = ["food", "play", "stay", "wish"];

function toDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthKey(date: Date): string {
  return toDateOnly(date).slice(0, 7);
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function schedulesForItem(item: TodoItemOut, schedules: TodoScheduleOut[]): TodoScheduleOut[] {
  return schedules.filter((schedule) => schedule.item_id === item.id);
}

function getPrimarySchedule(item: TodoItemOut, schedules: TodoScheduleOut[]): TodoScheduleOut | null {
  const ownSchedules = item.schedules.length ? item.schedules : schedulesForItem(item, schedules);
  return [...ownSchedules].sort((left, right) => left.scheduled_on.localeCompare(right.scheduled_on))[0] ?? null;
}

function scheduleMeta(date: string, checkedIn: boolean): { label: string; className: string } {
  const today = toDateOnly(new Date());
  const todayTime = new Date(`${today}T00:00:00`).getTime();
  const targetTime = new Date(`${date}T00:00:00`).getTime();
  const days = Math.round((targetTime - todayTime) / 86_400_000);
  if (checkedIn) {
    return { label: formatShortDate(date), className: "border-sage/28 bg-sage/16 text-ink-soft" };
  }
  if (days < 0) {
    return { label: `${formatShortDate(date)} 已过`, className: "border-red-200 bg-red-50 text-red-700" };
  }
  if (days === 0) {
    return { label: "今天", className: "border-rose/30 bg-rose/12 text-rose-deep" };
  }
  if (days <= 3) {
    return { label: `${days} 天后`, className: "border-peach-deep/30 bg-peach/24 text-rose-deep" };
  }
  return { label: formatShortDate(date), className: "border-peach/35 bg-peach/14 text-ink-soft" };
}

function isPersistedCandidate(candidate: CandidateQueueItem): candidate is TodoCandidateOut {
  return !("is_local" in candidate);
}

function candidateKey(candidate: CandidateQueueItem): string {
  return isPersistedCandidate(candidate) ? `server-${candidate.id}` : candidate.client_id;
}

function apiErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    return error.status === 0 ? "网络连接失败，请检查后端服务或高德详情调用后重试" : error.message;
  }
  return error instanceof Error ? error.message : "请求失败，请重试";
}
export default function TodoPage() {
  return (
    <AuthGate>
      <TodoInner />
    </AuthGate>
  );
}

function TodoInner() {
  const today = toDateOnly(new Date());
  const [month, setMonth] = useState(monthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [dashboard, setDashboard] = useState<TodoDashboardOut | null>(null);
  const [candidates, setCandidates] = useState<TodoCandidateOut[]>([]);
  const [localCandidates, setLocalCandidates] = useState<LocalTodoCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<TodoCategory, boolean>>({
    food: false,
    play: false,
    stay: false,
    wish: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("date");
    if (date) {
      setSelectedDate(date);
      setMonth(date.slice(0, 7));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextDashboard, nextCandidates] = await Promise.all([api.getTodoDashboard(month), api.listTodoCandidates()]);
      setDashboard(nextDashboard);
      setCandidates(nextCandidates);
    } catch {
      setDashboard({ month, items: [], schedules: [] });
      setCandidates([]);
      toast.error("Todo 看板加载失败");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const items = useMemo(() => dashboard?.items ?? [], [dashboard]);
  const schedules = useMemo(() => {
    const byId = new Map<number, TodoScheduleOut>();
    for (const item of items) {
      for (const schedule of item.schedules) byId.set(schedule.id, schedule);
    }
    for (const schedule of dashboard?.schedules ?? []) byId.set(schedule.id, schedule);
    return Array.from(byId.values());
  }, [dashboard, items]);
  const selectedDetail = detailId ? items.find((item) => item.id === detailId) ?? null : null;
  const queuedCandidates = useMemo<CandidateQueueItem[]>(() => [...localCandidates, ...candidates], [localCandidates, candidates]);

  async function scheduleItem(itemId: number, date = selectedDate) {
    await api.scheduleTodoItem(itemId, date);
    toast.success(`已设为 ${formatShortDate(date)} 完成`);
    await load();
  }

  async function removeSchedule(scheduleId: number) {
    await api.deleteTodoSchedule(scheduleId);
    toast.success("已取消这个时间");
    await load();
  }

  async function archiveItem(itemId: number) {
    await api.updateTodoItem(itemId, { is_archived: true });
    toast.success("已收起这个项目");
    if (detailId === itemId) setDetailId(null);
    await load();
  }

  async function addCandidate(title: string) {
    const now = new Date().toISOString();
    const clientId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const localCandidate: LocalTodoCandidate = {
      client_id: clientId,
      is_local: true,
      raw_title: title,
      category: "play",
      status: "parsing",
      amap_candidates: [],
      selected_candidate: null,
      parse_error: null,
      created_at: now,
      updated_at: now,
    };
    setLocalCandidates((current) => [localCandidate, ...current]);
    try {
      const created = await api.createTodoCandidate({ raw_title: title });
      setLocalCandidates((current) => current.filter((candidate) => candidate.client_id !== clientId));
      setCandidates((current) => [created, ...current.filter((candidate) => candidate.id !== created.id)]);
      toast.success("已放入待确认队列");
      void load();
    } catch (error) {
      const message = apiErrorMessage(error);
      setLocalCandidates((current) =>
        current.map((candidate) =>
          candidate.client_id === clientId
            ? { ...candidate, status: "failed", parse_error: message, updated_at: new Date().toISOString() }
            : candidate,
        ),
      );
    }
  }

  async function confirmCandidate(candidate: TodoCandidateOut, selectedCandidate = candidate.selected_candidate, category = candidate.category) {
    try {
      const item = await api.confirmTodoCandidate(candidate.id, {
        category,
        selected_candidate: selectedCandidate,
      });
      toast.success("已加入清单");
      await load();
      setDetailId(item.id);
    } catch (error) {
      toast.error(`加入失败：${apiErrorMessage(error)}`);
      throw error;
    }
  }

  async function discardCandidate(candidate: CandidateQueueItem) {
    if (!isPersistedCandidate(candidate)) {
      setLocalCandidates((current) => current.filter((item) => item.client_id !== candidate.client_id));
      return;
    }
    try {
      await api.deleteTodoCandidate(candidate.id);
      setCandidates((current) => current.filter((item) => item.id !== candidate.id));
      toast.success("已移出待确认");
      void load();
    } catch (error) {
      toast.error(`丢弃失败：${apiErrorMessage(error)}`);
      throw error;
    }
  }
  function toggleSection(category: TodoCategory) {
    setExpandedSections((current) => ({ ...current, [category]: !current[category] }));
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--cream)/0.68)] pb-[calc(env(safe-area-inset-bottom,0px)+9rem)] text-ink">
      <div className="mx-auto flex min-h-dvh max-w-6xl gap-0 px-3 py-3 sm:px-5 lg:px-6">
        <main className="min-w-0 flex flex-1 flex-col overflow-hidden rounded-[1.4rem] bg-surface/82 shadow-[0_12px_34px_-28px_rgb(var(--rose)/0.42)] hairline">
          <TodoBoardHeader
            loading={loading}
            openCount={items.filter((item) => !item.checked_in).length}
            candidateCount={queuedCandidates.length}
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:px-5 sm:pb-5">
            <div className="space-y-3 pt-3">
              <QuickAddBar onCreated={addCandidate} />
              {TODO_SECTIONS.map((section) => (
                <TodoCategorySection
                  key={section.category}
                  section={section}
                  expanded={expandedSections[section.category]}
                  items={items.filter((item) => item.category === section.category && !item.checked_in)}
                  completedItems={items.filter((item) => item.category === section.category && item.checked_in)}
                  schedules={schedules}
                  onToggle={() => toggleSection(section.category)}
                  onOpen={setDetailId}
                />
              ))}
              <CandidateQueue
                candidates={queuedCandidates}
                onConfirm={confirmCandidate}
                onDiscard={discardCandidate}
              />
            </div>
          </div>
        </main>

        <AnimatePresence>
          {detailId && (
            <TodoDetailPanel
              key={detailId}
              itemId={detailId}
              item={selectedDetail}
              schedules={selectedDetail ? schedulesForItem(selectedDetail, schedules) : []}
              initialScheduleDate={selectedDate}
              onClose={() => setDetailId(null)}
              onChanged={load}
              onSchedule={scheduleItem}
              onRemoveSchedule={removeSchedule}
              onArchive={archiveItem}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function filterItems(
  items: TodoItemOut[],
  schedules: TodoScheduleOut[],
  view: TodoView,
  query: string,
  completed: boolean,
): TodoItemOut[] {
  const normalized = query.trim().toLowerCase();
  const scheduledIds = new Set(schedules.map((schedule) => schedule.item_id));

  return items
    .filter((item) => {
      if (item.checked_in !== completed) return false;
      if (view === "all") return true;
      if (view === "important") return item.restaurant?.parse_status === "failed" || scheduledIds.has(item.id);
      if (view === "planned") return scheduledIds.has(item.id);
      if (view === "food") return item.category === "food";
      if (view === "play") return item.category === "play";
      if (view === "stay") return item.category === "stay";
      return true;
    })
    .filter((item) => {
      if (!normalized) return true;
      return [item.title, item.note, item.restaurant?.address, item.restaurant?.business_area, item.restaurant?.signature_dishes]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    })
    .sort((left, right) => compareTodoItems(left, right, schedules));
}

function getEarliestScheduleDate(item: TodoItemOut, schedules: TodoScheduleOut[]): string | null {
  const dates = schedules
    .filter((schedule) => schedule.item_id === item.id)
    .map((schedule) => schedule.scheduled_on)
    .sort();
  return dates[0] ?? null;
}

function compareTodoItems(left: TodoItemOut, right: TodoItemOut, schedules: TodoScheduleOut[]): number {
  const leftDate = getEarliestScheduleDate(left, schedules);
  const rightDate = getEarliestScheduleDate(right, schedules);
  if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  if (leftDate && !rightDate) return -1;
  if (!leftDate && rightDate) return 1;
  return left.created_at.localeCompare(right.created_at) || left.id - right.id;
}

function getViewCounts(items: TodoItemOut[], schedules: TodoScheduleOut[]): Record<TodoView, number> {
  const scheduledIds = new Set(schedules.map((schedule) => schedule.item_id));
  const openItems = items.filter((item) => !item.checked_in);
  return {
    all: openItems.length,
    important: openItems.filter((item) => item.restaurant?.parse_status === "failed" || scheduledIds.has(item.id)).length,
    planned: openItems.filter((item) => scheduledIds.has(item.id)).length,
    food: openItems.filter((item) => item.category === "food").length,
    play: openItems.filter((item) => item.category === "play").length,
    stay: openItems.filter((item) => item.category === "stay").length,
    lottery: openItems.filter((item) => item.category === "food").length,
  };
}

function TodoBoardHeader({
  loading,
  openCount,
  candidateCount,
}: {
  loading: boolean;
  openCount: number;
  candidateCount: number;
}) {
  return (
    <header className="border-b border-line/60 px-3 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-peach/20 text-rose-deep">
          <ListTodo className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold leading-tight text-ink sm:text-3xl">要一起做的事情</h1>
          <p className="mt-1 font-sc text-sm text-ink-muted">
            {openCount} 件还没完成，{candidateCount} 件待确认
          </p>
        </div>
        {loading && <Loader2 className="mt-2 h-5 w-5 animate-spin text-ink-muted" />}
      </div>
    </header>
  );
}
function TodoCategorySection({
  section,
  expanded,
  items,
  completedItems,
  schedules,
  onToggle,
  onOpen,
}: {
  section: (typeof TODO_SECTIONS)[number];
  expanded: boolean;
  items: TodoItemOut[];
  completedItems: TodoItemOut[];
  schedules: TodoScheduleOut[];
  onToggle: () => void;
  onOpen: (id: number) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line/62 bg-surface-raised/76">
      <button type="button" onClick={onToggle} className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition hover:bg-peach/8 focus-ring" aria-expanded={expanded}>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-peach/18 text-rose-deep">{section.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-semibold text-ink">{section.title}</span>
          <span className="block truncate font-sc text-xs text-ink-muted">{section.subtitle}</span>
        </span>
        <span className="rounded-full bg-ink/5 px-2 py-0.5 font-sc text-xs text-ink-muted">{items.length}</span>
        <ChevronRight className={cn("h-4 w-4 text-ink-muted transition", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="border-t border-line/52 p-3">
          <TaskList items={items} completedItems={completedItems} schedules={schedules} onOpen={onOpen} />
        </div>
      )}
    </section>
  );
}

function CandidateQueue({
  candidates,
  onConfirm,
  onDiscard,
}: {
  candidates: CandidateQueueItem[];
  onConfirm: (candidate: TodoCandidateOut, selectedCandidate?: TodoRestaurantCandidate | null, category?: TodoCategory) => void | Promise<void>;
  onDiscard: (candidate: CandidateQueueItem) => void | Promise<void>;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="rounded-2xl border border-rose/20 bg-rose/6 p-3">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">待确认</h2>
          <p className="font-sc text-xs text-ink-muted">点击卡片查看解析结果，再确认加入或丢弃。</p>
        </div>
        <span className="rounded-full bg-rose/10 px-2 py-0.5 font-sc text-xs text-rose-deep">{candidates.length}</span>
      </div>
      <div className="grid gap-2">
        {candidates.map((candidate) => (
          <CandidateCard key={candidateKey(candidate)} candidate={candidate} onConfirm={onConfirm} onDiscard={onDiscard} />
        ))}
      </div>
    </section>
  );
}

function CandidateCard({
  candidate,
  onConfirm,
  onDiscard,
}: {
  candidate: CandidateQueueItem;
  onConfirm: (candidate: TodoCandidateOut, selectedCandidate?: TodoRestaurantCandidate | null, category?: TodoCategory) => void | Promise<void>;
  onDiscard: (candidate: CandidateQueueItem) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState<TodoRestaurantCandidate | null>(candidate.selected_candidate ?? candidate.amap_candidates[0] ?? null);
  const [overrideCategory, setOverrideCategory] = useState<TodoCategory>(candidate.category);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const candidates = candidate.amap_candidates ?? [];
  const persisted = isPersistedCandidate(candidate);

  useEffect(() => {
    setSelected(candidate.selected_candidate ?? candidate.amap_candidates[0] ?? null);
    setOverrideCategory(candidate.category);
    setActionError(null);
  }, [candidate]);

  async function confirmWith(nextCategory = overrideCategory) {
    if (!persisted || candidate.status === "parsing") return;
    setConfirming(true);
    setActionError(null);
    try {
      await onConfirm(candidate, nextCategory === "wish" ? null : selected, nextCategory);
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setConfirming(false);
    }
  }

  async function discard() {
    setDiscarding(true);
    setActionError(null);
    try {
      await onDiscard(candidate);
    } catch (error) {
      setActionError(apiErrorMessage(error));
    } finally {
      setDiscarding(false);
    }
  }

  const statusText = candidate.status === "ready" ? "待增加" : candidate.status === "needs_choice" ? "需要选择地点" : candidate.status === "failed" ? "解析失败" : "正在解析";

  return (
    <article className="rounded-xl border border-line/58 bg-surface/86 p-3">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-start gap-3 text-left focus-ring">
        <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-xl bg-peach/18 text-rose-deep">
          {candidate.status === "parsing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className={cn("h-4 w-4 transition", expanded && "rotate-90")} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-semibold text-ink">{candidate.raw_title}</span>
          <span className="mt-1 block font-sc text-xs text-ink-muted">
            {TODO_CATEGORY_LABELS[candidate.category]} · {statusText}
          </span>
          {candidate.selected_candidate && <span className="mt-1 block truncate font-sc text-xs text-ink-muted">{candidate.selected_candidate.name}</span>}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-line/52 pt-3">
          {candidate.status === "parsing" && <p className="rounded-xl bg-peach/12 p-3 font-sc text-xs text-ink-muted">正在调用 LLM 和高德 MCP 解析，完成后这里会显示可确认的详情。</p>}
          {(candidate.parse_error || actionError) && <p className="rounded-xl bg-red-50 p-2 font-sc text-xs text-red-700">{actionError ?? candidate.parse_error}</p>}

          <div className="rounded-xl border border-line/58 bg-surface-raised/70 p-3">
            <p className="font-sc text-xs text-ink-muted">LLM 判断：{TODO_CATEGORY_LABELS[candidate.category]}。你也可以改到其它板块。</p>
            <div className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-ink/5 p-1">
              {TODO_CATEGORY_OPTIONS.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setOverrideCategory(category)}
                  className={cn(
                    "min-h-9 rounded-lg font-sc text-xs transition focus-ring",
                    overrideCategory === category ? "bg-surface text-rose-deep shadow-sm" : "text-ink-muted hover:bg-surface/62",
                  )}
                >
                  {TODO_CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
          </div>

          {candidate.status === "ready" && selected && <CandidatePoiSummary candidate={selected} selected />}

          {candidate.status === "needs_choice" && (
            <div className="grid gap-2">
              {candidates.map((item, index) => {
                const isSelected = selected === item || (!!selected?.amap_poi_id && selected.amap_poi_id === item.amap_poi_id);
                return (
                  <button
                    type="button"
                    key={`${item.amap_poi_id || item.name}-${index}`}
                    onClick={() => setSelected(item)}
                    className={cn(
                      "block w-full rounded-xl border p-3 text-left transition focus-ring",
                      isSelected ? "border-rose/38 bg-rose/10" : "border-line/58 bg-surface-raised/82 hover:bg-peach/10",
                    )}
                  >
                    <CandidatePoiSummary candidate={item} selected={isSelected} />
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {candidate.status === "failed" && persisted && (
              <button type="button" onClick={() => confirmWith(overrideCategory)} disabled={confirming || discarding} className="btn-ghost min-h-9 rounded-xl px-3 font-sc text-xs focus-ring disabled:opacity-50">
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : `按当前分类加入${TODO_CATEGORY_LABELS[overrideCategory]}`}
              </button>
            )}
            {(candidate.status === "ready" || candidate.status === "needs_choice") && persisted && (
              <button type="button" onClick={() => confirmWith()} disabled={confirming || discarding || (candidate.status === "needs_choice" && !selected)} className="btn-primary min-h-9 rounded-xl px-3 font-sc text-xs focus-ring disabled:opacity-50">
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认加入"}
              </button>
            )}
            <button type="button" onClick={discard} disabled={confirming || discarding} className="btn-ghost min-h-9 rounded-xl px-3 font-sc text-xs focus-ring disabled:opacity-50">
              {discarding ? <Loader2 className="h-4 w-4 animate-spin" /> : "丢弃"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function CandidatePoiSummary({ candidate, selected }: { candidate: TodoRestaurantCandidate; selected?: boolean }) {
  return (
    <span className="block">
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-semibold text-ink">{candidate.name}</span>
          <span className="mt-1 block truncate font-sc text-xs text-ink-muted">{candidate.address || candidate.city || "高德未返回地址"}</span>
        </span>
        {selected && <Check className="mt-0.5 h-4 w-4 flex-none text-rose-deep" />}
      </span>
      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-sc text-[11px] text-ink-muted">
        {candidate.poi_type && <span>{candidate.poi_type}</span>}
        {candidate.business_area && <span>{candidate.business_area}</span>}
        {candidate.rating != null && <span>评分 {candidate.rating}</span>}
        {candidate.per_capita != null && <span>人均 {candidate.per_capita}</span>}
      </span>
    </span>
  );
}
function TodoSidebar({
  open,
  me,
  view,
  query,
  counts,
  loading,
  onQuery,
  onPick,
  onClose,
}: {
  open: boolean;
  me: ReturnType<typeof useAppStore.getState>["me"];
  view: TodoView;
  query: string;
  counts: Record<TodoView, number>;
  loading: boolean;
  onQuery: (query: string) => void;
  onPick: (view: TodoView) => void;
  onClose: () => void;
}) {
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.button
            type="button"
            className="fixed inset-0 z-40 bg-ink/28 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-label="关闭列表导航"
            onClick={onClose}
          />
        )}
      </AnimatePresence>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[282px] flex-col border-r border-line/62 bg-surface/96 px-4 py-4 shadow-[18px_0_44px_-34px_rgb(var(--ink)/0.46)] transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:z-auto lg:min-h-dvh lg:translate-x-0 lg:bg-surface/68 lg:shadow-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          {me && (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar user={me.user} size="md" />
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold text-ink">{me.user.display_name}</p>
                <p className="truncate font-sc text-xs text-ink-muted">和 {me.counterpart.display_name} 的清单</p>
              </div>
            </div>
          )}
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-ink-muted hover:bg-ink/5 focus-ring lg:hidden" aria-label="关闭导航">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-4 flex h-11 items-center gap-2 rounded-xl border border-line/76 bg-surface-raised/86 px-3 focus-within:border-rose/60 focus-within:shadow-[0_0_0_4px_rgb(var(--focus)/0.14)]">
          <Search className="h-4 w-4 text-ink-muted" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索"
            className="min-w-0 flex-1 bg-transparent font-sc text-sm outline-none placeholder:text-ink-muted/80"
          />
        </label>

        <nav className="space-y-1" aria-label="Todo 列表">
          {(Object.keys(VIEW_META) as TodoView[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left font-sc text-sm transition focus-ring",
                view === key ? "bg-rose/12 text-rose-deep" : "text-ink-soft hover:bg-peach/12 hover:text-rose-deep",
              )}
            >
              <span className={cn("grid h-7 w-7 place-items-center rounded-lg", view === key ? "bg-rose/14" : "bg-transparent")}>{VIEW_META[key].icon}</span>
              <span className="min-w-0 flex-1 truncate">{VIEW_META[key].title}</span>
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-muted">{counts[key]}</span>
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t border-line/60 pt-4 font-sc text-xs text-ink-muted">
          {loading ? "正在同步清单..." : "Todo 数据只在你们两个人之间共享"}
        </div>
      </aside>
    </>
  );
}

function TodoToolbar({
  view,
  loading,
  count,
  onOpenSidebar,
}: {
  view: TodoView;
  loading: boolean;
  count: number;
  onOpenSidebar: () => void;
}) {
  const meta = VIEW_META[view];
  return (
    <header className="border-b border-line/60 px-3 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start gap-3">
        <button type="button" onClick={onOpenSidebar} className="grid h-10 w-10 place-items-center rounded-xl text-ink-soft hover:bg-peach/14 focus-ring lg:hidden" aria-label="打开列表导航">
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-peach/20 text-rose-deep">{meta.icon}</span>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold leading-tight text-ink sm:text-3xl">{meta.title}</h1>
              <p className="mt-1 font-sc text-sm text-ink-muted">{meta.subtitle}，{count} 项</p>
            </div>
          </div>
        </div>
        {loading && <Loader2 className="mt-2 h-5 w-5 animate-spin text-ink-muted" />}
      </div>
    </header>
  );
}
function TaskList({
  items,
  completedItems,
  schedules,
  onOpen,
}: {
  items: TodoItemOut[];
  completedItems: TodoItemOut[];
  schedules: TodoScheduleOut[];
  onOpen: (id: number) => void;
}) {
  return (
    <div className="pt-3">
      {items.length === 0 ? (
        <div className="grid min-h-[32vh] place-items-center rounded-2xl border border-dashed border-line/70 bg-peach/8 p-8 text-center">
          <div>
            <ListTodo className="mx-auto h-8 w-8 text-rose-deep" />
            <p className="mt-3 font-display text-lg font-semibold text-ink">这里还没有未完成任务</p>
            <p className="mt-1 font-sc text-sm text-ink-muted">从底部添加一条，或者切换到吃饭视图搜索餐厅。</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <TaskRow
                item={item}
                schedules={schedulesForItem(item, schedules)}
                onOpen={() => onOpen(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <CompletedTaskSection
        items={completedItems}
        schedules={schedules}
        onOpen={onOpen}
      />
    </div>
  );
}

function CompletedTaskSection({
  items,
  schedules,
  onOpen,
}: {
  items: TodoItemOut[];
  schedules: TodoScheduleOut[];
  onOpen: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-line/58 bg-surface-raised/54">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left font-sc text-sm text-ink-soft transition hover:bg-peach/8 focus-ring"
        aria-expanded={expanded}
      >
        <span className="inline-flex items-center gap-2">
          <ChevronRight className={cn("h-4 w-4 transition", expanded && "rotate-90")} />
          已完成/打卡
        </span>
        <span className="rounded-full bg-sage/16 px-2 py-0.5 text-xs text-ink-muted">{items.length}</span>
      </button>
      {expanded && (
        <ul className="space-y-2 border-t border-line/52 p-3">
          {items.map((item) => (
            <li key={item.id}>
              <TaskRow
                item={item}
                schedules={schedulesForItem(item, schedules)}
                onOpen={() => onOpen(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({
  item,
  schedules,
  onOpen,
}: {
  item: TodoItemOut;
  schedules: TodoScheduleOut[];
  onOpen: () => void;
}) {
  const restaurant = item.restaurant;
  const primarySchedule = getPrimarySchedule(item, schedules);
  const primaryScheduleMeta = primarySchedule ? scheduleMeta(primarySchedule.scheduled_on, item.checked_in) : null;

  return (
    <article className="group rounded-2xl border border-line/58 bg-surface-raised/88 px-3 py-3 transition hover:border-rose/26 hover:bg-peach/8">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full border transition focus-ring",
            item.checked_in ? "border-sage bg-sage text-white" : "border-rose/42 text-rose-deep hover:bg-rose/10",
          )}
          aria-label="打开任务详情"
        >
          {item.checked_in ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        </button>

        <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded-xl text-left focus-ring">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={cn("font-display text-base font-semibold leading-tight text-ink", item.checked_in && "text-ink-muted line-through")}>{item.title}</h3>
                <span className="rounded-full bg-peach/16 px-2 py-0.5 font-sc text-[11px] text-ink-muted">{TODO_CATEGORY_LABELS[item.category]}</span>
                {restaurant && <StatusPill status={restaurant.parse_status} />}
                {item.checked_in && <span className="rounded-full bg-sage/18 px-2 py-0.5 font-sc text-[11px] text-ink-soft">已打卡</span>}
              </div>
            </div>
            {primaryScheduleMeta && (
              <span className={cn("ml-auto inline-flex min-h-7 flex-none items-center rounded-full border px-2.5 font-sc text-[11px] font-medium", primaryScheduleMeta.className)}>
                {primaryScheduleMeta.label}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-sc text-xs text-ink-muted">
            {restaurant?.address && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 flex-none" />
                <span className="truncate">{restaurant.address}</span>
              </span>
            )}
            {restaurant?.per_capita != null && <span>人均 {restaurant.per_capita}</span>}
            {restaurant?.rating != null && <span>评分 {restaurant.rating}</span>}
            {restaurant?.opening_hours && <span>{restaurant.opening_hours}</span>}
            {restaurant?.poi_type && <span className="truncate">{restaurant.poi_type}</span>}
            {item.note && <span className="truncate">{item.note}</span>}
            {primarySchedule && (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                {formatShortDate(primarySchedule.scheduled_on)}
              </span>
            )}
          </div>
        </button>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "resolved") return <span className="rounded-full bg-sage/18 px-2 py-0.5 font-sc text-[11px] text-ink-soft">已解析</span>;
  if (status === "failed") return <span className="rounded-full bg-red-100 px-2 py-0.5 font-sc text-[11px] text-red-700">解析失败</span>;
  return <span className="rounded-full bg-peach/18 px-2 py-0.5 font-sc text-[11px] text-ink-muted">解析中</span>;
}

function QuickAddBar({ onCreated }: { onCreated: (title: string) => void | Promise<void> }) {
  const [title, setTitle] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next) return;
    setTitle("");
    void onCreated(next);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line/62 bg-surface-raised/82 p-3 shadow-[0_10px_24px_-22px_rgb(var(--ink)/0.42)] sm:p-4">
      <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-line/70 bg-surface-raised/90 px-3 focus-within:border-rose/60 focus-within:shadow-[0_0_0_4px_rgb(var(--focus)/0.14)]">
        <Plus className="h-4 w-4 text-rose-deep" />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="写下想一起做的事"
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent font-sc text-sm outline-none placeholder:text-ink-muted/82"
        />
        <button type="submit" disabled={!title.trim()} className="rounded-xl bg-rose px-3 py-2 font-sc text-sm text-white disabled:opacity-45 focus-ring">
          加入队列
        </button>
      </div>
    </form>
  );
}

function RestaurantCreator({ onCreated }: { onCreated: (item: TodoItemOut) => void | Promise<void> }) {
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState("");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [candidates, setCandidates] = useState<TodoRestaurantCandidate[]>([]);
  const [selected, setSelected] = useState<TodoRestaurantCandidate | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const result = await api.searchTodoRestaurants({ keyword: keyword.trim(), city: city.trim() || null });
      setCandidates(result.candidates);
      setSelected(result.candidates[0] ?? null);
      if (!result.candidates.length) toast.message("没有找到餐厅候选");
    } finally {
      setSearching(false);
    }
  }

  async function create() {
    if (!selected) return;
    setCreating(true);
    try {
      const item = await api.createTodoRestaurant({ candidate: selected });
      setKeyword("");
      setCity("");
      setCandidates([]);
      setSelected(null);
      toast.success("餐厅已添加，已刷新高德详情");
      await onCreated(item);
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="mt-3 rounded-2xl border border-line/62 bg-peach/10 p-3 sm:p-4">
      <form onSubmit={search} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_48px]">
        <input className="input-field rounded-xl text-sm" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索餐厅名或关键词" maxLength={100} />
        <input className="input-field rounded-xl text-sm" value={city} onChange={(event) => setCity(event.target.value)} placeholder="城市" maxLength={100} />
        <button type="submit" disabled={searching || !keyword.trim()} className="grid h-12 w-full place-items-center rounded-xl bg-rose text-white disabled:opacity-50 focus-ring" aria-label="搜索餐厅">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </form>

      {candidates.length > 0 && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid gap-2">
            {candidates.slice(0, 6).map((candidate, index) => (
              <button
                type="button"
                key={`${candidate.amap_poi_id || candidate.name}-${index}`}
                onClick={() => setSelected(candidate)}
                className={cn("rounded-xl border p-3 text-left transition focus-ring", selected === candidate ? "border-rose/38 bg-rose/10" : "border-line/58 bg-surface-raised/84 hover:bg-peach/12")}
              >
                <span className="block font-display text-sm font-semibold text-ink">{candidate.name}</span>
                <span className="mt-1 block truncate font-sc text-xs text-ink-muted">{candidate.address || candidate.city || "暂无地址"}</span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-sc text-[11px] text-ink-muted">
                  {candidate.poi_type && <span>{candidate.poi_type}</span>}
                  {candidate.business_area && <span>{candidate.business_area}</span>}
                  {candidate.rating != null && <span>评分 {candidate.rating}</span>}
                  {candidate.per_capita != null && <span>人均 {candidate.per_capita}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-line/58 bg-surface/78 p-3">
            <p className="font-display text-sm font-semibold text-ink">{selected?.name ?? "选择一家餐厅"}</p>
            <div className="mt-2 space-y-1 font-sc text-xs text-ink-muted">
              <p>{selected?.address || "高德未返回地址"}</p>
              <p>添加后会自动拉取高德详情，并打开右侧详情。</p>
            </div>
            <button type="button" onClick={create} disabled={!selected || creating} className="btn-primary mt-3 min-h-11 w-full rounded-xl px-4 font-sc text-sm disabled:opacity-50 focus-ring">
              {creating ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "添加并查看详情"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function RestaurantLottery({ onCreated, onOpen }: { onCreated: () => void; onOpen: (id: number) => void }) {
  const [budget, setBudget] = useState<[number | null, number | null]>([null, null]);
  const [radius, setRadius] = useState<number | null>(null);
  const [city, setCity] = useState("");
  const [location, setLocation] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [winner, setWinner] = useState<TodoItemOut | null>(null);
  const [candidate, setCandidate] = useState<TodoRestaurantCandidate | null>(null);

  async function locate(nextRadius: number) {
    setRadius(nextRadius);
    if (!navigator.geolocation) {
      toast.error("当前浏览器不支持定位");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(`${pos.coords.longitude},${pos.coords.latitude}`),
      () => toast.error("定位未授权，可以继续只按人均或城市抽取"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function draw() {
    setDrawing(true);
    setWinner(null);
    setCandidate(null);
    try {
      const result = await api.lotteryTodoRestaurant({
        per_capita_min: budget[0],
        per_capita_max: budget[1],
        location,
        radius_km: radius,
        city: city.trim() || null,
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      setWinner(result.item);
      setCandidate(result.candidate);
      if (!result.item && !result.candidate) toast.message("没有可抽取的餐厅");
    } finally {
      setDrawing(false);
    }
  }

  async function saveCandidate() {
    if (!candidate) return;
    const created = await api.createTodoRestaurant({ candidate });
    toast.success("已保存抽中的餐厅");
    setCandidate(null);
    onCreated();
    onOpen(created.id);
  }

  return (
    <section className="grid gap-4 pt-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-2xl border border-line/62 bg-peach/10 p-4">
        <TodoLotteryScene spinning={drawing} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SegmentedBudget value={budget} onChange={setBudget} />
          <div className="grid grid-cols-2 gap-2">
            {[1, 3, 5, 10].map((value) => (
              <button key={value} type="button" onClick={() => locate(value)} className={cn("btn-ghost min-h-11 rounded-xl px-3 font-sc text-sm focus-ring", radius === value && "bg-peach/28 text-rose-deep")}>
                附近 {value}km
              </button>
            ))}
          </div>
        </div>
      </div>
      <aside className="rounded-2xl border border-line/62 bg-surface-raised/88 p-4">
        <h2 className="font-display text-lg font-semibold text-ink">抽一家餐厅</h2>
        <p className="mt-1 font-sc text-sm text-ink-muted">可按人均、城市或附近距离筛选。</p>
        <input className="input-field mt-4 rounded-xl text-sm" value={city} onChange={(event) => setCity(event.target.value)} placeholder="城市/区域，可选" maxLength={100} />
        <button type="button" onClick={draw} disabled={drawing} className="btn-primary mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-sc text-sm focus-ring">
          {drawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
          开始抽
        </button>
        {winner && (
          <button type="button" onClick={() => onOpen(winner.id)} className="mt-4 w-full rounded-xl bg-peach/18 p-4 text-left hairline focus-ring">
            <span className="font-display text-base font-semibold text-ink">{winner.title}</span>
            <span className="mt-1 block font-sc text-xs text-ink-muted">点开查看详情</span>
          </button>
        )}
        {candidate && (
          <div className="mt-4 rounded-xl bg-peach/18 p-4 hairline">
            <p className="font-display text-base font-semibold text-ink">{candidate.name}</p>
            <p className="mt-1 font-sc text-xs text-ink-muted">{candidate.address || candidate.city}</p>
            <button type="button" onClick={saveCandidate} className="btn-primary mt-3 min-h-11 rounded-xl px-4 font-sc text-sm focus-ring">
              保存这家
            </button>
          </div>
        )}
      </aside>
    </section>
  );
}

function SegmentedBudget({ value, onChange }: { value: [number | null, number | null]; onChange: (value: [number | null, number | null]) => void }) {
  const options: Array<[string, [number | null, number | null]]> = [
    ["不限", [null, null]],
    ["100 内", [0, 100]],
    ["100-200", [100, 200]],
    ["200+", [200, null]],
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map(([label, option]) => {
        const selected = value[0] === option[0] && value[1] === option[1];
        return (
          <button key={label} type="button" onClick={() => onChange(option)} className={cn("btn-ghost min-h-11 rounded-xl px-3 font-sc text-sm focus-ring", selected && "bg-peach/28 text-rose-deep")}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function TodoDetailPanel({
  itemId,
  item,
  schedules,
  initialScheduleDate,
  onClose,
  onChanged,
  onSchedule,
  onRemoveSchedule,
  onArchive,
}: {
  itemId: number;
  item: TodoItemOut | null;
  schedules: TodoScheduleOut[];
  initialScheduleDate: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onSchedule: (id: number, date?: string) => void | Promise<void>;
  onRemoveSchedule: (id: number) => void | Promise<void>;
  onArchive: (id: number) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [detail, setDetail] = useState<TodoItemDetail | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(initialScheduleDate);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);

  useEffect(() => {
    setDetail(null);
    void api.getTodoItem(itemId).then(setDetail);
    const timer = window.setInterval(() => {
      void api.getTodoItem(itemId).then(setDetail);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [itemId]);

  useEffect(() => {
    const savedDate = (detail?.schedules ?? schedules)[0]?.scheduled_on;
    setScheduleDate(savedDate ?? initialScheduleDate);
  }, [detail?.schedules, schedules, initialScheduleDate, itemId]);

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    const text = comment.trim();
    if (!text) return;
    setSaving(true);
    try {
      await api.postTodoComment(itemId, text);
      setComment("");
      setDetail(await api.getTodoItem(itemId));
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(file: File | null) {
    if (!file) return;
    await api.postTodoImage(itemId, file);
    setDetail(await api.getTodoItem(itemId));
    await onChanged();
  }

  async function applyScheduleDate(nextDate: string) {
    setScheduleDate(nextDate);
    if (!nextDate) return;
    setSavingSchedule(true);
    try {
      await onSchedule(itemId, nextDate);
      setDetail(await api.getTodoItem(itemId));
      await onChanged();
    } catch {
      // apiRequest already shows the server-provided error toast.
    } finally {
      setSavingSchedule(false);
    }
  }

  async function clearScheduleDate() {
    if (!currentSchedule) return;
    setSavingSchedule(true);
    try {
      await onRemoveSchedule(currentSchedule.id);
      setDetail(await api.getTodoItem(itemId));
      await onChanged();
    } catch {
      // apiRequest already shows the server-provided error toast.
    } finally {
      setSavingSchedule(false);
    }
  }

  const current = detail ?? item;
  const currentSchedules = detail?.schedules ?? schedules;
  const currentSchedule = currentSchedules[0] ?? null;
  const panelMotion = reducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.12 },
      }
    : {
        initial: { x: 36, y: 18, opacity: 0 },
        animate: { x: 0, y: 0, opacity: 1 },
        exit: { x: 32, y: 18, opacity: 0 },
        transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <>
      <motion.button
        type="button"
        className="fixed inset-0 z-[70] bg-ink/30 lg:hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        aria-label="关闭任务详情"
        onClick={onClose}
      />
      <motion.aside
        {...panelMotion}
        className="fixed inset-x-0 bottom-0 z-[80] flex max-h-[100dvh] flex-col overflow-hidden rounded-t-[1.35rem] border border-line/70 bg-surface text-ink shadow-[0_-24px_52px_-36px_rgb(var(--ink)/0.55)] lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:h-dvh lg:w-[390px] lg:flex-none lg:max-h-none lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-[-18px_0_42px_-34px_rgb(var(--ink)/0.5)]"
        role="dialog"
        aria-modal="true"
      >
        <header className="border-b border-line/60 p-4">
          <div className="flex items-start gap-3">
            <span
              className={cn("mt-1 grid h-8 w-8 place-items-center rounded-full border", current?.checked_in ? "border-sage bg-sage text-white" : "border-rose/42 text-rose-deep")}
              aria-hidden="true"
            >
              {current?.checked_in ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-semibold leading-tight text-ink">{current?.title ?? "正在读取"}</h2>
              {current?.restaurant?.signature_dishes && <p className="mt-1 font-sc text-sm text-ink-soft">招牌菜：{current.restaurant.signature_dishes}</p>}
              {current?.restaurant?.address && <p className="mt-1 font-sc text-xs text-ink-muted">{current.restaurant.address}</p>}
            </div>
            <button type="button" onClick={onClose} className="grid h-10 w-10 flex-none place-items-center rounded-full hover:bg-ink/5 focus-ring" aria-label="关闭">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!detail ? (
            <div className="grid h-40 place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
            </div>
          ) : (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">日期安排</h3>
                <div className="rounded-2xl border border-line/58 bg-surface-raised/66 p-3">
                  <p className="mb-2 font-sc text-xs text-ink-muted">
                    当前日期：{currentSchedule ? formatShortDate(currentSchedule.scheduled_on) : "未安排"}
                  </p>
                  <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line/70 bg-surface/88 px-3 font-sc text-xs text-ink-soft focus-within:border-rose/60">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <input type="date" value={scheduleDate} onChange={(event) => void applyScheduleDate(event.target.value)} disabled={savingSchedule} className="min-w-0 flex-1 bg-transparent outline-none disabled:opacity-60" />
                  </label>
                  {currentSchedule && (
                    <button
                      type="button"
                      onClick={() => void clearScheduleDate()}
                      disabled={savingSchedule}
                      className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-full bg-rose/10 px-3 font-sc text-xs text-rose-deep disabled:opacity-60 focus-ring"
                    >
                      {savingSchedule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "清除日期"}
                    </button>
                  )}
                </div>
              </section>

              {detail.restaurant && <RestaurantEvidence restaurant={detail.restaurant} />}

              <section>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">双方评论</h3>
                {detail.comments.length === 0 ? (
                  <p className="rounded-xl bg-peach/14 p-4 font-sc text-sm text-ink-muted">还没有评论，写一句就算完成一次打卡。</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.comments.map((item) => (
                      <li key={item.id} className="rounded-xl bg-peach/14 p-4">
                        <p className="mb-2 font-sc text-xs font-medium text-rose-deep">{item.author_display_name || "对方"}</p>
                        <p className="whitespace-pre-wrap break-words font-sc text-sm text-ink">{item.text}</p>
                        <p className="mt-2 font-sc text-[11px] text-ink-muted">{formatRelative(item.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <button
                  type="button"
                  onClick={() => setPhotosOpen((value) => !value)}
                  className="mb-2 flex min-h-10 w-full items-center justify-between rounded-xl px-2 text-left font-sc text-sm font-medium text-ink hover:bg-peach/10 focus-ring"
                  aria-expanded={photosOpen}
                >
                  <span>照片</span>
                  <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
                    {detail.images.length}
                    <ChevronRight className={cn("h-4 w-4 transition", photosOpen && "rotate-90")} />
                  </span>
                </button>
                {photosOpen && (
                  detail.images.length === 0 ? (
                    <p className="rounded-xl bg-peach/14 p-4 font-sc text-sm text-ink-muted">还没有照片。</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {detail.images.map((image) => (
                        <TodoImageThumb key={image.id} image={image} />
                      ))}
                    </div>
                  )
                )}
              </section>
            </div>
          )}
        </div>

        <footer className="border-t border-line/60 p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] lg:pb-4">
          <form onSubmit={submitComment} className="mb-3 flex gap-2">
            <input className="input-field min-w-0 flex-1 rounded-xl text-sm" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写评论打卡" maxLength={2000} />
            <button type="submit" disabled={saving || !comment.trim()} className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-rose text-white disabled:opacity-50 focus-ring" aria-label="发送评论">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
          </form>
          <div className="flex items-center justify-between gap-2">
            <label className="btn-ghost inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 font-sc text-sm focus-ring">
              <ImagePlus className="h-4 w-4" />
              上传照片
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => uploadImage(event.target.files?.[0] ?? null)} />
            </label>
            <button type="button" onClick={() => onArchive(itemId)} className="grid h-11 w-11 place-items-center rounded-xl text-ink-muted hover:bg-ink/5 hover:text-rose-deep focus-ring" aria-label="收起项目">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </motion.aside>
    </>
  );
}

function RestaurantEvidence({ restaurant }: { restaurant: NonNullable<TodoItemDetail["restaurant"]> }) {
  const facts = restaurant.display_facts?.length
    ? restaurant.display_facts
    : [
        { label: "店名", value: restaurant.name },
        { label: "城市", value: restaurant.city },
        { label: "地址", value: restaurant.address },
        { label: "商圈", value: restaurant.business_area || restaurant.adname },
        { label: "菜系/类型", value: restaurant.poi_type },
        { label: "评分", value: restaurant.rating != null ? String(restaurant.rating) : null },
        { label: "人均", value: restaurant.per_capita != null ? `约 ${restaurant.per_capita} 元` : null },
        { label: "营业时间", value: restaurant.opening_hours },
        { label: "坐标", value: restaurant.location },
        { label: "高德 POI ID", value: restaurant.amap_poi_id },
        { label: "是否支持点餐", value: restaurant.meal_ordering != null ? `高德字段 meal_ordering: ${restaurant.meal_ordering}` : null },
        { label: "门店照片", value: restaurant.first_photo_url, href: restaurant.first_photo_url },
        { label: "地图导航", value: restaurant.amap_navigation_url, href: restaurant.amap_navigation_url },
      ];

  return (
    <section className="rounded-2xl border border-line/62 bg-surface-raised/66 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-sc text-sm font-medium text-ink">高德取证</h3>
        <StatusPill status={restaurant.parse_status} />
      </div>
      {restaurant.parse_status === "failed" && restaurant.parse_error && (
        <p className="mb-2 rounded-xl bg-red-50 p-2 font-sc text-xs text-red-700">{restaurant.parse_error}</p>
      )}
      <dl className="divide-y divide-line/52 overflow-hidden rounded-xl border border-line/52 bg-surface/78">
        {facts.map((fact) => (
          <div key={fact.label} className="grid grid-cols-[6.2rem_minmax(0,1fr)] gap-2 px-3 py-2 font-sc text-xs">
            <dt className="text-ink-muted">{fact.label}</dt>
            <dd className="min-w-0 break-words text-ink-soft">
              {fact.href && fact.value ? (
                <a href={fact.href} target="_blank" rel="noreferrer" className="text-rose-deep underline-offset-4 hover:underline">
                  {fact.label === "门店照片" ? "打开门店照片" : fact.label === "地图导航" ? "打开高德地图标记" : fact.value}
                </a>
              ) : (
                fact.value || "未返回"
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TodoImageThumb({ image }: { image: TodoImageOut }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void fetchTodoImageBlob("thumb", image.id).then((url) => {
      objectUrl = url;
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.id]);
  return src ? (
    <img src={src} alt="打卡照片" className="aspect-square w-full rounded-xl object-cover" />
  ) : (
    <div className="aspect-square w-full rounded-xl bg-line/40" />
  );
}
