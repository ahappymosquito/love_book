"use client";

// Chat composer for text, compressed system image picking, and protected press-and-hold voice recording.

import { Image as ImageIcon, Mic, Send, X } from "lucide-react";
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
  const [recordingStatus, setRecordingStatus] = useState<"idle" | "starting" | "recording">("idle");
  const [recordedMs, setRecordedMs] = useState(0);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [willCancelVoice, setWillCancelVoice] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const pointerActiveRef = useRef(false);
  const pointerStartYRef = useRef(0);
  const pendingStopRef = useRef<boolean | null>(null);
  const willCancelRef = useRef(false);

  const recording = recordingStatus !== "idle";

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      removeVoicePointerListeners();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // Gesture listeners are removed synchronously on pointer end; this is only unmount cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    if (recordingStatus !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      pointerActiveRef.current = false;
      removeVoicePointerListeners();
      toast.error("当前环境不支持录音");
      return;
    }
    setRecordingStatus("starting");
    setRecordedMs(0);
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
        cleanupRecorderState();
        if (cancelledRef.current) {
          return;
        }
        if (blob.size < 800) {
          toast.error("录音太短了，再说一次吧");
          return;
        }
        setUploadingVoice(true);
        try {
          await onUploadVoice(blob, finalMs);
        } catch {
          toast.error("语音发送失败，请重试");
        } finally {
          setUploadingVoice(false);
        }
      };
      recorder.start();
      startedAtRef.current = Date.now();
      setRecordingStatus("recording");
      tickRef.current = window.setInterval(() => {
        setRecordedMs(Date.now() - startedAtRef.current);
      }, 100);
      if (pendingStopRef.current !== null) {
        const shouldCancel = pendingStopRef.current;
        pendingStopRef.current = null;
        stopRecording(shouldCancel);
      }
    } catch (err) {
      pointerActiveRef.current = false;
      removeVoicePointerListeners();
      cleanupRecorderState();
      const msg = err instanceof Error ? err.message : "无法访问麦克风";
      toast.error(`录音失败：${msg}`);
    }
  }

  function pickMimeType(): string | null {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];
    const audio = typeof document !== "undefined" ? document.createElement("audio") : null;
    for (const c of candidates) {
      if (!MediaRecorder.isTypeSupported || !MediaRecorder.isTypeSupported(c)) continue;
      const playableType = c.split(";", 1)[0];
      if (!audio || audio.canPlayType(playableType)) return c;
    }
    return null;
  }

  function stopRecording(cancel = false) {
    if (!recorderRef.current) {
      pendingStopRef.current = cancel;
      return;
    }
    cancelledRef.current = cancel;
    if (recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  function cleanupRecorderState() {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    pendingStopRef.current = null;
    setRecordingStatus("idle");
    setWillCancelVoice(false);
    willCancelRef.current = false;
    setRecordedMs(0);
  }

  function addVoicePointerListeners() {
    window.addEventListener("pointermove", handleVoicePointerMove);
    window.addEventListener("pointerup", handleVoicePointerUp);
    window.addEventListener("pointercancel", handleVoicePointerCancel);
  }

  function removeVoicePointerListeners() {
    window.removeEventListener("pointermove", handleVoicePointerMove);
    window.removeEventListener("pointerup", handleVoicePointerUp);
    window.removeEventListener("pointercancel", handleVoicePointerCancel);
  }

  function handleVoicePointerMove(event: PointerEvent) {
    if (!pointerActiveRef.current) return;
    const shouldCancel = pointerStartYRef.current - event.clientY > 70;
    if (shouldCancel !== willCancelRef.current) {
      willCancelRef.current = shouldCancel;
      setWillCancelVoice(shouldCancel);
    }
  }

  function handleVoicePointerUp() {
    finishVoicePress(false);
  }

  function handleVoicePointerCancel() {
    finishVoicePress(true);
  }

  function finishVoicePress(forceCancel: boolean) {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    removeVoicePointerListeners();
    stopRecording(forceCancel || willCancelRef.current);
  }

  function handleVoicePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || uploadingVoice || recording || text.trim()) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded mobile browsers do not support pointer capture on buttons.
    }
    pointerActiveRef.current = true;
    pointerStartYRef.current = event.clientY;
    pendingStopRef.current = null;
    willCancelRef.current = false;
    setWillCancelVoice(false);
    addVoicePointerListeners();
    void startRecording();
  }

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
              hidden
              onChange={(e) => void handleImageInputChange(e)}
            />

            {recording ? (
              <RecordingBar
                ms={recordedMs}
                starting={recordingStatus === "starting"}
                willCancel={willCancelVoice}
              />
            ) : (
              <>
                <textarea
                  rows={1}
                  className={cn(
                    "flex-1 resize-none bg-transparent border-none outline-none px-2 py-2.5 max-h-32 min-h-[44px] font-sc text-[15px] text-ink placeholder:text-ink-muted/70",
                    "scrollbar-thin",
                  )}
                  placeholder="说点什么..."
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
                    onPointerDown={handleVoicePointerDown}
                    onContextMenu={(e) => e.preventDefault()}
                    onDragStart={(e) => e.preventDefault()}
                    disabled={disabled || uploadingVoice}
                    className={cn(
                      "h-11 w-11 flex-none grid place-items-center rounded-2xl focus-ring disabled:opacity-40 select-none touch-none cursor-pointer",
                      "bg-rose text-white hover:bg-rose-deep transition shadow-soft",
                    )}
                    style={{
                      WebkitTouchCallout: "none",
                      WebkitUserSelect: "none",
                      userSelect: "none",
                    }}
                    aria-label="按住说话"
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
  starting,
  willCancel,
}: {
  ms: number;
  starting: boolean;
  willCancel: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onContextMenu={(e) => e.preventDefault()}
      className="flex-1 flex items-center gap-2 px-2 py-2 select-none touch-none"
      style={{
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >
      <div
        className={cn(
          "h-11 w-11 grid place-items-center rounded-2xl transition",
          willCancel ? "bg-rose text-white" : "bg-ink/5 text-ink-soft",
        )}
        aria-hidden
      >
        <X className="h-5 w-5" />
      </div>
      <div
        className={cn(
          "flex-1 flex items-center gap-3 px-3 py-2 rounded-2xl transition",
          willCancel ? "bg-rose/15" : "bg-rose/10",
        )}
      >
        <span className="relative h-3 w-3 flex-none">
          <span className="absolute inset-0 rounded-full bg-rose animate-ping" />
          <span className="absolute inset-0 rounded-full bg-rose" />
        </span>
        <span className="font-sc text-sm text-rose-deep tabular-nums">
          {starting ? "准备中" : formatDuration(ms)}
        </span>
        <span
          className={cn(
            "font-sc text-xs ml-auto",
            willCancel ? "text-rose-deep" : "text-ink-muted",
          )}
        >
          {willCancel ? "松开取消" : "松开发送 · 上滑取消"}
        </span>
      </div>
    </motion.div>
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
