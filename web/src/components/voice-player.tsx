"use client";

import { Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchFileBlob } from "@/lib/api";
import { formatDuration } from "@/lib/format";

interface VoicePlayerProps {
  voiceId: number;
  durationMs: number | null;
  mine: boolean;
  pending?: boolean;
  localUrl?: string;
}

export function VoicePlayer({
  voiceId,
  durationMs,
  mine,
  pending,
  localUrl,
}: VoicePlayerProps) {
  const [url, setUrl] = useState<string | null>(localUrl || null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      if (url && !localUrl) URL.revokeObjectURL(url);
    };
  }, [url, localUrl]);

  async function ensureUrl(): Promise<string | null> {
    if (url) return url;
    if (pending) return null;
    setLoading(true);
    try {
      const blobUrl = await fetchFileBlob("voices", voiceId);
      setUrl(blobUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const u = await ensureUrl();
    if (!u) return;
    if (!audioRef.current) {
      const a = new Audio(u);
      a.onended = () => {
        setPlaying(false);
        setProgress(0);
      };
      a.ontimeupdate = () => {
        if (a.duration && Number.isFinite(a.duration)) {
          setProgress(a.currentTime / a.duration);
        }
      };
      audioRef.current = a;
    }
    const audio = audioRef.current;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    }
  }

  return (
    <div
      className={
        mine
          ? "rounded-2xl rounded-tr-md bg-gradient-to-br from-rose to-peach-deep text-white px-4 py-3 max-w-[260px]"
          : "rounded-2xl rounded-tl-md bg-rose-soft/40 dark:bg-rose-soft/20 text-ink px-4 py-3 max-w-[260px]"
      }
    >
      <div className="flex items-center gap-3">
        <button
          aria-label={playing ? "暂停" : "播放语音"}
          onClick={toggle}
          disabled={pending || loading}
          className={
            mine
              ? "h-10 w-10 rounded-full bg-white/25 grid place-items-center hover:bg-white/40 disabled:opacity-50 transition focus-ring"
              : "h-10 w-10 rounded-full bg-rose text-white grid place-items-center hover:bg-rose-deep disabled:opacity-50 transition focus-ring"
          }
        >
          {loading ? (
            <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 translate-x-[1px]" />
          )}
        </button>
        <div className="flex-1">
          <div
            className={
              mine
                ? "h-1.5 rounded-full bg-white/25 overflow-hidden"
                : "h-1.5 rounded-full bg-rose/15 overflow-hidden"
            }
          >
            <div
              className={mine ? "h-full bg-white/90" : "h-full bg-rose"}
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] opacity-90">
            <Volume2 className="h-3 w-3" />
            <span className="tabular-nums">{formatDuration(durationMs)}</span>
            {pending && <span>· 上传中…</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
