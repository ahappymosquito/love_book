"use client";

import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(!localUrl);

  useEffect(() => {
    let cancelled = false;
    if (localUrl || pending) {
      setUrl(localUrl ?? null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchFileBlob("images", imageId)
      .then((u) => {
        if (cancelled) return;
        setUrl(u);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
      if (url && !localUrl) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId]);

  const handleClick = () => {
    if (url && onClick) onClick(url);
  };

  return (
    <button
      onClick={handleClick}
      disabled={!url}
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
    </button>
  );
}
