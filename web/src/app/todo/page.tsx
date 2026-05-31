"use client";

// Pair-shared todo board for food/play plans with date scheduling, AMap restaurant parsing, lottery, and check-in details.

import Link from "next/link";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  MapPin,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Utensils,
  X,
  Music2,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { TimelineHeader } from "@/components/timeline-header";
import { TodoLotteryScene } from "@/components/todo-lottery-scene";
import { api, fetchTodoImageBlob } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import type {
  TodoCategory,
  TodoDashboardOut,
  TodoImageOut,
  TodoItemDetail,
  TodoItemOut,
  TodoRestaurantCandidate,
} from "@/lib/types";

function toDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthKey(date: Date): string {
  return toDateOnly(date).slice(0, 7);
}

function monthLabel(month: string): string {
  const [year, rawMonth] = month.split("-");
  return `${year} 年 ${Number(rawMonth)} 月`;
}

function daysInMonth(month: string): string[] {
  const [year, rawMonth] = month.split("-").map(Number);
  const total = new Date(year, rawMonth, 0).getDate();
  return Array.from({ length: total }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function shiftMonth(month: string, delta: number): string {
  const [year, rawMonth] = month.split("-").map(Number);
  return monthKey(new Date(year, rawMonth - 1 + delta, 1));
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
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<TodoCategory, boolean>>({ food: true, play: true });
  const [detailId, setDetailId] = useState<number | null>(null);

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
      setDashboard(await api.getTodoDashboard(month));
    } catch {
      setDashboard({ month, items: [], schedules: [] });
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => dashboard?.items ?? [], [dashboard]);
  const schedules = useMemo(() => dashboard?.schedules ?? [], [dashboard]);
  const scheduledDateSet = useMemo(() => new Set(schedules.map((schedule) => schedule.scheduled_on)), [schedules]);
  const selectedSchedules = schedules.filter((schedule) => schedule.scheduled_on === selectedDate);
  const selectedItemIds = new Set(selectedSchedules.map((schedule) => schedule.item_id));
  const foodItems = items.filter((item) => item.category === "food");
  const playItems = items.filter((item) => item.category === "play");

  async function scheduleItem(itemId: number) {
    await api.scheduleTodoItem(itemId, selectedDate);
    toast.success("已安排到日期看板");
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
    await load();
  }

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader
        title="todo 看板"
        back={{ href: "/timeline", label: "返回首页" }}
        rightSlot={
          <Link
            href="/timeline"
            className="h-10 w-10 grid place-items-center rounded-full hover:bg-ink/5 focus-ring text-ink-soft"
            aria-label="返回首页"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        }
      />

      <main className="mx-auto max-w-5xl px-5 pb-[calc(env(safe-area-inset-bottom,0px)+4rem)] pt-5 sm:px-6">
        <section className="mb-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl leading-tight text-ink">想一起做的事</h1>
              <p className="mt-1 font-sc text-sm text-ink-soft">把吃饭和玩乐安排到具体日期，完成后用评论和照片打卡。</p>
            </div>
            {loading && <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />}
          </div>
          <DateBoard
            month={month}
            selectedDate={selectedDate}
            scheduledDateSet={scheduledDateSet}
            onPrev={() => setMonth((value) => shiftMonth(value, -1))}
            onNext={() => setMonth((value) => shiftMonth(value, 1))}
            onPick={(date) => {
              setSelectedDate(date);
              if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
            }}
          />
        </section>

        <section className="mb-5 rounded-3xl bg-surface-raised/70 p-4 hairline">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-rose-deep" />
            <h2 className="font-display text-xl text-ink">{selectedDate} 的安排</h2>
          </div>
          {selectedSchedules.length === 0 ? (
            <p className="font-sc text-sm text-ink-muted">点下面项目右侧的添加按钮，就能安排到这一天。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedSchedules.map((schedule) => {
                const item = items.find((candidate) => candidate.id === schedule.item_id);
                if (!item) return null;
                return (
                  <button
                    key={schedule.id}
                    type="button"
                    onClick={() => removeSchedule(schedule.id)}
                    className="pill inline-flex min-h-10 items-center gap-1.5 bg-rose/10 text-rose-deep focus-ring"
                    aria-label={`移除 ${item.title}`}
                  >
                    {item.category === "food" ? <Utensils className="h-3.5 w-3.5" /> : <Music2 className="h-3.5 w-3.5" />}
                    {item.title}
                    <X className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <TodoSection
              category="food"
              title="吃饭打卡"
              icon={<Utensils className="h-5 w-5" />}
              expanded={expanded.food}
              items={foodItems}
              selectedItemIds={selectedItemIds}
              onToggle={() => setExpanded((value) => ({ ...value, food: !value.food }))}
              onSchedule={scheduleItem}
              onOpen={setDetailId}
              onArchive={archiveItem}
              extra={<RestaurantCreator onCreated={load} />}
            />
            <TodoSection
              category="play"
              title="想一起玩的事情"
              icon={<Music2 className="h-5 w-5" />}
              expanded={expanded.play}
              items={playItems}
              selectedItemIds={selectedItemIds}
              onToggle={() => setExpanded((value) => ({ ...value, play: !value.play }))}
              onSchedule={scheduleItem}
              onOpen={setDetailId}
              onArchive={archiveItem}
              extra={<PlayCreator onCreated={load} />}
            />
          </div>
          <RestaurantLottery onCreated={load} onOpen={setDetailId} />
        </div>
      </main>

      <AnimatePresence>
        {detailId && (
          <TodoDetailPanel
            itemId={detailId}
            onClose={() => setDetailId(null)}
            onChanged={load}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function DateBoard({
  month,
  selectedDate,
  scheduledDateSet,
  onPrev,
  onNext,
  onPick,
}: {
  month: string;
  selectedDate: string;
  scheduledDateSet: Set<string>;
  onPrev: () => void;
  onNext: () => void;
  onPick: (date: string) => void;
}) {
  return (
    <div className="glass-card rounded-3xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={onPrev} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/60 focus-ring" aria-label="上个月">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="font-display text-2xl text-ink">{monthLabel(month)}</h2>
        <button type="button" onClick={onNext} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/60 focus-ring" aria-label="下个月">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {daysInMonth(month).map((date) => {
          const day = Number(date.slice(-2));
          const hasSchedule = scheduledDateSet.has(date);
          const selected = selectedDate === date;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onPick(date)}
              className={cn(
                "relative grid aspect-square min-h-11 place-items-center rounded-2xl font-sc text-sm transition focus-ring",
                selected ? "bg-rose text-white shadow-soft" : "bg-surface-raised/70 text-ink hover:bg-white/90",
                hasSchedule && !selected ? "ring-2 ring-rose/35 text-rose-deep" : "",
              )}
            >
              {day}
              {hasSchedule && <span className={cn("absolute bottom-1.5 h-1.5 w-1.5 rounded-full", selected ? "bg-white" : "bg-rose")} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TodoSection({
  category,
  title,
  icon,
  expanded,
  items,
  selectedItemIds,
  onToggle,
  onSchedule,
  onOpen,
  onArchive,
  extra,
}: {
  category: TodoCategory;
  title: string;
  icon: ReactNode;
  expanded: boolean;
  items: TodoItemOut[];
  selectedItemIds: Set<number>;
  onToggle: () => void;
  onSchedule: (id: number) => void;
  onOpen: (id: number) => void;
  onArchive: (id: number) => void;
  extra: ReactNode;
}) {
  return (
    <section className="glass-card overflow-hidden rounded-3xl">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[64px] w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/45 focus-ring"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-rose/12 text-rose-deep">{icon}</span>
          <span>
            <span className="block font-display text-xl text-ink">{title}</span>
            <span className="font-sc text-xs text-ink-muted">{items.length} 个项目</span>
          </span>
        </span>
        <ChevronDown className={cn("h-5 w-5 transition", expanded ? "rotate-180" : "")} />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-line/60 p-4">
          {extra}
          {items.length === 0 ? (
            <p className="rounded-2xl bg-surface-raised/55 p-4 font-sc text-sm text-ink-muted">
              {category === "food" ? "还没有餐厅，先搜索一家想吃的。" : "还没有想玩的项目。"}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id}>
                  <TodoItemCard
                    item={item}
                    scheduled={selectedItemIds.has(item.id)}
                    onSchedule={() => onSchedule(item.id)}
                    onOpen={() => onOpen(item.id)}
                    onArchive={() => onArchive(item.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function TodoItemCard({
  item,
  scheduled,
  onSchedule,
  onOpen,
  onArchive,
}: {
  item: TodoItemOut;
  scheduled: boolean;
  onSchedule: () => void;
  onOpen: () => void;
  onArchive: () => void;
}) {
  const restaurant = item.restaurant;
  return (
    <article className="rounded-2xl bg-surface-raised/70 p-4 hairline">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left focus-ring rounded-xl">
          <h3 className="font-display text-lg leading-tight text-ink">{item.title}</h3>
          {restaurant ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusPill status={restaurant.parse_status} />
              {restaurant.per_capita != null && <span className="pill bg-cream-deep/70 text-ink-soft">人均 {restaurant.per_capita}</span>}
              {item.checked_in && <span className="pill bg-sage/20 text-ink-soft">已打卡</span>}
            </div>
          ) : item.note ? (
            <p className="mt-1 line-clamp-2 font-sc text-sm text-ink-soft">{item.note}</p>
          ) : null}
        </button>
        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            onClick={onSchedule}
            disabled={scheduled}
            className="grid h-11 w-11 place-items-center rounded-full bg-rose text-white transition disabled:bg-sage disabled:text-white focus-ring"
            aria-label={scheduled ? "已安排到所选日期" : "安排到所选日期"}
          >
            {scheduled ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onArchive} className="grid h-11 w-11 place-items-center rounded-full text-ink-muted hover:bg-white/70 hover:text-rose-deep focus-ring" aria-label="删除项目">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {restaurant?.address && (
        <p className="mt-3 flex items-center gap-1.5 font-sc text-xs text-ink-muted">
          <MapPin className="h-3.5 w-3.5" />
          {restaurant.address}
        </p>
      )}
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "resolved") return <span className="pill bg-sage/20 text-ink-soft">已完成解析</span>;
  if (status === "failed") return <span className="pill bg-red-100 text-red-700">解析失败</span>;
  return <span className="pill bg-cream-deep/70 text-ink-muted">解析中</span>;
}

function PlayCreator({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next) return;
    await api.createTodoItem({ category: "play", title: next });
    setTitle("");
    toast.success("已添加想玩的事情");
    onCreated();
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input className="input-field min-w-0 flex-1" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="添加想一起玩的项目" maxLength={200} />
      <button type="submit" disabled={!title.trim()} className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-rose text-white disabled:opacity-50 focus-ring" aria-label="添加">
        <Plus className="h-4 w-4" />
      </button>
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
    <div className="rounded-2xl bg-surface-raised/60 p-3 hairline">
      <form onSubmit={search} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_48px]">
        <input className="input-field" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索餐厅名或关键词" maxLength={100} />
        <input className="input-field" value={city} onChange={(event) => setCity(event.target.value)} placeholder="城市" maxLength={100} />
        <button type="submit" disabled={searching || !keyword.trim()} className="grid h-12 w-full place-items-center rounded-2xl bg-rose text-white disabled:opacity-50 focus-ring" aria-label="搜索餐厅">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </form>
      {candidates.length > 0 && (
        <div className="mt-3 space-y-2">
          {candidates.slice(0, 6).map((candidate, index) => (
            <button
              type="button"
              key={`${candidate.amap_poi_id || candidate.name}-${index}`}
              onClick={() => setSelected(candidate)}
              className={cn("w-full rounded-2xl p-3 text-left font-sc transition hairline focus-ring", selected === candidate ? "bg-rose/10 text-rose-deep" : "bg-white/55 text-ink-soft hover:bg-white/80")}
            >
              <span className="block font-medium text-ink">{candidate.name}</span>
              <span className="mt-1 block text-xs">{candidate.address || candidate.city || "暂无地址"}</span>
            </button>
          ))}
          {selected && (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_96px]">
              <input className="input-field" value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="招牌菜" maxLength={1000} />
              <input className="input-field" type="number" min={0} value={perCapita} onChange={(event) => setPerCapita(event.target.value)} placeholder="人均" />
              <button type="button" onClick={create} className="btn-primary min-h-12 rounded-2xl px-4 font-sc text-sm focus-ring">添加</button>
            </div>
          )}
        </div>
      )}
    </div>
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
    <aside className="glass-card h-fit rounded-3xl p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Shuffle className="h-5 w-5 text-rose-deep" />
        <h2 className="font-display text-xl text-ink">随机抽奖</h2>
      </div>
      <TodoLotteryScene spinning={drawing} />
      <div className="mt-4 space-y-3">
        <SegmentedBudget value={budget} onChange={setBudget} />
        <div className="grid grid-cols-2 gap-2">
          {[1, 3, 5, 10].map((value) => (
            <button key={value} type="button" onClick={() => locate(value)} className={cn("btn-ghost min-h-11 rounded-2xl px-3 font-sc text-sm focus-ring", radius === value && "bg-rose/10 text-rose-deep")}>
              附近 {value}km
            </button>
          ))}
        </div>
        <input className="input-field" value={city} onChange={(event) => setCity(event.target.value)} placeholder="城市/区域，可选" maxLength={100} />
        <button type="button" onClick={draw} disabled={drawing} className="btn-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-sc text-sm focus-ring">
          {drawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
          开始抽
        </button>
        {winner && (
          <button type="button" onClick={() => onOpen(winner.id)} className="w-full rounded-2xl bg-surface-raised/75 p-4 text-left hairline focus-ring">
            <span className="font-display text-lg text-ink">{winner.title}</span>
            <span className="mt-1 block font-sc text-xs text-ink-muted">点开查看详情</span>
          </button>
        )}
        {candidate && (
          <div className="rounded-2xl bg-surface-raised/75 p-4 hairline">
            <p className="font-display text-lg text-ink">{candidate.name}</p>
            <p className="mt-1 font-sc text-xs text-ink-muted">{candidate.address || candidate.city}</p>
            <button type="button" onClick={saveCandidate} className="btn-primary mt-3 min-h-11 rounded-2xl px-4 font-sc text-sm focus-ring">保存这家</button>
          </div>
        )}
      </div>
    </aside>
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
          <button key={label} type="button" onClick={() => onChange(option)} className={cn("btn-ghost min-h-11 rounded-2xl px-3 font-sc text-sm focus-ring", selected && "bg-rose/10 text-rose-deep")}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function TodoDetailPanel({ itemId, onClose, onChanged }: { itemId: number; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<TodoItemDetail | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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

  return (
    <motion.div className="fixed inset-0 z-50 bg-black/40 px-4 py-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        className="mx-auto flex max-h-[calc(100dvh-3rem)] max-w-2xl flex-col overflow-hidden rounded-3xl bg-surface text-ink shadow-glow"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line/60 p-5">
          <div className="min-w-0">
            <h2 className="font-display text-2xl leading-tight text-ink">{detail?.title ?? "正在读取"}</h2>
            {detail?.restaurant?.signature_dishes && <p className="mt-1 font-sc text-sm text-ink-soft">招牌菜：{detail.restaurant.signature_dishes}</p>}
            {detail?.restaurant?.address && <p className="mt-1 font-sc text-xs text-ink-muted">{detail.restaurant.address}</p>}
          </div>
          <button type="button" onClick={onClose} className="grid h-11 w-11 flex-none place-items-center rounded-full hover:bg-ink/5 focus-ring" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!detail ? (
            <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></div>
          ) : (
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">双方评论</h3>
                {detail.comments.length === 0 ? (
                  <p className="rounded-2xl bg-cream-deep/45 p-4 font-sc text-sm text-ink-muted">还没有评论，写一句就算完成一次打卡。</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.comments.map((item) => (
                      <li key={item.id} className="rounded-2xl bg-cream-deep/45 p-4">
                        <p className="whitespace-pre-wrap break-words font-sc text-sm text-ink">{item.text}</p>
                        <p className="mt-2 font-sc text-[11px] text-ink-muted">{formatRelative(item.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">照片</h3>
                {detail.images.length === 0 ? (
                  <p className="rounded-2xl bg-cream-deep/45 p-4 font-sc text-sm text-ink-muted">还没有照片。</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {detail.images.map((image) => <TodoImageThumb key={image.id} image={image} />)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <footer className="border-t border-line/60 p-4">
          <form onSubmit={submitComment} className="mb-3 flex gap-2">
            <input className="input-field min-w-0 flex-1" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写评论打卡" maxLength={2000} />
            <button type="submit" disabled={saving || !comment.trim()} className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-rose text-white disabled:opacity-50 focus-ring" aria-label="发送评论">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
          </form>
          <label className="btn-ghost inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring">
            <ImagePlus className="h-4 w-4" />
            上传照片
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => uploadImage(event.target.files?.[0] ?? null)} />
          </label>
        </footer>
      </motion.section>
    </motion.div>
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
    <img src={src} alt="打卡照片" className="aspect-square w-full rounded-2xl object-cover" />
  ) : (
    <div className="aspect-square w-full rounded-2xl bg-line/40" />
  );
}
