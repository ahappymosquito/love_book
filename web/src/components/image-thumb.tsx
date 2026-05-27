"use client";

// Timeline image bubble that loads a small authenticated thumbnail before fetching the full image for preview.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchFileBlob } from "@/lib/api";
import { cn } from "@/lib/cn";

interface ImageThumbProps {
  imageId: number;
  pending?: boolean;
  localUrl?: string;
  onClick?: (url: string) => void;
  className?: string;
}

export function ImageThumb({
  imageId,
  pending,
  localUrl,
  onClick,
  className,
}: ImageThumbProps) {
  const [url, setUrl] = useState<string | null>(localUrl || null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!localUrl);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let nextUrl: string | null = null;
    if (localUrl || pending) {
      setUrl(localUrl ?? null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchFileBlob("image-thumbs", imageId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        nextUrl = u;
        setUrl(u);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
      if (nextUrl && !localUrl) URL.revokeObjectURL(nextUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId]);

  useEffect(() => {
    return () => {
      if (fullUrl) URL.revokeObjectURL(fullUrl);
    };
  }, [fullUrl]);

  const handleClick = async () => {
    if (!url || !onClick || opening) return;
    if (localUrl || pending) {
      onClick(url);
      return;
    }
    if (fullUrl) {
      onClick(fullUrl);
      return;
    }
    setOpening(true);
    try {
      const nextFullUrl = await fetchFileBlob("images", imageId);
      setFullUrl(nextFullUrl);
      onClick(nextFullUrl);
    } catch {
      toast.error("图片加载失败，请重试");
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={!url || opening}
      className={cn(
        "relative h-44 w-44 rounded-2xl overflow-hidden bg-line/30 hairline focus-ring",
        "transition active:scale-[0.98]",
        className,
      )}
      aria-label="查看大图"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      ) : loading ? (
        <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-ink-muted font-sc">
          无法加载
        </div>
      )}
      {pending && (
        <div className="absolute inset-0 grid place-items-center bg-ink/40 text-white text-xs font-sc">
          <span className="h-5 w-5 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
        </div>
      )}
      {opening && (
        <div className="absolute inset-0 grid place-items-center bg-ink/35 text-white text-xs font-sc">
          <span className="h-5 w-5 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
        </div>
      )}
    </button>
  );
}
