// 手账文件导出：同一渲染器生成 HTML 文件、长图（750px 静态版按画布上限自适应倍率，过长自动按块分成多张 PNG）和 A5 PDF（离屏逐页截图后由 jsPDF 组装，内存按页释放）。
// modern-screenshot / jspdf 按需动态加载；全程可用 AbortSignal 取消；交付时优先 Web Share（iPhone 存到文件/相册或发微信），否则 <a download> 下载并延迟回收对象 URL。

import { collectJournalAssets, estimateAssetsBytes } from "./journal-assets";
import {
  formatBytes,
  LONG_IMAGE_WIDTH,
  paginateBlocks,
  planLongImage,
  PRINT_PAGE_HEIGHT,
  PRINT_PAGE_PADDING,
  CANVAS_MAX_AREA,
  CANVAS_MAX_DIMENSION,
  sanitizeFilename,
  type PageBlock,
} from "./journal-pages";
import {
  journalCss,
  renderFlowFragment,
  renderJournalBlocks,
  renderJournalDocument,
  renderPrintPage,
  type JournalBlock,
} from "./journal-render";
import type { JournalOut } from "./journal-types";

export type JournalFileFormat = "html" | "pdf" | "png";

export interface ExportProgress {
  label: string;
  done?: number;
  total?: number;
}

export interface ExportResult {
  files: File[];
  warning?: string;
}

export interface ExportOptions {
  includeImages: boolean;
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
}

const LARGE_HTML_BYTES = 30 * 1024 * 1024;
const LONG_FLOW_GAP = 30;
const LONG_FLOW_PADDING = 36 + 44;
const PRINT_FLOW_GAP = 18;
const PRINT_CONTENT_HEIGHT = PRINT_PAGE_HEIGHT - PRINT_PAGE_PADDING * 2;
const PAPER = "#fcf7ef";
const DESK = "#efe5d8";

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(host);
  return host;
}

async function mount(host: HTMLDivElement, html: string): Promise<HTMLElement> {
  host.innerHTML = `<style>${journalCss()}</style>${html}`;
  const root = host.querySelector<HTMLElement>(".lbj");
  if (!root) throw new Error("render failed");
  await Promise.all(Array.from(root.querySelectorAll("img")).map((img) => img.decode().catch(() => undefined)));
  await nextFrame();
  return root;
}

function measureBlocks(root: HTMLElement): number[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".lbj-flow > [data-block]")).map((el) => el.getBoundingClientRect().height);
}

function blockFlags(blocks: JournalBlock[], heights: number[], print: boolean): PageBlock[] {
  return blocks.map((block, i) => ({
    height: heights[i] ?? 0,
    alone: print && (block.kind === "cover" || block.kind === "closing"),
    keepWithNext: block.kind === "month" || block.kind === "meeting",
  }));
}

function ratioFor(height: number, preferred: number): number {
  const byArea = Math.sqrt(CANVAS_MAX_AREA / (LONG_IMAGE_WIDTH * Math.max(1, height)));
  const byDimension = CANVAS_MAX_DIMENSION / Math.max(1, height);
  return Math.max(0.5, Math.min(preferred, byArea, byDimension));
}

async function loadScreenshot() {
  return import("modern-screenshot");
}

async function exportHtml(journal: JournalOut, options: ExportOptions, name: string): Promise<ExportResult> {
  const assets = await collectJournalAssets(journal, {
    includeImages: options.includeImages,
    size: "full",
    maxEdge: 1600,
    quality: 0.82,
    signal: options.signal,
    onProgress: (done, total) => options.onProgress({ label: `正在装进照片 ${done}/${total}…`, done, total }),
  });
  throwIfAborted(options.signal);
  options.onProgress({ label: "正在装订成一本…" });
  const html = renderJournalDocument(journal, assets, { layout: "web", animate: true, includeImages: options.includeImages });
  const file = new File([html], `${name}.html`, { type: "text/html;charset=utf-8" });
  const bytes = file.size || estimateAssetsBytes(assets);
  return {
    files: [file],
    warning: bytes > LARGE_HTML_BYTES ? `这份手账有 ${formatBytes(bytes)}，打开或发送可能要多等一会儿` : undefined,
  };
}

