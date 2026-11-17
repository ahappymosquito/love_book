"use client";

// 首页唯一的手账本：每个月是一本小册，默认翻到本月（同一会话内记住上次翻到的月份，也可用 ?month=YYYY-MM 打开）。
// 书页保持固定比例（高度贴合视口），页内不滚动：隐藏的测量副本量出每张卡片的真实高度，packSheets 把当月小事装进一张张纸，记录多就多翻几页。
// 左右滑动 / 触控板横扫 / ← → 键 / 底部按钮逐页翻，翻到月末继续翻进下一个月（往回翻落在上个月最后一页）；工具条的箭头和月份网格按月跳。
// 手机是单页（第一页带月份标题和月历），书页绕左侧装订线翻起；lg 以上是左右对开（第一个对开左页是月历、见面票根、照片和导出入口），翻页时右页先翻过书脊、再落成左页。
// 翻页只动 transform / opacity，跟手拖动只做轻微掀起，减弱动效时改为淡入淡出；纸张是实体内容层，不用 backdrop-filter。
// 触屏首次显示“左右滑翻页”提示，只有真正滑动翻过一页才记住不再提示（按钮和键盘翻页不算）。

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, Ref, WheelEvent as ReactWheelEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import type { PanInfo, Variants } from "framer-motion";
import { BookOpen, CalendarDays, CalendarHeart, ChevronDown, ChevronLeft, ChevronRight, Plus, Undo2 } from "lucide-react";
import { MonthPickerGrid } from "@/components/month-picker";
import { PolaroidFrame } from "@/components/scrapbook-decor";
import { TimelineEntry } from "@/components/timeline-entry";
import { EventImagePreview, MeasuringContext } from "@/components/event-image-preview";
import { cn } from "@/lib/cn";
import { shanghaiDateKey, shanghaiMonthKey } from "@/lib/dates";
import { cardTilt, paperPatternFor } from "@/lib/gift-scrapbook";
import {
  buildBookMonths,
  monthCalendar,
  monthDateRange,
  neighborIndex,
  packSheets,
  sheetPage,
  spreadCount,
  spreadSheets,
} from "@/lib/journal-book";
import type { BookMonth, BookSheet, SheetDay } from "@/lib/journal-book";
import { MOTION_EASE, MOTION_TRANSITIONS } from "@/lib/motion";
import { useMediaQuery } from "@/lib/use-media-query";
import type { EventSummary, MeetingSessionOut } from "@/lib/types";

const SESSION_MONTH_KEY = "love-book:book-month";
const SWIPE_HINT_KEY = "love-book:book-swipe-hint-seen";
const MONTH_PARAM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FLIP_SINGLE = 0.56;
const FLIP_HALF = 0.32;
const FLIP_LIFT: [number, number, number, number] = [0.45, 0.05, 0.75, 0.35];
const FLIP_LAND: [number, number, number, number] = [0.2, 0.65, 0.3, 1];
const SWIPE_DISTANCE = 56;
const SWIPE_VELOCITY = 420;
const FLIP_COOLDOWN_MS = 240;
const STICKY_OFFSET_PX = 148;
const WEEKDAY_HEADERS = ["一", "二", "三", "四", "五", "六", "日"];
// 与 SheetEntries 里的 mt-3 / space-y-4 / space-y-7 和首页标题区的 mb-6 一一对应。
const SHEET_METRICS = { stampGap: 12, entryGap: 16, dayGap: 28 };
const HEAD_GAP = 24;
const ESTIMATED_ENTRY = 150;
const ESTIMATED_CAPACITY = 520;

type Direction = 1 | -1;
type LeafSide = "single" | "left" | "right";

function readInitialMonth(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const fromUrl = new URLSearchParams(window.location.search).get("month");
  if (fromUrl && MONTH_PARAM_RE.test(fromUrl)) return fromUrl;
  try {
    const stored = window.sessionStorage.getItem(SESSION_MONTH_KEY);
    if (stored && MONTH_PARAM_RE.test(stored)) return stored;
  } catch {
    // sessionStorage 不可用时直接用本月
  }
  return fallback;
}

export interface JournalBookState {
  months: BookMonth[];
  month: BookMonth;
  index: number;
  direction: Direction;
  currentMonth: string;
  counts: ReadonlyMap<string, number>;
  hasPrev: boolean;
  hasNext: boolean;
  /** 当月第几页；-1 表示最后一页（从下个月往回翻时落在这里）。 */
  page: number;
  goTo: (monthKey: string) => void;
  flip: (direction: Direction) => boolean;
  turnPage: (direction: Direction, current: number, count: number) => boolean;
  showPage: (page: number, current: number) => void;
}

