"use client";

// Timeline image bubble that loads a small authenticated thumbnail through useAuthedBlobUrl before fetching the full image for preview on tap.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchFileBlob } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAuthedBlobUrl } from "@/lib/use-authed-blob-url";

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
  const remote = useAuthedBlobUrl(localUrl || pending ? null : { kind: "image-thumb", id: imageId });
  const url = localUrl || pending ? (localUrl ?? null) : remote.url;
  const loading = !localUrl && !pending && remote.status === "loading";
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

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
        "transition duration-200 ease-out active:scale-[0.995]",
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
        <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent motion-reduce:animate-none" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-ink-muted font-sc">
          图片没加载出来
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
