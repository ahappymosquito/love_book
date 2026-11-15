"use client";

// 手账里的一条小事：普通小事是带头像、北京时间时分、徽章和拍立得缩略图的日记卡，礼物交给 GiftTimelineCard；另导出见面徽章和拍立得缩略图，供首页见面视图复用。

import Link from "next/link";
import { CalendarHeart } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EventImagePreview } from "@/components/event-image-preview";
import { GiftTimelineCard } from "@/components/gift-timeline-card";
import { PolaroidFrame, ScrapbookCard } from "@/components/scrapbook-decor";
import { SubmissionBadge, VisibilityBadge } from "@/components/visibility-badge";
import { shanghaiTimeLabel } from "@/lib/dates";
import { cardTilt } from "@/lib/gift-scrapbook";
import { isGiftEvent } from "@/lib/gift-state";
import { useAppStore } from "@/lib/store";
import type { EventSummary } from "@/lib/types";

export function MeetingBadge() {
  return (
    <span className="pill inline-flex items-center gap-1 bg-rose/10 text-rose-deep">
      <CalendarHeart className="h-3.5 w-3.5" />
      见面
    </span>
  );
}

export function EventPolaroid({ event }: { event: EventSummary }) {
  if (!event.preview_image) return null;
  return (
    <PolaroidFrame tilt={-cardTilt(event.id + 7)} className="w-[4.5rem] flex-none sm:w-24">
      <EventImagePreview imageId={event.preview_image.id} alt={`${event.title}的照片`} className="aspect-square w-full" />
    </PolaroidFrame>
  );
}

export function TimelineEntry({ event, onChanged }: { event: EventSummary; onChanged: () => Promise<void> }) {
  const isMeeting = event.meeting_session_id !== null;
  if (isGiftEvent(event)) return <GiftTimelineCard event={event} showMeetingTag={isMeeting} onChanged={onChanged} />;
  return <MemoryEntry event={event} isMeeting={isMeeting} />;
}

function MemoryEntry({ event, isMeeting }: { event: EventSummary; isMeeting: boolean }) {
  const me = useAppStore((state) => state.me)!;
  const author = event.creator_id === me.user.id ? me.user : me.counterpart;
  const time = event.occurred_at ?? event.created_at;

  return (
    <Link href={`/timeline/${event.id}`} className="scrapbook-entry block rounded-2xl focus-ring">
      <ScrapbookCard id={event.id} tone={isMeeting ? "meeting" : "memory"}>
        <div className="flex items-start gap-3">
          <Avatar user={author} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sc text-xs text-ink-muted">
              <span>{author.display_name}</span>
              <span className="h-1 w-1 rounded-full bg-line" />
              <time dateTime={time}>{shanghaiTimeLabel(time)}</time>
            </div>

            <h3 className="scrapbook-hand mt-1 line-clamp-2 break-words text-lg font-semibold leading-snug text-ink">
              {event.title}
            </h3>

            {event.description && (
              <p className="mt-2 line-clamp-3 font-sc text-sm leading-relaxed text-ink-soft">{event.description}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {isMeeting && <MeetingBadge />}
              {isMeeting && event.meeting_session && (
                <span className="pill inline-flex max-w-full items-center gap-1 truncate bg-peach/22 text-ink-soft">
                  {event.meeting_session.title}
                </span>
              )}
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
