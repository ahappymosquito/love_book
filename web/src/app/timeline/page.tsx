"use client";

// Timeline home with a queued relationship quote, static empty state, compact gift rows, meeting ranges, and reminders.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookHeart,
  CalendarHeart,
  ChevronDown,
  ChevronRight,
  Droplet,
  Gift,
  Plus,
} from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { EventImagePreview } from "@/components/event-image-preview";
import { LoadingScreen } from "@/components/loading-screen";
import { MeetingEditorDialog } from "@/components/meeting-editor-dialog";
import { AppHeader } from "@/components/app-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { MotionCollapse } from "@/components/ui/motion-collapse";
import { SubmissionBadge, VisibilityBadge } from "@/components/visibility-badge";
import { api } from "@/lib/api";
import {
  dismissCycleReminder,
  isCycleReminderDismissed,
  readCycleReminderDays,
} from "@/lib/cycle-reminder";
import { formatAbsolute, formatRelative } from "@/lib/format";
import { giftFeelingMeta } from "@/lib/gift-feelings";
import { MOTION_DURATION, MOTION_EASE, MOTION_TRANSITIONS } from "@/lib/motion";
import { useAppStore } from "@/lib/store";
import type { AnniversaryOut, CycleDashboardOut, EventSummary, MeetingSessionOut } from "@/lib/types";
import { cn } from "@/lib/cn";

const LOCAL_REMINDER_QUOTES = [
  "我说伤心了怎么办，小狗说忘忘忘忘忘。",
];
const QUOTE_BATCH_SIZE = 5;
const QUOTE_REFILL_THRESHOLD = 2;

type TimelineView = "all" | "meetings";

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

