"use client";

// Authenticated love-receipt dashboard with honest mood and rating summaries, creation, and paginated history.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronRight, Gift, HeartHandshake, Loader2, Plus, Send, Star } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { LoveReceiptCreateSheet } from "@/components/love-receipt-create-sheet";
import { LoveReceiptImage } from "@/components/love-receipt-image";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { api } from "@/lib/api";
import { formatAbsolute, formatRelative } from "@/lib/format";
import { LOVE_RECEIPT_STATUS_LABELS, loveReceiptMoodMeta, loveReceiptTypeMeta } from "@/lib/love-receipts";
import type { LoveReceiptListOut, LoveReceiptOut } from "@/lib/types";

type ReceiptView = "pending" | "active" | "completed";

export default function LoveReceiptsPage() {
  return <AuthGate><LoveReceiptsInner /></AuthGate>;
}

function LoveReceiptsInner() {
  const router = useRouter();
  const [view, setView] = useState<ReceiptView>("pending");
  const [data, setData] = useState<LoveReceiptListOut | null>(null);
  const [items, setItems] = useState<LoveReceiptOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (nextView: ReceiptView, page = 1) => {
    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const next = await api.listLoveReceipts({ view: nextView, page, pageSize: 12 });
      setData(next);
      setItems((current) => page === 1 ? next.items : [...current, ...next.items]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { void load(view); }, [load, view]);

  const options = [
    { value: "pending" as const, label: `待我回执 ${data?.pending_count ?? 0}` },
    { value: "active" as const, label: "进行中" },
    { value: "completed" as const, label: "已完成" },
  ];
  const canLoadMore = Boolean(data && items.length < data.total);

  return (
    <div className="viewport-guard min-h-dvh w-full">
      <AppHeader
        title="爱的回执"
        subtitle="每一份心意，都值得被认真回应"
        back={{ href: "/timeline" }}
        maxWidth="5xl"
        rightSlot={
          <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-rose px-3 font-sc text-xs font-semibold text-white transition hover:bg-rose-deep focus-ring sm:px-4" aria-label="送一份心意">
            <Plus className="h-4 w-4" /><span className="hidden sm:inline">送一份心意</span>
          </button>
        }
      />

      <main className="mx-auto w-full max-w-5xl min-w-0 px-4 pt-5 sm:px-6 scroll-pad-bottom">
        <section className="content-surface overflow-hidden p-5 sm:p-6" aria-labelledby="receipt-overview-title">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full bg-rose/10 px-3 py-1.5 font-sc text-xs font-medium text-rose-deep"><HeartHandshake className="h-4 w-4" />你们之间的心意</span>
              <h2 id="receipt-overview-title" className="mt-3 font-display text-xl font-semibold text-ink sm:text-2xl">
                {data?.pending_count ? `有 ${data.pending_count} 份心意等你接住` : data?.completed_count ? `你们已经认真回应了 ${data.completed_count} 份心意` : "从第一份认真回应开始"}
              </h2>
              <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">照片和一句真心话，会让收到的那一刻留得更久。</p>
            </div>
            <dl className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
              <OverviewStat label="待我回执" value={data?.pending_count ?? 0} tone="rose" />
              <OverviewStat label="已收到" value={data?.completed_count ?? 0} tone="sage" />
              <OverviewStat label="本月心意" value={data?.month_count ?? 0} tone="peach" />
            </dl>
          </div>
        </section>

        <div className="page-toolbar my-5">
          <SegmentedControl value={view} onChange={setView} ariaLabel="切换回执记录" layoutId="love-receipt-view-lens" className="w-full" options={options} />
        </div>

        {loading ? <ReceiptSkeleton /> : items.length ? (
          <section aria-label="爱的回执记录" className="space-y-3">
            {items.map((receipt) => <ReceiptCard key={receipt.id} receipt={receipt} />)}
            {canLoadMore && (
              <button type="button" disabled={loadingMore} onClick={() => void load(view, (data?.page ?? 1) + 1)} className="btn-ghost flex min-h-11 w-full items-center justify-center gap-2 rounded-xl font-sc text-sm focus-ring disabled:opacity-50">
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}{loadingMore ? "正在加载" : "加载更多回执"}
              </button>
            )}
          </section>
        ) : <ReceiptEmpty view={view} onCreate={() => setCreateOpen(true)} />}
      </main>

      <LoveReceiptCreateSheet open={createOpen} onOpenChange={setCreateOpen} onCreated={(receipt) => router.push(`/love-receipts/${receipt.id}`)} />
    </div>
  );
}

