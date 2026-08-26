"use client";

// Secondary confirmation sheet for closing a pair: warning copy, optional farewell, and a destructive confirm.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { MOTION_TRANSITIONS } from "@/lib/motion";

interface DissolvePairDialogProps {
  open: boolean;
  counterpartName: string;
  loading?: boolean;
  onConfirm: (message: string) => void;
  onCancel: () => void;
}

const MAX_MESSAGE = 500;

export function DissolvePairDialog({
  open,
  counterpartName,
  loading,
  onConfirm,
  onCancel,
}: DissolvePairDialogProps) {
  const reducedMotion = useReducedMotion();
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) {
      setMessage("");
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, loading, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.overlay}
        >
          <motion.div className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={loading ? undefined : onCancel} />
          <motion.div
            role="alertdialog"
            aria-labelledby="dissolve-title"
            className="relative w-full sm:max-w-md glass-card rounded-t-3xl sm:rounded-3xl px-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:pb-7 pt-7"
            initial={reducedMotion ? { opacity: 0 } : { y: 48, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { y: 32, opacity: 0, scale: 0.98 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { ...MOTION_TRANSITIONS.state, duration: 0.24 }}
          >
            <div className="mx-auto h-1.5 w-10 rounded-full bg-line/60 mb-5 sm:hidden" />
            <h3 id="dissolve-title" className="font-display text-xl text-ink mb-2">
              真的要合上这本手账吗
            </h3>
            <p className="font-sc text-sm text-ink-soft leading-relaxed">
              确认后，你和{counterpartName}都进不去了。写下的事情还留着，只是这扇门会关上，而且不能自己打开。
            </p>
            <label className="mt-5 block">
              <span className="font-sc text-sm font-medium text-ink-soft">如果想留一句话给{counterpartName}，可以写在这里</span>
              <textarea
                className="input-field mt-2 min-h-28 resize-none text-base"
                value={message}
                maxLength={MAX_MESSAGE}
                disabled={loading}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="也可以什么都不写"
              />
              <span className="mt-1 block text-right font-sc text-xs text-ink-muted">
                {message.length}/{MAX_MESSAGE}
              </span>
            </label>
            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                className="btn-ghost rounded-full px-5 py-3 font-sc text-sm focus-ring min-h-[44px]"
                onClick={onCancel}
                disabled={loading}
              >
                再想想
              </button>
              <button
                type="button"
                className="rounded-full px-5 py-3 font-sc text-sm font-medium bg-rose-deep text-white shadow-soft active:scale-[0.98] transition focus-ring min-h-[44px] disabled:opacity-60"
                onClick={() => onConfirm(message)}
                disabled={loading}
              >
                {loading ? "正在合上…" : "确认合上"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