async function exportPng(journal: JournalOut, options: ExportOptions, name: string): Promise<ExportResult> {
  const assets = await collectJournalAssets(journal, {
    includeImages: options.includeImages,
    size: "full",
    maxEdge: 1200,
    quality: 0.85,
    signal: options.signal,
    onProgress: (done, total) => options.onProgress({ label: `正在洗照片 ${done}/${total}…`, done, total }),
  });
  throwIfAborted(options.signal);
  const renderOptions = { layout: "long" as const, animate: false, includeImages: options.includeImages };
  const blocks = renderJournalBlocks(journal, assets, renderOptions);
  const { domToBlob } = await loadScreenshot();
  const host = createHost();
  try {
    options.onProgress({ label: "正在排版长图…" });
    let root = await mount(host, renderFlowFragment(blocks.map((b) => b.html), renderOptions));
    const heights = measureBlocks(root);
    const total = root.getBoundingClientRect().height;
    const preferred = Math.min(2, Math.max(1.5, window.devicePixelRatio || 2));
    const plan = planLongImage(total, LONG_IMAGE_WIDTH, preferred);
    const segments = plan.single
      ? [blocks.map((_, i) => i)]
      : paginateBlocks(blockFlags(blocks, heights, false), plan.maxSegmentHeight - LONG_FLOW_PADDING, LONG_FLOW_GAP);
    const files: File[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      throwIfAborted(options.signal);
      options.onProgress({ label: `正在拼第 ${i + 1}/${segments.length} 张长图…`, done: i, total: segments.length });
      if (segments.length > 1) root = await mount(host, renderFlowFragment(segments[i].map((index) => blocks[index].html), renderOptions));
      const height = root.getBoundingClientRect().height;
      const blob = await domToBlob(root, {
        type: "image/png",
        scale: ratioFor(height, plan.pixelRatio),
        backgroundColor: DESK,
        width: LONG_IMAGE_WIDTH,
        height: Math.ceil(height),
        font: false,
      });
      const suffix = segments.length > 1 ? `-${String(i + 1).padStart(2, "0")}` : "";
      files.push(new File([blob], `${name}${suffix}.png`, { type: "image/png" }));
    }
    return {
      files,
      warning: files.length > 1 ? `手账有点长，分成了 ${files.length} 张图，按编号顺序看就好` : undefined,
    };
  } finally {
    host.remove();
  }
}

async function exportPdf(journal: JournalOut, options: ExportOptions, name: string): Promise<ExportResult> {
  const assets = await collectJournalAssets(journal, {
    includeImages: options.includeImages,
    size: "full",
    maxEdge: 1000,
    quality: 0.85,
    signal: options.signal,
    onProgress: (done, total) => options.onProgress({ label: `正在洗照片 ${done}/${total}…`, done, total }),
  });
  throwIfAborted(options.signal);
  const renderOptions = { layout: "print" as const, animate: false, includeImages: options.includeImages };
  const blocks = renderJournalBlocks(journal, assets, renderOptions);
  const [{ domToJpeg }, { jsPDF }] = await Promise.all([loadScreenshot(), import("jspdf")]);
  const host = createHost();
  try {
    options.onProgress({ label: "正在排版每一页…" });
    const measureRoot = await mount(host, renderFlowFragment(blocks.map((b) => b.html), renderOptions));
    const heights = measureBlocks(measureRoot);
    const pages = paginateBlocks(blockFlags(blocks, heights, true), PRINT_CONTENT_HEIGHT, PRINT_FLOW_GAP);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5", compress: true });
    for (let i = 0; i < pages.length; i += 1) {
      throwIfAborted(options.signal);
      options.onProgress({ label: `正在整理第 ${i + 1}/${pages.length} 页…`, done: i, total: pages.length });
      const indexes = pages[i];
      const contentHeight = indexes.reduce((sum, index) => sum + (heights[index] ?? 0), 0) + PRINT_FLOW_GAP * Math.max(0, indexes.length - 1);
      const scale = contentHeight > PRINT_CONTENT_HEIGHT ? PRINT_CONTENT_HEIGHT / contentHeight : 1;
      const root = await mount(host, renderPrintPage(indexes.map((index) => blocks[index].html), i + 1, scale));
      const page = root.querySelector<HTMLElement>(".lbj-page") ?? root;
      const dataUrl = await domToJpeg(page, { scale: 2.4, quality: 0.88, backgroundColor: PAPER, font: false });
      if (i > 0) pdf.addPage("a5", "portrait");
      pdf.addImage(dataUrl, "JPEG", 0, 0, 148, 210, undefined, "FAST");
    }
    throwIfAborted(options.signal);
    options.onProgress({ label: "正在装订 PDF…" });
    const blob = pdf.output("blob");
    return { files: [new File([blob], `${name}.pdf`, { type: "application/pdf" })] };
  } finally {
    host.remove();
  }
}

export async function exportJournalFiles(journal: JournalOut, format: JournalFileFormat, options: ExportOptions): Promise<ExportResult> {
  const name = sanitizeFilename(journal.title);
  if (format === "html") return exportHtml(journal, options, name);
  if (format === "png") return exportPng(journal, options, name);
  return exportPdf(journal, options, name);
}

export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/** 必须在用户点击里调用；用户取消分享返回 "cancelled"。 */
export async function shareFiles(files: File[], title: string): Promise<"shared" | "cancelled" | "failed"> {
  try {
    await navigator.share({ files, title });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    return "failed";
  }
}

export async function downloadFiles(files: File[]): Promise<void> {
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (i < files.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 450));
  }
}
