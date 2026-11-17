"use client";

// 约会计划（/todo，底栏“约会”）：顶部是下一次见面（标题点开共享编辑、日期、倒计时、准备进度，多次见面可切换，“再定一次”新建，新建后后端发邮件请 TA 一起排）。
// 主体参考 Notion 日历：MeetingDayPlanner 把见面的每一天排成时间网格，点空白格就地加一件事，拖动卡片换时间；右侧是“还没排时间”的吃/玩/住、
// “出发前要准备”清单、上次没赶上的事（可一键放进这次见面）和“一起做过的”（可写进手账）。分类只有吃 / 玩 / 住 / 准备。
// 详情面板（手机底部弹窗盖住底边栏，桌面右侧抽屉）可改标题、分类、所属见面、哪一天几点、描述，写留言、传照片。
// 每 8 秒后台刷新：页面隐藏时跳过、失败保留上次数据并只提示一次，用请求序号丢弃过期响应；?meeting=ID（邮件链接）直接打开那次见面。

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Backpack,
  BedDouble,
  BookHeart,
  CalendarClock,
  CalendarHeart,
  Check,
  ChevronRight,
  CloudOff,
  ImageIcon,
  ImagePlus,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Ticket,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { MeetingDayPlanner } from "@/components/meeting-day-planner";
import type { SlotDraft } from "@/components/meeting-day-planner";
import { MeetingEditorDialog } from "@/components/meeting-editor-dialog";
import { MotionCollapse } from "@/components/ui/motion-collapse";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { shanghaiDateKey } from "@/lib/dates";
import { formatRelative } from "@/lib/format";
import { DEFAULT_DURATION, meetingDays, minuteLabel, parseMinute } from "@/lib/meeting-plan";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import { PAGE_MAIN_WIDTH_CLASS } from "@/lib/page-width";
import { useAppStore } from "@/lib/store";
import { useAuthedBlobUrl } from "@/lib/use-authed-blob-url";
import type { TodoCategory, TodoImageOut, TodoItemDetail, TodoItemOut, TodoMeetingOut, TodoPlanOut } from "@/lib/types";

const CATEGORY_META: Record<TodoCategory, { label: string; icon: ReactNode; tone: string }> = {
  food: { label: "吃", icon: <Utensils className="h-4 w-4" />, tone: "bg-peach/34 text-peach-deep" },
  play: { label: "玩", icon: <Ticket className="h-4 w-4" />, tone: "bg-rose/20 text-rose-deep" },
  stay: { label: "住", icon: <BedDouble className="h-4 w-4" />, tone: "bg-sage/24 text-ink-soft" },
  prep: { label: "准备", icon: <Backpack className="h-4 w-4" />, tone: "bg-line/40 text-ink-soft" },
};
const CATEGORY_ORDER: TodoCategory[] = ["food", "play", "stay", "prep"];
const PREP_IDEAS = ["订车票", "带充电宝", "带身份证", "订住的地方"];
const TRAY_IDEAS: Array<{ title: string; category: TodoCategory }> = [
  { title: "唱歌", category: "play" },
  { title: "看电影", category: "play" },
  { title: "拼乐高", category: "play" },
  { title: "一起做顿饭", category: "food" },
];
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function shortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${m}月${d}日 ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}

function formatRange(meeting: TodoMeetingOut): string {
  if (meeting.started_on === meeting.ended_on) return shortDay(meeting.started_on);
  return `${shortDay(meeting.started_on)} – ${shortDay(meeting.ended_on)}`;
}

function countdown(meeting: TodoMeetingOut, today: string): { big: string; small: string } {
  const toStart = dayNumber(meeting.started_on) - dayNumber(today);
  const length = dayNumber(meeting.ended_on) - dayNumber(meeting.started_on) + 1;
  if (toStart > 1) return { big: `${toStart}`, small: length > 1 ? `天后见面 · 一起 ${length} 天` : "天后见面" };
  if (toStart === 1) return { big: "明天", small: "就要见面啦" };
  if (dayNumber(today) <= dayNumber(meeting.ended_on)) {
    const day = dayNumber(today) - dayNumber(meeting.started_on) + 1;
    return { big: "今天", small: length > 1 ? `正在见面 · 第 ${day} 天` : "就是今天" };
  }
  return { big: "已结束", small: "这次见面过去啦" };
}

function defaultMeetingDates(today: string): { title: string; started_on: string; ended_on: string } {
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const toSaturday = (6 - base.getUTCDay() + 7) % 7 || 7;
  const start = new Date(base.getTime() + toSaturday * 86_400_000);
  const end = new Date(start.getTime() + 86_400_000);
  const key = (date: Date) => date.toISOString().slice(0, 10);
  return { title: "下一次见面", started_on: key(start), ended_on: key(end) };
}

function isPlaced(item: TodoItemOut, meeting: TodoMeetingOut): boolean {
  return Boolean(item.scheduled_on && item.scheduled_on >= meeting.started_on && item.scheduled_on <= meeting.ended_on);
}

export default function TodoPage() {
  return (
    <AuthGate>
      <TodoInner />
    </AuthGate>
  );
}

