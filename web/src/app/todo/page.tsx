"use client";

// Microsoft To Do inspired pair-shared todo workspace with Love Book colors, list navigation, planned tasks, restaurant search, lottery, and check-in detail panels.

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  Check,
  ChevronLeft,
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
  Search,
  Shuffle,
  Sparkles,
  Star,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { TodoLotteryScene } from "@/components/todo-lottery-scene";
import { api, fetchTodoImageBlob } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type {
  TodoCategory,
  TodoDashboardOut,
  TodoImageOut,
  TodoItemDetail,
  TodoItemOut,
  TodoRestaurantCandidate,
  TodoScheduleOut,
} from "@/lib/types";

type TodoView = "today" | "important" | "planned" | "food" | "play" | "completed" | "lottery";

const VIEW_META: Record<TodoView, { title: string; subtitle: string; icon: ReactNode }> = {
  today: { title: "我的一天", subtitle: "今天想一起完成的小安排", icon: <Sparkles className="h-4 w-4" /> },
  important: { title: "重要", subtitle: "最近安排、已打卡和餐厅解析提醒", icon: <Star className="h-4 w-4" /> },
  planned: { title: "计划内", subtitle: "已经放到具体日期的事项", icon: <CalendarDays className="h-4 w-4" /> },
  food: { title: "吃饭", subtitle: "想尝试的餐厅和打卡记录", icon: <Utensils className="h-4 w-4" /> },
  play: { title: "玩乐", subtitle: "一起去做的快乐清单", icon: <Music2 className="h-4 w-4" /> },
  completed: { title: "已完成/打卡", subtitle: "有评论或照片的完成记录", icon: <Check className="h-4 w-4" /> },
  lottery: { title: "随机抽奖", subtitle: "不知道吃什么时交给运气", icon: <Shuffle className="h-4 w-4" /> },
};

function toDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthKey(date: Date): string {
  return toDateOnly(date).slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, rawMonth] = month.split("-").map(Number);
  return monthKey(new Date(year, rawMonth - 1 + delta, 1));
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function formatMonth(month: string): string {
  const [year, rawMonth] = month.split("-");
  return `${year}年${Number(rawMonth)}月`;
}

