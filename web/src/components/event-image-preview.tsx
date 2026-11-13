"use client";

// Non-interactive authenticated event thumbnail for photo-led timeline cards, loaded through the shared useAuthedBlobUrl hook with a calm placeholder on failure.

import { Gift } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuthedBlobUrl } from "@/lib/use-authed-blob-url";

export function EventImagePreview({
  imageId,
  alt,
  className,
}: {
  imageId: number;
  alt: string;
  className?: string;
}) {
  const { url, status } = useAuthedBlobUrl({ kind: "image-thumb", id: imageId });

  return (
    <div className={cn("relative overflow-hidden bg-peach/14", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : status === "error" ? (
        <div className="absolute inset-0 grid place-items-center text-peach-deep" aria-hidden="true">
          <Gift className="h-7 w-7" strokeWidth={1.7} />
        </div>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-peach/12 motion-reduce:animate-none" aria-hidden="true" />
      )}
    </div>
  );
}