function TodoInner() {
  const router = useRouter();
  const me = useAppStore((state) => state.me);
  const today = shanghaiDateKey();
  const [plan, setPlan] = useState<TodoPlanOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const fromUrl = Number(new URLSearchParams(window.location.search).get("meeting"));
    return Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : null;
  });
  const [detailId, setDetailId] = useState<number | null>(null);
  const [meetingDialog, setMeetingDialog] = useState<"create" | "edit" | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set());
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const requestSeqRef = useRef(0);
  const inFlightSeqRef = useRef(0);
  const failureNotifiedRef = useRef(false);

  const names = useMemo(() => {
    const map = new Map<number, string>();
    if (me) {
      map.set(me.user.id, "我");
      map.set(me.counterpart.id, me.counterpart.display_name || "TA");
    }
    return map;
  }, [me]);

  const load = useCallback(async (mode: "foreground" | "background" = "foreground") => {
    if (mode === "background" && (inFlightSeqRef.current !== 0 || document.hidden)) return;
    const seq = ++requestSeqRef.current;
    inFlightSeqRef.current = seq;
    try {
      const next = await api.getTodoPlan({ silent: true });
      if (seq !== requestSeqRef.current) return;
      setPlan(next);
      setLoadFailed(false);
      failureNotifiedRef.current = false;
    } catch {
      if (seq !== requestSeqRef.current) return;
      setLoadFailed(true);
      if (!failureNotifiedRef.current) {
        failureNotifiedRef.current = true;
        toast.error("计划暂时没同步上，稍后会自动再试");
      }
    } finally {
      if (inFlightSeqRef.current === seq) inFlightSeqRef.current = 0;
      if (mode === "foreground") setLoading(false);
    }
  }, []);

  const markLocalChange = useCallback(() => {
    requestSeqRef.current += 1;
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load("background"), 8000);
    const onVisibilityChange = () => {
      if (!document.hidden) void load("background");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  useEffect(() => {
    if (highlightId == null) return;
    const timer = window.setTimeout(() => setHighlightId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const items = useMemo(() => plan?.items ?? [], [plan]);
  const meetingsById = useMemo(() => new Map((plan?.meetings ?? []).map((meeting) => [meeting.id, meeting])), [plan]);
  const upcomingMeetings = useMemo(() => (plan?.meetings ?? []).filter((meeting) => meeting.ended_on >= today), [plan, today]);
  const meeting =
    (selectedMeetingId != null ? upcomingMeetings.find((entry) => entry.id === selectedMeetingId) : undefined) ??
    (plan?.focus_meeting_id != null ? meetingsById.get(plan.focus_meeting_id) : undefined) ??
    null;

  const meetingItems = useMemo(
    () => (meeting ? items.filter((item) => item.meeting_session_id === meeting.id) : []),
    [items, meeting],
  );
  const meetingDone = meetingItems.filter((item) => item.completed_at);
  const tray = useMemo(
    () => (meeting ? meetingItems.filter((item) => item.category !== "prep" && !isPlaced(item, meeting)) : []),
    [meeting, meetingItems],
  );
  const prepItems = useMemo(
    () => (meeting ? meetingItems.filter((item) => item.category === "prep" && !isPlaced(item, meeting)) : []),
    [meeting, meetingItems],
  );
  const leftovers = useMemo(
    () =>
      items
        .filter((item) => {
          if (item.completed_at) return false;
          if (item.meeting_session_id == null) return true;
          const owner = meetingsById.get(item.meeting_session_id);
          return !owner || owner.ended_on < today;
        })
        .sort((left, right) => right.created_at.localeCompare(left.created_at)),
    [items, meetingsById, today],
  );
  const history = useMemo(
    () =>
      items
        .filter((item) => item.completed_at && (!meeting || item.meeting_session_id !== meeting.id))
        .sort((left, right) => (right.completed_at ?? "").localeCompare(left.completed_at ?? "")),
    [items, meeting],
  );
  const detailItem = detailId != null ? items.find((item) => item.id === detailId) ?? null : null;

  function replaceItem(next: TodoItemOut) {
    setPlan((current) => (current ? { ...current, items: current.items.map((item) => (item.id === next.id ? next : item)) } : current));
  }

  function setBusy(id: number, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function addItem(title: string, category: TodoCategory, slot?: SlotDraft): Promise<boolean> {
    if (!meeting) return false;
    try {
      const created = await api.createTodoItem({
        title,
        category,
        meeting_session_id: meeting.id,
        ...(slot ? { scheduled_on: slot.day, start_minute: slot.start, end_minute: slot.end } : {}),
      });
      markLocalChange();
      setPlan((current) => (current ? { ...current, items: [...current.items, created] } : current));
      setHighlightId(created.id);
      return true;
    } catch {
      return false;
    }
  }

  async function reschedule(item: TodoItemOut, slot: SlotDraft) {
    markLocalChange();
    replaceItem({ ...item, scheduled_on: slot.day, start_minute: slot.start, end_minute: slot.end });
    try {
      const next = await api.updateTodoItem(item.id, { scheduled_on: slot.day, start_minute: slot.start, end_minute: slot.end });
      markLocalChange();
      replaceItem(next);
    } catch {
      replaceItem(item);
    }
  }

  async function toggleComplete(item: TodoItemOut) {
    if (busyIds.has(item.id)) return;
    const completing = !item.completed_at;
    markLocalChange();
    replaceItem({ ...item, completed_at: completing ? new Date().toISOString() : null, completed_by_id: completing ? me?.user.id ?? null : null });
    setBusy(item.id, true);
    try {
      const next = await api.updateTodoItem(item.id, { completed: completing });
      markLocalChange();
      replaceItem(next);
      if (completing && meeting && item.meeting_session_id === meeting.id && meetingDone.length + 1 === meetingItems.length) {
        toast.success("这次见面想做的都做到啦");
      }
    } catch {
      replaceItem(item);
    } finally {
      setBusy(item.id, false);
    }
  }

  async function moveItem(item: TodoItemOut, meetingId: number | null) {
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    try {
      const next = await api.updateTodoItem(item.id, { meeting_session_id: meetingId });
      markLocalChange();
      replaceItem(next);
      setHighlightId(item.id);
      const target = meetingId != null ? meetingsById.get(meetingId) : null;
      toast.success(target ? `放进「${target.title}」啦` : "先从见面里拿出来了");
    } catch {
      return;
    } finally {
      setBusy(item.id, false);
    }
  }

  async function writeJournal(item: TodoItemOut) {
    if (item.journal_event_id) {
      router.push(`/timeline/${item.journal_event_id}`);
      return;
    }
    if (busyIds.has(item.id)) return;
    setBusy(item.id, true);
    try {
      const result = await api.writeTodoIntoJournal(item.id);
      markLocalChange();
      replaceItem({ ...item, journal_event_id: result.event_id });
      toast.success(result.created ? "写进手账啦" : "这件事已经在手账里了");
      router.push(`/timeline/${result.event_id}`);
    } catch {
      setBusy(item.id, false);
    }
  }

  const rowProps = (item: TodoItemOut) => ({
    item,
    busy: busyIds.has(item.id),
    highlighted: highlightId === item.id,
    onToggle: () => void toggleComplete(item),
    onOpen: () => setDetailId(item.id),
  });

  return (
    <div className="viewport-guard min-h-dvh pb-[calc(env(safe-area-inset-bottom,0px)+9rem)] text-ink">
      <AppHeader title="约会计划" subtitle="定好日子，一起排每一天" />

      <main className={cn("mx-auto w-full min-w-0 px-4 pt-4 sm:px-6 sm:pt-5", PAGE_MAIN_WIDTH_CLASS["7xl"])}>
        {loading && !plan ? (
          <PlanSkeleton />
        ) : !plan ? (
          <LoadFailed onRetry={() => void load()} />
        ) : (
          <>
            <MeetingHero
              meeting={meeting}
              upcoming={upcomingMeetings}
              today={today}
              total={meetingItems.length}
              done={meetingDone.length}
              onSelect={setSelectedMeetingId}
              onCreate={() => setMeetingDialog("create")}
              onEdit={() => setMeetingDialog("edit")}
            />
            {loadFailed && <p className="mt-3 px-1 font-sc text-xs text-ink-muted">暂时没连上，显示的是上次同步的计划。</p>}

            <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
              {meeting ? (
                <MeetingDayPlanner
                  meeting={meeting}
                  items={meetingItems}
                  today={today}
                  highlightId={highlightId}
                  onOpen={setDetailId}
                  onToggle={(item) => void toggleComplete(item)}
                  onCreate={addItem}
                  onReschedule={reschedule}
                />
              ) : (
                <NoMeetingYet onCreate={() => setMeetingDialog("create")} />
              )}

              <div className="min-w-0 space-y-4">
                {meeting && (
                  <PlanSection
                    id="plan-tray"
                    title="还没排时间"
                    hint="先记下想吃想玩的，再挑个时间排进去"
                    count={tray.length}
                  >
                    <QuickAdd
                      key={`tray-${meeting.id}`}
                      categories={["food", "play", "stay"]}
                      defaultCategory="play"
                      placeholder="比如：想去那家火锅"
                      onAdd={(title, category) => addItem(title, category)}
                    />
                    {tray.length === 0 ? (
                      meetingItems.length === 0 ? (
                        <IdeaChips ideas={TRAY_IDEAS} onPick={(idea) => void addItem(idea.title, idea.category)} />
                      ) : (
                        <p className="mt-3 px-1 font-sc text-xs text-ink-muted">想做的都排好时间啦。</p>
                      )
                    ) : (
                      <ul className="mt-3 space-y-2">
                        <AnimatePresence initial={false}>
                          {tray.map((item) => (
                            <ItemRow key={item.id} {...rowProps(item)} showCategory actionLabel="排时间" onAction={() => setDetailId(item.id)} />
                          ))}
                        </AnimatePresence>
                      </ul>
                    )}
                  </PlanSection>
                )}

                {meeting && (
                  <PlanSection id="plan-prep" title="出发前要准备" hint="谁做好了谁就点一下" count={prepItems.filter((item) => !item.completed_at).length}>
                    <QuickAdd
                      key={`prep-${meeting.id}`}
                      categories={["prep"]}
                      defaultCategory="prep"
                      placeholder="比如：带上充电宝"
                      onAdd={(title, category) => addItem(title, category)}
                    />
                    {prepItems.length === 0 ? (
                      <IdeaChips ideas={PREP_IDEAS.map((title) => ({ title, category: "prep" as const }))} onPick={(idea) => void addItem(idea.title, idea.category)} />
                    ) : (
                      <ul className="mt-3 space-y-2">
                        <AnimatePresence initial={false}>
                          {prepItems.map((item) => (
                            <ItemRow key={item.id} {...rowProps(item)} />
                          ))}
                        </AnimatePresence>
                      </ul>
                    )}
                  </PlanSection>
                )}

                {leftovers.length > 0 && (
                  <PlanSection id="plan-leftovers" title="上次没赶上的" hint={meeting ? "可以放进这次见面" : "定下见面后可以放进去"} count={leftovers.length}>
                    <ul className="space-y-2">
                      <AnimatePresence initial={false}>
                        {leftovers.map((item) => (
                          <ItemRow key={item.id} {...rowProps(item)} showCategory
                            actionLabel={meeting ? "放进这次" : undefined}
                            onAction={meeting ? () => void moveItem(item, meeting.id) : undefined} />
                        ))}
                      </AnimatePresence>
                    </ul>
                  </PlanSection>
                )}

                {history.length > 0 && (
                  <section className="content-surface p-2 sm:p-3">
                    <button type="button" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen}
                      className="flex min-h-12 w-full items-center justify-between rounded-2xl px-3 text-left hover:bg-peach/8 focus-ring">
                      <span>
                        <span className="block font-display text-base font-semibold text-ink">一起做过的</span>
                        <span className="block font-sc text-xs text-ink-muted">{history.length} 件，可以随时写进手账</span>
                      </span>
                      <ChevronRight className={cn("h-4 w-4 text-ink-muted transition", historyOpen && "rotate-90")} />
                    </button>
                    <MotionCollapse open={historyOpen}>
                      <ul className="space-y-2 p-2 pt-1">
                        {history.slice(0, 60).map((item) => (
                          <ItemRow key={item.id} {...rowProps(item)} highlighted={false} showCategory
                            doneBy={item.completed_by_id != null ? names.get(item.completed_by_id) : undefined}
                            onJournal={() => void writeJournal(item)} />
                        ))}
                      </ul>
                    </MotionCollapse>
                  </section>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      <AnimatePresence>
        {detailId != null && plan && (
          <TodoDetailPanel
            key={detailId}
            itemId={detailId}
            item={detailItem}
            meetings={upcomingMeetings}
            meetingsById={meetingsById}
            names={names}
            onClose={() => setDetailId(null)}
            onChanged={(next) => {
              markLocalChange();
              replaceItem(next);
            }}
            onToggle={(item) => toggleComplete(item)}
            onJournal={(item) => writeJournal(item)}
            onDeleted={(id) => {
              markLocalChange();
              setPlan((current) => (current ? { ...current, items: current.items.filter((item) => item.id !== id) } : current));
              setDetailId(null);
            }}
          />
        )}
      </AnimatePresence>

      <MeetingEditorDialog
        open={meetingDialog !== null}
        session={meetingDialog === "edit" && meeting ? { ...meeting, started_at: null, ended_at: null } : null}
        createDefaults={meetingDialog === "create" ? defaultMeetingDates(today) : undefined}
        onOpenChange={(open) => !open && setMeetingDialog(null)}
        onSaved={async (saved) => {
          setSelectedMeetingId(saved.id);
          await load();
        }}
        onDeleted={async () => {
          setSelectedMeetingId(null);
          await load();
        }}
      />
    </div>
  );
}

function PlanSection({ id, title, hint, count, children }: { id: string; title: string; hint: string; count: number; children: ReactNode }) {
  return (
    <section className="content-surface p-4" aria-labelledby={`${id}-title`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="font-display text-base font-semibold text-ink">{title}</h2>
        {count > 0 && <span className="font-sc text-xs text-ink-muted">{count} 件</span>}
      </div>
      <p className="-mt-2 mb-3 font-sc text-xs text-ink-muted">{hint}</p>
      {children}
    </section>
  );
}

function IdeaChips({ ideas, onPick }: { ideas: Array<{ title: string; category: TodoCategory }>; onPick: (idea: { title: string; category: TodoCategory }) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {ideas.map((idea) => (
        <button key={idea.title} type="button" onClick={() => onPick(idea)}
          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-line/80 px-3 font-sc text-xs text-ink-soft transition hover:border-rose/40 hover:text-rose-deep focus-ring">
          <Plus className="h-3.5 w-3.5" />{idea.title}
        </button>
      ))}
    </div>
  );
}

function NoMeetingYet({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="content-surface grid min-h-[22rem] place-items-center p-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose/10 text-rose-deep">
          <CalendarClock className="h-7 w-7" />
        </span>
        <h2 className="mt-4 font-display text-xl font-semibold text-ink">先定下见面的日子</h2>
        <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">
          定好后会发邮件告诉 TA。见面的每一天会排成一张日程表，吃什么、玩什么、住哪里，一起往里填。
        </p>
        <button type="button" onClick={onCreate} className="btn-primary mt-5 inline-flex min-h-11 items-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring">
          <CalendarHeart className="h-4 w-4" />定下一次见面
        </button>
      </div>
    </section>
  );
}

function MeetingHero({
  meeting,
  upcoming,
  today,
  total,
  done,
  onSelect,
  onCreate,
  onEdit,
}: {
  meeting: TodoMeetingOut | null;
  upcoming: TodoMeetingOut[];
  today: string;
  total: number;
  done: number;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onEdit: () => void;
}) {
  const reducedMotion = useReducedMotion();
  if (!meeting) return null;

  const { big, small } = countdown(meeting, today);
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="content-surface relative overflow-hidden px-5 py-4 sm:px-6" aria-label="下一次见面">
      <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-rose/12" aria-hidden="true" />
      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="font-sc text-xs text-ink-muted">下一次见面</p>
          <button type="button" onClick={onEdit} className="group mt-0.5 inline-flex max-w-full items-center gap-2 rounded-lg text-left focus-ring" aria-label={`编辑见面：${meeting.title}`}>
            <h2 className="truncate font-display text-xl font-semibold text-ink sm:text-2xl">{meeting.title}</h2>
            <Pencil className="h-4 w-4 flex-none text-ink-muted transition group-hover:text-rose-deep" />
          </button>
          <p className="font-sc text-sm text-ink-soft">{formatRange(meeting)}</p>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-semibold leading-none text-rose-deep sm:text-4xl">{big}</span>
          <span className="font-sc text-sm text-ink-soft">{small}</span>
        </div>
      </div>

      <div className="relative mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/45" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="准备进度">
          <motion.div
            className="h-full rounded-full bg-sage"
            initial={false}
            animate={{ width: `${percent}%` }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.emphasis}
          />
        </div>
        <span className="flex-none font-sc text-xs text-ink-muted">{total ? `做到 ${done} / ${total}` : "还没排进事情"}</span>
      </div>

      <div className="local-x-scroll relative -mx-1 mt-3 overflow-x-auto overscroll-x-contain px-1">
        <div className="flex w-max gap-2" role="group" aria-label="切换见面">
          {upcoming.length > 1 &&
            upcoming.map((entry) => (
              <button key={entry.id} type="button" onClick={() => onSelect(entry.id)} aria-pressed={entry.id === meeting.id}
                className={cn(
                  "min-h-9 rounded-full border px-3 font-sc text-xs transition focus-ring",
                  entry.id === meeting.id ? "border-rose/40 bg-rose/12 text-rose-deep" : "border-line/70 bg-surface-raised text-ink-soft hover:border-rose/30",
                )}>
                {entry.title} · {entry.started_on.slice(5).replace("-", "/")}
              </button>
            ))}
          <button type="button" onClick={onCreate} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-line/80 px-3 font-sc text-xs text-ink-soft hover:border-rose/40 hover:text-rose-deep focus-ring">
            <Plus className="h-3.5 w-3.5" />再定一次
          </button>
        </div>
      </div>
    </section>
  );
}

function QuickAdd({
  categories,
  defaultCategory,
  placeholder,
  onAdd,
  className,
}: {
  categories: TodoCategory[];
  defaultCategory: TodoCategory;
  placeholder: string;
  onAdd: (title: string, category: TodoCategory) => Promise<boolean>;
  className?: string;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TodoCategory>(defaultCategory);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text || saving) return;
    setSaving(true);
    const ok = await onAdd(text, category);
    setSaving(false);
    if (ok) setTitle("");
  }

  return (
    <form onSubmit={submit} className={cn("rounded-2xl border border-line/70 bg-surface-raised/90 p-1.5 focus-within:border-rose/50", className)}>
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          placeholder={placeholder}
          aria-label="写下一件事"
          className="min-h-10 min-w-0 flex-1 bg-transparent px-2 font-sc text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        <button type="submit" disabled={saving || !title.trim()} className="btn-primary grid h-10 w-10 flex-none place-items-center rounded-xl disabled:opacity-50 focus-ring" aria-label="加进去">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>
      {categories.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-1.5 px-1 pb-0.5" role="radiogroup" aria-label="分类">
          {categories.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={category === option} onClick={() => setCategory(option)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 font-sc text-xs transition focus-ring",
                category === option ? "bg-rose/14 text-rose-deep ring-1 ring-rose/30" : "text-ink-soft hover:bg-peach/14",
              )}>
              {CATEGORY_META[option].label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

function ItemRow({
  item,
  busy,
  highlighted,
  showCategory,
  doneBy,
  actionLabel,
  onToggle,
  onOpen,
  onAction,
  onJournal,
}: {
  item: TodoItemOut;
  busy: boolean;
  highlighted: boolean;
  showCategory?: boolean;
  doneBy?: string;
  actionLabel?: string;
  onToggle: () => void;
  onOpen: () => void;
  onAction?: () => void;
  onJournal?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const done = Boolean(item.completed_at);
  const meta = CATEGORY_META[item.category];
  return (
    <motion.li
      id={`todo-item-${item.id}`}
      layout={reducedMotion ? false : "position"}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
      className={cn(
        "relative flex items-center gap-1.5 rounded-2xl border px-1.5 py-1 transition-colors",
        done ? "border-sage/30 bg-sage/10" : "border-line/60 bg-surface-raised hover:border-rose/26",
        highlighted && "ring-2 ring-peach/70",
      )}
    >
      <button type="button" onClick={onToggle} disabled={busy} aria-pressed={done} aria-label={done ? `取消完成：${item.title}` : `完成：${item.title}`}
        className="grid h-10 w-10 flex-none place-items-center rounded-full focus-ring">
        <motion.span
          className={cn("grid h-[22px] w-[22px] place-items-center rounded-full border-2 transition-colors", done ? "border-sage bg-sage text-white" : "border-rose/45 bg-surface")}
          animate={done && !reducedMotion ? { scale: [1, 1.18, 1] } : { scale: 1 }}
          transition={MOTION_TRANSITIONS.emphasis}
        >
          {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </motion.span>
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded-lg py-1 text-left focus-ring">
        <span className={cn("block truncate font-sc text-sm", done ? "text-ink-soft line-through decoration-ink-muted/50" : "text-ink")}>{item.title}</span>
        {(showCategory || item.comments_count > 0 || item.images_count > 0 || item.note || doneBy) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-sc text-[11px] text-ink-muted">
            {showCategory && <span className={cn("rounded-full px-1.5 py-px", meta.tone)}>{meta.label}</span>}
            {doneBy && item.completed_at && <span>{doneBy} · {formatRelative(item.completed_at)}</span>}
            {item.note && <span className="max-w-[10rem] truncate">{item.note}</span>}
            {item.comments_count > 0 && <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{item.comments_count}</span>}
            {item.images_count > 0 && <span className="inline-flex items-center gap-0.5"><ImageIcon className="h-3 w-3" />{item.images_count}</span>}
          </span>
        )}
      </button>
      {onAction && actionLabel && !done && (
        <button type="button" onClick={onAction} disabled={busy}
          className="inline-flex min-h-9 flex-none items-center gap-1 rounded-full bg-rose/10 px-3 font-sc text-xs text-rose-deep transition hover:bg-rose/16 disabled:opacity-60 focus-ring">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
          {actionLabel}
        </button>
      )}
      {onJournal && done && (
        <button type="button" onClick={onJournal} disabled={busy}
          className={cn(
            "inline-flex min-h-9 flex-none items-center gap-1 rounded-full px-3 font-sc text-xs transition disabled:opacity-60 focus-ring",
            item.journal_event_id ? "text-ink-soft hover:bg-peach/14" : "bg-peach/26 text-rose-deep hover:bg-peach/36",
          )}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookHeart className="h-3.5 w-3.5" />}
          {item.journal_event_id ? "去手账看看" : "写进手账"}
        </button>
      )}
    </motion.li>
  );
}

function PlanSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="content-surface h-36 animate-pulse motion-reduce:animate-none" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="content-surface h-[28rem] animate-pulse motion-reduce:animate-none" />
        <div className="content-surface h-72 animate-pulse motion-reduce:animate-none" />
      </div>
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="content-surface grid min-h-[40vh] place-items-center p-6 text-center" role="alert">
      <div>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-peach/24 text-rose-deep">
          <CloudOff className="h-6 w-6" />
        </span>
        <p className="mt-3 font-sc text-sm text-ink-soft">计划暂时没打开</p>
        <button type="button" onClick={onRetry} className="btn-ghost mt-3 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-sc text-sm focus-ring">
          <RotateCcw className="h-4 w-4" />再试一次
        </button>
      </div>
    </div>
  );
}

function TodoDetailPanel({
  itemId,
  item,
  meetings,
  meetingsById,
  names,
  onClose,
  onChanged,
  onToggle,
  onJournal,
  onDeleted,
}: {
  itemId: number;
  item: TodoItemOut | null;
  meetings: TodoMeetingOut[];
  meetingsById: Map<number, TodoMeetingOut>;
  names: Map<number, string>;
  onClose: () => void;
  onChanged: (item: TodoItemOut) => void;
  onToggle: (item: TodoItemOut) => Promise<void>;
  onJournal: (item: TodoItemOut) => Promise<void>;
  onDeleted: (id: number) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [detail, setDetail] = useState<TodoItemDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedImage, setSelectedImage] = useState<TodoImageOut | null>(null);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    setDetailFailed(false);
    const fetchDetail = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api.getTodoItem(itemId, { silent: true });
        if (alive) {
          setDetail(next);
          setDetailFailed(false);
        }
      } catch {
        if (alive) setDetailFailed(true);
      } finally {
        inFlight = false;
      }
    };
    void fetchDetail();
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchDetail();
    }, 8000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [itemId, detailAttempt]);

  const current: TodoItemOut | null = item ?? detail;
  const merged = detail && current ? { ...detail, ...current } : detail;

  async function refresh() {
    try {
      const next = await api.getTodoItem(itemId, { silent: true });
      setDetail(next);
      onChanged(next);
    } catch {
      return;
    }
  }

  async function patch(payload: Parameters<typeof api.updateTodoItem>[1]): Promise<boolean> {
    setSaving(true);
    try {
      const next = await api.updateTodoItem(itemId, payload);
      onChanged(next);
      setDetail((value) => (value ? { ...value, ...next } : value));
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    const text = comment.trim();
    if (!text) return;
    setSending(true);
    try {
      await api.postTodoComment(itemId, text);
      setComment("");
      await refresh();
    } catch {
      return;
    } finally {
      setSending(false);
    }
  }

  async function uploadImage(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      await api.postTodoImage(itemId, file);
      setPhotosOpen(true);
      await refresh();
    } catch {
      return;
    } finally {
      setUploading(false);
    }
  }

  async function deleteImage(imageId: number) {
    await api.deleteTodoImage(imageId);
    setSelectedImage((value) => (value?.id === imageId ? null : value));
    await refresh();
  }

  async function removeItem() {
    setDeleting(true);
    try {
      await api.deleteTodoItem(itemId);
      toast.success("已经删掉了");
      onDeleted(itemId);
    } catch {
      setDeleting(false);
    }
  }

  const ownerMeeting = current?.meeting_session_id != null ? meetingsById.get(current.meeting_session_id) : undefined;
  const meetingOptions = ownerMeeting && !meetings.some((meeting) => meeting.id === ownerMeeting.id) ? [ownerMeeting, ...meetings] : meetings;
  const panelMotion = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: MOTION_TRANSITIONS.reduced }
    : { initial: { x: 36, y: 18, opacity: 0 }, animate: { x: 0, y: 0, opacity: 1 }, exit: { x: 32, y: 18, opacity: 0 }, transition: MOTION_TRANSITIONS.state };

  return (
    <>
      <motion.button
        type="button"
        className="fixed inset-0 z-[70] bg-ink/30 lg:bg-ink/12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.overlay}
        aria-label="关闭详情"
        onClick={onClose}
      />
      <motion.aside
        {...panelMotion}
        className="fixed inset-x-0 bottom-0 z-[80] box-border flex max-h-[min(92dvh,100%)] w-full max-w-full flex-col overflow-hidden rounded-t-[1.35rem] border border-line/70 bg-surface text-ink shadow-[0_-24px_52px_-36px_rgb(var(--ink)/0.55)] lg:inset-auto lg:bottom-6 lg:right-6 lg:top-[calc(var(--lb-header-clearance)+0.5rem)] lg:max-h-none lg:w-[380px] lg:rounded-[20px] lg:shadow-[0_24px_60px_-30px_rgb(var(--ink)/0.45)]"
        role="dialog"
        aria-modal="true"
        aria-label={current?.title ? `详情：${current.title}` : "详情"}
      >
        <header className="border-b border-line/60 p-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {editingTitle ? (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!titleDraft.trim()) return;
                    if (await patch({ title: titleDraft.trim() })) setEditingTitle(false);
                  }}
                  className="flex gap-2"
                >
                  <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={200} autoFocus aria-label="标题" className="input-field min-w-0 flex-1 rounded-xl text-sm" />
                  <button type="submit" disabled={saving || !titleDraft.trim()} className="btn-primary grid h-11 w-11 flex-none place-items-center rounded-xl disabled:opacity-50 focus-ring" aria-label="保存标题">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </button>
                </form>
              ) : (
                <button type="button" onClick={() => { setTitleDraft(current?.title ?? ""); setEditingTitle(true); }} disabled={!current}
                  className="group flex max-w-full items-start gap-2 rounded-lg text-left focus-ring" aria-label="编辑标题">
                  <h2 className="break-words font-display text-xl font-semibold leading-tight text-ink">{current?.title ?? "正在读取"}</h2>
                  <Pencil className="mt-1 h-4 w-4 flex-none text-ink-muted group-hover:text-rose-deep" />
                </button>
              )}
            </div>
            <button type="button" onClick={onClose} className="grid h-10 w-10 flex-none place-items-center rounded-full hover:bg-ink/5 focus-ring" aria-label="关闭">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!merged || !current ? (
            detailFailed ? (
              <div className="grid h-40 place-items-center text-center" role="alert">
                <div>
                  <p className="font-sc text-sm text-ink-soft">详情暂时没打开</p>
                  <button type="button" onClick={() => setDetailAttempt((value) => value + 1)} className="btn-ghost mt-3 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-sc text-sm focus-ring">
                    <RotateCcw className="h-4 w-4" />再试一次
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid h-40 place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-ink-muted motion-reduce:animate-none" />
              </div>
            )
          ) : (
            <div className="space-y-5">
              <section className={cn("rounded-2xl border p-3", current.completed_at ? "border-sage/34 bg-sage/12" : "border-line/58 bg-surface-raised/66")}>
                {current.completed_at ? (
                  <>
                    <p className="font-sc text-sm text-ink">
                      <Check className="mr-1 inline h-4 w-4 text-ink-soft" />
                      {current.completed_by_id != null ? `${names.get(current.completed_by_id) ?? "TA"}标记了完成` : "已经完成"} · {formatRelative(current.completed_at)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void onJournal(current)} className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-sc text-sm font-medium focus-ring">
                        <BookHeart className="h-4 w-4" />{current.journal_event_id ? "去手账看看" : "写进手账"}
                      </button>
                      <button type="button" onClick={() => void onToggle(current)} className="btn-ghost inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-sc text-sm focus-ring">
                        <RotateCcw className="h-4 w-4" />还没做完
                      </button>
                    </div>
                    {!current.journal_event_id && <p className="mt-2 font-sc text-xs text-ink-muted">描述、留言和照片会一起写进手账。</p>}
                  </>
                ) : (
                  <button type="button" onClick={() => void onToggle(current)} className="btn-primary inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 font-sc text-sm font-medium focus-ring">
                    <Check className="h-4 w-4" />做到啦
                  </button>
                )}
              </section>

              {ownerMeeting && (
                <ScheduleEditor key={`${current.id}-${current.scheduled_on}-${current.start_minute}-${current.end_minute}`} item={current} meeting={ownerMeeting} saving={saving} onPatch={patch} />
              )}

              <section>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">放在哪次见面</h3>
                <select
                  value={current.meeting_session_id ?? ""}
                  onChange={(event) => void patch({ meeting_session_id: event.target.value ? Number(event.target.value) : null })}
                  disabled={saving}
                  aria-label="放在哪次见面"
                  className="input-field min-h-11 w-full rounded-xl text-sm"
                >
                  <option value="">先不放进见面</option>
                  {meetingOptions.map((meeting) => (
                    <option key={meeting.id} value={meeting.id}>{meeting.title} · {formatRange(meeting)}</option>
                  ))}
                </select>
              </section>

              <section>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">分类</h3>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="分类">
                  {CATEGORY_ORDER.map((category) => (
                    <button key={category} type="button" role="radio" aria-checked={current.category === category} disabled={saving}
                      onClick={() => current.category !== category && void patch({ category })}
                      className={cn(
                        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 font-sc text-sm transition focus-ring",
                        current.category === category ? "border-rose/40 bg-rose/12 text-rose-deep" : "border-line/70 text-ink-soft hover:border-rose/30",
                      )}>
                      {CATEGORY_META[category].icon}{CATEGORY_META[category].label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-sc text-sm font-medium text-ink">描述</h3>
                  {!editingNote && (
                    <button type="button" onClick={() => { setNoteDraft(current.note ?? ""); setEditingNote(true); }} className="rounded-full bg-rose/10 px-3 py-1 font-sc text-xs text-rose-deep focus-ring">
                      {current.note ? "编辑" : "添加"}
                    </button>
                  )}
                </div>
                {editingNote ? (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (await patch({ note: noteDraft.trim() || null })) setEditingNote(false);
                    }}
                    className="rounded-2xl border border-line/58 bg-surface-raised/66 p-3"
                  >
                    <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={2000} rows={4} autoFocus
                      className="input-field min-h-24 w-full resize-none rounded-xl text-sm" placeholder="地址、预约时间、想点的菜……" />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingNote(false)} disabled={saving} className="btn-ghost min-h-9 rounded-xl px-3 font-sc text-xs focus-ring">取消</button>
                      <button type="submit" disabled={saving} className="btn-primary min-h-9 rounded-xl px-3 font-sc text-xs disabled:opacity-50 focus-ring">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
                      </button>
                    </div>
                  </form>
                ) : current.note ? (
                  <p className="whitespace-pre-wrap break-words rounded-2xl border border-line/58 bg-surface-raised/66 p-3 font-sc text-sm leading-relaxed text-ink-soft">{current.note}</p>
                ) : (
                  <p className="rounded-2xl border border-dashed border-line/70 bg-peach/10 p-3 font-sc text-sm text-ink-muted">可以记下地址、预约时间或者想点的菜。</p>
                )}
              </section>

              <section>
                <h3 className="mb-2 font-sc text-sm font-medium text-ink">留言</h3>
                {merged.comments.length === 0 ? (
                  <p className="rounded-xl bg-peach/12 p-4 font-sc text-sm text-ink-muted">想对这件事说点什么，就写在下面。</p>
                ) : (
                  <ul className="space-y-2">
                    {merged.comments.map((entry) => (
                      <li key={entry.id} className="rounded-xl bg-peach/12 p-3">
                        <p className="mb-1 font-sc text-xs font-medium text-rose-deep">{names.get(entry.author_id) ?? entry.author_display_name ?? "TA"}</p>
                        <p className="whitespace-pre-wrap break-words font-sc text-sm text-ink">{entry.text}</p>
                        <p className="mt-1.5 font-sc text-[11px] text-ink-muted">{formatRelative(entry.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <button type="button" onClick={() => setPhotosOpen((value) => !value)} aria-expanded={photosOpen}
                  className="mb-2 flex min-h-10 w-full items-center justify-between rounded-xl px-2 text-left font-sc text-sm font-medium text-ink hover:bg-peach/10 focus-ring">
                  <span>照片</span>
                  <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
                    {merged.images.length}
                    <ChevronRight className={cn("h-4 w-4 transition", photosOpen && "rotate-90")} />
                  </span>
                </button>
                <MotionCollapse open={photosOpen}>
                  <div className="pt-1">
                    {merged.images.length === 0 ? (
                      <p className="rounded-xl bg-peach/12 p-4 font-sc text-sm text-ink-muted">还没有照片。</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {merged.images.map((image) => (
                          <TodoImageThumb key={image.id} image={image} onOpen={() => setSelectedImage(image)} />
                        ))}
                      </div>
                    )}
                  </div>
                </MotionCollapse>
              </section>
            </div>
          )}
        </div>

        <footer className="border-t border-line/60 p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] lg:pb-4">
          <form onSubmit={submitComment} className="mb-3 flex gap-2">
            <input className="input-field min-w-0 flex-1 rounded-xl text-sm" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写句留言" maxLength={2000} aria-label="写句留言" />
            <button type="submit" disabled={sending || !comment.trim()} className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-rose text-white disabled:opacity-50 focus-ring" aria-label="发送留言">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
          </form>
          {confirmDelete ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-rose/8 px-3 py-2">
              <p className="font-sc text-sm text-rose-deep">删掉这件事？留言和照片也会一起删除。</p>
              <div className="flex flex-none gap-1">
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="btn-ghost min-h-10 rounded-xl px-3 font-sc text-sm focus-ring">算了</button>
                <button type="button" onClick={() => void removeItem()} disabled={deleting} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-rose-deep px-3 font-sc text-sm text-white disabled:opacity-60 focus-ring">
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}删掉
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <label className={cn("btn-ghost inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 font-sc text-sm focus-ring", uploading && "pointer-events-none opacity-60")}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                上传照片
                <input type="file" accept="image/*" className="sr-only" onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = "";
                  void uploadImage(file);
                }} />
              </label>
              <button type="button" onClick={() => setConfirmDelete(true)} className="grid h-11 w-11 place-items-center rounded-xl text-ink-muted hover:bg-ink/5 hover:text-rose-deep focus-ring" aria-label="删除这件事">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </footer>
      </motion.aside>
      <AnimatePresence>
        {selectedImage && (
          <TodoImagePreview key={selectedImage.id} image={selectedImage} onClose={() => setSelectedImage(null)} onDelete={() => deleteImage(selectedImage.id)} />
        )}
      </AnimatePresence>
    </>
  );
}

function ScheduleEditor({
  item,
  meeting,
  saving,
  onPatch,
}: {
  item: TodoItemOut;
  meeting: TodoMeetingOut;
  saving: boolean;
  onPatch: (payload: Parameters<typeof api.updateTodoItem>[1]) => Promise<boolean>;
}) {
  const days = useMemo(() => meetingDays(meeting.started_on, meeting.ended_on), [meeting.ended_on, meeting.started_on]);
  const placedDay = item.scheduled_on && days.some((day) => day.key === item.scheduled_on) ? item.scheduled_on : null;
  const [startText, setStartText] = useState(item.start_minute != null ? minuteLabel(item.start_minute) : "");
  const [endText, setEndText] = useState(item.end_minute != null ? minuteLabel(item.end_minute) : "");

  function commitTimes(nextStart: string, nextEnd: string) {
    const start = parseMinute(nextStart);
    if (start == null) return;
    const parsedEnd = parseMinute(nextEnd);
    const end = parsedEnd != null && parsedEnd > start ? parsedEnd : Math.min(start + DEFAULT_DURATION, 1440);
    if (start === item.start_minute && end === item.end_minute) return;
    void onPatch({ start_minute: start, end_minute: end });
  }

  return (
    <section>
      <h3 className="mb-2 font-sc text-sm font-medium text-ink">排在哪天</h3>
      <div className="local-x-scroll -mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1">
        <div className="flex w-max gap-1.5" role="radiogroup" aria-label="排在哪天">
          <button type="button" role="radio" aria-checked={!placedDay} disabled={saving}
            onClick={() => placedDay && void onPatch({ scheduled_on: null })}
            className={cn("min-h-10 rounded-full border px-3 font-sc text-xs transition focus-ring", !placedDay ? "border-rose/40 bg-rose/12 text-rose-deep" : "border-line/70 text-ink-soft hover:border-rose/30")}>
            还没排
          </button>
          {days.map((day) => (
            <button key={day.key} type="button" role="radio" aria-checked={placedDay === day.key} disabled={saving}
              onClick={() => placedDay !== day.key && void onPatch({ scheduled_on: day.key, start_minute: item.start_minute, end_minute: item.end_minute })}
              className={cn("min-h-10 rounded-full border px-3 font-sc text-xs transition focus-ring", placedDay === day.key ? "border-rose/40 bg-rose/12 text-rose-deep" : "border-line/70 text-ink-soft hover:border-rose/30")}>
              {day.month}/{day.day} {day.weekday}
            </button>
          ))}
        </div>
      </div>
      {placedDay && (
        <div className="mt-2 rounded-2xl border border-line/58 bg-surface-raised/66 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={saving}
              onClick={() => (item.start_minute == null ? void onPatch({ start_minute: 10 * 60, end_minute: 11 * 60 }) : void onPatch({ start_minute: null }))}
              className={cn("min-h-9 rounded-full px-3 font-sc text-xs transition focus-ring", item.start_minute == null ? "bg-rose/12 text-rose-deep ring-1 ring-rose/30" : "text-ink-soft hover:bg-peach/14")}
              aria-pressed={item.start_minute == null}>
              全天
            </button>
            {item.start_minute != null && (
              <span className="flex items-center gap-1.5 font-sc text-sm text-ink">
                <input type="time" step={900} value={startText} disabled={saving} aria-label="开始时间"
                  onChange={(event) => setStartText(event.target.value)} onBlur={() => commitTimes(startText, endText)}
                  className="input-field min-h-9 w-[6.5rem] rounded-xl px-2 text-sm tabular-nums" />
                –
                <input type="time" step={900} value={endText} disabled={saving} aria-label="结束时间"
                  onChange={(event) => setEndText(event.target.value)} onBlur={() => commitTimes(startText, endText)}
                  className="input-field min-h-9 w-[6.5rem] rounded-xl px-2 text-sm tabular-nums" />
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TodoImageThumb({ image, onOpen }: { image: TodoImageOut; onOpen: () => void }) {
  const { url: src, status } = useAuthedBlobUrl({ kind: "todo-thumb", id: image.id });
  if (src) {
    return (
      <button type="button" onClick={onOpen} className="aspect-square w-full overflow-hidden rounded-xl focus-ring" aria-label="查看大图">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="照片" className="h-full w-full object-cover transition motion-safe:hover:scale-[1.03]" />
      </button>
    );
  }
  if (status === "error") {
    return (
      <button type="button" onClick={onOpen} className="grid aspect-square w-full place-items-center rounded-xl bg-peach/14 px-2 text-center font-sc text-[11px] text-ink-muted focus-ring">
        没加载出来
      </button>
    );
  }
  return <div className="aspect-square w-full animate-pulse rounded-xl bg-line/40 motion-reduce:animate-none" />;
}

function TodoImagePreview({ image, onClose, onDelete }: { image: TodoImageOut; onClose: () => void; onDelete: () => void | Promise<void> }) {
  const { url: src, status } = useAuthedBlobUrl({ kind: "todo-image", id: image.id });
  const [deleting, setDeleting] = useState(false);

  async function deleteCurrent() {
    setDeleting(true);
    try {
      await onDelete();
      toast.success("照片已删除");
    } catch {
      return;
    } finally {
      setDeleting(false);
    }
  }

  return (
    <motion.div className="fixed inset-0 z-[95] flex items-center justify-center bg-ink/82 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal="true" aria-label="照片大图">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="关闭大图" />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-5xl flex-col gap-3">
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => void deleteCurrent()} disabled={deleting}
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/92 px-4 font-sc text-sm text-rose-deep shadow-sm disabled:opacity-60 focus-ring">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}删除
          </button>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/92 text-ink shadow-sm focus-ring" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid min-h-[40dvh] place-items-center overflow-hidden rounded-2xl bg-black/28">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="照片大图" className="max-h-[82dvh] w-auto max-w-full object-contain" />
          ) : status === "error" ? (
            <p className="font-sc text-sm text-white/85">照片没加载出来，稍后再试试</p>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-white motion-reduce:animate-none" />
          )}
        </div>
      </div>
    </motion.div>
  );
}

