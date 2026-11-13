"use client";

// /journal 手账工作台：从地址读取初始范围并同步回地址，按范围与“带上照片”拉取 /journal 并用统一渲染器生成在线翻看文档（缩略图有界并发、可中断）；
// 导出 HTML / PDF / 长图时显示分步进度、可取消、错误友好提示，手机触屏且支持文件分享时交给系统分享面板，否则直接下载。
// 桌面端左侧实体设置面板 + 右侧大预览；手机端预览铺满，设置收进底部弹层，操作放在贴着安全区的玻璃底条。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { api, APIError, friendlyErrorMessage } from "@/lib/api";
import { collectJournalAssets } from "@/lib/journal-assets";
import { fetchJournal } from "@/lib/journal-api";
import { canShareFiles, downloadFiles, exportJournalFiles, shareFiles } from "@/lib/journal-export";
import { journalPageSearch, journalQueryProblem, parseJournalQuery } from "@/lib/journal-query";
import { renderJournalDocument } from "@/lib/journal-render";
import type { JournalFormat, JournalOut, JournalQuery } from "@/lib/journal-types";
import type { MeetingSessionOut } from "@/lib/types";
import { JournalAction, type JournalExportState } from "./journal-action";
import { FORMAT_OPTIONS, JournalOptions, meetingOptionLabel } from "./journal-options";
import { JournalReader, JournalViewer } from "./journal-viewer";

function isAbort(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof APIError && error.status === 0 && /abort/i.test(error.message);
}

function journalErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    if (error.status === 404) return "这次见面找不到了，换一次试试吧";
    if (error.status === 422) {
      const message = friendlyErrorMessage(error);
      return message === "填写的内容有点问题，检查一下再试" ? "这个范围有点问题，换个日期再试试" : message;
    }
    return friendlyErrorMessage(error);
  }
  return "这次没能整理好，稍后再试一次";
}

function queryKey(query: JournalQuery, includeImages: boolean): string {
  return `${journalPageSearch(query)}|${includeImages ? 1 : 0}`;
}

