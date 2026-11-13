// 手账图片资源收集：以 4 路有界并发拉取私有事件图片与头像，浏览器端缩到指定长边并转成 JPEG data URL；单张失败记为占位、不打断导出，可用 AbortSignal 取消。

import { fetchJournalAvatar, fetchJournalImage } from "./journal-api";
import { mapWithConcurrency } from "./journal-pages";
import type { JournalAssets, JournalOut } from "./journal-types";

export interface CollectAssetsOptions {
  includeImages: boolean;
  size: "thumb" | "full";
  maxEdge: number;
  quality: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** 已经取过的图片，重复使用以省流量。 */
  cache?: Map<string, string>;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Safari 对部分格式不支持 createImageBitmap，退回 <img> 解码。
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downscaleToDataUrl(blob: Blob, maxEdge: number, quality: number): Promise<string> {
  const image = await decode(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height, 1));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source, 0, 0, width, height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    canvas.width = 0;
    canvas.height = 0;
    if (!out) throw new Error("encode failed");
    return blobToDataUrl(out);
  } finally {
    image.close();
  }
}

export async function collectJournalAssets(journal: JournalOut, options: CollectAssetsOptions): Promise<JournalAssets> {
  const assets: JournalAssets = { images: new Map(), failedImages: new Set(), avatars: new Map() };
  type Job = { type: "image" | "avatar"; id: number };
  const jobs: Job[] = journal.pair.users.filter((u) => u.avatar_has_image).map((u) => ({ type: "avatar", id: u.id }));
  if (options.includeImages) {
    const seen = new Set<number>();
    for (const month of journal.months) {
      for (const entry of month.entries) {
        if (entry.locked) continue;
        for (const image of entry.images) {
          if (seen.has(image.id)) continue;
          seen.add(image.id);
          jobs.push({ type: "image", id: image.id });
        }
      }
    }
  }

  await mapWithConcurrency(
    jobs,
    4,
    async (job) => {
      const cacheKey = `${job.type}:${job.id}:${options.size}:${options.maxEdge}`;
      try {
        let dataUrl = options.cache?.get(cacheKey);
        if (!dataUrl) {
          const blob =
            job.type === "avatar"
              ? await fetchJournalAvatar(job.id, options.signal)
              : await fetchJournalImage(job.id, options.size, options.signal);
          dataUrl = await downscaleToDataUrl(blob, job.type === "avatar" ? 256 : options.maxEdge, options.quality);
          options.cache?.set(cacheKey, dataUrl);
        }
        if (job.type === "avatar") assets.avatars.set(job.id, dataUrl);
        else assets.images.set(job.id, dataUrl);
      } catch (error) {
        if (isAbort(error) || options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (job.type === "image") assets.failedImages.add(job.id);
      }
    },
    { signal: options.signal, onProgress: options.onProgress },
  );
  return assets;
}

export function estimateAssetsBytes(assets: JournalAssets): number {
  let total = 0;
  assets.images.forEach((url) => {
    total += Math.round(url.length * 0.75);
  });
  assets.avatars.forEach((url) => {
    total += Math.round(url.length * 0.75);
  });
  return total;
}
