"use client";

// Timeline scrapbook entry for gifts: a wrapped box with teaser and "来自 {name}" for the receiver (tap opens the unwrap overlay once allowed, otherwise shows a countdown), a "等 TA 拆开" peek for the sender, and an opened box or polaroid with the receiver's response sticker afterwards; legacy gift_received rows render as opened gifts.

import Link from "next/link";
import { useState } from "react";
import { Gift } from "lucide-react";
import { EventImagePreview } from "@/components/event-image-preview";
import { GiftBoxArt, GiftCardPeek } from "@/components/gift-box";
import { GiftCountdownPill, useGiftClock } from "@/components/gift-countdown";
import { GiftResponseSticker } from "@/components/gift-response-form";
import { GiftUnwrapOverlay } from "@/components/gift-unwrap-overlay";
import { PolaroidFrame, ScrapbookCard } from "@/components/scrapbook-decor";
import { formatAbsolute } from "@/lib/format";
import { cardTilt } from "@/lib/gift-scrapbook";
import { deriveGiftView } from "@/lib/gift-state";
import { useAppStore } from "@/lib/store";
import type { EventSummary } from "@/lib/types";

export function GiftTimelineCard({
  event,
  showMeetingTag = false,
  onChanged,
}: {
  event: EventSummary;
  showMeetingTag?: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const me = useAppStore((state) => state.me)!;
  const now = useGiftClock(event.gift_state === "wrapped" ? event.gift_open_at : null);
  const [unwrapping, setUnwrapping] = useState(false);
  const view = deriveGiftView(event, me.user.id, now);
  const otherId = me.counterpart.id;
  const nameOf = (id: number | null) => (id === me.user.id ? me.user.display_name : id === otherId ? me.counterpart.display_name : "TA");
  const receiverId = view.receiverId ?? (event.creator_id === me.user.id ? otherId : me.user.id);
  const senderId = view.senderId ?? (receiverId === me.user.id ? otherId : me.user.id);
  const senderName = nameOf(senderId);
  const receiverName = receiverId === me.user.id ? "你" : nameOf(receiverId);
  const eventTime = event.occurred_at ?? event.created_at;
  const meetingTag = showMeetingTag ? <span className="scrapbook-tag scrapbook-tag-rose">见面</span> : null;

  if (view.phase === "ready" || view.phase === "sealed") {
    const content = (
      <ScrapbookCard id={event.id} tone="gift">
        <div className="flex items-center gap-3 sm:gap-4">
          <GiftBoxArt wrapStyle={view.wrapStyle} idle={view.phase === "ready"} className="h-20 w-20 flex-none sm:h-24 sm:w-24" />
          <div className="min-w-0 flex-1">
            <p className="font-sc text-xs text-ink-muted">来自 {senderName}</p>
            <h3 className="scrapbook-hand mt-0.5 line-clamp-2 break-words text-lg font-semibold leading-snug text-ink">
              {event.gift_teaser || "一份还没拆开的礼物"}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {view.phase === "ready" ? (
                <span className="scrapbook-tag scrapbook-tag-peach gift-ready-tag">
                  <Gift className="h-3 w-3" aria-hidden="true" />
                  可以拆啦
                </span>
              ) : (
                <GiftCountdownPill openAt={event.gift_open_at} now={now} />
              )}
              {meetingTag}
            </div>
          </div>
        </div>
      </ScrapbookCard>
    );

    if (view.phase === "ready") {
      return (
        <>
          <button type="button" onClick={() => setUnwrapping(true)} className="scrapbook-entry block w-full rounded-2xl text-left focus-ring" aria-label={`拆开来自 ${senderName} 的礼物`}>
            {content}
          </button>
          <GiftUnwrapOverlay
            open={unwrapping}
            eventId={event.id}
            wrapStyle={view.wrapStyle}
            teaser={event.gift_teaser}
            senderName={senderName}
            onClose={() => setUnwrapping(false)}
            onFinished={() => {
              setUnwrapping(false);
              void onChanged();
            }}
          />
        </>
      );
    }
    return (
      <Link href={`/timeline/${event.id}`} className="scrapbook-entry block rounded-2xl focus-ring">
        {content}
      </Link>
    );
  }

  if (view.phase === "waiting") {
    return (
      <Link href={`/timeline/${event.id}`} className="scrapbook-entry block rounded-2xl focus-ring">
        <ScrapbookCard id={event.id} tone="gift">
          <div className="flex items-center gap-3 sm:gap-4">
            <GiftBoxArt wrapStyle={view.wrapStyle} className="h-20 w-20 flex-none sm:h-24 sm:w-24" />
            <div className="min-w-0 flex-1">
              <p className="font-sc text-xs text-ink-muted">送给 {receiverName}</p>
              <h3 className="scrapbook-hand mt-0.5 line-clamp-2 break-words text-lg font-semibold leading-snug text-ink">{event.title}</h3>
              {event.gift_teaser && (
                <p className="mt-1 line-clamp-1 font-sc text-xs text-ink-soft">盒子上写着：{event.gift_teaser}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="gift-waiting-stamp">等 {receiverName} 拆开</span>
                <GiftCountdownPill openAt={event.gift_open_at} now={now} />
                {meetingTag}
              </div>
            </div>
          </div>
        </ScrapbookCard>
      </Link>
    );
  }

  return (
    <Link href={`/timeline/${event.id}`} className="scrapbook-entry block rounded-2xl focus-ring">
      <ScrapbookCard id={event.id} tone="gift">
        <div className="flex items-start gap-3 sm:gap-4">
          {event.preview_image ? (
            <PolaroidFrame tilt={-cardTilt(event.id + 7)} className="w-20 flex-none sm:w-24">
              <EventImagePreview imageId={event.preview_image.id} alt={`${event.title}的照片`} className="aspect-square w-full" />
            </PolaroidFrame>
          ) : (
            <GiftBoxArt wrapStyle={view.wrapStyle} stage="open" inside={<GiftCardPeek />} className="h-20 w-20 flex-none sm:h-24 sm:w-24" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-sc text-xs text-ink-muted">
              {view.legacy ? `${receiverName}收到的礼物` : `${senderName} 送给 ${receiverName}`}
              <span aria-hidden="true"> · </span>
              <time dateTime={eventTime}>{formatAbsolute(eventTime, false)}</time>
            </p>
            <h3 className="scrapbook-hand mt-0.5 line-clamp-2 break-words text-lg font-semibold leading-snug text-ink">{event.title}</h3>
            {meetingTag && <div className="mt-1.5 flex flex-wrap gap-1.5">{meetingTag}</div>}
            {view.hasResponse ? (
              <div className="mt-2">
                <GiftResponseSticker
                  feelings={event.gift_feelings}
                  rating={event.gift_rating}
                  feedback={view.feedback}
                  receiverName={receiverName}
                  compact
                />
              </div>
            ) : (
              <p className="mt-1.5 font-sc text-xs text-ink-muted">
                {view.canRespond ? "已经拆开啦，说说收到的感受吧" : `等 ${receiverName} 写下回音`}
              </p>
            )}
          </div>
        </div>
      </ScrapbookCard>
    </Link>
  );
}