function prefersShareSheet(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

function shortDate(value: string): string {
  const [, m, d] = value.split("-");
  return m && d ? `${Number(m)}.${Number(d)}` : value;
}

export function JournalStudio() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState<JournalQuery>(() => parseJournalQuery(searchParams));
  const [includeImages, setIncludeImages] = useState(true);
  const [format, setFormat] = useState<JournalFormat>("online");
  const [meetings, setMeetings] = useState<MeetingSessionOut[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [journal, setJournal] = useState<{ key: string; data: JournalOut } | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [exportState, setExportState] = useState<JournalExportState>({ status: "idle" });
  const [readerOpen, setReaderOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const thumbCache = useRef(new Map<string, string>());
  const exportAbort = useRef<AbortController | null>(null);

  const problem = journalQueryProblem(query);
  const currentKey = queryKey(query, includeImages);
  const exporting = exportState.status === "working";

  useEffect(() => {
    let cancelled = false;
    api
      .listMeetingSessions()
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort((a, b) => b.started_on.localeCompare(a.started_on));
        setMeetings(sorted);
        setQuery((current) =>
          current.scope === "meeting" && !current.meetingId && sorted[0] ? { ...current, meetingId: sorted[0].id } : current,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setMeetingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const search = journalPageSearch(query);
    if (typeof window !== "undefined" && window.location.search !== search) {
      router.replace(`/journal${search}`, { scroll: false });
    }
  }, [query, router]);

  useEffect(() => {
    if (problem) {
      setDoc(null);
      setPreviewError(null);
      setPreviewLabel(null);
      return;
    }
    const controller = new AbortController();
    const key = queryKey(query, includeImages);
    const timer = window.setTimeout(async () => {
      setPreviewError(null);
      setPreviewLabel("正在翻开手账…");
      try {
        const data = await fetchJournal(query, controller.signal);
        if (controller.signal.aborted) return;
        setJournal({ key, data });
        const assets = await collectJournalAssets(data, {
          includeImages,
          size: "thumb",
          maxEdge: 900,
          quality: 0.8,
          cache: thumbCache.current,
          signal: controller.signal,
          onProgress: (done, total) => {
            if (!controller.signal.aborted && total > 1) setPreviewLabel(`正在贴照片 ${done}/${total}…`);
          },
        });
        if (controller.signal.aborted) return;
        setDoc(renderJournalDocument(data, assets, { layout: "web", animate: true, includeImages }));
        setPreviewLabel(null);
      } catch (error) {
        if (controller.signal.aborted || isAbort(error)) return;
        setPreviewLabel(null);
        setPreviewError(journalErrorMessage(error));
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, includeImages, problem, reloadToken]);

  useEffect(() => () => exportAbort.current?.abort(), []);

  const resetExport = useCallback(() => {
    exportAbort.current?.abort();
    exportAbort.current = null;
    setExportState({ status: "idle" });
  }, []);

  useEffect(() => {
    resetExport();
  }, [currentKey, format, resetExport]);

  const runExport = useCallback(async () => {
    if (format === "online") {
      if (doc) setReaderOpen(true);
      return;
    }
    if (problem) return;
    exportAbort.current?.abort();
    const controller = new AbortController();
    exportAbort.current = controller;
    setSheetOpen(false);
    setExportState({ status: "working", label: "正在准备…" });
    try {
      const data = journal?.key === currentKey ? journal.data : await fetchJournal(query, controller.signal);
      const result = await exportJournalFiles(data, format, {
        includeImages,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setExportState({ status: "working", ...progress });
        },
      });
      if (controller.signal.aborted) return;
      const canShare = prefersShareSheet() && canShareFiles(result.files);
      if (!canShare) await downloadFiles(result.files);
      setExportState({ status: "done", files: result.files, canShare, delivered: !canShare, warning: result.warning });
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return;
      setExportState({ status: "error", message: error instanceof APIError ? journalErrorMessage(error) : "这次没能做好，可能是照片太多了，试试不带照片或缩小范围" });
    } finally {
      if (exportAbort.current === controller) exportAbort.current = null;
    }
  }, [format, doc, problem, journal, currentKey, query, includeImages]);

  const shareResult = useCallback(async () => {
    if (exportState.status !== "done") return;
    const outcome = await shareFiles(exportState.files, journal?.data.title ?? "我们的手账");
    if (outcome === "failed") await downloadFiles(exportState.files);
    if (outcome !== "cancelled") setExportState({ ...exportState, delivered: true });
  }, [exportState, journal]);

  const downloadResult = useCallback(async () => {
    if (exportState.status !== "done") return;
    await downloadFiles(exportState.files);
    setExportState({ ...exportState, delivered: true });
  }, [exportState]);

  const summary = useMemo(() => {
    let scope = "全部回忆";
    if (query.scope === "range") scope = query.start && query.end ? `${shortDate(query.start)}–${shortDate(query.end)}` : "按日期";
    if (query.scope === "meeting") {
      const meeting = meetings.find((m) => m.id === query.meetingId);
      scope = meeting ? meetingOptionLabel(meeting).split(" · ")[0] : "某次见面";
    }
    const formatLabel = FORMAT_OPTIONS.find((option) => option.value === format)?.label ?? "";
    return `${scope} · ${includeImages ? "带照片" : "只有文字"} · ${formatLabel}`;
  }, [query, meetings, includeImages, format]);

  const stats = journal?.key === currentKey ? journal.data.stats : null;
  const title = journal?.key === currentKey ? journal.data.title : "我们的手账";
  const ready = !problem && (format !== "online" || Boolean(doc && !previewLabel));

  const optionsProps = {
    query,
    onQueryChange: setQuery,
    includeImages,
    onIncludeImagesChange: setIncludeImages,
    format,
    onFormatChange: setFormat,
    meetings,
    meetingsLoading,
    disabled: exporting,
  };
  const actionProps = {
    format,
    state: exportState,
    ready,
    onPrimary: runExport,
    onCancel: resetExport,
    onShare: shareResult,
    onDownload: downloadResult,
    onReset: resetExport,
  };

  return (
    <div className="viewport-guard min-h-dvh w-full">
      <AppHeader title="我们的手账" subtitle="翻一翻，也可以带走一份" back={{ href: "/timeline", label: "返回首页" }} />

      <main className="mx-auto w-full min-w-0 max-w-5xl px-3 pb-[calc(env(safe-area-inset-bottom,0px)+10rem)] pt-3 sm:px-6 sm:pt-4 lg:pb-8">
        <div className="lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-6">
          <aside className="hidden lg:block">
            <div className="content-surface sticky top-20 flex flex-col gap-6 p-5">
              <JournalOptions {...optionsProps} idPrefix="desk" />
              <div className="border-t border-line/70 pt-5">
                <JournalAction {...actionProps} />
              </div>
            </div>
          </aside>

          <section className="min-w-0" aria-label="手账预览">
            <JournalViewer
              doc={problem ? null : doc}
              title={title}
              loadingLabel={problem ? null : previewLabel}
              error={problem ? null : previewError}
              hint={problem}
              onRetry={() => setReloadToken((value) => value + 1)}
              className="h-[calc(100dvh-14.5rem-env(safe-area-inset-bottom,0px))] min-h-[22rem] lg:h-[calc(100dvh-7.5rem)] lg:min-h-[32rem]"
            />
            {stats ? (
              <p className="mt-2 px-1 text-center font-sc text-xs text-ink-muted">
                {`共 ${stats.entry_count} 篇小事`}
                {stats.image_count ? ` · ${stats.image_count} 张照片` : ""}
                {stats.meeting_count ? ` · ${stats.meeting_count} 次见面` : ""}
                {stats.gift_count ? ` · ${stats.gift_count} 份礼物` : ""}
              </p>
            ) : null}
          </section>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 box-border max-w-full px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.6rem)] pt-2 lg:hidden">
        <GlassSurface variant="regular" className="mx-auto flex w-full max-w-[34rem] flex-col gap-2 rounded-[1.6rem] p-2.5">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            disabled={exporting}
            className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-full px-3 text-left transition hover:bg-ink/5 focus-ring disabled:opacity-60"
            aria-label={`调整手账：${summary}`}
          >
            <SlidersHorizontal className="h-4 w-4 flex-none text-rose-deep" />
            <span className="min-w-0 flex-1 truncate font-sc text-sm text-ink">{summary}</span>
            <span className="flex-none font-sc text-xs font-medium text-rose-deep">调整</span>
          </button>
          <JournalAction {...actionProps} compact />
        </GlassSurface>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetBody open={sheetOpen}>
          <SheetContent closeLabel="收起设置" reducedMotion={reducedMotion} className="overflow-y-auto lg:hidden">
            <SheetTitle className="pr-12 font-display text-xl font-semibold text-ink">这本手账</SheetTitle>
            <SheetDescription className="mt-1 pr-12 font-sc text-sm text-ink-soft">选好范围和样子，预览会跟着变。</SheetDescription>
            <div className="mt-5">
              <JournalOptions {...optionsProps} idPrefix="sheet" />
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="btn-primary mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full font-sc text-[15px] font-medium focus-ring"
            >
              好了
            </button>
          </SheetContent>
        </SheetBody>
      </Sheet>

      <JournalReader open={readerOpen} doc={doc} title={title} onClose={() => setReaderOpen(false)} />
    </div>
  );
}
