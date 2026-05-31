"use client";

// Timeline home screen showing pair reminders, avatar-aware event authors, moon cycle entry, month groups, and shortcuts.

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BookHeart,
  CalendarHeart,
  Check,
  ChevronDown,
  ChevronRight,
  Droplet,
  Gift,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { TimelineHeader } from "@/components/timeline-header";
import { Avatar } from "@/components/avatar";
import { SubmissionBadge, VisibilityBadge } from "@/components/visibility-badge";
import { LoadingScreen } from "@/components/loading-screen";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { formatAbsolute, formatRelative } from "@/lib/format";
import {
  dismissCycleReminder,
  isCycleReminderDismissed,
  readCycleReminderDays,
} from "@/lib/cycle-reminder";
import type { AnniversaryOut, CycleDashboardOut, EventSummary, QuoteOut, ReminderItem } from "@/lib/types";

const LOCAL_REMINDER_QUOTES = [
  "我说伤心了怎么办 小狗说忘忘忘忘忘忘",
];

function todayDateOnly(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function monthKeyForEvent(evt: EventSummary): string {
  const date = new Date(evt.occurred_at ?? evt.created_at);
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

export default function TimelinePage() {
  return (
    <AuthGate>
      <TimelineInner />
    </AuthGate>
  );
}

function TimelineInner() {
  const me = useAppStore((s) => s.me);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [anniversary, setAnniversary] = useState<AnniversaryOut | null>(null);
  const [quotes, setQuotes] = useState<QuoteOut[] | null>(null);
  const [quoteText, setQuoteText] = useState("");
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [quoteEditorOpen, setQuoteEditorOpen] = useState(false);
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
    void loadQuotes();
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
    for (const evt of events ?? []) {
      const key = monthKeyForEvent(evt);
      map.set(key, [...(map.get(key) ?? []), evt]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => monthSortValue(b) - monthSortValue(a))
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
    return { today, daysLeft, reminderDays, nextPeriodStart: cycleDashboard.stats.next_period_start };
  }, [cycleDashboard, cyclePromptDismissed, me]);

  async function load() {
    try {
      const list = await api.listEvents();
      setEvents(list);
    } catch {
      setEvents([]);
    }
  }

  async function loadAnniversary(startedOn: string) {
    try {
      const next = await api.getAnniversary();
      setAnniversary(next);
    } catch {
      setAnniversary(immediateAnniversary(startedOn));
    }
  }

  async function loadQuotes() {
    try {
      setQuotes(await api.listQuotes());
    } catch {
      setQuotes([]);
    }
  }

  function toggleMonth(month: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
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

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = quoteText.trim();
    if (!text) return;
    setQuoteSaving(true);
    try {
      await api.createQuote(text);
      setQuoteText("");
      toast.success("语录已添加");
      await loadQuotes();
      await loadAnniversary(me!.love_started_on);
      setQuoteEditorOpen(false);
    } finally {
      setQuoteSaving(false);
    }
  }

  async function deleteQuote(id: number) {
    await api.deleteQuote(id);
    toast.success("语录已删除");
    await loadQuotes();
    await loadAnniversary(me!.love_started_on);
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

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader />

      <div className="max-w-3xl mx-auto px-5 sm:px-6 pt-6 pb-[calc(env(safe-area-inset-bottom,0px)+7rem)]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl text-ink leading-tight">
              我们的甜蜜小事
            </h2>
            <p className="font-sc text-sm text-ink-soft mt-1">
              把每一次心动、想念和日常，都慢慢写成只属于你们的书。
            </p>
          </div>
          <Link
            href="/cycle"
            className="hidden h-11 w-11 flex-none place-items-center rounded-full bg-surface-raised/70 text-rose-deep shadow-soft transition hover:-translate-y-0.5 hover:bg-surface-raised focus-ring sm:grid"
            aria-label="进入月经周期记录"
            title="月经周期记录"
          >
            <Moon className="h-5 w-5" />
          </Link>
        </div>

        {anniversary && (
          <AnniversaryCard
            data={anniversary}
            userName={me.user.display_name}
            counterpartName={me.counterpart.display_name}
            quotes={quotes}
            quoteText={quoteText}
            quoteSaving={quoteSaving}
            quoteEditorOpen={quoteEditorOpen}
            quoteRefreshing={quoteRefreshing}
            onQuoteTextChange={setQuoteText}
            onCreateQuote={createQuote}
            onDeleteQuote={deleteQuote}
            onRefreshQuote={refreshAnniversary}
            onOpenQuoteEditor={() => setQuoteEditorOpen(true)}
            onCloseQuoteEditor={() => {
              setQuoteText("");
              setQuoteEditorOpen(false);
            }}
          />
        )}

        {events === null ? (
          <ListSkeleton />
        ) : events.length === 0 ? (
          <EmptyState />
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
      </div>

      {cyclePrompt && (
        <CycleCheckInPrompt
          daysLeft={cyclePrompt.daysLeft}
          nextPeriodStart={cyclePrompt.nextPeriodStart}
          onDismiss={dismissTodayCyclePrompt}
        />
      )}

      <Link
        href="/create"
        className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] z-30 btn-primary rounded-full pl-5 pr-6 py-3.5 shadow-glow font-sc text-sm font-medium inline-flex items-center gap-2 focus-ring min-h-[52px]"
        aria-label="记一笔新事"
      >
        <Plus className="h-4 w-4" />
        记一笔
      </Link>
    </div>
  );
}

function AnniversaryCard({
  data,
  userName,
  counterpartName,
  quotes,
  quoteText,
  quoteSaving,
  quoteEditorOpen,
  quoteRefreshing,
  onQuoteTextChange,
  onCreateQuote,
  onDeleteQuote,
  onRefreshQuote,
  onOpenQuoteEditor,
  onCloseQuoteEditor,
}: {
  data: AnniversaryOut;
  userName: string;
  counterpartName: string;
  quotes: QuoteOut[] | null;
  quoteText: string;
  quoteSaving: boolean;
  quoteEditorOpen: boolean;
  quoteRefreshing: boolean;
  onQuoteTextChange: (text: string) => void;
  onCreateQuote: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteQuote: (id: number) => void;
  onRefreshQuote: () => void;
  onOpenQuoteEditor: () => void;
  onCloseQuoteEditor: () => void;
}) {
  const items = [
    ...data.anniversary_items,
    ...data.love_festival_items,
    ...data.holiday_items,
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-3xl p-5 sm:p-6 mb-6 overflow-hidden"
    >
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-2xl bg-rose/12 text-rose-deep grid place-items-center flex-none">
          <CalendarHeart className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 break-words font-display text-2xl text-ink leading-tight">
              {userName} 和 {counterpartName} 在一起第 {data.days_together} 天
            </p>
            <div className="flex flex-none items-center gap-1">
              <button
                type="button"
                onClick={onRefreshQuote}
                disabled={quoteRefreshing}
                className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-white/70 hover:text-rose-deep disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
                aria-label="刷新语录"
              >
                <RefreshCw className={`h-4 w-4 ${quoteRefreshing ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={quoteEditorOpen ? onCloseQuoteEditor : onOpenQuoteEditor}
                className="grid h-9 w-9 place-items-center rounded-full text-ink-muted transition hover:bg-white/70 hover:text-rose-deep focus-ring"
                aria-label={quoteEditorOpen ? "收起语录编辑" : "编辑语录库"}
              >
                {quoteEditorOpen ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <p className="font-sc text-sm text-ink-soft mt-2 leading-relaxed">
            {data.message}
          </p>
          {items.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {items.map((item, index) => (
                <ReminderPill key={`${item.type}-${item.label}-${index}`} item={item} />
              ))}
            </div>
          )}
          {quoteEditorOpen && (
            <QuoteEditor
              quotes={quotes}
              quoteText={quoteText}
              quoteSaving={quoteSaving}
              onQuoteTextChange={onQuoteTextChange}
              onCreateQuote={onCreateQuote}
              onDeleteQuote={onDeleteQuote}
            />
          )}
        </div>
      </div>
    </motion.section>
  );
}

function QuoteEditor({
  quotes,
  quoteText,
  quoteSaving,
  onQuoteTextChange,
  onCreateQuote,
  onDeleteQuote,
}: {
  quotes: QuoteOut[] | null;
  quoteText: string;
  quoteSaving: boolean;
  onQuoteTextChange: (text: string) => void;
  onCreateQuote: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteQuote: (id: number) => void;
}) {
  return (
    <div className="mt-5 border-t border-line/70 pt-4">
      <form onSubmit={onCreateQuote} className="mt-4 flex gap-2">
        <input
          value={quoteText}
          onChange={(event) => onQuoteTextChange(event.target.value)}
          maxLength={500}
          placeholder="写一句想随机出现的话"
          className="min-w-0 flex-1 rounded-2xl border border-line/80 bg-white/70 px-4 py-3 font-sc text-sm text-ink outline-none transition focus:border-rose/50"
        />
        <button
          type="submit"
          disabled={quoteSaving || !quoteText.trim()}
          className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-rose text-white shadow-soft transition hover:bg-rose-deep disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
          aria-label="保存语录"
        >
          <Check className="h-4 w-4" />
        </button>
      </form>

      <div className="mt-4 space-y-2">
        {quotes === null ? (
          <p className="font-sc text-sm text-ink-muted">正在读取语录...</p>
        ) : quotes.length === 0 ? (
          <p className="font-sc text-sm text-ink-muted">还没有自定义语录，普通日会先使用默认语录。</p>
        ) : (
          quotes.map((quote) => (
            <div
              key={quote.id}
              className="flex items-start gap-3 rounded-2xl bg-cream-deep/45 px-4 py-3"
            >
              <p className="min-w-0 flex-1 break-words font-sc text-sm leading-relaxed text-ink-soft">
                {quote.text}
              </p>
              <button
                onClick={() => onDeleteQuote(quote.id)}
                className="grid h-8 w-8 flex-none place-items-center rounded-full text-ink-muted transition hover:bg-white/70 hover:text-rose-deep focus-ring"
                aria-label="删除语录"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReminderPill({ item }: { item: ReminderItem }) {
  const Icon = item.type === "anniversary" ? Sparkles : item.type === "love_festival" ? Gift : CalendarHeart;
  return (
    <span className="pill bg-rose/10 text-rose-deep inline-flex items-center gap-1.5">
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
    <section className="glass-card overflow-hidden rounded-3xl">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[64px] w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-white/45 focus-ring sm:px-6"
        aria-expanded={expanded}
      >
        <div>
          <h3 className="font-display text-xl leading-tight text-ink">{monthLabel(month)}</h3>
          <p className="mt-1 font-sc text-xs text-ink-muted">{events.length} 件小事</p>
        </div>
        <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-surface-raised/70 text-ink-soft">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {expanded && (
        <ul className="space-y-3 border-t border-line/60 p-3 sm:p-4">
          {events.map((evt, idx) => (
            <motion.li
              key={evt.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.03, 0.18), duration: 0.24 }}
            >
              <EventCard evt={evt} nested />
            </motion.li>
          ))}
        </ul>
      )}
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
  const title = daysLeft === 0 ? "预计今天来月经" : `预计还有 ${daysLeft} 天来月经`;
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-40 mx-auto w-full max-w-3xl px-5 sm:bottom-6">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-3xl p-5 shadow-glow"
        role="dialog"
        aria-label="周期记录提醒"
      >
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-rose/12 text-rose-deep">
            <Droplet className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-xl leading-tight text-ink">{title}</h3>
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

function EventCard({ evt, nested = false }: { evt: EventSummary; nested?: boolean }) {
  const me = useAppStore((s) => s.me)!;
  const author =
    evt.creator_id === me.user.id ? me.user : me.counterpart;

  return (
    <Link
      href={`/timeline/${evt.id}`}
      className="block group focus-ring rounded-3xl"
    >
      <article
        className={`rounded-3xl p-5 transition-transform group-hover:-translate-y-0.5 group-active:translate-y-0 sm:p-6 ${
          nested ? "bg-surface-raised/60" : "glass-card"
        }`}
      >
        <header className="flex items-start gap-3">
          <Avatar user={author} size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-sc text-xs text-ink-muted">
              {author.display_name} ·{" "}
              <span title={formatAbsolute(evt.created_at)}>
                {formatRelative(evt.created_at)}
              </span>
            </p>
            <h3 className="font-display text-xl text-ink mt-0.5 leading-snug truncate">
              {evt.title}
            </h3>
          </div>
        </header>

        {evt.description && (
          <p className="font-sc text-sm text-ink-soft mt-3 leading-relaxed line-clamp-2">
            {evt.description}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <VisibilityBadge mode={evt.visibility_mode} />
          <SubmissionBadge state={evt.submission_state} mode={evt.visibility_mode} />
          {evt.occurred_at && (
            <span className="pill bg-cream-deep/70 text-ink-soft inline-flex items-center gap-1">
              <span className="h-1 w-1 rounded-full bg-rose" />
              {formatAbsolute(evt.occurred_at, false)}
            </span>
          )}
        </div>
      </article>
    </Link>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-4">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="glass-card rounded-3xl p-5 sm:p-6 relative overflow-hidden"
        >
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-line/40" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 rounded-full bg-line/40" />
              <div className="h-5 w-2/3 rounded-full bg-line/40" />
              <div className="h-3 w-full rounded-full bg-line/30" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="glass-card rounded-3xl px-6 py-12 text-center">
      <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-rose/10 text-rose mb-4">
        <BookHeart className="h-6 w-6" />
      </div>
      <p className="font-display text-xl text-ink">还是空白的一页</p>
      <p className="font-sc text-sm text-ink-soft mt-2">
        从今天的小事开始，记下来你们就拥有了它。
      </p>
      <Link
        href="/create"
        className="btn-primary mt-6 inline-flex items-center gap-2 rounded-full px-5 py-3 font-sc text-sm focus-ring"
      >
        <Plus className="h-4 w-4" />
        写第一笔
      </Link>
    </div>
  );
}
