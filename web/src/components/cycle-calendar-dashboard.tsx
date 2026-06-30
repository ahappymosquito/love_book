"use client";

// CycleCalendarDashboard records period facts below the unified AppHeader, keeps mobile horizontal scrolling local to controls, refreshes predictions after edits, and links cycle terms to mainland-friendly encyclopedia search.

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Droplet,
  ExternalLink,
  Filter,
  HeartPulse,
  List,
  Loader2,
  Moon,
  Plus,
  Save,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { readCycleReminderDays, saveCycleReminderDays } from "@/lib/cycle-reminder";
import { useAppStore } from "@/lib/store";
import type { CycleDashboardOut, CycleFlow, CycleMood, CyclePhase, DailyLog, DailyLogInput } from "@/lib/types";

type ViewMode = "month" | "week" | "list";
type FilterState = {
  symptom: string;
  hasNote: boolean;
  periodOnly: boolean;
};

const phaseMeta: Record<CyclePhase, { name: string; short: string; desc: string; chip: string; band: string; dot: string }> = {
  menstrual: {
    name: "经期",
    short: "经",
    desc: "已记录的经期日期",
    chip: "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-100",
    band: "bg-gradient-to-r from-rose-100 to-pink-100 dark:from-rose-400/20 dark:to-pink-400/15",
    dot: "bg-rose-500",
  },
  predicted_period: {
    name: "预测经期",
    short: "预",
    desc: "根据历史记录估算",
    chip: "border border-dashed border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-100",
    band: "border border-dashed border-rose-300 bg-rose-50/80 dark:bg-rose-400/10",
    dot: "bg-rose-300",
  },
  follicular: {
    name: "卵泡期",
    short: "卵",
    desc: "周期前段参考阶段",
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-100",
    band: "bg-sky-100/80 dark:bg-sky-400/15",
    dot: "bg-sky-400",
  },
  fertile: {
    name: "易孕期",
    short: "易",
    desc: "预测窗口，仅作记录参考",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-100",
    band: "bg-emerald-100/80 dark:bg-emerald-400/15",
    dot: "bg-emerald-400",
  },
  ovulation: {
    name: "排卵日",
    short: "排",
    desc: "预测重点日期",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-400/15 dark:text-violet-100",
    band: "bg-violet-100/70 ring-2 ring-violet-300 dark:bg-violet-400/15 dark:ring-violet-300/60",
    dot: "bg-violet-500",
  },
  luteal: {
    name: "黄体期",
    short: "黄",
    desc: "周期后段参考阶段",
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-400/15 dark:text-orange-100",
    band: "bg-orange-100/80 dark:bg-orange-400/15",
    dot: "bg-orange-400",
  },
  unknown: {
    name: "未判断",
    short: "未",
    desc: "等待更多记录",
    chip: "bg-peach/18 text-ink-soft",
    band: "bg-transparent",
    dot: "bg-line",
  },
};

const flowLabels: Record<CycleFlow, string> = {
  none: "无",
  spotting: "点滴",
  light: "少",
  medium: "中",
  heavy: "多",
};

const moodLabels: Record<CycleMood, string> = {
  happy: "开心",
  calm: "平静",
  anxious: "焦虑",
  sad: "低落",
  tired: "疲惫",
};

const mucusLabels = {
  none: "无",
  dry: "干燥",
  moist: "湿润",
  creamy: "乳霜状",
  eggwhite: "蛋清状",
} as const;

const symptomOptions = ["腹痛", "疲劳", "情绪波动", "头痛", "腰酸", "乳房胀痛"];
const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];

function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function dayLabel(value: string): string {
  return format(parseISO(value), "M 月 d 日 EEEE", { locale: zhCN });
}

