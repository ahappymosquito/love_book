"use client";

// Timeline home screen showing pair reminders, event list, visibility state, and entry creation shortcuts.

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookHeart, CalendarHeart, Gift, Plus, Sparkles } from "lucide-react";
import { AuthGate } from "@/components/auth-gate";
import { TimelineHeader } from "@/components/timeline-header";
import { Avatar } from "@/components/avatar";
import { SubmissionBadge, VisibilityBadge } from "@/components/visibility-badge";
import { LoadingScreen } from "@/components/loading-screen";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { formatAbsolute, formatRelative } from "@/lib/format";
import type { AnniversaryOut, EventSummary, ReminderItem } from "@/lib/types";

const QUOTE_CACHE_KEY = "love-book-reminder-quotes";
const LOCAL_REMINDER_QUOTES = [
  "今天也想把温柔攒起来，慢慢都给你。",
  "日子往前走，我还是偏心你。",
  "和你一起的普通一天，也会发一点光。",
];

function todayDateOnly(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function daysTogether(startedOn: string, today: string): number {
  const start = new Date(`${startedOn}T00:00:00`);
  const end = new Date(`${today}T00:00:00`);
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function readQuoteCache(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUOTE_CACHE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberQuote(quote: string) {
  if (typeof window === "undefined") return;
  const trimmed = quote.trim();
  if (!trimmed) return;
  const next = [trimmed, ...readQuoteCache().filter((item) => item !== trimmed)].slice(0, 3);
  window.localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify(next));
}

function immediateAnniversary(startedOn: string): AnniversaryOut {
  const today = todayDateOnly();
  const cached = readQuoteCache();
  return {
    love_started_on: startedOn,
    today,
    days_together: daysTogether(startedOn, today),
    anniversary_items: [],
    love_festival_items: [],
    holiday_items: [],
    message: cached[0] || LOCAL_REMINDER_QUOTES[0],
    message_source: cached[0] ? "hitokoto" : "local",
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

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!me) return;
    setAnniversary(immediateAnniversary(me.love_started_on));
    void loadAnniversary(me.love_started_on);
  }, [me]);

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
      if (
        next.anniversary_items.length === 0 &&
        next.love_festival_items.length === 0 &&
        next.holiday_items.length === 0
      ) {
        rememberQuote(next.message);
      }
      setAnniversary(next);
    } catch {
      setAnniversary(immediateAnniversary(startedOn));
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
              我们的小事
            </h2>
            <p className="font-sc text-sm text-ink-soft mt-1">
              你写一笔，ta 写一笔，慢慢就成了一本书。
            </p>
          </div>
          <BookHeart className="h-7 w-7 text-rose hidden sm:block" />
        </div>

        {anniversary && <AnniversaryCard data={anniversary} />}

        {events === null ? (
          <ListSkeleton />
        ) : events.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-4">
            {events.map((evt, idx) => (
              <motion.li
                key={evt.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.04, 0.32), duration: 0.3 }}
              >
                <EventCard evt={evt} />
              </motion.li>
            ))}
          </ul>
        )}
      </div>

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

function AnniversaryCard({ data }: { data: AnniversaryOut }) {
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
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-display text-2xl text-ink leading-tight">
              一起第 {data.days_together} 天
            </p>
            {data.message_source === "hitokoto" && (
              <span className="pill bg-cream-deep/70 text-ink-soft">一言</span>
            )}
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
        </div>
      </div>
    </motion.section>
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

function EventCard({ evt }: { evt: EventSummary }) {
  const me = useAppStore((s) => s.me)!;
  const author =
    evt.creator_id === me.user.id ? me.user : me.counterpart;

  return (
    <Link
      href={`/timeline/${evt.id}`}
      className="block group focus-ring rounded-3xl"
    >
      <article className="glass-card rounded-3xl p-5 sm:p-6 transition-transform group-hover:-translate-y-0.5 group-active:translate-y-0">
        <header className="flex items-start gap-3">
          <Avatar emoji={author.avatar} name={author.display_name} size="md" />
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
