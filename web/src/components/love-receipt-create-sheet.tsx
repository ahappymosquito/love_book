"use client";

// Responsive creation sheet for recording a private gesture for the current partner, with an optional local cover preview.

import { FormEvent, useEffect, useState } from "react";
import { CalendarClock, ImagePlus, Loader2, Send, Trash2 } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { LOVE_RECEIPT_TYPE_OPTIONS } from "@/lib/love-receipts";
import type { LoveReceiptOut, LoveReceiptType } from "@/lib/types";

export function LoveReceiptCreateSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (receipt: LoveReceiptOut) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [type, setType] = useState<LoveReceiptType>("gift");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [requireReceipt, setRequireReceipt] = useState(true);
  const [cover, setCover] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!cover) {
      setCoverUrl(null);
      return;
    }
    const url = URL.createObjectURL(cover);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  function reset() {
    setType("gift");
    setTitle("");
    setMessage("");
    setExpectedAt("");
    setRequireReceipt(true);
    setCover(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const receipt = await api.createLoveReceipt({
        type,
        title: title.trim(),
        message: message.trim(),
        expectedArrivalAt: expectedAt ? new Date(expectedAt).toISOString() : null,
        requireReceipt,
        cover,
      });
      toast.success("这份心意已经记下，正在等 TA 接住");
      reset();
      onOpenChange(false);
      onCreated(receipt);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting && (title || message || cover) && !window.confirm("这份心意还没有保存，确定离开吗？")) return;
        onOpenChange(next);
        if (!next && !submitting) reset();
      }}
    >
      <SheetBody open={open}>
        <SheetContent reducedMotion={reducedMotion} className="overflow-y-auto sm:inset-x-0 sm:mx-auto sm:w-[min(680px,calc(100%-2rem))]">
          <div className="pr-12">
            <SheetTitle className="font-display text-xl font-semibold text-ink">送一份心意</SheetTitle>
            <SheetDescription className="mt-1 font-sc text-sm text-ink-muted">
              先记下你想送出的在意，不需要填写价格或订单。
            </SheetDescription>
          </div>

          <form onSubmit={submit} className="mt-5 space-y-5">
            <fieldset>
              <legend className="mb-2 font-sc text-sm font-medium text-ink">这是一份什么心意</legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {LOVE_RECEIPT_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setType(option.value)}
                    className={`min-h-[68px] rounded-xl px-2 py-2 font-sc text-xs transition focus-ring ${
                      type === option.value ? "bg-rose/14 text-rose-deep ring-1 ring-rose/30" : "bg-cream-deep/48 text-ink-soft hover:bg-peach/18"
                    }`}
                    aria-pressed={type === option.value}
                  >
                    <span className="block text-xl" aria-hidden="true">{option.emoji}</span>
                    <span className="mt-1 block truncate">{option.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-2 block font-sc text-sm font-medium text-ink">心意标题</span>
              <input className="input-field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="例如：忙碌一天后的热晚饭" required />
            </label>

            <label className="block">
              <span className="mb-2 block font-sc text-sm font-medium text-ink">想对 TA 说</span>
              <textarea className="input-field min-h-24 resize-y py-3" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} placeholder="把为什么想送给 TA 写下来" />
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-2 font-sc text-sm font-medium text-ink"><CalendarClock className="h-4 w-4 text-rose-deep" />预计送到</span>
              <input type="datetime-local" className="input-field" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} />
            </label>

            <div>
              <span className="mb-2 block font-sc text-sm font-medium text-ink">封面照片（可选）</span>
              {coverUrl ? (
                <div className="relative overflow-hidden rounded-2xl bg-cream-deep/55">
                  <img src={coverUrl} alt="心意封面预览" className="h-40 w-full object-cover" />
                  <button type="button" onClick={() => setCover(null)} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-surface/95 text-ink shadow-sm focus-ring" aria-label="移除封面照片">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-rose/35 bg-rose/5 px-4 font-sc text-sm text-rose-deep transition hover:bg-rose/9 focus-within:ring-2 focus-within:ring-rose/40">
                  <ImagePlus className="h-5 w-5" />选择一张照片
                  <input type="file" accept="image/*" className="sr-only" onChange={(event) => setCover(event.target.files?.[0] ?? null)} />
                </label>
              )}
            </div>

            <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-sage/10 px-4 py-3">
              <span>
                <span className="block font-sc text-sm font-medium text-ink">需要 TA 留下回执</span>
                <span className="mt-0.5 block font-sc text-xs text-ink-muted">收到后拍照，再写一句回应</span>
              </span>
              <input type="checkbox" checked={requireReceipt} onChange={(event) => setRequireReceipt(event.target.checked)} className="h-5 w-5 accent-[rgb(var(--rose))]" />
            </label>

            <button type="submit" disabled={submitting || !title.trim()} className="btn-primary flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 font-sc text-sm font-semibold disabled:opacity-50 focus-ring">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}
              {submitting ? "正在记下" : "送出这份心意"}
            </button>
          </form>
        </SheetContent>
      </SheetBody>
    </Sheet>
  );
}