function OverviewStat({ label, value, tone }: { label: string; value: number; tone: "rose" | "sage" | "peach" }) {
  const classes = { rose: "bg-rose/9 text-rose-deep", sage: "bg-sage/12 text-ink", peach: "bg-peach/16 text-ink" }[tone];
  return <div className={`rounded-xl px-3 py-3 text-center ${classes}`}><dd className="font-display text-xl font-semibold">{value}</dd><dt className="mt-0.5 font-sc text-[11px] text-ink-muted">{label}</dt></div>;
}

function ReceiptCard({ receipt }: { receipt: LoveReceiptOut }) {
  const type = loveReceiptTypeMeta(receipt.receipt_type);
  const mood = loveReceiptMoodMeta(receipt.receipt_mood);
  const image = receipt.cover ?? receipt.receipt_images[0] ?? null;
  const actionable = receipt.viewer_role === "receiver" && receipt.status !== "completed";
  return (
    <article className="content-surface overflow-hidden">
      <div className="flex min-w-0 gap-4 p-4 sm:p-5">
        {image ? <LoveReceiptImage imageId={image.id} alt={`${receipt.title}的照片`} className="h-24 w-24 flex-none rounded-xl sm:h-28 sm:w-32" /> : <div className="grid h-24 w-24 flex-none place-items-center rounded-xl bg-peach/16 text-3xl sm:h-28 sm:w-32" aria-hidden="true">{type.emoji}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 font-sc text-[11px] font-medium ${receipt.status === "completed" ? "bg-sage/16 text-ink-soft" : "bg-rose/10 text-rose-deep"}`}>{LOVE_RECEIPT_STATUS_LABELS[receipt.status]}</span>
            <span className="font-sc text-xs text-ink-muted">{type.emoji} {type.label}</span>
          </div>
          <h2 className="mt-2 line-clamp-1 font-display text-lg font-semibold text-ink">{receipt.title}</h2>
          <p className="mt-1 line-clamp-2 font-sc text-sm leading-relaxed text-ink-soft">{receipt.receipt_content || receipt.message || "这份心意没有多说，但已经好好放在这里。"}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-sc text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5"><Avatar user={receipt.sender} size="sm" />{receipt.sender.display_name} 送出</span>
            <span title={formatAbsolute(receipt.created_at)}>{formatRelative(receipt.created_at)}</span>
            {mood && <span>{mood.emoji} {mood.label}</span>}
            {receipt.receipt_rating && <span className="inline-flex items-center gap-1" aria-label={`${receipt.receipt_rating} 星`}><Star className="h-3.5 w-3.5 fill-peach-deep text-peach-deep" />{receipt.receipt_rating}</span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/55 bg-cream-deep/28 px-4 py-3 sm:px-5">
        <span className="font-sc text-xs text-ink-muted">{receipt.expected_arrival_at ? `预计 ${formatAbsolute(receipt.expected_arrival_at, false)}` : receipt.completed_at ? `完成于 ${formatAbsolute(receipt.completed_at, false)}` : "等 TA 收到时再留下回应"}</span>
        <div className="flex items-center gap-2">
          {actionable && <Link href={`/love-receipts/${receipt.id}?quick=thanks#receipt`} className="min-h-10 rounded-full px-3 py-2.5 font-sc text-xs text-ink-soft transition hover:bg-rose/8 focus-ring">直接说谢谢</Link>}
          <Link href={`/love-receipts/${receipt.id}${actionable ? "#receipt" : ""}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-rose px-4 py-2.5 font-sc text-xs font-semibold text-white transition hover:bg-rose-deep focus-ring">
            {actionable ? <Camera className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{actionable ? "拍照回执" : "查看详情"}
          </Link>
        </div>
      </div>
    </article>
  );
}

function ReceiptEmpty({ view, onCreate }: { view: ReceiptView; onCreate: () => void }) {
  const complete = view === "completed";
  return <section className="content-surface px-5 py-10 text-center sm:px-8"><Gift className="mx-auto h-9 w-9 text-rose-deep" /><h2 className="mt-4 font-display text-xl font-semibold text-ink">{complete ? "还没有爱的回执" : "所有心意都已认真回应"}</h2><p className="mx-auto mt-2 max-w-md font-sc text-sm leading-relaxed text-ink-soft">{complete ? "从第一次认真回应开始，收藏你们被爱和表达爱的瞬间。" : "下一份惊喜到来时，记得留下属于你们的回忆。"}</p><button type="button" onClick={onCreate} className="btn-primary mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 font-sc text-sm focus-ring"><Send className="h-4 w-4" />送一份心意</button></section>;
}

function ReceiptSkeleton() {
  return <div className="space-y-3" aria-label="正在加载回执"><div className="content-surface h-40 animate-pulse bg-line/20 motion-reduce:animate-none" /><div className="content-surface h-40 animate-pulse bg-line/20 motion-reduce:animate-none" /></div>;
}