export function useJournalBook(events: EventSummary[] | null): JournalBookState {
  const currentMonth = useMemo(() => shanghaiMonthKey(), []);
  const months = useMemo(() => buildBookMonths(events ?? [], currentMonth), [events, currentMonth]);
  const [activeKey, setActiveKey] = useState(() => readInitialMonth(currentMonth));
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<Direction>(1);
  const lastFlipAt = useRef(0);
  const found = months.findIndex((item) => item.key === activeKey);
  const index = found >= 0 ? found : months.length - 1;
  const month = months[index];

  useEffect(() => {
    if (events === null) return;
    try {
      window.sessionStorage.setItem(SESSION_MONTH_KEY, month.key);
    } catch {
      // 记不住上次的月份也不影响翻看
    }
  }, [events, month.key]);

  const coolingDown = useCallback(() => {
    const now = Date.now();
    if (now - lastFlipAt.current < FLIP_COOLDOWN_MS) return true;
    lastFlipAt.current = now;
    return false;
  }, []);

  const goTo = useCallback(
    (monthKey: string) => {
      const target = months.findIndex((item) => item.key === monthKey);
      if (target < 0 || target === index) return;
      lastFlipAt.current = Date.now();
      setDirection(target > index ? 1 : -1);
      setActiveKey(monthKey);
      setPage(0);
    },
    [index, months],
  );

  const flipMonth = useCallback(
    (nextDirection: Direction, land: "first" | "last") => {
      const target = neighborIndex(months.length, index, nextDirection);
      if (target === null || coolingDown()) return false;
      setDirection(nextDirection);
      setActiveKey(months[target].key);
      setPage(land === "last" ? -1 : 0);
      return true;
    },
    [coolingDown, index, months],
  );

  const flip = useCallback((nextDirection: Direction) => flipMonth(nextDirection, "first"), [flipMonth]);

  const turnPage = useCallback(
    (nextDirection: Direction, current: number, count: number) => {
      const target = current + nextDirection;
      if (target >= 0 && target < count) {
        if (coolingDown()) return false;
        setDirection(nextDirection);
        setPage(target);
        return true;
      }
      return flipMonth(nextDirection, nextDirection < 0 ? "last" : "first");
    },
    [coolingDown, flipMonth],
  );

  const showPage = useCallback((target: number, current: number) => {
    if (target === current) return;
    lastFlipAt.current = Date.now();
    setDirection(target > current ? 1 : -1);
    setPage(target);
  }, []);

  const counts = useMemo(() => new Map(months.map((item) => [item.key, item.stats.entries])), [months]);

  return {
    months,
    month,
    index,
    direction,
    currentMonth,
    counts,
    hasPrev: index > 0,
    hasNext: index < months.length - 1,
    page,
    goTo,
    flip,
    turnPage,
    showPage,
  };
}

/* ------------------------------------------------------------------ */
/* 工具条：上一个月 / 选月 / 下一个月                                   */
/* ------------------------------------------------------------------ */

