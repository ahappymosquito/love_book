"use client";

// Pair-private love-receipt image loader that owns and revokes authenticated Blob URLs.

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchLoveReceiptImageBlob } from "@/lib/api";

export function LoveReceiptImage({
  imageId,
  alt,
  full = false,
  className,
}: {
  imageId: number;
  alt: string;
  full?: boolean;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let blobUrl: string | null = null;
    setFailed(false);
    void fetchLoveReceiptImageBlob(full ? "file" : "thumb", imageId)
      .then((nextUrl) => {
        blobUrl = nextUrl;
        if (active) setUrl(nextUrl);
        else URL.revokeObjectURL(nextUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [full, imageId]);

  if (failed) {
    return (
      <div className={cn("grid place-items-center bg-cream-deep/55 text-ink-muted", className)} role="img" aria-label={`${alt}加载失败`}>
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  if (!url) return <div className={cn("animate-pulse bg-line/35 motion-reduce:animate-none", className)} aria-hidden="true" />;
  return <img src={url} alt={alt} className={cn("object-cover", className)} />;
}
