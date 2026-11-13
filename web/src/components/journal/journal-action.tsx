"use client";

// 手账导出操作区：主按钮（全屏翻看 / 生成文件）、导出进度条与取消、友好错误与重试、完成后的“存到手机 / 下载”交付按钮；桌面侧栏用完整样式，手机底部玻璃条用紧凑样式。

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookOpen, Download, Loader2, RotateCcw, Share2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import type { JournalFormat } from "@/lib/journal-types";

export type JournalExportState =
  | { status: "idle" }
  | { status: "working"; label: string; done?: number; total?: number }
  | { status: "done"; files: File[]; canShare: boolean; delivered: boolean; warning?: string }
  | { status: "error"; message: string };

const PRIMARY_LABEL: Record<JournalFormat, string> = {
  online: "全屏翻看",
  html: "生成 HTML 文件",
  pdf: "生成 PDF",
  png: "生成长图",
};

export function JournalAction({
  format,
  state,
  ready,
  compact = false,
  onPrimary,
  onCancel,
  onShare,
  onDownload,
  onReset,
}: {
  format: JournalFormat;
  state: JournalExportState;
  ready: boolean;
  compact?: boolean;
  onPrimary: () => void;
  onCancel: () => void;
  onShare: () => void;
  onDownload: () => void;
  onReset: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const transition = reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state;
  const enter = reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 };

  let content: ReactNode;
  if (state.status === "working") {
    const percent = state.total ? Math.min(100, Math.round(((state.done ?? 0) / state.total) * 100)) : null;
    content = (
      <div className="flex min-w-0 flex-col gap-2" role="status" aria-live="polite">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 flex-none animate-spin text-rose-deep motion-reduce:animate-none" />
          <p className="min-w-0 flex-1 truncate font-sc text-sm text-ink">{state.label}</p>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 flex-none items-center gap-1 rounded-full px-3 font-sc text-sm text-ink-soft transition hover:bg-ink/5 hover:text-rose-deep focus-ring"
          >
            <X className="h-4 w-4" />
            取消
          </button>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
          <div
            className={cn(
              "h-full origin-left rounded-full bg-rose transition-transform duration-300 ease-out motion-reduce:transition-none",
              percent === null && "animate-pulse motion-reduce:animate-none",
            )}
            style={{ transform: `scaleX(${percent === null ? 0.35 : Math.max(0.04, percent / 100)})` }}
          />
        </div>
      </div>
    );
  } else if (state.status === "done") {
    const count = state.files.length;
    content = (
      <div className="flex min-w-0 flex-col gap-2" role="status" aria-live="polite">
        <p className="flex items-center gap-1.5 font-sc text-sm font-medium text-ink">
          <Sparkles className="h-4 w-4 flex-none text-peach-deep" />
          {state.delivered ? (count > 1 ? `${count} 张图都下载好啦` : "已经下载好啦") : count > 1 ? `${count} 张图准备好啦` : "手账准备好啦"}
        </p>
        {state.warning ? <p className="font-sc text-xs leading-relaxed text-ink-soft">{state.warning}</p> : null}
        <div className="flex flex-wrap gap-2">
          {state.canShare ? (
            <button type="button" onClick={onShare} className="btn-primary inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-4 font-sc text-sm font-medium focus-ring">
              <Share2 className="h-4 w-4" />
              存到手机 / 发给 TA
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDownload}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 font-sc text-sm font-medium focus-ring",
              state.canShare ? "btn-ghost" : "btn-primary flex-1",
            )}
          >
            <Download className="h-4 w-4" />
            {state.delivered ? "再下载一次" : "下载"}
          </button>
          <button type="button" onClick={onReset} className="btn-ghost inline-flex min-h-11 items-center rounded-full px-4 font-sc text-sm focus-ring">
            好的
          </button>
        </div>
      </div>
    );
  } else if (state.status === "error") {
    content = (
      <div className="flex min-w-0 flex-col gap-2" role="alert">
        <p className="font-sc text-sm leading-relaxed text-rose-deep">{state.message}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onPrimary} className="btn-primary inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-4 font-sc text-sm font-medium focus-ring">
            <RotateCcw className="h-4 w-4" />
            再试一次
          </button>
          <button type="button" onClick={onReset} className="btn-ghost inline-flex min-h-11 items-center rounded-full px-4 font-sc text-sm focus-ring">
            先不了
          </button>
        </div>
      </div>
    );
  } else {
    content = (
      <button
        type="button"
        onClick={onPrimary}
        disabled={!ready}
        className={cn(
          "btn-primary inline-flex w-full items-center justify-center gap-2 rounded-full px-5 font-sc font-medium focus-ring",
          compact ? "min-h-12 text-[15px]" : "min-h-12 text-base",
        )}
      >
        {format === "online" ? <BookOpen className="h-[18px] w-[18px]" /> : <Download className="h-[18px] w-[18px]" />}
        {PRIMARY_LABEL[format]}
      </button>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={state.status} initial={enter} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={transition} className="min-w-0">
        {content}
      </motion.div>
    </AnimatePresence>
  );
}
