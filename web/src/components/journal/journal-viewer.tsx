"use client";

// 手账在线翻看：用 sandbox="allow-scripts"（不含 allow-same-origin）的 srcdoc iframe 展示与 HTML 导出完全相同的文档；加载时显示纸页骨架与进度，失败给出温和重试；另提供覆盖全屏的沉浸阅读层，Esc 或关闭按钮退出。

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookHeart, RotateCcw, X } from "lucide-react";
import { GlassSurface } from "@/components/ui/glass-surface";
import { cn } from "@/lib/cn";
import { MOTION_TRANSITIONS } from "@/lib/motion";

function JournalFrame({ doc, title, className }: { doc: string; title: string; className?: string }) {
  return (
    <iframe
      title={title}
      srcDoc={doc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={cn("block h-full w-full border-0 bg-[#efe5d8]", className)}
    />
  );
}

export function JournalViewer({
  doc,
  title,
  loadingLabel,
  error,
  hint,
  onRetry,
  className,
}: {
  doc: string | null;
  title: string;
  loadingLabel: string | null;
  error: string | null;
  hint: string | null;
  onRetry: () => void;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <div className={cn("relative overflow-hidden rounded-[1.5rem] border border-line/70 bg-[#efe5d8] shadow-[0_2px_10px_rgb(var(--ink)/0.08)]", className)}>
      {doc ? <JournalFrame doc={doc} title={title} /> : null}

      <AnimatePresence>
        {loadingLabel && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
            className={cn("absolute inset-0 grid place-items-center p-6", doc ? "bg-[#efe5d8]/80" : "bg-[#efe5d8]")}
            role="status"
            aria-live="polite"
          >
            <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
              <div className="relative h-28 w-24" aria-hidden="true">
                <span className="absolute inset-0 rotate-[-4deg] rounded-md bg-[#f6ecdf] shadow-sm" />
                <span className="absolute inset-0 rotate-[3deg] rounded-md bg-[#fcf7ef] shadow motion-safe:animate-pulse" />
                <BookHeart className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-rose" />
              </div>
              <p className="font-sc text-sm text-[#674c4b]">{loadingLabel}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!loadingLabel && (error || hint) ? (
        <div className="absolute inset-0 grid place-items-center bg-[#efe5d8] p-6">
          <div className="flex max-w-xs flex-col items-center gap-3 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fcf7ef] text-rose-deep shadow-sm">
              <BookHeart className="h-6 w-6" />
            </span>
            <p className={cn("font-sc text-sm leading-relaxed", error ? "text-[#9f3f58]" : "text-[#674c4b]")} role={error ? "alert" : undefined}>
              {error ?? hint}
            </p>
            {error ? (
              <button type="button" onClick={onRetry} className="btn-primary inline-flex min-h-11 items-center gap-1.5 rounded-full px-5 font-sc text-sm font-medium focus-ring">
                <RotateCcw className="h-4 w-4" />
                再试一次
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function JournalReader({ open, doc, title, onClose }: { open: boolean; doc: string | null; title: string; onClose: () => void }) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && doc ? (
        <motion.div
          key="reader"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.emphasis}
          className="fixed inset-0 z-[60] max-w-full bg-[#efe5d8]"
        >
          <JournalFrame doc={doc} title={title} />
          <GlassSurface
            variant="regular"
            shape="circle"
            className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-[61] grid h-12 w-12 place-items-center"
          >
            <button type="button" onClick={onClose} autoFocus className="grid h-12 w-12 place-items-center rounded-full text-ink focus-ring" aria-label="合上手账">
              <X className="h-5 w-5" />
            </button>
          </GlassSurface>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
