"use client";

// Avatar editing sheet with private image upload controls plus the existing emoji fallback presets.

import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { AVATAR_PRESETS } from "@/lib/types";
import { cn } from "@/lib/cn";

interface AvatarPickerProps {
  open: boolean;
  current?: string | null;
  hasImage?: boolean;
  uploading?: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  onUpload?: (file: File) => void;
  onDeleteImage?: () => void;
  title?: string;
}

export function AvatarPicker({
  open,
  current,
  hasImage,
  uploading,
  onClose,
  onPick,
  onUpload,
  onDeleteImage,
  title = "选择一个头像",
}: AvatarPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

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
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="dialog"
            aria-label={title}
            className="relative w-full sm:max-w-md glass-card rounded-t-3xl sm:rounded-3xl px-6 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] sm:pb-8 pt-7"
            initial={{ y: 80, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 80, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
          >
            <div className="mx-auto h-1.5 w-10 rounded-full bg-line/60 mb-5 sm:hidden" />
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-xl text-ink">{title}</h3>
              <button
                aria-label="关闭"
                className="h-9 w-9 grid place-items-center rounded-full hover:bg-ink/5 focus-ring"
                onClick={onClose}
              >
                <X className="h-4 w-4 text-ink-soft" />
              </button>
            </div>

            {onUpload && (
              <div className="mb-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="min-h-12 rounded-2xl bg-rose text-white shadow-soft transition hover:bg-rose-deep disabled:opacity-60 focus-ring inline-flex items-center justify-center gap-2 font-sc text-sm"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  上传图片
                </button>
                <button
                  type="button"
                  onClick={onDeleteImage}
                  disabled={!hasImage || uploading || !onDeleteImage}
                  className="min-h-12 rounded-2xl bg-surface-raised/70 hairline text-ink-soft transition hover:bg-cream-deep/70 disabled:opacity-45 focus-ring inline-flex items-center justify-center gap-2 font-sc text-sm"
                >
                  <Trash2 className="h-4 w-4" />
                  清除图片
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) onUpload(file);
                  }}
                />
              </div>
            )}

            <div className="grid grid-cols-4 gap-3">
              {AVATAR_PRESETS.map((emoji) => {
                const active = emoji === current && !hasImage;
                return (
                  <button
                    key={emoji}
                    onClick={() => {
                      onPick(emoji);
                      onClose();
                    }}
                    className={cn(
                      "h-16 w-full rounded-2xl text-3xl grid place-items-center transition-all focus-ring",
                      "bg-surface-raised/70 hairline",
                      active
                        ? "ring-2 ring-rose ring-offset-2 ring-offset-cream scale-[1.03]"
                        : "hover:scale-[1.04] active:scale-95",
                    )}
                    aria-pressed={active}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
