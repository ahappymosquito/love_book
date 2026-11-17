"use client";

// Timeline home: a queued relationship quote, then a sticky toolbar (手账 / 见面 segmented control plus month navigation with a one-tap month grid) above a single scrapbook book (JournalBook) that opens on the current month with fixed-height pages sized to the viewport, flowing a busy month's day-grouped entries across several sheets that turn left/right instead of scrolling; the 见面 view keeps ticket-styled meeting groups (two columns on xl) with an export link, and gift cards keep the unwrap overlay. A header 手账 button links to /journal. Months and "today" follow the Asia/Shanghai calendar, and only events inside a meeting range count as 见面.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookHeart,
  BookOpen,
  CalendarHeart,
  Droplet,
  Plus,
} from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { GiftTimelineCard } from "@/components/gift-timeline-card";
import { ScrapbookCard } from "@/components/scrapbook-decor";
import { BookMonthNav, JournalBook, useJournalBook } from "@/components/journal-book";
import { LoadingScreen } from "@/components/loading-screen";
import { MeetingEditorDialog } from "@/components/meeting-editor-dialog";
import { AppHeader } from "@/components/app-header";
import { EventPolaroid, MeetingBadge } from "@/components/timeline-entry";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SubmissionBadge, VisibilityBadge } from "@/components/visibility-badge";
import { api } from "@/lib/api";
import {
  dismissCycleReminder,
  isCycleReminderDismissed,
  readCycleReminderDays,
} from "@/lib/cycle-reminder";
import { shanghaiDateKey } from "@/lib/dates";
import { formatAbsolute } from "@/lib/format";
import { isGiftEvent } from "@/lib/gift-state";
import { MOTION_DURATION, MOTION_EASE, MOTION_TRANSITIONS } from "@/lib/motion";
import { PAGE_MAIN_WIDTH_CLASS } from "@/lib/page-width";
import { useAppStore } from "@/lib/store";
import type { AnniversaryOut, CycleDashboardOut, EventSummary, MeetingSessionOut } from "@/lib/types";
import { cn } from "@/lib/cn";

const LOCAL_REMINDER_QUOTES = [
  "我说伤心了怎么办，小狗说忘忘忘忘忘。",
];
const QUOTE_BATCH_SIZE = 5;
const QUOTE_REFILL_THRESHOLD = 2;

type TimelineView = "book" | "meetings";

