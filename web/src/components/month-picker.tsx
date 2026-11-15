"use client";

// 选月网格：年份左右切换 + 4×3 月份格，点一下就选中该月；格子显示当月小事数，超出范围或（requireEntries 时）空月份置灰。首页手账本的月份弹层和 /journal 的“某个月”范围共用。

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { monthParts, yearMonthCells } from "@/lib/journal-book";
import { MOTION_TRANSITIONS } from "@/lib/motion";

export function MonthPickerGrid({
  value,
  counts,
  minMonth,
  maxMonth,
  requireEntries = false,
  disabled = false,
  onSelect,
  className,
}: {
  value: string | null;
  counts: ReadonlyMap<string, number>;
  minMonth: string;
  maxMonth: string;
  requireEntries?: boolean;
  disabled?: boolean;
  onSelect: (monthKey: string) => void;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const minYear = monthParts(minMonth).year;
  const maxYear = monthParts(maxMonth).year;
  const [year, setYear] = useState(() => Math.min(maxYear, Math.max(minYear, monthParts(value ?? maxMonth).year)));
  const [yearDirection, setYearDirection] = useState(0);
  const cells = yearMonthCells(year, counts, { minMonth, maxMonth, requireEntries });
  const yearTotal = cells.reduce((total, cell) => total + cell.count, 0);

  function changeYear(delta: number) {
    setYearDirection(delta);
    setYear((current) => Math.min(maxYear, Math.max(minYear, current + delta)));
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => changeYear(-1)}
          disabled={disabled || year <= minYear}
          className="grid h-10 w-10 place-items-center rounded-full text-ink-soft transition hover:bg-rose/10 hover:text-rose-deep disabled:opacity-30 focus-ring"
          aria-label="上一年"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 text-center" aria-live="polite">
          <p className="scrapbook-hand text-lg font-semibold leading-tight text-ink">{year} 年</p>
          <p className="font-sc text-[11px] text-ink-muted">{yearTotal ? `${yearTotal} 段小事` : "这一年还没有记录"}</p>
        </div>
        <button
          type="button"
          onClick={() => changeYear(1)}
          disabled={disabled || year >= maxYear}
          className="grid h-10 w-10 place-items-center rounded-full text-ink-soft transition hover:bg-rose/10 hover:text-rose-deep disabled:opacity-30 focus-ring"
          aria-label="下一年"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <motion.div
        key={year}
        initial={reducedMotion || yearDirection === 0 ? false : { opacity: 0, x: yearDirection * 14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.state}
        className="mt-3 grid grid-cols-4 gap-1.5"
        role="listbox"
        aria-label={`${year} 年的月份`}
      >
        {cells.map((cell) => {
          const selected = cell.key === value;
          const isCurrent = cell.key === maxMonth;
          return (
            <button
              key={cell.key}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled || cell.disabled}
              onClick={() => onSelect(cell.key)}
              className={cn(
                "month-picker-cell focus-ring",
                selected && "is-selected",
                isCurrent && !selected && "is-current",
                cell.count > 0 && "has-entries",
              )}
              aria-label={`${year} 年 ${cell.month} 月${cell.count ? `，${cell.count} 段小事` : ""}${isCurrent ? "，本月" : ""}`}
            >
              <span className="font-sc text-sm font-semibold leading-none">{cell.month}月</span>
              <span className="month-picker-count">
                {cell.count > 0 ? cell.count : isCurrent ? "本月" : ""}
              </span>
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}
