"use client";

// Mobile-first timeline home screen with a tighter relationship header, refreshed anniversary hierarchy, lighter month groups, puppy-assisted empty state, and create-window entry points.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BookHeart,
  CalendarHeart,
  ChevronDown,
  ChevronRight,
  Droplet,
  Gift,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { LoadingScreen } from "@/components/loading-screen";
import { TimelineHeader } from "@/components/timeline-header";
import { SubmissionBadge, VisibilityBadge } from "@/components/visibility-badge";
import { api } from "@/lib/api";
import {
  dismissCycleReminder,
  isCycleReminderDismissed,
  readCycleReminderDays,
} from "@/lib/cycle-reminder";
import { formatAbsolute, formatRelative } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { AnniversaryOut, CycleDashboardOut, EventSummary, ReminderItem } from "@/lib/types";

const PuppyScene = dynamic(
  () => import("@/components/puppy-scene").then((module) => module.PuppyScene),
  { ssr: false },
);

const LOCAL_REMINDER_QUOTES = [
  "我说伤心了怎么办，小狗说忘忘忘忘忘。",
];

function todayDateOnly(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function toDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysTogether(startedOn: string, today: string): number {
  const start = new Date(`${startedOn}T00:00:00`);
  const end = new Date(`${today}T00:00:00`);
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function immediateAnniversary(startedOn: string): AnniversaryOut {
  const today = todayDateOnly();
  return {
    love_started_on: startedOn,
    today,
    days_together: daysTogether(startedOn, today),
    anniversary_items: [],
    love_festival_items: [],
    holiday_items: [],
    message: LOCAL_REMINDER_QUOTES[0],
    message_source: "local",
  };
}

function monthKeyForEvent(event: EventSummary): string {
  const date = new Date(event.occurred_at ?? event.created_at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function monthSortValue(key: string): number {
  const [year, month] = key.split("-").map(Number);
  return year * 12 + month;
}

function daysUntil(date: string, today: string): number {
  const targetTime = new Date(`${date}T00:00:00`).getTime();
  const todayTime = new Date(`${today}T00:00:00`).getTime();
  return Math.round((targetTime - todayTime) / 86_400_000);
}

function reminderRange(today: string): { start: string; end: string } {
  const now = new Date(`${today}T00:00:00`);
  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  return { start: toDateOnly(start), end: toDateOnly(end) };
}

export default function TimelinePage() {
  return (
    <AuthGate>
      <TimelineInner />
    </AuthGate>
  );
}

function TimelineInner() {
  const me = useAppStore((state) => state.me);
  const openCreateWindow = useAppStore((state) => state.openCreateWindow);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [anniversary, setAnniversary] = useState<AnniversaryOut | null>(null);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [cycleDashboard, setCycleDashboard] = useState<CycleDashboardOut | null>(null);
  const [cyclePromptDismissed, setCyclePromptDismissed] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set([todayDateOnly().slice(0, 7)]));

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!me) return;
    setAnniversary(immediateAnniversary(me.love_started_on));
    void loadAnniversary(me.love_started_on);
    const today = todayDateOnly();
    const range = reminderRange(today);
    void api
      .getCycleDashboard(range)
      .then((dashboard) => {
        setCycleDashboard(dashboard);
        setCyclePromptDismissed(isCycleReminderDismissed(me.pair_id, today));
      })
      .catch(() => setCycleDashboard(null));
  }, [me]);

  const eventGroups = useMemo(() => {
    const map = new Map<string, EventSummary[]>();
    for (const event of events ?? []) {
      const key = monthKeyForEvent(event);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return [...map.entries()]
      .sort(([left], [right]) => monthSortValue(right) - monthSortValue(left))
      .map(([key, monthEvents]) => ({ key, events: monthEvents }));
  }, [events]);

  const cyclePrompt = useMemo(() => {
    if (!me || !cycleDashboard || cyclePromptDismissed) return null;
    const today = todayDateOnly();
    const todayRecorded = cycleDashboard.logs.some((log) => log.date === today && log.source === "recorded");
    if (todayRecorded || isCycleReminderDismissed(me.pair_id, today)) return null;
    const reminderDays = readCycleReminderDays(me.pair_id);
    const daysLeft = daysUntil(cycleDashboard.stats.next_period_start, today);
    if (daysLeft < 0 || daysLeft > reminderDays) return null;
    return {
      today,
      daysLeft,
      nextPeriodStart: cycleDashboard.stats.next_period_start,
    };
  }, [cycleDashboard, cyclePromptDismissed, me]);

  async function load() {
    try {
      setEvents(await api.listEvents());
    } catch {
      setEvents([]);
    }
  }

  async function loadAnniversary(startedOn: string) {
    try {
      setAnniversary(await api.getAnniversary());
    } catch {
      setAnniversary(immediateAnniversary(startedOn));
    }
  }

  function toggleMonth(month: string) {
    setExpandedMonths((previous) => {
      const next = new Set(previous);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  }

  function dismissTodayCyclePrompt() {
    if (!me || !cyclePrompt) return;
    dismissCycleReminder(me.pair_id, cyclePrompt.today);
    setCyclePromptDismissed(true);
  }

  async function refreshAnniversary() {
    if (!me) return;
    setQuoteRefreshing(true);
    try {
      await loadAnniversary(me.love_started_on);
    } finally {
      setQuoteRefreshing(false);
    }
  }

  if (!me) return <LoadingScreen />;

  const relationshipDays = anniversary?.days_together ?? daysTogether(me.love_started_on, todayDateOnly());

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader mode="compact" />

      <main className="mx-auto w-full max-w-5xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+7.6rem)] pt-5 sm:px-6 sm:pt-6">
        <HomeHero
          userName={me.user.display_name}
          counterpartName={me.counterpart.display_name}
          relationshipDays={relationshipDays}
          totalEvents={events?.length ?? 0}
          monthCount={eventGroups.length}
          onCreate={openCreateWindow}
        />

        {anniversary && (
          <AnniversaryCard
            data={anniversary}
            quoteRefreshing={quoteRefreshing}
            onRefreshQuote={refreshAnniversary}
          />
        )}

        {events === null ? (
          <ListSkeleton />
        ) : events.length === 0 ? (
          <EmptyState onCreate={openCreateWindow} />
        ) : (
          <div className="space-y-4">
            {eventGroups.map((group) => (
              <MonthEventGroup
                key={group.key}
                month={group.key}
                events={group.events}
                expanded={expandedMonths.has(group.key)}
                onToggle={() => toggleMonth(group.key)}
              />
            ))}
          </div>
        )}
      </main>

      {cyclePrompt && (
        <CycleCheckInPrompt
          daysLeft={cyclePrompt.daysLeft}
          nextPeriodStart={cyclePrompt.nextPeriodStart}
          onDismiss={dismissTodayCyclePrompt}
        />
      )}
    </div>
  );
}

function HomeHero({
  userName,
  counterpartName,
  relationshipDays,
  totalEvents,
  monthCount,
  onCreate,
}: {
  userName: string;
  counterpartName: string;
  relationshipDays: number;
  totalEvents: number;
  monthCount: number;
  onCreate: () => void;
}) {
  return (
    <section className="timeline-hero-panel mb-5 rounded-[2rem] px-5 py-5 sm:mb-6 sm:px-6 sm:py-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-sc text-xs font-semibold text-rose-deep">今天也要收藏一点甜</p>
          <h1 className="mt-2 max-w-2xl font-display text-[1.9rem] font-bold leading-tight text-ink sm:text-[2.4rem]">
            让每一次心动、想念和见面，都能在这里留下好看的位置。
          </h1>
          <p className="mt-3 max-w-2xl font-sc text-sm leading-relaxed text-ink-soft">
            首页现在把你们的关系状态、纪念日提醒和时间线入口收得更紧凑，手机上滑动和点按都会更顺手。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="pill inline-flex items-center gap-1.5 bg-rose/12 text-rose-deep">
              <BookHeart className="h-3.5 w-3.5" />
              {userName} 和 {counterpartName}
            </span>
            <span className="pill inline-flex items-center gap-1.5 bg-peach/22 text-ink-soft">
              在一起第 {relationshipDays} 天
            </span>
            <span className="pill inline-flex items-center gap-1.5 bg-surface-raised/78 text-ink-soft">
              已记下 {totalEvents} 段小事，收进 {monthCount || 1} 个时间盒子
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
          <button
            type="button"
            onClick={onCreate}
            className="btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring"
          >
            <Plus className="h-4 w-4" />
            记一笔
          </button>
          <Link
            href="/cycle"
            className="btn-ghost inline-flex min-h-12 items-center justify-center rounded-full px-5 font-sc text-sm focus-ring"
          >
            看看今天的提醒
          </Link>
        </div>
      </div>
    </section>
  );
}

function AnniversaryCard({
  data,
  quoteRefreshing,
  onRefreshQuote,
}: {
  data: AnniversaryOut;
  quoteRefreshing: boolean;
  onRefreshQuote: () => void;
}) {
  const reminderItems = [...data.anniversary_items, ...data.love_festival_items, ...data.holiday_items];

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card mb-5 rounded-[1.85rem] p-5 sm:mb-6 sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-sc text-xs font-semibold text-rose-deep">今日话语</p>
          <p className="mt-2 font-display text-[1.35rem] font-semibold leading-snug text-ink sm:text-[1.55rem]">
            {data.message}
          </p>
          <p className="mt-2 font-sc text-xs text-ink-muted">
            {data.message_source === "local" ? "来自本地小狗语录兜底" : "来自共享语录与纪念日提醒"}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefreshQuote}
          disabled={quoteRefreshing}
          className="btn-ghost inline-flex h-11 w-11 items-center justify-center self-start rounded-full p-0 text-rose-deep focus-ring disabled:opacity-50"
          aria-label="刷新今日话语"
        >
          <RefreshCw className={`h-4 w-4 ${quoteRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {reminderItems.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {reminderItems.map((item, index) => (
            <ReminderPill key={`${item.type}-${item.label}-${index}`} item={item} />
          ))}
        </div>
      )}
    </motion.section>
  );
}

function ReminderPill({ item }: { item: ReminderItem }) {
  const Icon = item.type === "anniversary" ? Sparkles : item.type === "love_festival" ? Gift : CalendarHeart;
  const tone =
    item.type === "holiday"
      ? "bg-surface-raised/80 text-ink-soft"
      : item.type === "love_festival"
        ? "bg-peach/24 text-rose-deep"
        : "bg-rose/12 text-rose-deep";

  return (
    <span className={`pill inline-flex items-center gap-1.5 ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      {item.label}
    </span>
  );
}

function MonthEventGroup({
  month,
  events,
  expanded,
  onToggle,
}: {
  month: string;
  events: EventSummary[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="glass-card overflow-hidden rounded-[1.85rem]">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[72px] w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-white/42 focus-ring sm:px-6"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-tight text-ink sm:text-xl">{monthLabel(month)}</h2>
          <p className="mt-1 font-sc text-xs text-ink-muted">{events.length} 段小事收在这个月里</p>
        </div>
        <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-rose/10 text-rose-deep">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <ul className="divide-y divide-line/50 border-t border-line/55 bg-surface-raised/42">
          {events.map((event, index) => (
            <motion.li
              key={event.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.025, 0.14), duration: 0.22 }}
            >
              <EventRow event={event} />
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const me = useAppStore((state) => state.me)!;
  const author = event.creator_id === me.user.id ? me.user : me.counterpart;

  return (
    <Link href={`/timeline/${event.id}`} className="group block rounded-2xl focus-ring">
      <article className="timeline-event-row px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <Avatar user={author} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sc text-xs text-ink-muted">
              <span>{author.display_name}</span>
              <span className="h-1 w-1 rounded-full bg-line" />
              <span title={formatAbsolute(event.created_at)}>{formatRelative(event.created_at)}</span>
            </div>

            <h3 className="mt-1 line-clamp-2 font-display text-lg font-semibold leading-snug text-ink">
              {event.title}
            </h3>

            {event.description && (
              <p className="mt-2 line-clamp-2 max-w-3xl font-sc text-sm leading-relaxed text-ink-soft">
                {event.description}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <VisibilityBadge mode={event.visibility_mode} />
              <SubmissionBadge state={event.submission_state} mode={event.visibility_mode} />
              {event.occurred_at && (
                <span className="pill inline-flex items-center gap-1 bg-peach/22 text-ink-soft">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose" />
                  {formatAbsolute(event.occurred_at, false)}
                </span>
              )}
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function CycleCheckInPrompt({
  daysLeft,
  nextPeriodStart,
  onDismiss,
}: {
  daysLeft: number;
  nextPeriodStart: string;
  onDismiss: () => void;
}) {
  const title = daysLeft === 0 ? "预计今天来月经" : `预计还有 ${daysLeft} 天来月经`;

  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5.45rem)] z-40 mx-auto w-full max-w-3xl px-4 sm:bottom-6 sm:px-6">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-[1.8rem] p-4 shadow-glow sm:p-5"
        role="dialog"
        aria-label="周期记录提醒"
      >
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-peach/30 text-rose-deep">
            <Droplet className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg font-semibold leading-tight text-ink sm:text-xl">{title}</h3>
            <p className="mt-1 font-sc text-sm leading-relaxed text-ink-soft">
              今天还没有记录状态，预计日期是 {formatAbsolute(`${nextPeriodStart}T00:00:00`, false)}。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/cycle?quickLog=today"
                className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-sc text-sm font-medium focus-ring"
              >
                <Plus className="h-4 w-4" />
                填写今天
              </Link>
              <button
                type="button"
                onClick={onDismiss}
                className="btn-ghost min-h-11 rounded-full px-4 font-sc text-sm focus-ring"
              >
                暂时不写
              </button>
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((groupIndex) => (
        <section key={groupIndex} className="glass-card overflow-hidden rounded-[1.85rem]">
          <div className="flex min-h-[72px] items-center justify-between px-5 py-4 sm:px-6">
            <div className="space-y-2">
              <div className="h-4 w-28 rounded-full bg-line/45" />
              <div className="h-3 w-36 rounded-full bg-line/30" />
            </div>
            <div className="h-10 w-10 rounded-full bg-line/35" />
          </div>
          <div className="space-y-0 divide-y divide-line/50 border-t border-line/55 bg-surface-raised/42">
            {[0, 1].map((rowIndex) => (
              <div key={rowIndex} className="px-5 py-4 sm:px-6">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-line/35" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-28 rounded-full bg-line/35" />
                    <div className="h-5 w-2/3 rounded-full bg-line/40" />
                    <div className="h-3 w-full rounded-full bg-line/28" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="glass-card overflow-hidden rounded-[2rem] p-5 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-peach/24 px-3 py-1.5 font-sc text-xs font-medium text-rose-deep">
            <BookHeart className="h-3.5 w-3.5" />
            还没有留下第一段小事
          </div>
          <h2 className="mt-4 font-display text-[1.7rem] font-semibold leading-tight text-ink sm:text-[2rem]">
            小狗已经把空白页铺好了，等你们写下今天发生的第一件甜事。
          </h2>
          <p className="mt-3 max-w-xl font-sc text-sm leading-relaxed text-ink-soft">
            可以先记一顿一起吃的饭，一句想说的话，或者一次突然决定出门的小约会。写下第一笔之后，时间线就会自己长出节奏。
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="btn-primary mt-5 inline-flex min-h-12 items-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring"
          >
            <Plus className="h-4 w-4" />
            写第一笔
          </button>
        </div>

        <div className="inline-puppy-shell relative h-[220px] overflow-hidden rounded-[1.8rem] sm:h-[250px]">
          <PuppyScene
            variant="inline"
            interactive={false}
            reducedMotionFallback="still"
            className="absolute inset-0"
          />
        </div>
      </div>
    </section>
  );
}
