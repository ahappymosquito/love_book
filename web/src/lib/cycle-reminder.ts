// Local cycle reminder preferences shared by the timeline prompt and cycle dashboard settings.

export const DEFAULT_CYCLE_REMINDER_DAYS = 3;
const MIN_CYCLE_REMINDER_DAYS = 1;
const MAX_CYCLE_REMINDER_DAYS = 7;

export function cycleReminderDaysKey(pairId: number): string {
  return `love-book:cycle-reminder-days:${pairId}`;
}

export function cycleReminderDismissedKey(pairId: number, day: string): string {
  return `love-book:cycle-reminder-dismissed:${pairId}:${day}`;
}

export function normalizeCycleReminderDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CYCLE_REMINDER_DAYS;
  return Math.min(MAX_CYCLE_REMINDER_DAYS, Math.max(MIN_CYCLE_REMINDER_DAYS, Math.round(value)));
}

export function readCycleReminderDays(pairId: number): number {
  if (typeof window === "undefined") return DEFAULT_CYCLE_REMINDER_DAYS;
  const raw = window.localStorage.getItem(cycleReminderDaysKey(pairId));
  if (!raw) return DEFAULT_CYCLE_REMINDER_DAYS;
  return normalizeCycleReminderDays(Number(raw));
}

export function saveCycleReminderDays(pairId: number, days: number): number {
  const normalized = normalizeCycleReminderDays(days);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(cycleReminderDaysKey(pairId), String(normalized));
  }
  return normalized;
}

export function isCycleReminderDismissed(pairId: number, day: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(cycleReminderDismissedKey(pairId, day)) === "1";
}

export function dismissCycleReminder(pairId: number, day: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(cycleReminderDismissedKey(pairId, day), "1");
}
