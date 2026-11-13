"use client";

// Receiver response for an opened gift: up to three feeling chips, a one-to-five postage-stamp rating, and written feedback, saved through PUT /events/{id}/gift/response; also exports the read-only stamp row and response sticker used on timeline and detail.

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Heart, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { GIFT_FEELING_OPTIONS, giftFeelingMeta } from "@/lib/gift-feelings";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import type { EventDetail, GiftFeeling } from "@/lib/types";

export function GiftStampRating({
  value,
  onChange,
  size = "md",
  disabled,
}: {
  value: number | null;
  onChange?: (value: number | null) => void;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const interactive = Boolean(onChange);
  return (
    <div
      className={cn("flex items-center", size === "sm" ? "gap-1" : "gap-1.5")}
      role={interactive ? "radiogroup" : "img"}
      aria-label={value ? `盖了 ${value} 枚喜欢印章` : interactive ? "盖几枚喜欢印章" : "还没有盖章"}
    >
      {[1, 2, 3, 4, 5].map((stamp) => {
        const filled = stamp <= (value ?? 0);
        const body = (
          <span className={cn("gift-stamp", filled && "gift-stamp-filled", size === "sm" ? "gift-stamp-sm" : "gift-stamp-md")}>
            <Heart className={size === "sm" ? "h-2.5 w-2.5" : "h-4 w-4"} fill={filled ? "currentColor" : "none"} aria-hidden="true" />
          </span>
        );
        if (!interactive) return <span key={stamp}>{body}</span>;
        return (
          <motion.button
            key={stamp}
            type="button"
            role="radio"
            aria-checked={value === stamp}
            aria-label={`${stamp} 枚印章`}
            disabled={disabled}
            whileTap={reducedMotion ? undefined : { scale: 0.9, rotate: -4 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.press}
            onClick={() => onChange?.(value === stamp ? null : stamp)}
            className="grid min-h-11 min-w-11 place-items-center rounded-xl focus-ring"
          >
            {body}
          </motion.button>
        );
      })}
    </div>
  );
}

export function GiftResponseSticker({
  feelings,
  rating,
  feedback,
  receiverName,
  compact = false,
}: {
  feelings: GiftFeeling[];
  rating: number | null;
  feedback: string | null;
  receiverName: string;
  compact?: boolean;
}) {
  if (feelings.length === 0 && !rating && !feedback) return null;
  const shownFeelings = compact ? feelings.slice(0, 2) : feelings;
  return (
    <div className={cn("gift-response-sticker", compact && "gift-response-sticker-compact")}>
      <p className="font-sc text-[11px] font-semibold text-rose-deep">{receiverName} 的回音</p>
      {shownFeelings.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {shownFeelings.map((feeling) => {
            const meta = giftFeelingMeta(feeling);
            return (
              <span key={feeling} className="inline-flex min-h-6 items-center rounded-full bg-surface-raised px-2 font-sc text-[11px] text-ink-soft hairline">
                {meta.emoji} {meta.label}
              </span>
            );
          })}
        </div>
      )}
      {rating ? <div className="mt-2"><GiftStampRating value={rating} size="sm" /></div> : null}
      {feedback && (
        <p className={cn("mt-2 whitespace-pre-wrap break-words font-sc text-sm leading-relaxed text-ink-soft", compact && "line-clamp-2")}>
          {feedback}
        </p>
      )}
    </div>
  );
}

export function GiftResponseForm({
  eventId,
  initialFeelings = [],
  initialRating = null,
  initialFeedback = "",
  submitLabel = "留下回音",
  onSaved,
  onSkip,
}: {
  eventId: number;
  initialFeelings?: GiftFeeling[];
  initialRating?: number | null;
  initialFeedback?: string;
  submitLabel?: string;
  onSaved: (event: EventDetail) => void;
  onSkip?: () => void;
}) {
  const [feelings, setFeelings] = useState<GiftFeeling[]>(initialFeelings);
  const [rating, setRating] = useState<number | null>(initialRating);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [saving, setSaving] = useState(false);
  const canSubmit = feelings.length > 0 || rating !== null || feedback.trim().length > 0;

  function toggleFeeling(value: GiftFeeling) {
    setFeelings((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      if (current.length >= 3) {
        toast.error("最多选 3 个感受");
        return current;
      }
      return [...current, value];
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const updated = await api.respondGift(eventId, { feelings, rating, feedback: feedback.trim() });
      toast.success("TA 会看到你的回音");
      onSaved(updated);
    } catch {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="font-sc text-xs font-medium text-ink-muted">收到时的感受（最多 3 个）</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {GIFT_FEELING_OPTIONS.map((option) => {
            const selected = feelings.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                disabled={saving || (!selected && feelings.length >= 3)}
                onClick={() => toggleFeeling(option.value)}
                className={cn(
                  "min-h-10 rounded-full px-3 font-sc text-xs transition focus-ring disabled:cursor-not-allowed disabled:opacity-45",
                  selected
                    ? option.tone === "warm"
                      ? "bg-peach/32 text-ink ring-1 ring-peach-deep/30"
                      : "bg-rose/12 text-ink ring-1 ring-rose-deep/24"
                    : "bg-cream-deep/55 text-ink-soft hover:bg-peach/18",
                )}
              >
                {option.emoji} {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-sc text-xs font-medium text-ink-muted">盖几枚喜欢印章（可选）</legend>
        <div className="mt-1">
          <GiftStampRating value={rating} onChange={setRating} disabled={saving} />
        </div>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor={`gift-feedback-${eventId}`} className="font-sc text-xs font-medium text-ink-muted">想对 TA 说</label>
        <textarea
          id={`gift-feedback-${eventId}`}
          className="input-field min-h-24 resize-y leading-relaxed"
          value={feedback}
          maxLength={2000}
          disabled={saving}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="喜欢哪里、想到了什么，或者一句谢谢"
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {onSkip && (
          <button type="button" onClick={onSkip} disabled={saving} className="btn-ghost min-h-11 rounded-full px-4 font-sc text-sm focus-ring">
            晚点再写
          </button>
        )}
        <button
          type="submit"
          disabled={!canSubmit || saving}
          className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
