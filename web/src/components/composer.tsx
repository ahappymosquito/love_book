"use client";

// Timeline detail composer for text and compressed image picking in a mobile-safe bar above the global nav.

import { Image as ImageIcon, Send } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

interface ComposerProps {
  onSendText: (text: string) => Promise<void> | void;
  onPickImages: (files: File[]) => void;
  disabled?: boolean;
}

export function Composer({
  onSendText,
  onPickImages,
  disabled,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;
    try {
      onPickImages(await compressPickedImages(files));
    } catch {
      toast.error("图片压缩失败，已按原图上传");
      onPickImages(files);
    }
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSendText(trimmed);
      setText("");
    } finally {
      setSending(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] max-w-full">
      <div className="pointer-events-auto max-w-full bg-gradient-to-t from-cream/98 via-cream/85 to-cream/0 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 dark:from-cream-deep/98 dark:via-cream-deep/85">
        <div className="mx-auto w-full max-w-3xl min-w-0 px-3">
          <div className="glass-card flex min-w-0 items-end gap-2 rounded-3xl px-3 py-2.5 sm:py-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-peach/18 text-rose-deep hover:bg-peach/30 disabled:opacity-40 focus-ring"
              aria-label="发送图片"
            >
              <ImageIcon className="h-5 w-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => void handleImageInputChange(e)}
            />

            <textarea
              rows={1}
              className={cn(
                "min-w-0 flex-1 resize-none bg-transparent border-none outline-none px-2 py-2.5 max-h-32 min-h-[44px] font-sc text-[15px] text-ink placeholder:text-ink-muted/70",
                "scrollbar-thin",
              )}
              placeholder="说点什么..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKey}
              disabled={disabled || sending}
            />
            {text.trim() && (
              <button
                type="button"
                onClick={send}
                disabled={sending || disabled}
                className="h-11 w-11 flex-none grid place-items-center rounded-2xl btn-primary focus-ring"
                aria-label="发送"
              >
                {sending ? (
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                ) : (
                  <Send className="h-4.5 w-4.5" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const MAX_COMPRESSED_IMAGE_EDGE = 1600;
const COMPRESSED_IMAGE_QUALITY = 0.82;

async function compressPickedImages(files: File[]): Promise<File[]> {
  const compressed: File[] = [];
  for (const file of files) {
    compressed.push(await compressImageFile(file));
  }
  return compressed;
}

async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_COMPRESSED_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale >= 1 && file.size < 700 * 1024) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  const outputType = file.type === "image/webp" ? "image/webp" : "image/jpeg";
  if (outputType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, outputType, COMPRESSED_IMAGE_QUALITY);
  if (!blob || blob.size >= file.size) return file;
  const name = outputType === "image/jpeg" ? file.name.replace(/\.[^.]+$/, ".jpg") : file.name;
  return new File([blob], name, { type: outputType, lastModified: file.lastModified });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