function schedulesForItem(item: TodoItemOut, schedules: TodoScheduleOut[]): TodoScheduleOut[] {
  return schedules.filter((schedule) => schedule.item_id === item.id);
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
  const me = useAppStore((state) => state.me);
  const [view, setView] = useState<TodoView>("today");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [month, setMonth] = useState(monthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const [dashboard, setDashboard] = useState<TodoDashboardOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("date");
    if (date) {
      setSelectedDate(date);
      setMonth(date.slice(0, 7));
      setView("planned");
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDashboard(await api.getTodoDashboard(month));
    } catch {
      setDashboard({ month, items: [], schedules: [] });
      toast.error("Todo 看板加载失败");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => dashboard?.items ?? [], [dashboard]);
  const schedules = useMemo(() => dashboard?.schedules ?? [], [dashboard]);
  const visibleItems = useMemo(() => filterItems(items, schedules, view, today, selectedDate, query), [items, schedules, view, today, selectedDate, query]);
  const counts = useMemo(() => getViewCounts(items, schedules, today), [items, schedules, today]);
  const selectedDetail = detailId ? items.find((item) => item.id === detailId) ?? null : null;

  async function scheduleItem(itemId: number, date = selectedDate) {
    await api.scheduleTodoItem(itemId, date);
    toast.success(`已安排到 ${formatShortDate(date)}`);
    await load();
  }

  async function removeSchedule(scheduleId: number) {
    await api.deleteTodoSchedule(scheduleId);
    toast.success("已移除日期安排");
    await load();
  }

  async function archiveItem(itemId: number) {
    await api.updateTodoItem(itemId, { is_archived: true });
    toast.success("已收起这个项目");
    if (detailId === itemId) setDetailId(null);
    await load();
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--cream)/0.68)] pb-[calc(env(safe-area-inset-bottom,0px)+5.75rem)] text-ink">
      <div className="mx-auto flex min-h-dvh max-w-[1440px]">
        <TodoSidebar
          open={sidebarOpen}
          me={me}
          view={view}
          query={query}
          counts={counts}
          loading={loading}
          onQuery={setQuery}
          onPick={(next) => {
            setView(next);
            setSidebarOpen(false);
          }}
          onClose={() => setSidebarOpen(false)}
        />

        <main className="min-w-0 flex-1 px-3 py-3 sm:px-5 lg:px-6">
          <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-6xl flex-col overflow-hidden rounded-[1.4rem] bg-surface/82 shadow-[0_12px_34px_-28px_rgb(var(--rose)/0.42)] hairline">
            <TodoToolbar
              view={view}
              month={month}
              selectedDate={selectedDate}
              loading={loading}
              count={visibleItems.length}
              onOpenSidebar={() => setSidebarOpen(true)}
              onPrevMonth={() => setMonth((value) => shiftMonth(value, -1))}
              onNextMonth={() => setMonth((value) => shiftMonth(value, 1))}
              onDateChange={(date) => {
                setSelectedDate(date);
                setMonth(date.slice(0, 7));
                if (view === "today") setView("planned");
              }}
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-5 sm:pb-5">
              {view === "food" && <RestaurantCreator onCreated={load} />}
              {view === "lottery" ? (
                <RestaurantLottery onCreated={load} onOpen={setDetailId} />
              ) : (
                <TaskList
                  items={visibleItems}
                  schedules={schedules}
                  selectedDate={selectedDate}
                  onOpen={setDetailId}
                  onSchedule={scheduleItem}
                  onRemoveSchedule={removeSchedule}
                  onArchive={archiveItem}
                />
              )}
            </div>

            {view !== "lottery" && (
              <QuickAddBar
                view={view}
                selectedDate={selectedDate}
                onCreated={async (item) => {
                  if (view === "today" || view === "planned") await scheduleItem(item.id, selectedDate);
                  else await load();
                }}
                onFoodIntent={() => setView("food")}
              />
            )}
          </div>
        </main>

        <AnimatePresence>
          {detailId && (
            <TodoDetailPanel
              key={detailId}
              itemId={detailId}
              item={selectedDetail}
              schedules={selectedDetail ? schedulesForItem(selectedDetail, schedules) : []}
              selectedDate={selectedDate}
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
  today: string,
  selectedDate: string,
  query: string,
): TodoItemOut[] {
  const normalized = query.trim().toLowerCase();
  const scheduledIds = new Set(schedules.map((schedule) => schedule.item_id));
  const todayIds = new Set(schedules.filter((schedule) => schedule.scheduled_on === today).map((schedule) => schedule.item_id));
  const selectedDateIds = new Set(schedules.filter((schedule) => schedule.scheduled_on === selectedDate).map((schedule) => schedule.item_id));

  return items
    .filter((item) => {
      if (view === "today") return todayIds.has(item.id);
      if (view === "important") return item.checked_in || item.restaurant?.parse_status === "failed" || selectedDateIds.has(item.id);
      if (view === "planned") return scheduledIds.has(item.id);
      if (view === "food") return item.category === "food";
      if (view === "play") return item.category === "play";
      if (view === "completed") return item.checked_in;
      return true;
    })
    .filter((item) => {
      if (!normalized) return true;
      return [item.title, item.note, item.restaurant?.address, item.restaurant?.business_area, item.restaurant?.signature_dishes]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
}

function getViewCounts(items: TodoItemOut[], schedules: TodoScheduleOut[], today: string): Record<TodoView, number> {
  const todayIds = new Set(schedules.filter((schedule) => schedule.scheduled_on === today).map((schedule) => schedule.item_id));
  const scheduledIds = new Set(schedules.map((schedule) => schedule.item_id));
  return {
    today: todayIds.size,
    important: items.filter((item) => item.checked_in || item.restaurant?.parse_status === "failed").length,
    planned: scheduledIds.size,
    food: items.filter((item) => item.category === "food").length,
    play: items.filter((item) => item.category === "play").length,
    completed: items.filter((item) => item.checked_in).length,
    lottery: items.filter((item) => item.category === "food").length,
  };
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
  month,
  selectedDate,
  loading,
  count,
  onOpenSidebar,
  onPrevMonth,
  onNextMonth,
  onDateChange,
}: {
  view: TodoView;
  month: string;
  selectedDate: string;
  loading: boolean;
  count: number;
  onOpenSidebar: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDateChange: (date: string) => void;
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onPrevMonth} className="grid h-10 w-10 place-items-center rounded-xl text-ink-soft hover:bg-peach/14 focus-ring" aria-label="上个月">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="rounded-xl bg-peach/12 px-3 py-2 font-sc text-sm text-ink-soft">{formatMonth(month)}</span>
        <button type="button" onClick={onNextMonth} className="grid h-10 w-10 place-items-center rounded-xl text-ink-soft hover:bg-peach/14 focus-ring" aria-label="下个月">
          <ChevronRight className="h-5 w-5" />
        </button>
        <label className="ml-0 flex h-10 items-center gap-2 rounded-xl border border-line/70 bg-surface-raised/80 px-3 font-sc text-sm text-ink-soft focus-within:border-rose/60 sm:ml-auto">
          <CalendarDays className="h-4 w-4" />
          <input type="date" value={selectedDate} onChange={(event) => onDateChange(event.target.value)} className="bg-transparent outline-none" />
        </label>
      </div>
    </header>
  );
}

function TaskList({
  items,
  schedules,
  selectedDate,
  onOpen,
  onSchedule,
  onRemoveSchedule,
  onArchive,
}: {
  items: TodoItemOut[];
  schedules: TodoScheduleOut[];
  selectedDate: string;
  onOpen: (id: number) => void;
  onSchedule: (id: number, date?: string) => void;
  onRemoveSchedule: (id: number) => void;
  onArchive: (id: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="grid min-h-[42vh] place-items-center rounded-2xl border border-dashed border-line/70 bg-peach/8 p-8 text-center">
        <div>
          <ListTodo className="mx-auto h-8 w-8 text-rose-deep" />
          <p className="mt-3 font-display text-lg font-semibold text-ink">这里还没有任务</p>
          <p className="mt-1 font-sc text-sm text-ink-muted">从底部添加一条，或者切换到吃饭视图搜索餐厅。</p>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-2 pt-3">
      {items.map((item) => (
        <li key={item.id}>
          <TaskRow
            item={item}
            schedules={schedulesForItem(item, schedules)}
            selectedDate={selectedDate}
            onOpen={() => onOpen(item.id)}
            onSchedule={() => onSchedule(item.id)}
            onRemoveSchedule={onRemoveSchedule}
            onArchive={() => onArchive(item.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function TaskRow({
  item,
  schedules,
  selectedDate,
  onOpen,
  onSchedule,
  onRemoveSchedule,
  onArchive,
}: {
  item: TodoItemOut;
  schedules: TodoScheduleOut[];
  selectedDate: string;
  onOpen: () => void;
  onSchedule: () => void;
  onRemoveSchedule: (id: number) => void;
  onArchive: () => void;
}) {
  const scheduledOnSelected = schedules.some((schedule) => schedule.scheduled_on === selectedDate);
  const restaurant = item.restaurant;

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
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn("font-display text-base font-semibold leading-tight text-ink", item.checked_in && "text-ink-muted line-through")}>{item.title}</h3>
            <span className="rounded-full bg-peach/16 px-2 py-0.5 font-sc text-[11px] text-ink-muted">{item.category === "food" ? "吃饭" : "玩乐"}</span>
            {restaurant && <StatusPill status={restaurant.parse_status} />}
            {item.checked_in && <span className="rounded-full bg-sage/18 px-2 py-0.5 font-sc text-[11px] text-ink-soft">已打卡</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-sc text-xs text-ink-muted">
            {restaurant?.address && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 flex-none" />
                <span className="truncate">{restaurant.address}</span>
              </span>
            )}
            {restaurant?.per_capita != null && <span>人均 {restaurant.per_capita}</span>}
            {item.note && <span className="truncate">{item.note}</span>}
            {schedules.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                {schedules.map((schedule) => formatShortDate(schedule.scheduled_on)).join("、")}
              </span>
            )}
          </div>
        </button>

        <div className="flex flex-none items-center gap-1">
          {scheduledOnSelected ? (
            <button
              type="button"
              onClick={() => {
                const schedule = schedules.find((itemSchedule) => itemSchedule.scheduled_on === selectedDate);
                if (schedule) onRemoveSchedule(schedule.id);
              }}
              className="grid h-10 w-10 place-items-center rounded-xl bg-sage/18 text-sage hover:bg-sage/24 focus-ring"
              aria-label="取消所选日期安排"
            >
              <Check className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={onSchedule} className="grid h-10 w-10 place-items-center rounded-xl text-rose-deep hover:bg-rose/10 focus-ring" aria-label="安排到所选日期">
              <Plus className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onArchive} className="grid h-10 w-10 place-items-center rounded-xl text-ink-muted hover:bg-ink/5 hover:text-rose-deep focus-ring" aria-label="收起项目">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "resolved") return <span className="rounded-full bg-sage/18 px-2 py-0.5 font-sc text-[11px] text-ink-soft">已解析</span>;
  if (status === "failed") return <span className="rounded-full bg-red-100 px-2 py-0.5 font-sc text-[11px] text-red-700">解析失败</span>;
  return <span className="rounded-full bg-peach/18 px-2 py-0.5 font-sc text-[11px] text-ink-muted">解析中</span>;
}

function QuickAddBar({
  view,
  selectedDate,
  onCreated,
  onFoodIntent,
}: {
  view: TodoView;
  selectedDate: string;
  onCreated: (item: TodoItemOut) => void;
  onFoodIntent: () => void;
}) {
  const [title, setTitle] = useState("");
  const category: TodoCategory = view === "food" ? "food" : "play";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next) return;
    if (category === "food") {
      toast.message("餐厅请先用上方搜索添加，这样可以保存地址和人均");
      onFoodIntent();
      return;
    }
    const item = await api.createTodoItem({ category: "play", title: next });
    setTitle("");
    toast.success(view === "today" || view === "planned" ? `已添加，准备安排到 ${formatShortDate(selectedDate)}` : "已添加到玩乐清单");
    await onCreated(item);
  }

  return (
    <form onSubmit={submit} className="border-t border-line/60 bg-surface/92 p-3 sm:p-4">
      <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-line/70 bg-surface-raised/90 px-3 focus-within:border-rose/60 focus-within:shadow-[0_0_0_4px_rgb(var(--focus)/0.14)]">
        <Plus className="h-4 w-4 text-rose-deep" />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={view === "food" ? "搜索餐厅后添加" : "添加任务"}
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent font-sc text-sm outline-none placeholder:text-ink-muted/82"
        />
        <button type="submit" disabled={!title.trim()} className="rounded-xl bg-rose px-3 py-2 font-sc text-sm text-white disabled:opacity-45 focus-ring">
          添加
        </button>
      </div>
    </form>
  );
}

function RestaurantCreator({ onCreated }: { onCreated: () => void }) {
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<TodoRestaurantCandidate[]>([]);
  const [selected, setSelected] = useState<TodoRestaurantCandidate | null>(null);
  const [signature, setSignature] = useState("");
  const [perCapita, setPerCapita] = useState("");

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
    await api.createTodoRestaurant({
      candidate: selected,
      signature_dishes: signature.trim() || null,
      per_capita: perCapita ? Number(perCapita) : null,
    });
    setKeyword("");
    setCity("");
    setCandidates([]);
    setSelected(null);
    setSignature("");
    setPerCapita("");
    toast.success("餐厅已添加");
    onCreated();
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
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-line/58 bg-surface/78 p-3">
            <p className="font-display text-sm font-semibold text-ink">{selected?.name ?? "选择一家餐厅"}</p>
            <div className="mt-3 grid gap-2">
              <input className="input-field rounded-xl text-sm" value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="招牌菜，可选" maxLength={1000} />
              <input className="input-field rounded-xl text-sm" type="number" min={0} value={perCapita} onChange={(event) => setPerCapita(event.target.value)} placeholder="人均，可选" />
              <button type="button" onClick={create} disabled={!selected} className="btn-primary min-h-11 rounded-xl px-4 font-sc text-sm disabled:opacity-50 focus-ring">
                添加餐厅
              </button>
            </div>
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
  selectedDate,
  onClose,
  onChanged,
  onSchedule,
  onRemoveSchedule,
  onArchive,
}: {
  itemId: number;
  item: TodoItemOut | null;
  schedules: TodoScheduleOut[];
  selectedDate: string;
  onClose: () => void;
  onChanged: () => void;
  onSchedule: (id: number, date?: string) => void;
  onRemoveSchedule: (id: number) => void;
  onArchive: (id: number) => void;
}) {
  const [detail, setDetail] = useState<TodoItemDetail | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDetail(null);
    void api.getTodoItem(itemId).then(setDetail);
  }, [itemId]);

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    const text = comment.trim();
    if (!text) return;
    setSaving(true);
    try {
      await api.postTodoComment(itemId, text);
      setComment("");
      setDetail(await api.getTodoItem(itemId));
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(file: File | null) {
    if (!file) return;
    await api.postTodoImage(itemId, file);
    setDetail(await api.getTodoItem(itemId));
    onChanged();
  }

  const current = detail ?? item;
  const scheduledOnSelected = schedules.find((schedule) => schedule.scheduled_on === selectedDate);

  return (
    <>
      <motion.button
        type="button"
        className="fixed inset-0 z-50 bg-ink/30 lg:hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        aria-label="关闭任务详情"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: 36, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 36, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[86dvh] flex-col overflow-hidden rounded-t-[1.35rem] border border-line/70 bg-surface text-ink shadow-[0_-24px_52px_-36px_rgb(var(--ink)/0.55)] lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:h-dvh lg:w-[380px] lg:max-h-none lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-[-18px_0_42px_-34px_rgb(var(--ink)/0.5)]"
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
                <div className="flex flex-wrap gap-2">
                  {schedules.map((schedule) => (
                    <button key={schedule.id} type="button" onClick={() => onRemoveSchedule(schedule.id)} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-peach/18 px-3 font-sc text-xs text-rose-deep focus-ring">
                      {formatShortDate(schedule.scheduled_on)}
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => (scheduledOnSelected ? onRemoveSchedule(scheduledOnSelected.id) : onSchedule(itemId, selectedDate))}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full bg-rose/10 px-3 font-sc text-xs text-rose-deep focus-ring"
                  >
                    {scheduledOnSelected ? "取消所选日期" : `安排到 ${formatShortDate(selectedDate)}`}
                  </button>
                </div>
              </section>

              <section>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">双方评论</h3>
                {detail.comments.length === 0 ? (
                  <p className="rounded-xl bg-peach/14 p-4 font-sc text-sm text-ink-muted">还没有评论，写一句就算完成一次打卡。</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.comments.map((item) => (
                      <li key={item.id} className="rounded-xl bg-peach/14 p-4">
                        <p className="whitespace-pre-wrap break-words font-sc text-sm text-ink">{item.text}</p>
                        <p className="mt-2 font-sc text-[11px] text-ink-muted">{formatRelative(item.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">照片</h3>
                {detail.images.length === 0 ? (
                  <p className="rounded-xl bg-peach/14 p-4 font-sc text-sm text-ink-muted">还没有照片。</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {detail.images.map((image) => (
                      <TodoImageThumb key={image.id} image={image} />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <footer className="border-t border-line/60 p-4">
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
