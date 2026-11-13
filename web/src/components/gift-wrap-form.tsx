"use client";

// Gift wrapping form for "送一份礼物": the sender names the gift, hides a card message, leaves a teaser on the box, picks one of five code-drawn wrapping papers with a live box preview, adds up to six photos (system picker, no camera capture), and can set an earliest open time; submits multipart to POST /events/gifts/wrap.

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Hourglass, ImagePlus, Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GiftBoxArt } from "@/components/gift-box";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { DEFAULT_GIFT_WRAP_STYLE, GIFT_WRAP_STYLES } from "@/lib/gift-state";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import { useAppStore } from "@/lib/store";
import type { EventDetail, GiftWrapStyle } from "@/lib/types";

const MAX_PHOTOS = 6;

export function GiftWrapStylePicker({
  value,
  onChange,
  disabled,
}: {
  value: GiftWrapStyle;
  onChange: (value: GiftWrapStyle) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="包装纸" className="grid grid-cols-5 gap-2">
      {GIFT_WRAP_STYLES.map((style) => {
        const selected = value === style.value;
        return (
          <button
            key={style.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(style.value)}
            title={style.hint}
            className={cn(
              "flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-2xl p-1.5 transition focus-ring",
              selected ? "bg-peach/22 ring-2 ring-rose/40" : "hover:bg-peach/12",
            )}
          >
            <GiftBoxArt wrapStyle={style.value} className="aspect-square w-full max-w-14" />
            <span className="w-full truncate font-sc text-[11px] text-ink-soft">{style.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function GiftWrapForm({ onCreated }: { onCreated: (event: EventDetail) => void }) {
  const me = useAppStore((state) => state.me);
  const reducedMotion = useReducedMotion();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [teaser, setTeaser] = useState("");
  const [wrapStyle, setWrapStyle] = useState<GiftWrapStyle>(DEFAULT_GIFT_WRAP_STYLE);
  const [waitToOpen, setWaitToOpen] = useState(false);
  const [openAt, setOpenAt] = useState(() => toLocalInputValue(new Date(Date.now() + 24 * 3_600_000)));
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  const receiverName = me?.counterpart.display_name ?? "TA";

  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length + selected.length > MAX_PHOTOS) {
      toast.error(`最多放 ${MAX_PHOTOS} 张照片`);
      return;
    }
    setFiles((current) => [...current, ...selected]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || submitting) return;
    let openAtIso: string | null = null;
    if (waitToOpen && openAt) {
      openAtIso = fromLocalInputValue(openAt);
      if (new Date(openAtIso).getTime() <= Date.now()) {
        toast.error("拆开的时间要选在以后哦");
        return;
      }
    }
    setSubmitting(true);
    try {
      const created = await api.wrapGift({
        title: title.trim(),
        message: message.trim(),
        teaser: teaser.trim(),
        wrapStyle,
        openAt: openAtIso,
        occurredAt: new Date().toISOString(),
        files,
      });
      toast.success(`礼物包好啦，等 ${receiverName} 来拆`);
      onCreated(created);
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="pb-1">
        <p className="mb-1 font-sc text-xs font-semibold text-peach-deep">把心意包起来</p>
        <h1 className="font-display text-2xl font-bold leading-tight text-ink">送一份礼物</h1>
        <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">
          {receiverName} 会先看到一个包好的盒子，亲手拆开之后才知道里面是什么。
        </p>
      </div>

      <section className="gift-wrap-preview form-section flex items-center gap-4" aria-label="包装预览">
        <motion.div
          key={wrapStyle}
          initial={reducedMotion ? { opacity: 0.6 } : { scale: 0.9, rotate: -3, opacity: 0.6 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.emphasis}
          className="w-28 flex-none sm:w-32"
        >
          <GiftBoxArt wrapStyle={wrapStyle} idle reducedMotion={reducedMotion} className="aspect-square w-full" label="礼物包装预览" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="font-sc text-[11px] text-ink-muted">送给 {receiverName}</p>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={teaser.trim() || "empty"}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
              className="scrapbook-hand mt-1 break-words text-lg font-semibold leading-snug text-ink"
            >
              {teaser.trim() || "猜猜里面是什么"}
            </motion.p>
          </AnimatePresence>
          {waitToOpen && openAt && (
            <p className="mt-2 inline-flex items-center gap-1 font-sc text-xs text-ink-soft">
              <Hourglass className="h-3.5 w-3.5" />
              {new Date(openAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 之后才能拆
            </p>
          )}
        </div>
      </section>

      <fieldset className="form-section">
        <legend className="font-sc text-xs font-medium text-ink-muted">选一张包装纸</legend>
        <div className="mt-2">
          <GiftWrapStylePicker value={wrapStyle} onChange={setWrapStyle} disabled={submitting} />
        </div>
      </fieldset>

      <div className="form-section space-y-2">
        <label htmlFor="gift-title" className="font-sc text-xs font-medium text-ink-muted">礼物是什么</label>
        <input id="gift-title" className="input-field font-display text-lg font-semibold" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="例如：一直想要的那支口红" required autoFocus />
        <p className="font-sc text-[11px] text-ink-muted">拆开之前，{receiverName} 看不到这里。</p>
      </div>

      <div className="form-section space-y-2">
        <label htmlFor="gift-teaser" className="font-sc text-xs font-medium text-ink-muted">写在盒子上的小提示（可不写）</label>
        <input id="gift-teaser" className="input-field" value={teaser} onChange={(event) => setTeaser(event.target.value)} maxLength={60} placeholder="例如：和上次路过时你多看了一眼的东西有关" />
      </div>

      <div className="form-section space-y-2">
        <label htmlFor="gift-message" className="font-sc text-xs font-medium text-ink-muted">藏在卡片里的话（可不写）</label>
        <textarea id="gift-message" className="input-field min-h-28 resize-y leading-relaxed" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} placeholder="拆开礼物时，TA 会第一眼读到" />
      </div>

      <div className="form-section">
        <span className="font-sc text-xs font-medium text-ink-muted">照片（可选，最多 {MAX_PHOTOS} 张，拆开后才能看到）</span>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {previews.map((preview, index) => (
            <div key={`${preview.file.name}-${index}`} className="relative">
              <img src={preview.url} alt={`待放进礼物的照片 ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" />
              <button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-1.5 top-1.5 grid h-9 w-9 place-items-center rounded-full bg-surface/95 text-ink focus-ring" aria-label={`移除第 ${index + 1} 张照片`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {previews.length < MAX_PHOTOS && (
            <label className="flex aspect-square min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-peach-deep/35 bg-peach/8 font-sc text-xs text-ink-soft focus-within:ring-2 focus-within:ring-peach-deep/35">
              <ImagePlus className="mb-1 h-5 w-5" />选择照片
              <input type="file" accept="image/*" multiple className="sr-only" onChange={selectFiles} />
            </label>
          )}
        </div>
      </div>

      <div className="form-section space-y-3">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 font-sc text-sm text-ink">
            <Hourglass className="h-4 w-4 text-peach-deep" />
            等到某个时间才能拆
          </span>
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--rose))]" checked={waitToOpen} onChange={(event) => setWaitToOpen(event.target.checked)} />
        </label>
        {waitToOpen && (
          <div className="space-y-2">
            <label htmlFor="gift-open-at" className="font-sc text-xs font-medium text-ink-muted">什么时候才能拆</label>
            <input id="gift-open-at" type="datetime-local" className="input-field font-sc" value={openAt} onChange={(event) => setOpenAt(event.target.value)} />
            <p className="font-sc text-[11px] text-ink-muted">在那之前，{receiverName} 只能看着盒子数日子。</p>
          </div>
        )}
      </div>

      <div className="glass-surface glass-prominent sticky bottom-0 z-10 flex justify-end rounded-[18px] p-2">
        <button type="submit" disabled={!title.trim() || submitting} className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-2xl px-6 font-sc text-[15px] font-medium focus-ring disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}
          {submitting ? "正在包装" : "包好送出"}
        </button>
      </div>
    </form>
  );
}
