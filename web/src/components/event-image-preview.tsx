"use client";

// Non-interactive authenticated event thumbnail for photo-led timeline cards.

import { useEffect, useState } from "react";
import { fetchFileBlob } from "@/lib/api";
import { cn } from "@/lib/cn";

export function EventImagePreview({
  imageId,
  alt,
  className,
}: {
  imageId: number;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchFileBlob("image-thumbs", imageId)
      .then((nextUrl) => {
        objectUrl = nextUrl;
        if (cancelled) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        setUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  return (
    <div className={cn("relative overflow-hidden bg-peach/14", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-peach/12 motion-reduce:animate-none" aria-hidden="true" />
      )}
    </div>
  );
}
