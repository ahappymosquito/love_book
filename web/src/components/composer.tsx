"use client";

import { Image as ImageIcon, Mic, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

interface ComposerProps {
  onSendText: (text: string) => Promise<void> | void;
  onPickImages: (files: File[]) => void;
  onUploadVoice: (blob: Blob, durationMs: number) => Promise<void> | void;
  disabled?: boolean;
}

export function Composer({
  onSendText,
  onPickImages,
  onUploadVoice,
  disabled,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedMs, setRecordedMs] = useState(0);
  const [uploadingVoice, setUploadingVoice] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("当前环境不支持录音");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const finalMs = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        if (tickRef.current) {
          window.clearInterval(tickRef.current);
          tickRef.current = null;
        }
        setRecording(false);
        if (cancelledRef.current) {
          setRecordedMs(0);
          return;
        }
        if (blob.size < 800) {
          toast.error("录音太短啦，再来一次？");
          setRecordedMs(0);
          return;
        }
        setUploadingVoice(true);
        try {
          await onUploadVoice(blob, finalMs);
        } finally {
          setUploadingVoice(false);
          setRecordedMs(0);
        }
      };
      recorder.start();
      startedAtRef.current = Date.now();
      setRecording(true);
      setRecordedMs(0);
      tickRef.current = window.setInterval(() => {
        setRecordedMs(Date.now() - startedAtRef.current);
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法访问麦克风";
      toast.error(`录音被拒绝：${msg}`);
    }
  }

  function pickMimeType(): string | null {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return null;
  }

  function stopRecording(cancel = false) {
    if (!recorderRef.current) return;
    cancelledRef.current = cancel;
    if (recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
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
    <div className="fixed inset-x-0 bottom-0 z-30 pointer-events-none">
      <div className="pointer-events-auto bg-gradient-to-t from-cream/98 via-cream/85 to-cream/0 dark:from-cream-deep/98 dark:via-cream-deep/85 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3">
        <div className="max-w-3xl mx-auto px-3">
          <div className="glass-card rounded-3xl px-3 py-2.5 sm:py-3 flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || recording}
              className="h-11 w-11 flex-none grid place-items-center rounded-2xl bg-cream-deep/40 hover:bg-cream-deep/70 text-rose-deep focus-ring disabled:opacity-40"
              aria-label="发送图片"
            >
              <ImageIcon className="h-5 w-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) onPickImages(files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />

            {recording ? (
              <RecordingBar
                ms={recordedMs}
                onCancel={() => stopRecording(true)}
                onConfirm={() => stopRecording(false)}
              />
            ) : (
              <>
                <textarea
                  rows={1}
                  className={cn(
                    "flex-1 resize-none bg-transparent border-none outline-none px-2 py-2.5 max-h-32 min-h-[44px] font-sc text-[15px] text-ink placeholder:text-ink-muted/70",
                    "scrollbar-thin",
                  )}
                  placeholder="说点什么…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKey}
                  disabled={disabled || sending || uploadingVoice}
                />
                {text.trim() ? (
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
                ) : (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={disabled || uploadingVoice}
                    className={cn(
                      "h-11 w-11 flex-none grid place-items-center rounded-2xl focus-ring disabled:opacity-40",
                      "bg-rose text-white hover:bg-rose-deep transition shadow-soft",
                    )}
                    aria-label="录音"
                  >
                    {uploadingVoice ? (
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordingBar({
  ms,
  onCancel,
  onConfirm,
}: {
  ms: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 flex items-center gap-2 px-2 py-2"
    >
      <button
        onClick={onCancel}
        className="h-11 w-11 grid place-items-center rounded-2xl bg-ink/5 text-ink-soft hover:bg-ink/10 focus-ring"
        aria-label="取消录音"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex-1 flex items-center gap-3 px-3 py-2 rounded-2xl bg-rose/10">
        <span className="relative h-3 w-3 flex-none">
          <span className="absolute inset-0 rounded-full bg-rose animate-ping" />
          <span className="absolute inset-0 rounded-full bg-rose" />
        </span>
        <span className="font-sc text-sm text-rose-deep tabular-nums">
          {formatDuration(ms)}
        </span>
        <span className="font-sc text-xs text-ink-muted ml-auto">正在录音…</span>
      </div>
      <button
        onClick={onConfirm}
        className="h-11 w-11 grid place-items-center rounded-2xl btn-primary focus-ring"
        aria-label="结束并发送"
      >
        <Square className="h-4 w-4" fill="currentColor" />
      </button>
    </motion.div>
  );
}
