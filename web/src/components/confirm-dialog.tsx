"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive,
  onConfirm,
  onCancel,
  loading,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-ink/45 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            role="alertdialog"
            aria-label={title}
            className="relative w-full sm:max-w-sm glass-card rounded-t-3xl sm:rounded-3xl px-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:pb-7 pt-7"
            initial={{ y: 60, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <div className="mx-auto h-1.5 w-10 rounded-full bg-line/60 mb-5 sm:hidden" />
            <h3 className="font-display text-xl text-ink mb-2">{title}</h3>
            {description && (
              <p className="font-sc text-sm text-ink-soft mb-6 leading-relaxed">{description}</p>
            )}
            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              <button
                className="btn-ghost rounded-full px-5 py-3 font-sc text-sm focus-ring min-h-[44px]"
                onClick={onCancel}
                disabled={loading}
              >
                {cancelLabel}
              </button>
              <button
                className={
                  destructive
                    ? "rounded-full px-5 py-3 font-sc text-sm font-medium bg-rose-deep text-white shadow-soft active:scale-[0.98] transition focus-ring min-h-[44px] disabled:opacity-60"
                    : "btn-primary rounded-full px-5 py-3 font-sc text-sm font-medium focus-ring min-h-[44px]"
                }
                onClick={onConfirm}
                disabled={loading}
              >
                {loading ? "处理中…" : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
