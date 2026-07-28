"use client";

// Received-gift form with independent feedback, up to three honest feeling tags, rating, time, and six image previews.

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarHeart, Gift, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { GIFT_FEELING_OPTIONS } from "@/lib/gift-feelings";
import type { EventDetail, GiftFeeling } from "@/lib/types";
import { cn } from "@/lib/cn";

export function ReceivedGiftForm({ onCreated }: { onCreated: (event: EventDetail) => void }) {
  const [title, setTitle] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feelings, setFeelings] = useState<GiftFeeling[]>([]);
  const [occurredAt, setOccurredAt] = useState(toLocalInputValue(new Date()));
  const [rating, setRating] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (files.length + selected.length > 6) {
      toast.error("一次最多选择 6 张照片");
      event.target.value = "";
      return;
    }
    setFiles((current) => [...current, ...selected]);
    event.target.value = "";
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await api.createReceivedGift({
        title: title.trim(),
        feedback: feedback.trim(),
        feelings,
        occurredAt: occurredAt ? fromLocalInputValue(occurredAt) : null,
        rating,
        files,
      });
      toast.success("这份收礼已经放进时间线");
      onCreated(created);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFeeling(value: GiftFeeling) {
    setFeelings((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      if (current.length >= 3) {
        toast.error("最多选择 3 个感受");
        return current;
      }
      return [...current, value];
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="pb-2">
        <p className="mb-1 font-sc text-xs font-semibold text-peach-deep">把收到心意的这一刻留下来</p>
        <h1 className="font-display text-2xl font-bold leading-tight text-ink">记一份收礼</h1>
        <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">礼物名称之外都可以跳过，想写多少由你决定。</p>
      </div>

      <div className="form-section space-y-2">
        <label htmlFor="gift-title" className="font-sc text-xs font-medium text-ink-muted">礼物名称</label>
        <input id="gift-title" className="input-field font-display text-lg font-semibold" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="例如：下班后收到的一束花" required autoFocus />
      </div>

      <div className="form-section space-y-2">
        <label htmlFor="gift-feedback" className="font-sc text-xs font-medium text-ink-muted">想记下的反馈（可不写）</label>
        <textarea id="gift-feedback" className="input-field min-h-28 resize-y leading-relaxed" value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={2000} placeholder="喜欢、不喜欢，或者想对 TA 说的话，都可以认真写下来" />
      </div>

      <fieldset className="form-section">
        <legend className="font-sc text-xs font-medium text-ink-muted">收到时的感受（可选，最多 3 个）</legend>
        <p className="mt-1 font-sc text-xs leading-relaxed text-ink-muted">真实感受不只一种，开心或有点复杂都值得留下。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {GIFT_FEELING_OPTIONS.map((option) => {
            const selected = feelings.includes(option.value);
            const unavailable = !selected && feelings.length >= 3;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleFeeling(option.value)}
                aria-pressed={selected}
                disabled={unavailable}
                className={cn(
                  "min-h-11 rounded-full px-3.5 font-sc text-xs transition focus-ring disabled:cursor-not-allowed disabled:opacity-45",
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

      <fieldset className="form-section">
        <legend className="font-sc text-xs font-medium text-ink-muted">给这份礼物打分（可选）</legend>
        <div className="mt-2 flex items-center gap-1" aria-label={rating ? `${rating} 星` : "尚未评分"}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button key={star} type="button" onClick={() => setRating(rating === star ? null : star)} aria-label={`${star} 星`} aria-pressed={rating === star} className="grid h-11 w-11 place-items-center rounded-full text-peach-deep transition hover:bg-peach/18 focus-ring">
              <Star className={`h-6 w-6 ${star <= (rating ?? 0) ? "fill-current" : ""}`} />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="form-section">
        <span className="font-sc text-xs font-medium text-ink-muted">照片（可选，最多 6 张）</span>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {previews.map((preview, index) => (
            <div key={`${preview.file.name}-${index}`} className="relative">
              <img src={preview.url} alt={`待保存照片 ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" />
              <button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-1.5 top-1.5 grid h-9 w-9 place-items-center rounded-full bg-surface/95 text-ink focus-ring" aria-label={`移除第 ${index + 1} 张照片`}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {previews.length < 6 && (
            <label className="flex aspect-square min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-peach-deep/35 bg-peach/8 font-sc text-xs text-ink-soft focus-within:ring-2 focus-within:ring-peach-deep/35">
              <ImagePlus className="mb-1 h-5 w-5" />选择照片
              <input type="file" accept="image/*" multiple className="sr-only" onChange={selectFiles} />
            </label>
          )}
        </div>
      </div>

      <div className="form-section space-y-2">
        <label htmlFor="gift-time" className="inline-flex items-center gap-1.5 font-sc text-xs font-medium text-ink-muted"><CalendarHeart className="h-3.5 w-3.5" />收到时间</label>
        <input id="gift-time" type="datetime-local" className="input-field font-sc" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
      </div>

      <div className="glass-surface glass-prominent sticky bottom-0 z-10 flex justify-end rounded-[18px] p-2">
        <button type="submit" disabled={!title.trim() || submitting} className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-2xl px-6 font-sc text-[15px] font-medium focus-ring disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Gift className="h-4 w-4" />}
          {submitting ? "正在收藏" : "收藏这份收礼"}
        </button>
      </div>
    </form>
  );
}