function meetingSessionDateLabel(session: MeetingSessionOut): string {
  const formatDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return `${year}年${month}月${day}日`;
  };
  if (session.started_on === session.ended_on) return formatDate(session.started_on);
  return `${formatDate(session.started_on)} - ${formatDate(session.ended_on)}`;
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
  const [meetingSessions, setMeetingSessions] = useState<MeetingSessionOut[]>([]);
  const [anniversary, setAnniversary] = useState<AnniversaryOut | null>(null);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const quoteQueueRef = useRef<string[]>([]);
  const quoteBatchPromiseRef = useRef<Promise<string[]> | null>(null);
  const quoteBatchPairIdRef = useRef<number | null>(null);
  const quotePairIdRef = useRef<number | null>(null);
  const pendingQuoteAdvanceRef = useRef(false);
  const quoteAdvancedRef = useRef(false);
  const currentQuoteRef = useRef(LOCAL_REMINDER_QUOTES[0]);
  const [cycleDashboard, setCycleDashboard] = useState<CycleDashboardOut | null>(null);
  const [cyclePromptDismissed, setCyclePromptDismissed] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set([todayDateOnly().slice(0, 7)]));
  const [timelineView, setTimelineView] = useState<TimelineView>("all");
  const reducedMotion = useReducedMotion();

  const loadQuoteBatch = useCallback((): Promise<string[]> => {
    const pairId = me?.pair_id;
    if (!pairId) return Promise.resolve([]);
    if (quoteBatchPromiseRef.current && quoteBatchPairIdRef.current === pairId) {
      return quoteBatchPromiseRef.current;
    }

    const request = api
      .sampleQuotes(QUOTE_BATCH_SIZE)
      .then(({ items }) => {
        if (quotePairIdRef.current !== pairId) return items;
        const existingQuotes = new Set([currentQuoteRef.current, ...quoteQueueRef.current]);
        const freshQuotes = items.filter((item) => item && !existingQuotes.has(item));
        quoteQueueRef.current = [...quoteQueueRef.current, ...freshQuotes];

        if (me && pendingQuoteAdvanceRef.current && quoteQueueRef.current.length > 0) {
          const [nextQuote, ...remainingQuotes] = quoteQueueRef.current;
          quoteQueueRef.current = remainingQuotes;
          pendingQuoteAdvanceRef.current = false;
          currentQuoteRef.current = nextQuote;
          quoteAdvancedRef.current = true;
          setAnniversary((previous) => ({
            ...(previous ?? immediateAnniversary(me.love_started_on)),
            message: nextQuote,
            message_source: "local",
          }));
        }
        return items;
      })
      .catch(() => [])
      .finally(() => {
        if (quoteBatchPromiseRef.current === request) {
          quoteBatchPromiseRef.current = null;
          quoteBatchPairIdRef.current = null;
        }
      });

    quoteBatchPromiseRef.current = request;
    quoteBatchPairIdRef.current = pairId;
    return request;
  }, [me]);

  const showNextQueuedQuote = useCallback((refill = true): boolean => {
    if (!me) return false;
    const [nextQuote, ...remainingQuotes] = quoteQueueRef.current;
    if (!nextQuote) return false;

    quoteQueueRef.current = remainingQuotes;
    currentQuoteRef.current = nextQuote;
    quoteAdvancedRef.current = true;
    setAnniversary((previous) => ({
      ...(previous ?? immediateAnniversary(me.love_started_on)),
      message: nextQuote,
      message_source: "local",
    }));

    if (refill && remainingQuotes.length <= QUOTE_REFILL_THRESHOLD) {
      void loadQuoteBatch();
    }
    return true;
  }, [loadQuoteBatch, me]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!me) {
      quotePairIdRef.current = null;
      quoteQueueRef.current = [];
      pendingQuoteAdvanceRef.current = false;
      return;
    }
    const immediate = immediateAnniversary(me.love_started_on);
    quotePairIdRef.current = me.pair_id;
    quoteQueueRef.current = [];
    pendingQuoteAdvanceRef.current = false;
    quoteAdvancedRef.current = false;
    currentQuoteRef.current = immediate.message;
    setAnniversary(immediate);
    void loadAnniversary(me.love_started_on);
    void loadQuoteBatch();
    const today = todayDateOnly();
    const range = reminderRange(today);
    void api
      .getCycleDashboard(range)
      .then((dashboard) => {
        setCycleDashboard(dashboard);
        setCyclePromptDismissed(isCycleReminderDismissed(me.pair_id, today));
      })
      .catch(() => setCycleDashboard(null));
  }, [loadQuoteBatch, me]);

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

  const meetingEvents = useMemo(
    () => (events ?? []).filter((event) => event.meeting_session_id !== null || event.event_kind === "offline_meeting"),
    [events],
  );

  const meetingGroups = useMemo(() => {
    const eventMap = new Map<number, EventSummary[]>();
    const orphanEvents: EventSummary[] = [];
    for (const event of meetingEvents) {
      if (event.meeting_session_id) {
        eventMap.set(event.meeting_session_id, [...(eventMap.get(event.meeting_session_id) ?? []), event]);
      } else {
        orphanEvents.push(event);
      }
    }
    const groups = meetingSessions
      .map((session) => ({ session, events: eventMap.get(session.id) ?? [] }))
      .filter((group) => group.events.length > 0);
    groups.sort((left, right) => {
      const leftTime = new Date(left.session.started_at ?? left.events[0]?.occurred_at ?? left.session.created_at).getTime();
      const rightTime = new Date(right.session.started_at ?? right.events[0]?.occurred_at ?? right.session.created_at).getTime();
      return rightTime - leftTime;
    });
    if (orphanEvents.length > 0) {
      groups.push({
        session: {
          id: 0,
          pair_id: 0,
          title: "未整理的见面",
          started_on: (orphanEvents[orphanEvents.length - 1]?.occurred_at ?? orphanEvents[orphanEvents.length - 1]?.created_at ?? "").slice(0, 10),
          ended_on: (orphanEvents[0]?.occurred_at ?? orphanEvents[0]?.created_at ?? "").slice(0, 10),
          started_at: null,
          ended_at: null,
          created_by_id: 0,
          created_at: orphanEvents[0].created_at,
          updated_at: orphanEvents[0].created_at,
          event_count: orphanEvents.length,
        },
        events: orphanEvents,
      });
    }
    return groups;
  }, [meetingEvents, meetingSessions]);

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
      const [loadedEvents, loadedMeetingSessions] = await Promise.all([
        api.listEvents(),
        api.listMeetingSessions().catch(() => []),
      ]);
      setEvents(loadedEvents);
      setMeetingSessions(loadedMeetingSessions);
    } catch {
      setEvents([]);
      setMeetingSessions([]);
    }
  }

  async function loadAnniversary(startedOn: string) {
    try {
      const loaded = await api.getAnniversary();
      if (quoteAdvancedRef.current) {
        setAnniversary((previous) => ({
          ...loaded,
          message: previous?.message ?? currentQuoteRef.current,
          message_source: previous?.message_source ?? "local",
        }));
      } else {
        currentQuoteRef.current = loaded.message;
        setAnniversary(loaded);
      }
    } catch {
      if (!quoteAdvancedRef.current) {
        const immediate = immediateAnniversary(startedOn);
        currentQuoteRef.current = immediate.message;
        setAnniversary(immediate);
      }
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

  function refreshQuote() {
    if (!me) return;
    if (showNextQueuedQuote()) return;

    pendingQuoteAdvanceRef.current = true;
    setQuoteRefreshing(true);
    void loadQuoteBatch().finally(() => {
      pendingQuoteAdvanceRef.current = false;
      setQuoteRefreshing(false);
    });
  }

  if (!me) return <LoadingScreen />;

  const relationshipDays = anniversary?.days_together ?? daysTogether(me.love_started_on, todayDateOnly());

  return (
    <div className="viewport-guard min-h-dvh w-full">
      <AppHeader mode="compact" />

      <main className="mx-auto w-full max-w-5xl min-w-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+7.6rem)] pt-5 sm:px-6 sm:pt-6">
        <HomeHero
          userName={me.user.display_name}
          counterpartName={me.counterpart.display_name}
          relationshipDays={relationshipDays}
          data={anniversary ?? immediateAnniversary(me.love_started_on)}
          quoteRefreshing={quoteRefreshing}
          onRefreshQuote={refreshQuote}
        />

        {events !== null && events.length > 0 && (
          <TimelineViewSwitch
            view={timelineView}
            totalCount={events.length}
            meetingCount={meetingGroups.length}
            onChange={setTimelineView}
          />
        )}

        {events === null ? (
          <ListSkeleton />
        ) : events.length === 0 ? (
          <EmptyState onCreate={openCreateWindow} />
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={timelineView}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: timelineView === "meetings" ? 6 : -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: timelineView === "meetings" ? -6 : 6 }}
              transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
              className="min-w-0"
            >
              {timelineView === "meetings" ? (
                meetingEvents.length === 0 ? (
                  <MeetingEmptyState onCreate={openCreateWindow} />
                ) : (
                  <MeetingTimeRiver
                    groups={meetingGroups}
                    eventCount={meetingEvents.length}
                    onChanged={load}
                  />
                )
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
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      <AnimatePresence initial={false}>
        {cyclePrompt && (
          <CycleCheckInPrompt
            daysLeft={cyclePrompt.daysLeft}
            nextPeriodStart={cyclePrompt.nextPeriodStart}
            onDismiss={dismissTodayCyclePrompt}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function HomeHero({
  userName,
  counterpartName,
  relationshipDays,
  data,
  quoteRefreshing,
  onRefreshQuote,
}: {
  userName: string;
  counterpartName: string;
  relationshipDays: number;
  data: AnniversaryOut;
  quoteRefreshing: boolean;
  onRefreshQuote: () => void;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <section className="timeline-quote-panel mb-5 sm:mb-6">
      <p className="timeline-quote-meta">
        <BookHeart className="h-4 w-4 flex-none text-rose-deep" />
        <span>{userName} 和 {counterpartName}</span>
        <span aria-hidden="true">·</span>
        <span>在一起第 {relationshipDays} 天</span>
      </p>
          <motion.button
            type="button"
            onClick={onRefreshQuote}
            disabled={quoteRefreshing}
            layout="size"
            whileTap={reducedMotion ? undefined : { scale: 0.995 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
            className="timeline-quote-button focus-ring"
            aria-label="刷新今日话语"
            aria-busy={quoteRefreshing}
          >
            <span className="relative block min-h-[2.15rem] sm:min-h-[2.6rem]">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={data.message}
                  aria-hidden="true"
                  className="block origin-left"
                  initial={
                    reducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0.2, y: 6, filter: "blur(2px)", clipPath: "inset(0 0 70% 0 round 8px)" }
                  }
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)", clipPath: "inset(0 0 0% 0 round 8px)" }}
                  exit={
                    reducedMotion
                      ? { opacity: 0 }
                      : {
                          opacity: 0,
                          y: -4,
                          filter: "blur(2px)",
                          transition: { duration: MOTION_DURATION.press, ease: MOTION_EASE },
                        }
                  }
                  transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { ...MOTION_TRANSITIONS.state, duration: 0.24 }}
                >
                  {data.message}
                </motion.span>
              </AnimatePresence>
              {quoteRefreshing && (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 origin-left rounded-full bg-rose/55"
                  initial={{ opacity: 0.35, scaleX: 0.24 }}
                  animate={reducedMotion ? { opacity: 0.7, scaleX: 1 } : { opacity: [0.35, 0.8, 0.35], scaleX: [0.24, 1, 0.24] }}
                  transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { duration: 0.8, ease: MOTION_EASE, repeat: Infinity }}
                />
              )}
            </span>
            <span className="sr-only" aria-live="polite" aria-atomic="true">{data.message}</span>
          </motion.button>
    </section>
  );
}

function TimelineViewSwitch({
  view,
  totalCount,
  meetingCount,
  onChange,
}: {
  view: TimelineView;
  totalCount: number;
  meetingCount: number;
  onChange: (view: TimelineView) => void;
}) {
  const options: Array<{ key: TimelineView; label: string; count: number }> = [
    { key: "all", label: "全部", count: totalCount },
    { key: "meetings", label: "见面", count: meetingCount },
  ];

  return (
    <div className="page-toolbar mb-4 flex justify-center sm:mb-5">
      <SegmentedControl
        value={view}
        onChange={onChange}
        ariaLabel="切换首页内容"
        layoutId="timeline-view-lens"
        className="w-full max-w-sm"
        options={options.map((option) => ({
          value: option.key,
          label: (
            <span className="inline-flex items-center justify-center gap-1.5">
              {option.label}
              <span className="rounded-full bg-white/55 px-1.5 py-0.5 text-[11px] text-ink-soft">
                {option.count}
              </span>
            </span>
          ),
        }))}
      />
    </div>
  );
}

function MeetingTimeRiver({
  groups,
  eventCount,
  onChanged,
}: {
  groups: Array<{ session: MeetingSessionOut; events: EventSummary[] }>;
  eventCount: number;
  onChanged: () => Promise<void>;
}) {
  return (
    <section className="meeting-river-shell content-surface overflow-hidden px-5 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line/55 pb-4">
        <div>
          <p className="font-sc text-xs font-medium text-rose-deep">线下见面</p>
          <h2 className="mt-1 font-display text-xl font-semibold leading-tight text-ink sm:text-2xl">
            {groups.length} 次见面，留下 {eventCount} 条小事
          </h2>
        </div>
      </div>

      <div className="meeting-river mt-5 space-y-6">
        {groups.map((group) => (
          <MeetingGroup
            key={group.session.id || "orphans"}
            group={group}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  );
}

function MeetingGroup({
  group,
  onChanged,
}: {
  group: { session: MeetingSessionOut; events: EventSummary[] };
  onChanged: () => Promise<void>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const canOrganize = group.session.id > 0;

  return (
    <div className="relative pl-8 sm:pl-10">
      <div className="meeting-month-node" aria-hidden="true" />
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1.5">
        <button type="button" className={cn(
          "min-h-11 max-w-full truncate rounded-xl px-1 text-left font-display text-lg font-semibold text-ink transition focus-ring",
          canOrganize && "hover:text-rose-deep",
        )} disabled={!canOrganize} onClick={() => setEditorOpen(true)}
          title={canOrganize ? "编辑见面标题和日期" : undefined}>
          {group.session.title}
        </button>
        <span className="font-sc text-xs text-ink-muted">{meetingSessionDateLabel(group.session)}</span>
        <span className="font-sc text-xs text-rose-deep">{group.events.length} 条小事</span>
      </div>

      <div className="space-y-3">
        {group.events.map((event, index) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.035, 0.14), duration: 0.22 }}
          >
            <MeetingRiverEvent event={event} />
          </motion.div>
        ))}
      </div>
      <MeetingEditorDialog open={editorOpen} session={canOrganize ? group.session : null}
        onOpenChange={setEditorOpen} onSaved={async () => onChanged()} onDeleted={async () => onChanged()} />
    </div>
  );
}

function MeetingRiverEvent({ event }: { event: EventSummary }) {
  const me = useAppStore((state) => state.me)!;
  const author = event.creator_id === me.user.id ? me.user : me.counterpart;
  const eventTime = event.occurred_at ?? event.created_at;
  const isGift = event.event_kind === "gift_received";

  if (isGift) {
    return (
      <Link href={`/timeline/${event.id}`} className="group block rounded-2xl focus-ring">
        <article className="meeting-river-event meeting-river-event-gift px-4 py-3.5 sm:px-5">
          <GiftTimelineContent event={event} />
        </article>
      </Link>
    );
  }

  return (
    <Link href={`/timeline/${event.id}`} className="group block rounded-2xl focus-ring">
      <article className="meeting-river-event px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <Avatar user={author} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-sc text-xs text-ink-muted">
              <span>{author.display_name}</span>
              <span className="h-1 w-1 rounded-full bg-line" />
              <span>{formatAbsolute(eventTime, false)}</span>
            </div>
            <h3 className="mt-1 line-clamp-2 font-display text-lg font-semibold leading-snug text-ink">
              {event.title}
            </h3>
            {event.description && (
              <p className="mt-2 line-clamp-2 font-sc text-sm leading-relaxed text-ink-soft">
                {event.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <MeetingBadge />
              <VisibilityBadge mode={event.visibility_mode} />
              <SubmissionBadge state={event.submission_state} mode={event.visibility_mode} />
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function MeetingEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="glass-card overflow-hidden rounded-[2rem] p-5 sm:p-6">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 rounded-full bg-rose/10 px-3 py-1.5 font-sc text-xs font-medium text-rose-deep">
          <CalendarHeart className="h-3.5 w-3.5" />
          还没有单独标记见面
        </div>
        <h2 className="mt-4 max-w-2xl font-display text-[1.55rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">
          下次见面时，把那一天放进这条小河里。
        </h2>
        <p className="mt-3 max-w-xl font-sc text-sm leading-relaxed text-ink-soft">
          新建记录时选择“线下见面”，它就会出现在这里。以前的小事也可以进入详情后补上标记。
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="btn-primary mt-5 inline-flex min-h-12 items-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring"
        >
          <Plus className="h-4 w-4" />
          记一次见面
        </button>
      </div>
    </section>
  );
}

function MeetingBadge() {
  return (
    <span className="pill inline-flex items-center gap-1 bg-rose/10 text-rose-deep">
      <CalendarHeart className="h-3.5 w-3.5" />
      线下见面
    </span>
  );
}

function GiftEventTags({
  feelings,
  showMeetingTag,
}: {
  feelings: EventSummary["gift_feelings"];
  showMeetingTag: boolean;
}) {
  const visibleFeelings = feelings.slice(0, showMeetingTag ? 1 : 2);

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="收礼事件标签">
      <span className="inline-flex min-h-6 items-center gap-1 rounded-full bg-peach/28 px-2 font-sc text-[11px] font-medium text-ink">
        <Gift className="h-3 w-3 text-peach-deep" />
        收礼
      </span>
      {showMeetingTag && (
        <span className="inline-flex min-h-6 items-center rounded-full bg-rose/10 px-2 font-sc text-[11px] text-rose-deep">
          见面
        </span>
      )}
      {visibleFeelings.map((feeling) => (
        <span
          key={feeling}
          className="inline-flex min-h-6 items-center rounded-full bg-surface/78 px-2 font-sc text-[11px] text-ink-soft"
        >
          {giftFeelingMeta(feeling).label}
        </span>
      ))}
    </div>
  );
}

function GiftTimelineContent({
  event,
  showMeetingTag = false,
}: {
  event: EventSummary;
  showMeetingTag?: boolean;
}) {
  const eventTime = event.occurred_at ?? event.created_at;

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <GiftCardMedia event={event} />
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 font-display text-base font-semibold leading-snug text-ink sm:text-lg">
          {event.title}
        </h3>
        <time
          dateTime={eventTime}
          className="mt-1.5 block font-sc text-xs text-ink-muted"
          title={formatAbsolute(eventTime)}
        >
          {formatAbsolute(eventTime, false)}
        </time>
        <GiftEventTags feelings={event.gift_feelings} showMeetingTag={showMeetingTag} />
      </div>
    </div>
  );
}

function GiftCardMedia({ event }: { event: EventSummary }) {
  return (
    <div className="relative h-20 w-20 flex-none overflow-hidden rounded-xl bg-peach/18 sm:h-24 sm:w-24">
      {event.preview_image ? (
        <EventImagePreview imageId={event.preview_image.id} alt={`${event.title}的照片`} className="h-full w-full" />
      ) : (
        <div className="grid h-full w-full place-items-center text-peach-deep" aria-hidden="true">
          <Gift className="h-8 w-8" strokeWidth={1.7} />
        </div>
      )}
    </div>
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
  const reducedMotion = useReducedMotion();

  return (
    <section className="content-surface overflow-hidden">
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

      <MotionCollapse open={expanded}>
        <ul className="divide-y divide-line/50 border-t border-line/55 bg-surface-raised/42">
          {events.map((event, index) => (
            <motion.li
              key={event.id}
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reducedMotion
                  ? MOTION_TRANSITIONS.reduced
                  : { ...MOTION_TRANSITIONS.state, delay: Math.min(index, 6) * 0.02 }
              }
            >
              <EventRow event={event} />
            </motion.li>
          ))}
        </ul>
      </MotionCollapse>
    </section>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const me = useAppStore((state) => state.me)!;
  const author = event.creator_id === me.user.id ? me.user : me.counterpart;
  const isMeeting = event.meeting_session_id !== null || event.event_kind === "offline_meeting";
  const isGift = event.event_kind === "gift_received";

  if (isGift) {
    return (
      <Link href={`/timeline/${event.id}`} className="group block rounded-2xl focus-ring">
        <article className={cn("timeline-event-row timeline-event-row-gift px-5 py-3.5 sm:px-6", isMeeting && "timeline-event-row-meeting")}>
          <GiftTimelineContent event={event} showMeetingTag={isMeeting} />
        </article>
      </Link>
    );
  }

  return (
    <Link href={`/timeline/${event.id}`} className="group block rounded-2xl focus-ring">
      <article className={cn("timeline-event-row px-5 py-4 sm:px-6", isMeeting && "timeline-event-row-meeting")}>
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
              {isMeeting && <MeetingBadge />}
              {isMeeting && event.meeting_session && (
                <span className="pill inline-flex items-center gap-1 bg-peach/22 text-ink-soft">
                  {event.meeting_session.title}
                </span>
              )}
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
  const reducedMotion = useReducedMotion();
  const title = daysLeft === 0 ? "预计今天来月经" : `预计还有 ${daysLeft} 天来月经`;

  return (
    <motion.div
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5.45rem)] z-40 mx-auto box-border w-full max-w-3xl px-4 sm:bottom-6 sm:px-6"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 9 }}
      transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
    >
      <section
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
      </section>
    </motion.div>
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
    <section className="content-surface px-5 py-8 text-center sm:px-7 sm:py-10">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-peach/22 text-rose-deep">
        <BookHeart className="h-7 w-7" />
      </div>
      <h2 className="mt-4 font-display text-xl font-semibold text-ink sm:text-2xl">从今天的小事开始</h2>
      <p className="mx-auto mt-2 max-w-md font-sc text-sm leading-6 text-ink-soft">记下一顿饭、一句想说的话，或一次临时决定的小约会。</p>
      <button type="button" onClick={onCreate} className="btn-primary mt-5 inline-flex min-h-12 items-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring">
        <Plus className="h-4 w-4" />
        记一笔
      </button>
    </section>
  );
}