function dateKey(logs: DailyLog[]): Map<string, DailyLog> {
  return new Map(logs.map((log) => [log.date, log]));
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function dashboardRange(viewDate: Date, mode: ViewMode): { start: Date; end: Date } {
  if (mode === "week") {
    return {
      start: startOfWeek(viewDate, { weekStartsOn: 1 }),
      end: endOfWeek(viewDate, { weekStartsOn: 1 }),
    };
  }
  return {
    start: startOfWeek(startOfMonth(viewDate), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(viewDate), { weekStartsOn: 1 }),
  };
}

function applyFilters(logs: DailyLog[], filters: FilterState): Set<string> {
  if (!filters.symptom && !filters.hasNote && !filters.periodOnly) return new Set();
  return new Set(
    logs
      .filter((log) => {
        if (filters.symptom && !log.symptoms.includes(filters.symptom)) return false;
        if (filters.hasNote && !log.note?.trim()) return false;
        if (filters.periodOnly && !log.is_period) return false;
        return true;
      })
      .map((log) => log.date),
  );
}

function confidenceLabel(value: "high" | "medium" | "low"): string {
  return value === "high" ? "较高" : value === "medium" ? "中等" : "较低";
}

function formatPeriodWindow(stats: CycleDashboardOut["stats"], compact = false): string {
  const pattern = compact ? "M/d" : "M 月 d 日";
  return `${format(parseISO(stats.next_period_start), pattern)} - ${format(parseISO(stats.next_period_end), pattern)}`;
}

function formatStartWindow(stats: CycleDashboardOut["stats"], compact = false): string {
  const pattern = compact ? "M/d" : "M 月 d 日";
  return `${format(parseISO(stats.prediction_start), pattern)} - ${format(parseISO(stats.prediction_end), pattern)}`;
}

function hasStartWindow(stats: CycleDashboardOut["stats"]): boolean {
  return stats.prediction_start !== stats.prediction_end;
}

function nextPeriodHint(stats: CycleDashboardOut["stats"]): string {
  const confidence = `可信度：${confidenceLabel(stats.confidence)}`;
  return hasStartWindow(stats) ? `${confidence} · 开始日可能在 ${formatStartWindow(stats)}` : confidence;
}

const termSearchKeywords = {
  bbt: "基础体温",
  cervicalMucus: "宫颈黏液",
  fertile: "易孕期",
  ovulation: "排卵日",
  follicular: "卵泡期",
  luteal: "黄体期",
} as const;

const phaseTermKeys: Partial<Record<CyclePhase, keyof typeof termSearchKeywords>> = {
  follicular: "follicular",
  fertile: "fertile",
  ovulation: "ovulation",
  luteal: "luteal",
};

function encyclopediaUrl(keyword: string): string {
  return `https://baike.baidu.com/search/word?word=${encodeURIComponent(keyword)}`;
}

function TermLink({
  term,
  children,
  className,
}: {
  term: keyof typeof termSearchKeywords;
  children: React.ReactNode;
  className?: string;
}) {
  const keyword = termSearchKeywords[term];
  return (
    <a
      href={encyclopediaUrl(keyword)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("term-link", className)}
      aria-label={`打开百度百科搜索：${keyword}`}
      title={`百度百科：${keyword}`}
    >
      <span>{children}</span>
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

export function CycleCalendarDashboard() {
  const pairId = useAppStore((s) => s.me?.pair_id);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [dashboard, setDashboard] = useState<CycleDashboardOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(toISODate(new Date()));
  const [editing, setEditing] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ symptom: "", hasNote: false, periodOnly: false });
  const [reminderDays, setReminderDays] = useState(3);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const loadDashboard = useCallback(async () => {
    const range = dashboardRange(viewDate, viewMode);
    setLoading(true);
    try {
      setDashboard(
        await api.getCycleDashboard({
          start: toISODate(range.start),
          end: toISODate(range.end),
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [viewDate, viewMode]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!pairId) return;
    setReminderDays(readCycleReminderDays(pairId));
  }, [pairId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("quickLog") !== "today") return;
    const today = new Date();
    setViewDate(today);
    setSelectedDate(toISODate(today));
    setEditing(true);
  }, []);

  const logsByDate = useMemo(() => dateKey(dashboard?.logs ?? []), [dashboard]);
  const selectedLog = logsByDate.get(selectedDate) ?? null;
  const filteredDates = useMemo(() => applyFilters(dashboard?.logs ?? [], filters), [dashboard, filters]);
  const todayLog = logsByDate.get(toISODate(new Date()));

  async function saveLog(date: string, input: DailyLogInput) {
    const range = dashboardRange(viewDate, viewMode);
    const updatedDashboard = await api.upsertCycleLogDashboard(
      date,
      {
        start: toISODate(range.start),
        end: toISODate(range.end),
      },
      input,
    );
    setDashboard(updatedDashboard);
    setEditing(false);
    toast.success("记录已保存");
  }

  async function removeLog(date: string) {
    await api.deleteCycleLog(date);
    await loadDashboard();
    setEditing(false);
    toast.success("这一天的记录已删除");
  }

  function changeReminderDays(days: number) {
    if (!pairId) return;
    setReminderDays(saveCycleReminderDays(pairId, days));
  }

  return (
    <div className="viewport-guard min-h-dvh w-full pb-[calc(env(safe-area-inset-bottom,0px)+9rem)]">
      <AppHeader
        title="周期日历"
        subtitle="记录和预测仅供参考"
        rightSlot={
          <Button size="sm" onClick={() => setEditing(true)} className="rounded-full">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">快速记录</span>
          </Button>
        }
      />

      <main className="mx-auto grid w-full max-w-7xl min-w-0 gap-5 px-4 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-5">
          {dashboard && (
            <HeaderSummaryCards
              stats={dashboard.stats}
              todayRecorded={todayLog?.source === "recorded"}
              onQuickLog={() => {
                setSelectedDate(toISODate(new Date()));
                setEditing(true);
              }}
            />
          )}

          <ReminderSettingsCard value={reminderDays} onChange={changeReminderDays} />

          {dashboard?.is_empty ? (
            <EmptyState
              onStart={() => {
                setSelectedDate(toISODate(new Date()));
                setEditing(true);
              }}
            />
          ) : null}

          <Card className="overflow-hidden">
            <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>周期日历</CardTitle>
                <CardDescription>颜色连成每段周期位置，记录过的日期会多一个小圆点。</CardDescription>
              </div>
              <CalendarToolbar
                viewDate={viewDate}
                viewMode={viewMode}
                onMode={setViewMode}
                onPrev={() => setViewDate((d) => (viewMode === "week" ? addDays(d, -7) : subMonths(d, 1)))}
                onNext={() => setViewDate((d) => (viewMode === "week" ? addDays(d, 7) : addMonths(d, 1)))}
                onToday={() => {
                  const today = new Date();
                  setViewDate(today);
                  setSelectedDate(toISODate(today));
                }}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <FilterBar filters={filters} onChange={setFilters} />
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${viewMode}-${format(viewDate, "yyyy-MM-dd")}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.24 }}
                >
                  {loading || !dashboard ? (
                    <div className="grid min-h-[420px] place-items-center text-ink-soft">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : viewMode === "list" ? (
                    <RecordList logs={dashboard.logs} filteredDates={filteredDates} onSelect={setSelectedDate} />
                  ) : (
                    <CalendarMonthView
                      mode={viewMode}
                      viewDate={viewDate}
                      logs={dashboard.logs}
                      selectedDate={selectedDate}
                      filteredDates={filteredDates}
                      onSelect={(date) => {
                        setSelectedDate(date);
                        setEditing(false);
                      }}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </CardContent>
          </Card>

          {dashboard && <CycleTimeline stats={dashboard.stats} />}
          <PhaseLegend />
          {dashboard && <StatsCards dashboard={dashboard} />}

          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-rose" />
                <p className="font-sc text-sm leading-relaxed text-ink-soft">
                  数据保存在当前服务中，当前 pair 双方可共同查看和编辑。预测结果仅供参考。
                </p>
              </div>
            </div>
          </Card>
        </section>

        <aside className="hidden space-y-5 lg:block">
          <DayDetailPanel
            log={selectedLog}
            selectedDate={selectedDate}
            editing={editing}
            onEdit={() => setEditing(true)}
            onCancel={() => setEditing(false)}
            onSave={saveLog}
            onDelete={removeLog}
          />
        </aside>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 box-border max-w-full border-t border-line/60 bg-surface/90 p-3 backdrop-blur-xl md:hidden">
        <Button
          className="w-full"
          size="lg"
          onClick={() => {
            setSelectedDate(toISODate(new Date()));
            setEditing(true);
          }}
        >
          <Plus className="h-4 w-4" />
          快速记录今天
        </Button>
      </div>

      {isMobile && (
        <Sheet open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedDate("")}>
          <SheetBody open={Boolean(selectedLog)}>
            <SheetContent>
              <SheetTitle className="font-display text-xl text-ink">日期详情</SheetTitle>
              <SheetDescription className="font-sc text-sm text-ink-soft">编辑当天状态，保存后会同步到当前 pair。</SheetDescription>
              <div className="mt-5 max-h-[72dvh] overflow-y-auto pr-1">
                <DayDetailPanel
                  log={selectedLog}
                  selectedDate={selectedDate}
                  editing={editing}
                  onEdit={() => setEditing(true)}
                  onCancel={() => setEditing(false)}
                  onSave={saveLog}
                  onDelete={removeLog}
                  compact
                />
              </div>
            </SheetContent>
          </SheetBody>
        </Sheet>
      )}
    </div>
  );
}

function CalendarToolbar({
  viewDate,
  viewMode,
  onMode,
  onPrev,
  onNext,
  onToday,
}: {
  viewDate: Date;
  viewMode: ViewMode;
  onMode: (mode: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:items-end">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={onPrev} aria-label="上一个周期视图">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-28 text-center font-sc text-sm font-medium text-ink">{format(viewDate, "yyyy 年 M 月")}</div>
        <Button variant="outline" size="icon" onClick={onNext} aria-label="下一个周期视图">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="sm" onClick={onToday}>
          今天
        </Button>
      </div>
      <div className="grid grid-cols-3 rounded-2xl bg-peach/18 p-1">
        {[
          ["month", CalendarDays, "月视图"],
          ["week", Moon, "周视图"],
          ["list", List, "列表"],
        ].map(([mode, Icon, label]) => (
          <button
            key={String(mode)}
            type="button"
            onClick={() => onMode(mode as ViewMode)}
            className={cn(
              "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium text-ink-soft transition focus-ring",
              viewMode === mode && "bg-surface-raised text-ink shadow-soft",
            )}
          >
            <Icon className="h-4 w-4" />
            {String(label)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HeaderSummaryCards({
  stats,
  todayRecorded,
  onQuickLog,
}: {
  stats: CycleDashboardOut["stats"];
  todayRecorded: boolean;
  onQuickLog: () => void;
}) {
  const nextText = `预计 ${formatPeriodWindow(stats)}`;
  const cards = [
    { icon: HeartPulse, label: "当前周期", value: `周期第 ${stats.current_cycle_day} 天`, hint: phaseMeta[stats.current_phase].name },
    { icon: Droplet, label: "下次经期", value: nextText, hint: nextPeriodHint(stats) },
    { icon: ClipboardList, label: "今日状态", value: todayRecorded ? "今日已记录" : "今日尚未记录", hint: "10 秒快速记录" },
  ];
  return (
    <div className="local-x-scroll flex snap-x gap-3 pb-1 md:grid md:grid-cols-3 md:overflow-visible">
      {cards.map((item) => (
        <Card key={item.label} className="min-w-[min(240px,82vw)] snap-start p-5 md:min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-sc text-xs text-ink-muted">{item.label}</p>
              <p className="mt-2 font-display text-xl font-semibold leading-tight text-ink">{item.value}</p>
              <p className="mt-1 font-sc text-sm text-ink-soft">{item.hint}</p>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-peach/28 text-rose">
              <item.icon className="h-5 w-5" />
            </div>
          </div>
          {item.label === "今日状态" && (
            <Button className="mt-4 w-full" size="sm" onClick={onQuickLog}>
              快速记录
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

function ReminderSettingsCard({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-peach/28 text-rose">
            <Droplet className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display text-lg font-semibold leading-tight text-ink">首页记录提醒</p>
            <p className="mt-1 font-sc text-sm leading-relaxed text-ink-soft">
              预计月经开始前 {value} 天内，如果当天还没记录，首页会提醒填写。
            </p>
          </div>
        </div>
        <label className="flex min-w-0 items-center gap-3 rounded-2xl bg-peach/14 px-4 py-3 md:min-w-[220px]">
          <span className="font-sc text-sm text-ink-soft">提前</span>
          <input
            type="number"
            min={1}
            max={7}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-10 w-16 rounded-xl border border-line/70 bg-surface px-3 text-center font-sc text-sm text-ink outline-none transition focus:border-rose/60"
          />
          <span className="font-sc text-sm text-ink-soft">天</span>
        </label>
      </div>
    </Card>
  );
}

export function FilterBar({ filters, onChange }: { filters: FilterState; onChange: (filters: FilterState) => void }) {
  const active = Boolean(filters.symptom || filters.hasNote || filters.periodOnly);
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-line/70 bg-peach/12 p-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 text-sm font-medium text-ink">
        <Filter className="h-4 w-4 text-rose" />
        筛选
      </div>
      <div className="local-x-scroll flex flex-1 gap-2">
        <select
          value={filters.symptom}
          onChange={(e) => onChange({ ...filters, symptom: e.target.value })}
          className="min-h-11 rounded-2xl border border-line/70 bg-surface px-3 text-sm text-ink focus-ring"
          aria-label="按症状筛选"
        >
          <option value="">全部症状</option>
          {symptomOptions.map((symptom) => (
            <option key={symptom} value={symptom}>
              {symptom}
            </option>
          ))}
        </select>
        <Toggle active={filters.hasNote} onClick={() => onChange({ ...filters, hasNote: !filters.hasNote })}>
          有备注
        </Toggle>
        <Toggle active={filters.periodOnly} onClick={() => onChange({ ...filters, periodOnly: !filters.periodOnly })}>
          经期日期
        </Toggle>
      </div>
      {active && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ symptom: "", hasNote: false, periodOnly: false })}>
          <X className="h-4 w-4" />
          清除
        </Button>
      )}
    </div>
  );
}

function Toggle({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 whitespace-nowrap rounded-2xl border px-3 text-sm transition focus-ring",
        active ? "border-rose/50 bg-peach/28 text-rose-deep" : "border-line/70 bg-surface text-ink-soft",
      )}
    >
      {children}
    </button>
  );
}

export function CalendarMonthView({
  mode,
  viewDate,
  logs,
  selectedDate,
  filteredDates,
  onSelect,
}: {
  mode: "month" | "week";
  viewDate: Date;
  logs: DailyLog[];
  selectedDate: string;
  filteredDates: Set<string>;
  onSelect: (date: string) => void;
}) {
  const range = dashboardRange(viewDate, mode);
  const days = _days(range.start, range.end);
  const logMap = dateKey(logs);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-y-1 text-center font-sc text-xs text-ink-muted">
        {weekLabels.map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1 overflow-hidden rounded-3xl border border-line/70 bg-surface-raised/88 p-1">
        {days.map((day) => {
          const key = toISODate(day);
          return (
            <CalendarDayCell
              key={key}
              date={day}
              log={logMap.get(key)}
              selected={selectedDate === key}
              today={isSameDay(day, new Date())}
              muted={mode === "month" && !isSameMonth(day, viewDate)}
              filtered={filteredDates.has(key)}
              prevPhase={logMap.get(toISODate(addDays(day, -1)))?.phase}
              nextPhase={logMap.get(toISODate(addDays(day, 1)))?.phase}
              onSelect={() => onSelect(key)}
            />
          );
        })}
      </div>
    </div>
  );
}

function _days(start: Date, end: Date): Date[] {
  const result: Date[] = [];
  let cursor = start;
  while (cursor <= end) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

export function CalendarDayCell({
  date,
  log,
  selected,
  today,
  muted,
  filtered,
  prevPhase,
  nextPhase,
  onSelect,
}: {
  date: Date;
  log?: DailyLog;
  selected: boolean;
  today: boolean;
  muted: boolean;
  filtered: boolean;
  prevPhase?: CyclePhase;
  nextPhase?: CyclePhase;
  onSelect: () => void;
}) {
  const phase = log?.phase ?? "unknown";
  const connectPrev = prevPhase === phase && phase !== "unknown" && date.getDay() !== 1;
  const connectNext = nextPhase === phase && phase !== "unknown" && date.getDay() !== 0;
  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onSelect}
      className={cn(
        "group relative min-h-[72px] rounded-2xl p-1 text-left transition focus-ring sm:min-h-[92px]",
        muted && "opacity-45",
        filtered && "ring-2 ring-rose/50",
      )}
      aria-label={`${format(date, "M 月 d 日")}，${phaseMeta[phase].name}`}
    >
      {phase !== "unknown" && (
        <span
          className={cn(
            "absolute inset-x-1 top-3 h-11 transition",
            phaseMeta[phase].band,
            connectPrev ? "rounded-l-none" : "rounded-l-2xl",
            connectNext ? "rounded-r-none" : "rounded-r-2xl",
          )}
        />
      )}
      <span
        className={cn(
          "relative z-10 flex h-full min-h-[64px] flex-col justify-between rounded-2xl p-2",
          selected && "bg-surface-raised shadow-soft ring-2 ring-rose/35",
        )}
      >
        <span className="flex items-center justify-between gap-1">
          <span className={cn("font-sc text-sm font-semibold text-ink", today && "text-rose-deep")}>{format(date, "d")}</span>
          {today && <span className="rounded-full bg-rose px-1.5 py-0.5 text-[10px] font-medium text-white">今</span>}
        </span>
        <span className="flex items-center justify-between">
          {log?.source === "recorded" ? <CircleDot className="h-3.5 w-3.5 text-rose" /> : <span />}
          {phase !== "unknown" && (
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", phaseMeta[phase].chip)}>
              {phaseMeta[phase].short}
            </span>
          )}
        </span>
      </span>
    </motion.button>
  );
}

export function PhaseLegend() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>阶段图例</CardTitle>
        <CardDescription>颜色用于帮助回顾周期位置，不代表诊断结论。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(phaseMeta) as CyclePhase[])
          .filter((phase) => phase !== "unknown")
          .map((phase) => {
            const termKey = phaseTermKeys[phase];
            return (
              <div key={phase} className="flex items-start gap-3 rounded-2xl bg-peach/12 p-3">
                <span className={cn("mt-1 h-4 w-4 rounded-md", phaseMeta[phase].band)} />
                <div>
                  <p className="font-sc text-sm font-medium text-ink">
                    {termKey ? <TermLink term={termKey}>{phaseMeta[phase].name}</TermLink> : phaseMeta[phase].name}
                  </p>
                  <p className="font-sc text-xs leading-relaxed text-ink-muted">{phaseMeta[phase].desc}</p>
                </div>
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}

export function DayDetailPanel({
  log,
  selectedDate,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  compact = false,
}: {
  log: DailyLog | null;
  selectedDate: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (date: string, input: DailyLogInput) => Promise<void>;
  onDelete: (date: string) => Promise<void>;
  compact?: boolean;
}) {
  if (!log && !selectedDate) return null;
  const displayLog = log ?? {
    date: selectedDate,
    phase: "unknown",
    is_period: false,
    is_predicted: true,
    flow: null,
    symptoms: [],
    mood: null,
    bbt: null,
    cervical_mucus: null,
    note: null,
    updated_by_id: null,
    updated_at: null,
    source: "empty",
  } satisfies DailyLog;
  if (editing) {
    return <QuickLogForm log={displayLog} onCancel={onCancel} onSave={onSave} onDelete={onDelete} />;
  }
  return (
    <Card className={cn("overflow-hidden", compact && "glass-card border-0 shadow-none")}>
      <CardHeader className="pr-16">
        <div className="flex items-center gap-2">
          <Badge className={phaseMeta[displayLog.phase].chip}>{phaseMeta[displayLog.phase].name}</Badge>
          {displayLog.source === "predicted" && <Badge variant="outline">预测</Badge>}
        </div>
        <CardTitle>{dayLabel(displayLog.date)}</CardTitle>
        <CardDescription>{displayLog.is_period ? "经期日期" : "非经期日期"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <InfoGrid log={displayLog} />
        <div className="flex gap-2">
          <Button onClick={onEdit} className="flex-1">
            编辑
          </Button>
          {displayLog.source === "recorded" && (
            <Button variant="danger" onClick={() => void onDelete(displayLog.date)}>
              删除
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InfoGrid({ log }: { log: DailyLog }) {
  const items: Array<[React.ReactNode, string]> = [
    ["流量", log.flow ? flowLabels[log.flow] : "无"],
    ["症状", log.symptoms.length ? log.symptoms.join("、") : "未记录"],
    ["心情", log.mood ? moodLabels[log.mood] : "未记录"],
    [<TermLink key="bbt" term="bbt">BBT</TermLink>, log.bbt ? `${log.bbt.toFixed(2)} °C` : "未记录"],
    [<TermLink key="cervicalMucus" term="cervicalMucus">宫颈黏液</TermLink>, log.cervical_mucus ? mucusLabels[log.cervical_mucus] : "未记录"],
    ["备注", log.note?.trim() || "无"],
  ];
  return (
    <dl className="grid gap-3">
      {items.map(([label, value], index) => (
        <div key={index} className="rounded-2xl bg-peach/12 p-3">
          <dt className="font-sc text-xs text-ink-muted">{label}</dt>
          <dd className="mt-1 font-sc text-sm leading-relaxed text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function QuickLogForm({
  log,
  onCancel,
  onSave,
  onDelete,
}: {
  log: DailyLog;
  onCancel: () => void;
  onSave: (date: string, input: DailyLogInput) => Promise<void>;
  onDelete: (date: string) => Promise<void>;
}) {
  const [isPeriod, setIsPeriod] = useState(log.is_period);
  const [flow, setFlow] = useState<CycleFlow>(log.flow ?? "none");
  const [symptoms, setSymptoms] = useState<string[]>(log.symptoms);
  const [mood, setMood] = useState<CycleMood | null>(log.mood);
  const [bbt, setBbt] = useState(log.bbt?.toString() ?? "");
  const [mucus, setMucus] = useState<DailyLog["cervical_mucus"]>(log.cervical_mucus);
  const [note, setNote] = useState(log.note ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await onSave(log.date, {
        phase: isPeriod ? "menstrual" : "unknown",
        is_period: isPeriod,
        is_predicted: false,
        flow,
        symptoms,
        mood,
        bbt: bbt.trim() ? Number(bbt) : null,
        cervical_mucus: mucus,
        note: note.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>快速记录</CardTitle>
        <CardDescription>{dayLabel(log.date)}，只需要填写今天最关键的状态。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field label="是否经期">
          <div className="grid grid-cols-2 gap-2">
            <Toggle active={isPeriod} onClick={() => setIsPeriod(true)}>
              是
            </Toggle>
            <Toggle active={!isPeriod} onClick={() => setIsPeriod(false)}>
              否
            </Toggle>
          </div>
        </Field>
        <Field label="流量">
          <OptionGrid
            values={Object.keys(flowLabels) as CycleFlow[]}
            labels={flowLabels}
            value={flow}
            onValue={(value) => setFlow(value)}
          />
        </Field>
        <Field label="症状标签">
          <div className="flex flex-wrap gap-2">
            {symptomOptions.map((symptom) => (
              <Toggle
                key={symptom}
                active={symptoms.includes(symptom)}
                onClick={() =>
                  setSymptoms((prev) => (prev.includes(symptom) ? prev.filter((item) => item !== symptom) : [...prev, symptom]))
                }
              >
                {symptom}
              </Toggle>
            ))}
          </div>
        </Field>
        <Field label="心情">
          <OptionGrid
            values={Object.keys(moodLabels) as CycleMood[]}
            labels={moodLabels}
            value={mood}
            onValue={(value) => setMood(value)}
          />
        </Field>
        <Field label="基础体温 BBT">
          <input
            value={bbt}
            onChange={(e) => setBbt(e.target.value)}
            type="number"
            step="0.01"
            min="34"
            max="42"
            inputMode="decimal"
            className="input-field"
            placeholder="例如 36.58"
          />
        </Field>
        <Field label="宫颈黏液">
          <OptionGrid
            values={Object.keys(mucusLabels) as Array<NonNullable<DailyLog["cervical_mucus"]>>}
            labels={mucusLabels}
            value={mucus}
            onValue={(value) => setMucus(value)}
          />
        </Field>
        <Field label="备注">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input-field min-h-24 resize-none"
            placeholder="可选"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </Button>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          {log.source === "recorded" && (
            <Button variant="danger" onClick={() => void onDelete(log.date)}>
              删除
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="font-sc text-sm font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

function OptionGrid<T extends string>({
  values,
  labels,
  value,
  onValue,
}: {
  values: T[];
  labels: Record<T, string>;
  value: T | null;
  onValue: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {values.map((item) => (
        <Toggle key={item} active={value === item} onClick={() => onValue(item)}>
          {labels[item]}
        </Toggle>
      ))}
    </div>
  );
}

export function CycleTimeline({ stats }: { stats: CycleDashboardOut["stats"] }) {
  const progress = Math.min(100, Math.max(0, (stats.current_cycle_day / stats.average_cycle_length) * 100));
  const ovulationIndex = Math.max(stats.average_period_length + 1, stats.average_cycle_length - 14);
  const fertileStart = Math.max(stats.average_period_length, ovulationIndex - 5);
  const follicularDays = Math.max(0, fertileStart - stats.average_period_length);
  const fertileDays = Math.min(6, Math.max(1, stats.average_cycle_length - fertileStart));
  const lutealDays = Math.max(1, stats.average_cycle_length - stats.average_period_length - follicularDays - fertileDays);
  const segments = [
    { phase: "menstrual" as CyclePhase, days: stats.average_period_length },
    { phase: "follicular" as CyclePhase, days: follicularDays },
    { phase: "fertile" as CyclePhase, days: fertileDays },
    { phase: "luteal" as CyclePhase, days: lutealDays },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>当前周期进度</CardTitle>
        <CardDescription>横向时间轴标出当前周期位置，圆点停在今天。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative h-4 overflow-hidden rounded-full bg-peach/20">
          <div className="flex h-full">
            {segments.map((seg) => (
              <div key={seg.phase} className={phaseMeta[seg.phase].band} style={{ width: `${(seg.days / stats.average_cycle_length) * 100}%` }} />
            ))}
          </div>
          <span
            className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-surface bg-rose shadow-soft"
            style={{ left: `${progress}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between font-sc text-xs text-ink-muted">
          <span>第 1 天</span>
          <span>第 {stats.average_cycle_length} 天</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatsCards({ dashboard }: { dashboard: CycleDashboardOut }) {
  const stats = dashboard.stats;
  const items: Array<{ label: string; value: string; hint?: string }> = [
    { label: "平均周期长度", value: `${stats.average_cycle_length} 天` },
    { label: "平均经期长度", value: `${stats.average_period_length} 天` },
    { label: "最近一次经期开始", value: format(parseISO(stats.last_period_start), "M 月 d 日") },
    { label: "下次经期预测", value: formatPeriodWindow(stats, true) },
    { label: "开始日参考范围", value: hasStartWindow(stats) ? formatStartWindow(stats, true) : format(parseISO(stats.next_period_start), "M/d") },
    { label: "预测可信度", value: confidenceLabel(stats.confidence), hint: "由记录数量和周期波动估算，较低时开始日可能前后浮动。" },
    { label: "本月已记录天数", value: `${dashboard.logs.filter((log) => log.source === "recorded").length} 天` },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label} className="p-4">
          <p className="font-sc text-xs text-ink-muted">{item.label}</p>
          <p className="mt-2 font-display text-xl font-semibold text-ink">{item.value}</p>
          {item.hint ? <p className="mt-1 font-sc text-xs leading-relaxed text-ink-muted">{item.hint}</p> : null}
        </Card>
      ))}
    </div>
  );
}

export function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <Card className="overflow-hidden p-6">
      <div className="grid gap-5 md:grid-cols-[180px_1fr] md:items-center">
        <div className="relative h-36 overflow-hidden rounded-3xl bg-peach/20">
          <div className="absolute left-6 top-8 h-20 w-20 rounded-full border-8 border-white/75" />
          <div className="absolute bottom-7 right-6 h-10 w-10 rounded-full bg-violet-300/70" />
          <div className="absolute inset-x-5 bottom-5 h-3 rounded-full bg-white/70" />
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">还没有周期记录</h2>
          <p className="mt-2 font-sc text-sm leading-relaxed text-ink-soft">
            可以先记录一次经期，之后日历会按历史记录给出参考预测。
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={onStart}>
              <Plus className="h-4 w-4" />
              开始记录
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RecordList({ logs, filteredDates, onSelect }: { logs: DailyLog[]; filteredDates: Set<string>; onSelect: (date: string) => void }) {
  const recorded = logs.filter((log) => log.source === "recorded");
  if (!recorded.length) {
    return (
      <div className="grid min-h-[280px] place-items-center rounded-3xl bg-peach/14 text-center">
        <div>
          <Search className="mx-auto h-6 w-6 text-ink-muted" />
          <p className="mt-3 font-sc text-sm text-ink-soft">当前范围暂无实际记录</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {recorded.map((log) => (
        <button
          key={log.date}
          type="button"
          onClick={() => onSelect(log.date)}
          className={cn(
            "flex w-full items-center justify-between rounded-2xl border border-line/60 bg-surface-raised/78 p-4 text-left transition hover:bg-peach/12 focus-ring",
            filteredDates.has(log.date) && "ring-2 ring-rose/40",
          )}
        >
          <div>
            <p className="font-sc text-sm font-medium text-ink">{dayLabel(log.date)}</p>
            <p className="mt-1 font-sc text-xs text-ink-muted">{log.symptoms.join("、") || log.note || "已记录"}</p>
          </div>
          <Badge className={phaseMeta[log.phase].chip}>{phaseMeta[log.phase].name}</Badge>
        </button>
      ))}
    </div>
  );
}
