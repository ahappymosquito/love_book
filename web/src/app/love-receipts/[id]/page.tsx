"use client";

// Role-aware love-receipt detail with honest moods, optional star ratings, private photos, and guarded response composer.

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Camera, Check, Gift, ImagePlus, Loader2, PackageCheck, Send, Star, Trash2, Truck } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { LoveReceiptImage } from "@/components/love-receipt-image";
import { api } from "@/lib/api";
import { formatAbsolute } from "@/lib/format";
import {
  LOVE_RECEIPT_MOOD_OPTIONS,
  LOVE_RECEIPT_STATUS_LABELS,
  QUICK_RECEIPT_MESSAGES,
  loveReceiptMoodMeta,
  loveReceiptProgress,
  loveReceiptTypeMeta,
} from "@/lib/love-receipts";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import type { LoveReceiptMood, LoveReceiptOut } from "@/lib/types";

export default function LoveReceiptDetailPage() {
  return <AuthGate><LoveReceiptDetailInner /></AuthGate>;
}

function LoveReceiptDetailInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const receiptId = Number(params.id);
  const reducedMotion = useReducedMotion();
  const [receipt, setReceipt] = useState<LoveReceiptOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [content, setContent] = useState(search.get("quick") === "thanks" ? QUICK_RECEIPT_MESSAGES[0] : "");
  const [mood, setMood] = useState<LoveReceiptMood | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);
  const dirty = Boolean(content.trim() || mood || rating || files.length);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty || receipt?.status === "completed") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, receipt?.status]);

  const load = useCallback(async () => {
    try {
      setReceipt(await api.getLoveReceipt(receiptId));
    } catch {
      router.replace("/love-receipts");
    } finally {
      setLoading(false);
    }
  }, [receiptId, router]);
  useEffect(() => { if (Number.isFinite(receiptId)) void load(); }, [load, receiptId]);

  async function updateStatus(next: "delivering" | "delivered" | "waiting_receipt") {
    if (!receipt || updating) return;
    setUpdating(true);
    try {
      const updated = await api.updateLoveReceiptStatus(receipt.id, next);
      setReceipt(updated);
      if (updated.status === "completed") {
        setSuccess(true);
        toast.success("这份心意已经被好好接住");
      } else if (next === "waiting_receipt") {
        toast.success("已经确认收到，可以留下照片和回应了");
        requestAnimationFrame(() => document.getElementById("receipt")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
      } else {
        toast.success(next === "delivering" ? "已经记为正在送去" : "已经记为送达");
      }
    } finally {
      setUpdating(false);
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (files.length + selected.length > 3) {
      toast.error("回执最多选择 3 张照片");
      event.target.value = "";
      return;
    }
    setFiles((current) => [...current, ...selected]);
    event.target.value = "";
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!receipt || submitting || !content.trim() || files.length < 1) return;
    setSubmitting(true);
    try {
      const updated = await api.submitLoveReceipt(receipt.id, { content: content.trim(), mood, rating, files });
      setReceipt(updated);
      setContent("");
      setMood(null);
      setRating(null);
      setFiles([]);
      setSuccess(true);
      toast.success("回执已送达 TA");
    } finally {
      setSubmitting(false);
    }
  }

  const canLeave = () => !dirty || receipt?.status === "completed" || window.confirm("回执草稿还没有发送，确定离开吗？");

  if (loading || !receipt) return <DetailSkeleton />;
  const type = loveReceiptTypeMeta(receipt.receipt_type);
  const moodMeta = loveReceiptMoodMeta(receipt.receipt_mood);
  const isReceiver = receipt.viewer_role === "receiver";
  const canConfirm = isReceiver && receipt.status !== "waiting_receipt" && receipt.status !== "completed";
  const canCompose = isReceiver && receipt.require_receipt && receipt.status === "waiting_receipt";

  return (
    <div className="viewport-guard min-h-dvh w-full">
      <AppHeader title="爱的回执" subtitle={LOVE_RECEIPT_STATUS_LABELS[receipt.status]} back={{ href: "/love-receipts", onClick: canLeave }} maxWidth="5xl" />
      <main className="mx-auto w-full max-w-5xl min-w-0 px-4 pt-5 sm:px-6 scroll-pad-bottom">
        {success && (
          <motion.div initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state} className="mb-4 rounded-2xl bg-sage/18 px-4 py-3 font-sc text-sm text-ink" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-rose-deep" />这份心意已经被好好收藏。</span>
          </motion.div>
        )}

        <section className="content-surface overflow-hidden">
          {receipt.cover && <LoveReceiptImage imageId={receipt.cover.id} alt={`${receipt.title}的封面`} full className="h-52 w-full sm:h-72" />}
          <div className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-rose/10 px-3 py-1.5 font-sc text-xs font-medium text-rose-deep">{type.emoji} {type.label}</span>
              <span className={`rounded-full px-3 py-1.5 font-sc text-xs font-medium ${receipt.status === "completed" ? "bg-sage/18 text-ink-soft" : "bg-peach/18 text-ink-soft"}`}>{LOVE_RECEIPT_STATUS_LABELS[receipt.status]}</span>
            </div>
            <h1 className="mt-4 text-balance font-display text-2xl font-semibold leading-tight text-ink sm:text-3xl">{receipt.title}</h1>
            {receipt.message && <p className="mt-3 max-w-2xl whitespace-pre-wrap font-sc text-sm leading-7 text-ink-soft">“{receipt.message}”</p>}
            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-line/55 pt-4 font-sc text-xs text-ink-muted">
              <span className="inline-flex items-center gap-2"><Avatar user={receipt.sender} size="sm" />{receipt.sender.display_name} 送给 {receipt.receiver.display_name}</span>
              <span>{formatAbsolute(receipt.created_at)}</span>
              {receipt.expected_arrival_at && <span>预计 {formatAbsolute(receipt.expected_arrival_at, false)}</span>}
            </div>
          </div>
        </section>

        <ReceiptProgress receipt={receipt} />

        {receipt.viewer_role === "sender" && receipt.status !== "completed" && (
          <section className="form-section mt-5 p-5 sm:p-6">
            <h2 className="font-display text-lg font-semibold text-ink">让 TA 知道它走到哪里了</h2>
            <p className="mt-1 font-sc text-sm text-ink-muted">这里只记录你们知道的进度，不会连接物流平台。</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {receipt.status === "created" && <button type="button" disabled={updating} onClick={() => void updateStatus("delivering")} className="btn-ghost inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-sc text-sm focus-ring disabled:opacity-50"><Truck className="h-4 w-4" />正在送去</button>}
              {receipt.status !== "delivered" && <button type="button" disabled={updating} onClick={() => void updateStatus("delivered")} className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-sc text-sm focus-ring disabled:opacity-50">{updating ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <PackageCheck className="h-4 w-4" />}标记已经送达</button>}
            </div>
          </section>
        )}

        {canConfirm && (
          <section id="receipt" className="form-section mt-5 p-5 sm:p-6 scroll-mt-24">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-rose/10 text-rose-deep"><Gift className="h-5 w-5" /></span>
            <h2 className="mt-3 font-display text-xl font-semibold text-ink">心意到你手里了吗？</h2>
            <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">确认收到后，就可以拍下这一刻，再留一句想对 TA 说的话。</p>
            <button type="button" disabled={updating} onClick={() => void updateStatus("waiting_receipt")} className="btn-primary mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 font-sc text-sm font-semibold focus-ring disabled:opacity-50 sm:w-auto">
              {updating ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <PackageCheck className="h-4 w-4" />}确认已经收到
            </button>
          </section>
        )}

        {canCompose && <ReceiptComposer content={content} setContent={setContent} mood={mood} setMood={setMood} rating={rating} setRating={setRating} previews={previews} removeFile={(index) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} selectFiles={selectFiles} submitting={submitting} submit={submit} />}

        {receipt.status === "completed" && (
          <section className="content-surface mt-5 p-5 sm:p-7">
            <div className="flex items-start gap-3"><Avatar user={receipt.receiver} size="md" /><div><p className="font-display font-semibold text-ink">{receipt.receiver.display_name} 已经收到</p><p className="mt-1 font-sc text-xs text-ink-muted">{receipt.completed_at ? formatAbsolute(receipt.completed_at) : "刚刚完成"}</p></div></div>
            {receipt.receipt_images.length > 0 && <div className={`mt-5 grid gap-2 ${receipt.receipt_images.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>{receipt.receipt_images.map((image) => <LoveReceiptImage key={image.id} imageId={image.id} alt="回执照片" full className="aspect-square w-full rounded-xl" />)}</div>}
            {receipt.receipt_content && <blockquote className="mt-5 rounded-2xl bg-peach/14 px-4 py-4 font-sc text-sm leading-7 text-ink">“{receipt.receipt_content}”</blockquote>}
            {receipt.receipt_rating && <StarRating value={receipt.receipt_rating} readOnly className="mt-4" />}
            {moodMeta && <p className="mt-3 font-sc text-sm text-ink-soft">{moodMeta.emoji} {moodMeta.label}</p>}
            {receipt.timeline_event_id && <Link href={`/timeline/${receipt.timeline_event_id}`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-sage/14 px-4 font-sc text-sm text-ink transition hover:bg-sage/22 focus-ring">去共同时间线看看 <Send className="h-4 w-4" /></Link>}
          </section>
        )}
      </main>
    </div>
  );
}

function ReceiptProgress({ receipt }: { receipt: LoveReceiptOut }) {
  const current = loveReceiptProgress(receipt.status);
  const steps = [{ label: "已送出", icon: Send }, { label: "送去中", icon: Truck }, { label: "已收到", icon: PackageCheck }, { label: "已回执", icon: Check }];
  return <section className="content-surface mt-5 p-4 sm:p-5" aria-label="心意进度"><ol className="grid grid-cols-4">{steps.map((step, index) => { const Icon = step.icon; const done = index <= current; return <li key={step.label} className="relative flex min-w-0 flex-col items-center text-center">{index > 0 && <span className={`absolute right-1/2 top-5 h-px w-full ${index <= current ? "bg-sage" : "bg-line"}`} aria-hidden="true" />}<span className={`relative z-10 grid h-10 w-10 place-items-center rounded-full ${done ? "bg-sage/22 text-ink" : "bg-cream-deep text-ink-muted"}`}><Icon className="h-4 w-4" /></span><span className={`mt-2 font-sc text-[11px] ${done ? "text-ink-soft" : "text-ink-muted"}`}>{step.label}</span></li>; })}</ol></section>;
}

function ReceiptComposer({ content, setContent, mood, setMood, rating, setRating, previews, removeFile, selectFiles, submitting, submit }: { content: string; setContent: (value: string) => void; mood: LoveReceiptMood | null; setMood: (value: LoveReceiptMood | null) => void; rating: number | null; setRating: (value: number | null) => void; previews: Array<{ file: File; url: string }>; removeFile: (index: number) => void; selectFiles: (event: ChangeEvent<HTMLInputElement>) => void; submitting: boolean; submit: (event: FormEvent) => void }) {
  return <form id="receipt" onSubmit={submit} className="form-section mt-5 scroll-mt-24 p-5 sm:p-6"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-rose/10 text-rose-deep"><Camera className="h-5 w-5" /></span><div><h2 className="font-display text-xl font-semibold text-ink">留下爱的回执</h2><p className="mt-0.5 font-sc text-xs text-ink-muted">1–3 张照片，再写一句真实回应</p></div></div><div className="mt-5 grid grid-cols-3 gap-2">{previews.map((preview, index) => <div key={`${preview.file.name}-${index}`} className="relative"><img src={preview.url} alt={`待发送照片 ${index + 1}`} className="aspect-square w-full rounded-xl object-cover" /><button type="button" onClick={() => removeFile(index)} className="absolute right-1.5 top-1.5 grid h-9 w-9 place-items-center rounded-full bg-surface/95 text-ink focus-ring" aria-label={`移除第 ${index + 1} 张照片`}><Trash2 className="h-4 w-4" /></button></div>)}{previews.length < 3 && <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-rose/35 bg-rose/5 font-sc text-xs text-rose-deep focus-within:ring-2 focus-within:ring-rose/40"><ImagePlus className="mb-1 h-5 w-5" />选择照片<input type="file" accept="image/*" multiple className="sr-only" onChange={selectFiles} /></label>}</div>{previews.length === 0 && <p className="mt-2 font-sc text-xs text-ink-muted">至少选择一张收到心意后的照片。</p>}<div className="mt-5"><label htmlFor="receipt-content" className="font-sc text-sm font-medium text-ink">想对 TA 说</label><textarea id="receipt-content" value={content} onChange={(event) => setContent(event.target.value)} maxLength={100} required className="input-field mt-2 min-h-28 resize-y py-3" placeholder="喜欢或不喜欢，都可以认真说出来" /><div className="mt-1 text-right font-sc text-xs text-ink-muted">{content.length}/100</div></div><div className="mt-3 flex gap-2 overflow-x-auto pb-1 local-x-scroll" aria-label="快捷回应">{QUICK_RECEIPT_MESSAGES.map((message) => <button key={message} type="button" onClick={() => setContent(message)} className="min-h-10 flex-none rounded-full bg-peach/16 px-3 font-sc text-xs text-ink-soft transition hover:bg-peach/26 focus-ring">{message}</button>)}</div><StarRating value={rating} onChange={setRating} className="mt-5" /><fieldset className="mt-5"><legend className="font-sc text-sm font-medium text-ink">收到时的心情（可选）</legend><p className="mt-1 font-sc text-xs text-ink-muted">不必只选开心，真实感受也值得被听见。</p><div className="mt-2 flex flex-wrap gap-2">{LOVE_RECEIPT_MOOD_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setMood(mood === option.value ? null : option.value)} aria-pressed={mood === option.value} className={`min-h-10 rounded-full px-3 font-sc text-xs transition focus-ring ${mood === option.value ? "bg-rose/14 text-rose-deep ring-1 ring-rose/30" : "bg-cream-deep/55 text-ink-soft"}`}>{option.emoji} {option.label}</button>)}</div></fieldset><button type="submit" disabled={submitting || previews.length < 1 || !content.trim()} className="btn-primary mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 font-sc text-sm font-semibold focus-ring disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}{submitting ? "正在发送回执" : "发送回执"}</button></form>;
}

function StarRating({ value, onChange, readOnly = false, className = "" }: { value: number | null; onChange?: (value: number | null) => void; readOnly?: boolean; className?: string }) {
  return <fieldset className={className}><legend className="font-sc text-sm font-medium text-ink">{readOnly ? "这份心意的评分" : "给这份心意打分（可选）"}</legend><div className="mt-2 flex items-center gap-1" aria-label={value ? `${value} 星` : "尚未评分"}>{[1, 2, 3, 4, 5].map((star) => readOnly ? <Star key={star} className={`h-5 w-5 ${star <= (value ?? 0) ? "fill-peach-deep text-peach-deep" : "text-line"}`} aria-hidden="true" /> : <button key={star} type="button" onClick={() => onChange?.(value === star ? null : star)} aria-label={`${star} 星`} aria-pressed={value === star} className="grid h-11 w-11 place-items-center rounded-full text-peach-deep transition hover:bg-peach/18 focus-ring"><Star className={`h-6 w-6 ${star <= (value ?? 0) ? "fill-current" : ""}`} /></button>)}</div></fieldset>;
}

function DetailSkeleton() {
  return <div className="viewport-guard min-h-dvh w-full"><div className="mx-auto mt-24 w-[calc(100%-2rem)] max-w-5xl"><div className="content-surface h-72 animate-pulse bg-line/20 motion-reduce:animate-none" /><div className="content-surface mt-5 h-24 animate-pulse bg-line/20 motion-reduce:animate-none" /></div></div>;
}
