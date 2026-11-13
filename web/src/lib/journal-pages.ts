// 手账导出的纯计算：文件名清理、确定性小角度旋转、按块高度分页（PDF A5 / 长图分段）、移动端画布面积与边长上限下的长图倍率与分段规划、有界并发执行。

/** iOS Safari 画布面积上限约 16.7M 像素，单边约 16384。 */
export const CANVAS_MAX_AREA = 16_777_216;
export const CANVAS_MAX_DIMENSION = 16_384;

export const LONG_IMAGE_WIDTH = 750;
/** A5 竖版 148×210mm 按 96dpi 换算的 CSS 像素。 */
export const PRINT_PAGE_WIDTH = 559;
export const PRINT_PAGE_HEIGHT = 794;
export const PRINT_PAGE_PADDING = 30;

const FILENAME_FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

export function sanitizeFilename(title: string, fallback = "我们的手账"): string {
  const cleaned = title
    .replace(FILENAME_FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim();
  const chars = Array.from(cleaned);
  const limited = chars.length > 60 ? chars.slice(0, 60).join("").trim() : cleaned;
  return limited || fallback;
}

/** 同一个 key 永远得到同一个角度，范围 [-max, max]，默认 1.5 度。 */
export function deterministicRotation(key: string | number, max = 1.5): number {
  let hash = 2166136261;
  const text = String(key);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 10001) / 10000;
  return Math.round((unit * 2 - 1) * max * 100) / 100;
}

export interface PageBlock {
  height: number;
  /** 必须从新页开始。 */
  breakBefore?: boolean;
  /** 独占一页（封面、结尾）。 */
  alone?: boolean;
  /** 不能留在页尾，跟下一块走（月份标题、见面票根）。 */
  keepWithNext?: boolean;
}

/** 贪心分页，返回每页包含的块下标；超高块独占一页，由调用方缩放。 */
export function paginateBlocks(blocks: PageBlock[], pageHeight: number, gap = 0): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;

  const flush = () => {
    if (current.length) pages.push(current);
    current = [];
    used = 0;
  };

  blocks.forEach((block, index) => {
    if (block.alone) {
      flush();
      pages.push([index]);
      return;
    }
    if (block.breakBefore) flush();
    let needed = block.height + (current.length ? gap : 0);
    if (block.keepWithNext) {
      const next = blocks[index + 1];
      if (next && !next.alone && !next.breakBefore) needed += gap + Math.min(next.height, pageHeight);
    }
    if (current.length && used + needed > pageHeight) flush();
    used += block.height + (current.length ? gap : 0);
    current.push(index);
  });
  flush();
  return pages;
}

export interface LongImagePlan {
  pixelRatio: number;
  /** 每段最多多少 CSS 像素高。 */
  maxSegmentHeight: number;
  /** 整张能否一次画完。 */
  single: boolean;
}

export function maxSegmentHeightFor(width: number, pixelRatio: number): number {
  const byDimension = CANVAS_MAX_DIMENSION / pixelRatio;
  const byArea = CANVAS_MAX_AREA / (width * pixelRatio * pixelRatio);
  return Math.floor(Math.min(byDimension, byArea));
}

/** 优先 2 倍清晰度；整张放不下时依次降到 1.5、1；仍放不下就按 1.5 倍分段。 */
export function planLongImage(totalHeight: number, width = LONG_IMAGE_WIDTH, preferredRatio = 2): LongImagePlan {
  const candidates = [preferredRatio, 1.5, 1].filter((ratio, i, all) => ratio <= preferredRatio && all.indexOf(ratio) === i);
  for (const ratio of candidates) {
    const limit = maxSegmentHeightFor(width, ratio);
    if (totalHeight <= limit) return { pixelRatio: ratio, maxSegmentHeight: limit, single: true };
  }
  const ratio = Math.min(1.5, preferredRatio);
  return { pixelRatio: ratio, maxSegmentHeight: maxSegmentHeightFor(width, ratio), single: false };
}

/** 有界并发映射；失败由 fn 自己兜底，取消时抛出 AbortError。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
      done += 1;
      options.onProgress?.(done, items.length);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return results;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