export function BookMonthNav({ book }: { book: JournalBookState }) {
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { month } = book;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative flex-none">
      <div className="glass-surface glass-clear glass-capsule flex h-11 items-center gap-0.5 px-1 sm:h-12">
        <button
          type="button"
          onClick={() => book.flip(-1)}
          disabled={!book.hasPrev}
          className="grid h-9 w-9 place-items-center rounded-full text-ink-soft transition hover:bg-rose/10 hover:text-rose-deep disabled:opacity-30 focus-ring"
          aria-label="翻到上一个月"
          title="上一个月"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-full px-2.5 text-ink transition hover:bg-rose/10 focus-ring sm:min-w-[8.5rem]"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`选择月份，当前 ${month.year} 年 ${month.month} 月`}
        >
          <CalendarDays className="hidden h-4 w-4 flex-none text-rose-deep sm:block" aria-hidden="true" />
          <span className="flex flex-col items-center leading-none sm:flex-row sm:gap-1">
            <span className="font-sc text-[10px] text-ink-muted sm:text-sm sm:text-ink">{month.year}<span className="hidden sm:inline"> 年</span></span>
            <span className="font-sc text-sm font-semibold">{month.month} 月</span>
          </span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
            className="grid place-items-center text-ink-muted"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </motion.span>
        </button>
        <button
          type="button"
          onClick={() => book.flip(1)}
          disabled={!book.hasNext}
          className="grid h-9 w-9 place-items-center rounded-full text-ink-soft transition hover:bg-rose/10 hover:text-rose-deep disabled:opacity-30 focus-ring"
          aria-label="翻到下一个月"
          title="下一个月"
        >
          <ChevronRight className="h-[18px] w-[18px]" />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="翻到哪个月"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
            className="book-month-popover absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(19.5rem,calc(100vw-2rem))] origin-top-right p-3.5"
          >
            <MonthPickerGrid
              value={month.key}
              counts={book.counts}
              minMonth={book.months[0].key}
              maxMonth={book.currentMonth}
              requireEntries
              onSelect={(key) => {
                book.goTo(key);
                setOpen(false);
              }}
            />
            {month.key !== book.currentMonth && (
              <button
                type="button"
                onClick={() => {
                  book.goTo(book.currentMonth);
                  setOpen(false);
                }}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full bg-rose/10 font-sc text-sm font-medium text-rose-deep transition hover:bg-rose/16 focus-ring"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                回到本月
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 书本与翻页                                                           */
/* ------------------------------------------------------------------ */

const ZINDEX_NOW = { duration: 0 };

function leafVariants(side: LeafSide, reduced: boolean): Variants {
  if (reduced) {
    return {
      enter: { opacity: 0, zIndex: 2 },
      center: { opacity: 1, zIndex: 2, transition: { ...MOTION_TRANSITIONS.state, zIndex: ZINDEX_NOW } },
      exit: { opacity: 0, zIndex: 1, transition: { ...MOTION_TRANSITIONS.fast, zIndex: ZINDEX_NOW } },
    };
  }
  if (side === "single") {
    return {
      enter: (dir: Direction) =>
        dir > 0 ? { rotateY: 0, scale: 0.965, opacity: 0.6, zIndex: 1 } : { rotateY: -98, scale: 1, opacity: 1, zIndex: 3 },
      center: (dir: Direction) => ({
        rotateY: 0,
        scale: 1,
        opacity: 1,
        zIndex: 2,
        transition: { duration: FLIP_SINGLE, ease: dir > 0 ? MOTION_EASE : FLIP_LAND, zIndex: ZINDEX_NOW },
      }),
      exit: (dir: Direction) =>
        dir > 0
          ? { rotateY: -98, zIndex: 3, transition: { duration: FLIP_SINGLE, ease: FLIP_LIFT, zIndex: ZINDEX_NOW } }
          : { scale: 0.965, opacity: 0.55, zIndex: 1, transition: { duration: FLIP_SINGLE, ease: MOTION_EASE, zIndex: ZINDEX_NOW } },
    };
  }
  const turnsAway = side === "right" ? 1 : -1;
  const edge = side === "right" ? -90 : 90;
  return {
    enter: (dir: Direction) => (dir === turnsAway ? { rotateY: 0, opacity: 1, zIndex: 1 } : { rotateY: edge, opacity: 1, zIndex: 3 }),
    center: (dir: Direction) => ({
      rotateY: 0,
      opacity: 1,
      zIndex: 2,
      transition:
        dir === turnsAway
          ? { duration: 0 }
          : { rotateY: { delay: FLIP_HALF, duration: FLIP_HALF, ease: FLIP_LAND }, opacity: { duration: 0 }, zIndex: ZINDEX_NOW },
    }),
    exit: (dir: Direction) =>
      dir === turnsAway
        ? { rotateY: edge, zIndex: 3, transition: { rotateY: { duration: FLIP_HALF, ease: FLIP_LIFT }, zIndex: ZINDEX_NOW } }
        : { opacity: 0, zIndex: 1, transition: { opacity: { delay: FLIP_HALF * 2, duration: 0.01 }, zIndex: ZINDEX_NOW } },
  };
}

function shadeVariants(side: LeafSide, reduced: boolean): Variants {
  if (reduced) return { enter: { opacity: 0 }, center: { opacity: 0 }, exit: { opacity: 0 } };
  if (side === "single") {
    return {
      enter: (dir: Direction) => ({ opacity: dir > 0 ? 0.18 : 0.42 }),
      center: { opacity: 0, transition: { duration: FLIP_SINGLE, ease: MOTION_EASE } },
      exit: (dir: Direction) => ({ opacity: dir > 0 ? 0.45 : 0.22, transition: { duration: FLIP_SINGLE, ease: MOTION_EASE } }),
    };
  }
  const turnsAway = side === "right" ? 1 : -1;
  return {
    enter: (dir: Direction) => ({ opacity: dir === turnsAway ? 0 : 0.42 }),
    center: (dir: Direction) => ({
      opacity: 0,
      transition: dir === turnsAway ? { duration: 0 } : { delay: FLIP_HALF, duration: FLIP_HALF, ease: MOTION_EASE },
    }),
    exit: (dir: Direction) =>
      dir === turnsAway
        ? { opacity: 0.42, transition: { duration: FLIP_HALF, ease: FLIP_LIFT } }
        : { opacity: 0.16, transition: { delay: FLIP_HALF, duration: FLIP_HALF, ease: MOTION_EASE } },
  };
}

function BookLeaf({
  side,
  direction,
  pattern,
  children,
}: {
  side: LeafSide;
  direction: Direction;
  pattern: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const variants = useMemo(() => leafVariants(side, reducedMotion), [side, reducedMotion]);
  const shade = useMemo(() => shadeVariants(side, reducedMotion), [side, reducedMotion]);

  return (
    <motion.article
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      className={cn("journal-leaf", `journal-leaf-${side}`, `scrapbook-paper-${pattern}`)}
      style={{ transformOrigin: side === "left" ? "right center" : "left center" }}
    >
      {children}
      <motion.span custom={direction} variants={shade} className={cn("journal-leaf-shade", `journal-leaf-shade-${side}`)} aria-hidden="true" />
    </motion.article>
  );
}

function useSwipeHint(): [boolean, () => void] {
  const coarse = useMediaQuery("(pointer: coarse)");
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    try {
      setSeen(window.localStorage.getItem(SWIPE_HINT_KEY) === "1");
    } catch {
      setSeen(true);
    }
  }, []);
  const dismiss = useCallback(() => {
    setSeen(true);
    try {
      window.localStorage.setItem(SWIPE_HINT_KEY, "1");
    } catch {
      // 不能记住也只是下次再提示一次
    }
  }, []);
  return [coarse && !seen, dismiss];
}

interface SheetMeasure {
  capacity: number;
  head: number;
  stamp: number;
  heights: ReadonlyMap<number, number>;
}

function sameMeasure(left: SheetMeasure | null, right: SheetMeasure): boolean {
  if (!left || left.capacity !== right.capacity || left.head !== right.head || left.stamp !== right.stamp) return false;
  if (left.heights.size !== right.heights.size) return false;
  for (const [id, height] of right.heights) if (left.heights.get(id) !== height) return false;
  return true;
}

export function JournalBook({
  book,
  meetingSessions,
  onChanged,
  onCreate,
}: {
  book: JournalBookState;
  meetingSessions: MeetingSessionOut[];
  onChanged: () => Promise<void>;
  onCreate: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const spread = useMediaQuery("(min-width: 1024px)");
  const { month, direction, index, months } = book;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const tilt = useMotionValue(0);
  const shift = useMotionValue(0);
  const panRef = useRef<{ width: number } | null>(null);
  const suppressClickRef = useRef(false);
  const wheelRef = useRef({ total: 0, lockedUntil: 0, resetTimer: 0 });
  const firstRenderRef = useRef(true);
  const [showHint, dismissHint] = useSwipeHint();
  const [measure, setMeasure] = useState<SheetMeasure | null>(null);
  const [flashKey, setFlashKey] = useState<{ dateKey: string; at: number } | null>(null);
  const today = shanghaiDateKey();
  const pattern = paperPatternFor(month.key);

  // 相邻月份也一起量，翻进去时页数已经是准的（往回翻要直接落在最后一页）。
  const measureEvents = useMemo(
    () => [months[index - 1], month, months[index + 1]].filter(Boolean).flatMap((item) => item.days.flatMap((day) => day.events)),
    [index, month, months],
  );

  const remeasure = useCallback(() => {
    const root = measureRef.current;
    if (!root) return;
    const slot = root.querySelector<HTMLElement>("[data-measure-slot]");
    const head = root.querySelector<HTMLElement>("[data-measure-head]");
    const stamp = root.querySelector<HTMLElement>("[data-measure-stamp]");
    if (!slot || !stamp) return;
    const heights = new Map<number, number>();
    root.querySelectorAll<HTMLElement>("[data-measure-id]").forEach((node) => heights.set(Number(node.dataset.measureId), node.offsetHeight));
    const next = { capacity: slot.clientHeight, head: head ? head.offsetHeight + HEAD_GAP : 0, stamp: stamp.offsetHeight, heights };
    setMeasure((previous) => (sameMeasure(previous, next) ? previous : next));
  }, []);

  useLayoutEffect(() => {
    remeasure();
  }, [remeasure, measureEvents, spread]);

  useEffect(() => {
    const root = measureRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => remeasure());
    root.querySelectorAll("[data-measure-slot], [data-measure-list], [data-measure-head]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [remeasure, measureEvents, spread]);

  const sheets = useMemo(() => {
    const capacity = measure?.capacity || ESTIMATED_CAPACITY;
    const metrics = { ...SHEET_METRICS, stamp: measure?.stamp ?? 34 };
    return packSheets(
      month.days,
      (id) => measure?.heights.get(id) ?? ESTIMATED_ENTRY,
      (sheet) => (!spread && sheet === 0 ? capacity - (measure?.head ?? 0) : capacity),
      metrics,
    );
  }, [measure, month.days, spread]);

  const pageCount = spread ? spreadCount(sheets.length) : sheets.length;
  const page = book.page < 0 ? pageCount - 1 : Math.min(book.page, pageCount - 1);
  const turn = useCallback((dir: Direction) => book.turnPage(dir, page, pageCount), [book, page, pageCount]);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const top = stage.getBoundingClientRect().top;
    if (top < STICKY_OFFSET_PX - 8) {
      window.scrollTo({ top: window.scrollY + top - STICKY_OFFSET_PX, behavior: reducedMotion ? "auto" : "smooth" });
    }
  }, [month.key, page, reducedMotion]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [role='slider'], [role='tablist']")) return;
      if (document.querySelector("[aria-modal='true']")) return;
      if (turn(event.key === "ArrowRight" ? 1 : -1)) event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [turn]);

  useEffect(() => {
    if (!flashKey) return;
    const timer = window.setTimeout(() => {
      stageRef.current?.querySelectorAll<HTMLElement>(`.journal-leaf [data-book-day="${flashKey.dateKey}"]`).forEach((target) => {
        target.classList.remove("is-flash");
        void target.offsetWidth;
        target.classList.add("is-flash");
      });
    }, flashKey.at);
    return () => window.clearTimeout(timer);
  }, [flashKey]);

  function settleDrag() {
    const spring = reducedMotion ? MOTION_TRANSITIONS.reduced : { type: "spring" as const, stiffness: 340, damping: 32 };
    void animate(tilt, 0, spring);
    void animate(shift, 0, spring);
  }

  const canTurnPrev = page > 0 || book.hasPrev;
  const canTurnNext = page < pageCount - 1 || book.hasNext;

  function handlePanStart(event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    const pointerType = "pointerType" in event ? event.pointerType : "touch";
    if (pointerType === "mouse" || Math.abs(info.offset.x) <= Math.abs(info.offset.y)) {
      panRef.current = null;
      return;
    }
    panRef.current = { width: stageRef.current?.offsetWidth ?? 360 };
  }

  function handlePan(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    const pan = panRef.current;
    if (!pan) return;
    const offset = info.offset.x;
    if (Math.abs(offset) > 8) suppressClickRef.current = true;
    const canTurn = offset < 0 ? canTurnNext : canTurnPrev;
    const effective = canTurn ? offset : offset * 0.22;
    if (reducedMotion) return;
    if (spread) {
      shift.set(Math.max(-48, Math.min(48, effective * 0.25)));
      return;
    }
    tilt.set(effective < 0 ? Math.max(-22, (effective / pan.width) * 30) : 0);
    shift.set(effective > 0 ? Math.min(52, effective * 0.3) : effective * 0.05);
  }

  function handlePanEnd(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    const pan = panRef.current;
    panRef.current = null;
    settleDrag();
    if (!pan) return;
    const { x } = info.offset;
    const vx = info.velocity.x;
    let turned = false;
    if (x < -SWIPE_DISTANCE || vx < -SWIPE_VELOCITY) turned = turn(1);
    else if (x > SWIPE_DISTANCE || vx > SWIPE_VELOCITY) turned = turn(-1);
    if (turned) dismissHint();
  }

  function handleClickCapture(event: ReactMouseEvent) {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleWheel(event: ReactWheelEvent) {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.2) return;
    const state = wheelRef.current;
    window.clearTimeout(state.resetTimer);
    state.resetTimer = window.setTimeout(() => {
      state.total = 0;
    }, 180);
    if (Date.now() < state.lockedUntil) return;
    state.total += event.deltaX;
    if (Math.abs(state.total) < 70) return;
    turn(state.total > 0 ? 1 : -1);
    state.total = 0;
    state.lockedUntil = Date.now() + 700;
  }

  const jumpToDay = useCallback(
    (dateKey: string) => {
      const sheetIndex = sheets.findIndex((sheet) => sheet.days.some((day) => day.dateKey === dateKey));
      if (sheetIndex < 0) return;
      const target = sheetPage(sheetIndex, spread);
      book.showPage(target, page);
      setFlashKey({ dateKey, at: target === page || reducedMotion ? 0 : 520 });
    },
    [book, page, reducedMotion, sheets, spread],
  );

  const prevMonth = book.hasPrev ? months[index - 1] : null;
  const nextMonth = book.hasNext ? months[index + 1] : null;
  const leafKey = `${month.key}:${page}`;
  const entriesProps = { month, onChanged, onCreate, isCurrent: month.key === book.currentMonth };
  const pair = spreadSheets(page);

  return (
    <section className="journal-book" aria-roledescription="手账本" aria-label={`${month.year} 年 ${month.month} 月，第 ${page + 1} 页`}>
      <motion.div
        ref={stageRef}
        className={cn("journal-book-stage", spread && "is-spread", canTurnPrev && "has-prev", canTurnNext && "has-next")}
        style={{ touchAction: "pan-y" } as CSSProperties}
        onPanStart={handlePanStart}
        onPan={handlePan}
        onPanEnd={handlePanEnd}
        onClickCapture={handleClickCapture}
        onPointerDownCapture={() => {
          suppressClickRef.current = false;
        }}
        onWheel={handleWheel}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.emphasis}
      >
        <motion.div className="journal-book-lift" style={{ rotateY: tilt, x: shift }}>
          {spread ? (
            <div className="journal-book-spread">
              <div className="journal-book-column">
                <AnimatePresence initial={false} custom={direction}>
                  <BookLeaf key={leafKey} side="left" direction={direction} pattern={page === 0 ? "dots" : pattern}>
                    {pair.left === null ? (
                      <OverviewPage month={month} today={today} meetingSessions={meetingSessions} pageNumber={1} onPickDay={jumpToDay} />
                    ) : (
                      <SheetPage sheet={sheets[pair.left]} sheetIndex={pair.left} pageNumber={page * 2 + 1} align="left" {...entriesProps} />
                    )}
                  </BookLeaf>
                </AnimatePresence>
              </div>
              <div className="journal-book-spine" aria-hidden="true" />
              <div className="journal-book-column">
                <AnimatePresence initial={false} custom={direction}>
                  <BookLeaf key={leafKey} side="right" direction={direction} pattern={pattern}>
                    <SheetPage sheet={sheets[pair.right]} sheetIndex={pair.right} pageNumber={page * 2 + 2} align="right" {...entriesProps} />
                  </BookLeaf>
                </AnimatePresence>
                <SheetMeasurer ref={measureRef} side="right" events={measureEvents} onChanged={onChanged} />
              </div>
            </div>
          ) : (
            <div className="journal-book-column journal-book-column-single">
              <AnimatePresence initial={false} custom={direction}>
                <BookLeaf key={leafKey} side="single" direction={direction} pattern={pattern}>
                  <SheetPage
                    sheet={sheets[page]}
                    sheetIndex={page}
                    pageNumber={page + 1}
                    align="right"
                    head={page === 0 ? <FirstPageHead month={month} today={today} onPickDay={jumpToDay} /> : undefined}
                    {...entriesProps}
                  />
                </BookLeaf>
              </AnimatePresence>
              <SheetMeasurer
                ref={measureRef}
                side="single"
                events={measureEvents}
                onChanged={onChanged}
                head={<FirstPageHead month={month} today={today} onPickDay={() => undefined} />}
              />
            </div>
          )}
        </motion.div>
      </motion.div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1">
        <div>
          {canTurnPrev && (
            <button
              type="button"
              onClick={() => turn(-1)}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-sc text-sm text-ink-soft transition hover:bg-rose/10 hover:text-rose-deep focus-ring"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {page > 0 ? "上一页" : prevMonth ? `${prevMonth.year !== month.year ? `${prevMonth.year} 年 ` : ""}${prevMonth.month} 月` : ""}
            </button>
          )}
        </div>
        <div className="flex flex-col items-center text-center">
          <span className="font-sc text-xs text-ink-muted">
            {month.month} 月 · 第 {page + 1} / {pageCount} 页
          </span>
          <AnimatePresence initial={false}>
            {showHint && (pageCount > 1 || months.length > 1) && (
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
                className="mt-1 font-sc text-[11px] text-rose-deep/80"
              >
                左右滑翻页
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="flex justify-end">
          {canTurnNext && (
            <button
              type="button"
              onClick={() => turn(1)}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-sc text-sm text-ink-soft transition hover:bg-rose/10 hover:text-rose-deep focus-ring"
            >
              {page < pageCount - 1 ? "下一页" : nextMonth ? `${nextMonth.year !== month.year ? `${nextMonth.year} 年 ` : ""}${nextMonth.month} 月` : ""}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 测量副本：和真实纸页同宽同高，隐藏渲染所有要排版的卡片                  */
/* ------------------------------------------------------------------ */

function SheetMeasurer({
  ref,
  side,
  events,
  head,
  onChanged,
}: {
  ref: Ref<HTMLDivElement>;
  side: "single" | "right";
  events: EventSummary[];
  head?: ReactNode;
  onChanged: () => Promise<void>;
}) {
  return (
    <MeasuringContext.Provider value={true}>
      <div ref={ref} className={cn("journal-leaf journal-measure", `journal-leaf-${side}`)} aria-hidden="true" inert>
        <div className="journal-leaf-body journal-sheet">
          <div className="journal-sheet-slot" data-measure-slot>
            {head && (
              <div className="absolute inset-x-0 top-0" data-measure-head>
                {head}
              </div>
            )}
            <div className="absolute inset-x-0 top-0" data-measure-list>
              <div data-measure-stamp>
                <DayStamp day={{ dateKey: "2026-01-01", day: 28, weekday: "周三", events: [], continued: false }} />
              </div>
              {events.map((event) => (
                <div key={event.id} data-measure-id={event.id}>
                  <TimelineEntry event={event} onChanged={onChanged} />
                </div>
              ))}
            </div>
          </div>
          <PageNumber value={0} align="right" />
        </div>
      </div>
    </MeasuringContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* 页面内容                                                             */
/* ------------------------------------------------------------------ */

function statsLine(month: BookMonth): string {
  const { entries, meetings, photos, gifts } = month.stats;
  if (!entries) return "这一页还空着";
  return [
    `${entries} 段小事`,
    meetings ? `${meetings} 次见面` : null,
    photos ? `${photos} 张照片` : null,
    gifts ? `${gifts} 份礼物` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function MonthHeading({ month, size, action }: { month: BookMonth; size: "md" | "lg"; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="font-sc text-xs font-medium tracking-wide text-ink-muted">{month.year}</p>
        <h2 className={cn("scrapbook-hand font-semibold leading-none text-ink", size === "lg" ? "mt-1 text-[3rem]" : "mt-0.5 text-[2.2rem]")}>
          {month.month}
          <span className={cn("ml-1 align-baseline", size === "lg" ? "text-2xl" : "text-xl")}>月</span>
        </h2>
        <p className="mt-2 font-sc text-xs text-ink-soft">{statsLine(month)}</p>
      </div>
      {action}
    </header>
  );
}

function FirstPageHead({ month, today, onPickDay }: { month: BookMonth; today: string; onPickDay: (dateKey: string) => void }) {
  return (
    <div>
      <MonthHeading month={month} size="md" action={<ExportMonthLink monthKey={month.key} compact />} />
      <BookCalendar month={month} today={today} onPickDay={onPickDay} className="mt-3" />
    </div>
  );
}

function ExportMonthLink({ monthKey, compact = false }: { monthKey: string; compact?: boolean }) {
  const range = monthDateRange(monthKey);
  return (
    <Link
      href={`/journal?scope=range&start=${range.start}&end=${range.end}`}
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-full font-sc text-xs font-medium text-rose-deep transition hover:bg-rose/10 focus-ring",
        compact ? "min-h-10 px-3" : "min-h-11 border border-rose/25 bg-surface-raised/70 px-4",
      )}
    >
      <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
      带走这个月
    </Link>
  );
}

function PageNumber({ value, align }: { value: number; align: "left" | "right" }) {
  return (
    <p className={cn("journal-page-number", align === "right" ? "text-right" : "text-left")} aria-hidden="true">
      — {value} —
    </p>
  );
}

function BookCalendar({
  month,
  today,
  onPickDay,
  className,
}: {
  month: BookMonth;
  today: string;
  onPickDay: (dateKey: string) => void;
  className?: string;
}) {
  const weeks = useMemo(() => monthCalendar(month.key), [month.key]);
  const dayMap = useMemo(() => new Map(month.days.map((day) => [day.dateKey, day])), [month.days]);

  return (
    <div className={cn("book-calendar", className)}>
      <div className="grid grid-cols-7 gap-1 pb-1">
        {WEEKDAY_HEADERS.map((label, column) => (
          <span key={label} className={cn("text-center font-sc text-[10px] font-medium", column >= 5 ? "text-rose-deep/70" : "text-ink-muted")}>
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((cell, position) => {
          if (!cell) return <span key={`blank-${position}`} aria-hidden="true" />;
          const day = dayMap.get(cell.dateKey);
          const isToday = cell.dateKey === today;
          const isMeeting = Boolean(day?.events.some((event) => event.meeting_session_id !== null));
          if (!day) {
            return (
              <span key={cell.dateKey} className={cn("book-calendar-day", isToday && "is-today")}>
                {cell.day}
              </span>
            );
          }
          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() => onPickDay(cell.dateKey)}
              className={cn("book-calendar-day has-entry focus-ring", isMeeting && "is-meeting", isToday && "is-today")}
              aria-label={`${month.month} 月 ${cell.day} 日，${day.events.length} 段小事${isMeeting ? "，见面" : ""}`}
            >
              {cell.day}
              {day.events.length > 1 && <span className="book-calendar-count">{day.events.length}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OverviewPage({
  month,
  today,
  meetingSessions,
  pageNumber,
  onPickDay,
}: {
  month: BookMonth;
  today: string;
  meetingSessions: MeetingSessionOut[];
  pageNumber: number;
  onPickDay: (dateKey: string) => void;
}) {
  const photos = useMemo(
    () => month.days.flatMap((day) => day.events).filter((event) => event.preview_image && !event.gift_masked).slice(0, 4),
    [month.days],
  );
  const range = monthDateRange(month.key);
  const meetings = useMemo(
    () =>
      meetingSessions
        .filter((session) => session.started_on <= range.end && session.ended_on >= range.start)
        .sort((left, right) => left.started_on.localeCompare(right.started_on)),
    [meetingSessions, range.end, range.start],
  );

  return (
    <div className="journal-leaf-body journal-sheet">
      <MonthHeading month={month} size="lg" action={<ExportMonthLink monthKey={month.key} />} />
      <BookCalendar month={month} today={today} onPickDay={onPickDay} className="mt-5 flex-none" />

      <div className="journal-sheet-slot journal-overview-rest mt-5">
        {meetings.length > 0 && (
          <section aria-label="这个月的见面">
            <h3 className="scrapbook-hand text-base font-semibold text-ink-soft">见面的日子</h3>
            <ul className="mt-2 grid gap-2 xl:grid-cols-2">
              {meetings.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/journal?scope=meeting&meeting_id=${session.id}`}
                    className="scrapbook-ticket !py-2 transition hover:-translate-y-0.5 focus-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="scrapbook-hand block truncate text-base font-semibold text-ink">{session.title}</span>
                      <span className="block font-sc text-xs text-ink-muted">{meetingRangeLabel(session)}</span>
                    </span>
                    <span className="scrapbook-ticket-stamp !h-9 !w-9" aria-hidden="true">
                      <CalendarHeart className="h-4 w-4" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {photos.length > 0 && (
          <section className={meetings.length ? "mt-4" : undefined} aria-label="这个月的照片">
            <h3 className="scrapbook-hand text-base font-semibold text-ink-soft">贴上去的照片</h3>
            <div className="mt-2 grid grid-cols-4 gap-3">
              {photos.map((event) => (
                <Link key={event.id} href={`/timeline/${event.id}`} className="scrapbook-entry block rounded focus-ring" aria-label={`打开「${event.title}」`}>
                  <PolaroidFrame tilt={cardTilt(event.id + 3) * 2}>
                    <EventImagePreview imageId={event.preview_image!.id} alt={`${event.title}的照片`} className="aspect-square w-full" />
                  </PolaroidFrame>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
      <PageNumber value={pageNumber} align="left" />
    </div>
  );
}

function meetingRangeLabel(session: Pick<MeetingSessionOut, "started_on" | "ended_on">): string {
  const format = (value: string) => `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}`;
  return session.started_on === session.ended_on ? format(session.started_on) : `${format(session.started_on)} – ${format(session.ended_on)}`;
}

function SheetPage({
  sheet,
  sheetIndex,
  pageNumber,
  align,
  head,
  month,
  isCurrent,
  onChanged,
  onCreate,
}: {
  sheet: BookSheet | undefined;
  sheetIndex: number;
  pageNumber: number;
  align: "left" | "right";
  head?: ReactNode;
  month: BookMonth;
  isCurrent: boolean;
  onChanged: () => Promise<void>;
  onCreate: () => void;
}) {
  return (
    <div className="journal-leaf-body journal-sheet">
      {head && <div className="mb-6 flex-none">{head}</div>}
      <div className="journal-sheet-slot">
        {sheet && sheet.days.length > 0 ? (
          <ol className="space-y-7">
            {sheet.days.map((day) => (
              <li key={day.dateKey} data-book-day={day.dateKey} className="book-day">
                <DayStamp day={day} monthNumber={month.month} />
                <ul className="mt-3 space-y-4">
                  {day.events.map((event) => (
                    <li key={event.id}>
                      <TimelineEntry event={event} onChanged={onChanged} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : sheetIndex === 0 && month.days.length === 0 ? (
          <EmptyMonth isCurrent={isCurrent} onCreate={onCreate} />
        ) : (
          <p className="journal-blank-note" aria-hidden="true">· 留白 ·</p>
        )}
      </div>
      <PageNumber value={pageNumber} align={align} />
    </div>
  );
}

function DayStamp({ day, monthNumber }: { day: SheetDay; monthNumber?: number }) {
  return (
    <div className="book-day-stamp">
      <span className="scrapbook-hand text-[1.7rem] font-semibold leading-none text-ink">{day.day}</span>
      <span className="font-sc text-xs text-ink-muted">
        {monthNumber ?? Number(day.dateKey.slice(5, 7))} 月 · {day.weekday}
        {day.continued && " · 接上页"}
      </span>
      <span className="book-day-rule" aria-hidden="true" />
    </div>
  );
}

function EmptyMonth({ isCurrent, onCreate }: { isCurrent: boolean; onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 py-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-peach/22 text-rose-deep">
        <CalendarHeart className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="scrapbook-hand mt-3 text-xl font-semibold text-ink">{isCurrent ? "这个月的第一笔，等你来写" : "这一页还空着"}</h3>
      <p className="mx-auto mt-1.5 max-w-xs font-sc text-sm leading-6 text-ink-soft">记下一顿饭、一句想说的话，或一次临时决定的小约会。</p>
      <button type="button" onClick={onCreate} className="btn-primary mt-4 inline-flex min-h-11 items-center gap-2 rounded-full px-5 font-sc text-sm font-medium focus-ring">
        <Plus className="h-4 w-4" aria-hidden="true" />
        记一笔
      </button>
    </div>
  );
}