function todayDateOnly(): string {
  return shanghaiDateKey();
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

function isMeetingEvent(event: EventSummary): boolean {
  return event.meeting_session_id !== null;
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
  const [timelineView, setTimelineView] = useState<TimelineView>("book");
  const reducedMotion = useReducedMotion();
  const book = useJournalBook(events);

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

  const meetingEvents = useMemo(() => (events ?? []).filter(isMeetingEvent), [events]);

  const meetingGroups = useMemo(() => {
    const eventMap = new Map<number, EventSummary[]>();
    for (const event of meetingEvents) {
      if (event.meeting_session_id) {
        eventMap.set(event.meeting_session_id, [...(eventMap.get(event.meeting_session_id) ?? []), event]);
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
    return groups;
  }, [meetingEvents, meetingSessions]);

  const cyclePrompt = useMemo(() => {
    if (!me || !cycleDashboard || cyclePromptDismissed) return null;
    const today = todayDateOnly();
    const todayRecorded = cycleDashboard.logs.some((log) => log.date === today && log.source === "recorded");
    if (todayRecorded || isCycleReminderDismissed(me.pair_id, today)) return null;
    const nextPeriodStart = cycleDashboard.stats.next_period_start;
    if (!nextPeriodStart) return null;
    const reminderDays = readCycleReminderDays(me.pair_id);
    const daysLeft = daysUntil(nextPeriodStart, today);
    if (daysLeft < 0 || daysLeft > reminderDays) return null;
    return {
      today,
      daysLeft,
      nextPeriodStart,
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
      <AppHeader
        mode="compact"
        rightSlot={
          <Link
            href="/journal"
            className="inline-flex h-11 flex-none items-center gap-1.5 rounded-full px-3 font-sc text-sm font-medium text-ink-soft transition hover:bg-peach/16 hover:text-rose-deep focus-ring"
            aria-label="打开我们的手账"
            title="手账"
          >
            <BookOpen className="h-[18px] w-[18px]" aria-hidden="true" />
            <span className="hidden min-[380px]:inline">手账</span>
          </Link>
        }
      />

      <main className={cn("mx-auto w-full min-w-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+7.6rem)] pt-5 sm:px-6 sm:pt-6", PAGE_MAIN_WIDTH_CLASS["7xl"])}>
        <HomeHero
          userName={me.user.display_name}
          counterpartName={me.counterpart.display_name}
          relationshipDays={relationshipDays}
          data={anniversary ?? immediateAnniversary(me.love_started_on)}
          quoteRefreshing={quoteRefreshing}
          onRefreshQuote={refreshQuote}
        />

        {events !== null && events.length > 0 && (
          <TimelineToolbar
            view={timelineView}
            meetingCount={meetingGroups.length}
            onChange={setTimelineView}
            monthNav={timelineView === "book" ? <BookMonthNav book={book} /> : null}
          />
        )}

        {events === null ? (
          <BookSkeleton />
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
                meetingGroups.length === 0 ? (
                  <MeetingEmptyState onCreate={openCreateWindow} />
                ) : (
                  <MeetingTimeRiver
                    groups={meetingGroups}
                    eventCount={meetingGroups.reduce((total, group) => total + group.events.length, 0)}
                    onChanged={load}
                  />
                )
              ) : (
                <JournalBook book={book} meetingSessions={meetingSessions} onChanged={load} onCreate={openCreateWindow} />
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

function TimelineToolbar({
  view,
  meetingCount,
  onChange,
  monthNav,
}: {
  view: TimelineView;
  meetingCount: number;
  onChange: (view: TimelineView) => void;
  monthNav: React.ReactNode;
}) {
  return (
    <div className="page-toolbar mb-4 flex items-center justify-between gap-2 sm:mb-5">
      <SegmentedControl
        value={view}
        onChange={onChange}
        ariaLabel="切换首页内容"
        layoutId="timeline-view-lens"
        className="flex-none sm:min-w-[15rem]"
        options={[
          { value: "book" as const, label: "手账" },
          {
            value: "meetings" as const,
            label: (
              <span className="inline-flex items-center justify-center gap-1.5">
                见面
                <span className="rounded-full bg-white/55 px-1.5 py-0.5 text-[11px] text-ink-soft">{meetingCount}</span>
              </span>
            ),
          },
        ]}
      />
      {monthNav}
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
    <section className="scrapbook-page scrapbook-paper-dots px-4 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-dashed border-line/70 pb-4">
        <div>
          <p className="font-sc text-xs font-medium text-rose-deep">见面</p>
          <h2 className="scrapbook-hand mt-1 text-xl font-semibold leading-tight text-ink sm:text-2xl">
            {groups.length} 次见面，留下 {eventCount} 条小事
          </h2>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-x-10 gap-y-8 xl:grid-cols-2">
        {groups.map((group) => (
          <MeetingGroup
            key={group.session.id}
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
  const reducedMotion = useReducedMotion();

  return (
    <div className="min-w-0">
      <div className="scrapbook-ticket mb-4">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="scrapbook-hand block min-h-11 max-w-full truncate rounded-xl text-left text-lg font-semibold text-ink transition hover:text-rose-deep focus-ring"
            onClick={() => setEditorOpen(true)}
            title="编辑见面标题和日期"
          >
            {group.session.title}
          </button>
          <p className="font-sc text-xs text-ink-muted">
            {meetingSessionDateLabel(group.session)}
            <span aria-hidden="true"> · </span>
            {group.events.length} 条小事
          </p>
          <Link
            href={`/journal?scope=meeting&meeting_id=${group.session.id}`}
            className="mt-1.5 inline-flex min-h-9 items-center gap-1 rounded-full px-1 font-sc text-xs font-medium text-rose-deep underline-offset-4 hover:underline focus-ring"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            导出这次见面
          </Link>
        </div>
        <span className="scrapbook-ticket-stamp" aria-hidden="true">
          <CalendarHeart className="h-5 w-5" />
        </span>
      </div>

      <div className="space-y-4">
        {group.events.map((event, index) => (
          <motion.div
            key={event.id}
            initial={reducedMotion ? false : { opacity: 0, y: -10, scale: 1.015 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { ...MOTION_TRANSITIONS.layout, delay: Math.min(index, 6) * 0.045 }}
          >
            {isGiftEvent(event) ? (
              <GiftTimelineCard event={event} onChanged={onChanged} />
            ) : (
              <MeetingRiverEvent event={event} />
            )}
          </motion.div>
        ))}
      </div>
      <MeetingEditorDialog open={editorOpen} session={group.session}
        onOpenChange={setEditorOpen} onSaved={async () => onChanged()} onDeleted={async () => onChanged()} />
    </div>
  );
}

function MeetingRiverEvent({ event }: { event: EventSummary }) {
  const me = useAppStore((state) => state.me)!;
  const author = event.creator_id === me.user.id ? me.user : me.counterpart;
  const eventTime = event.occurred_at ?? event.created_at;

  return (
    <Link href={`/timeline/${event.id}`} className="scrapbook-entry block rounded-2xl focus-ring">
      <ScrapbookCard id={event.id} tone="meeting">
        <div className="flex items-start gap-3">
          <Avatar user={author} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-sc text-xs text-ink-muted">
              <span>{author.display_name}</span>
              <span className="h-1 w-1 rounded-full bg-line" />
              <span>{formatAbsolute(eventTime, false)}</span>
            </div>
            <h3 className="scrapbook-hand mt-1 line-clamp-2 break-words text-lg font-semibold leading-snug text-ink">
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
          <EventPolaroid event={event} />
        </div>
      </ScrapbookCard>
    </Link>
  );
}

function MeetingEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="scrapbook-page scrapbook-paper-grid p-5 sm:p-6">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 rounded-full bg-rose/10 px-3 py-1.5 font-sc text-xs font-medium text-rose-deep">
          <CalendarHeart className="h-3.5 w-3.5" />
          还没有见面记录
        </div>
        <h2 className="scrapbook-hand mt-4 max-w-2xl text-[1.55rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">
          下次见面时，把那一天贴进这本手账里。
        </h2>
        <p className="mt-3 max-w-xl font-sc text-sm leading-relaxed text-ink-soft">
          点「记一次见面」，那几天里写下的小事都会收进来。以前的小事，也可以在详情里点日历爱心补上。
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
      className="nav-clearance-bottom fixed inset-x-0 z-40 mx-auto box-border w-full max-w-3xl px-4 sm:px-6"
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

function BookSkeleton() {
  return (
    <div className="journal-book-stage" aria-hidden="true">
      <div className="grid gap-0 lg:grid-cols-2">
        <div className="journal-leaf journal-leaf-single scrapbook-paper-dots">
          <div className="journal-leaf-body space-y-4">
            <div className="h-3 w-12 rounded-full bg-line/40" />
            <div className="h-10 w-24 rounded-full bg-line/45" />
            <div className="h-44 rounded-2xl bg-line/22" />
          </div>
        </div>
        <div className="journal-leaf journal-leaf-right scrapbook-paper-dots hidden lg:block">
          <div className="journal-leaf-body space-y-4">
            {[0, 1, 2].map((row) => (
              <div key={row} className="scrapbook-card scrapbook-card-memory">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-line/35" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-28 rounded-full bg-line/35" />
                    <div className="h-5 w-2/3 rounded-full bg-line/40" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
