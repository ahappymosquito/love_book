// 日期口径工具：时间线分组、"今天"判断统一按北京时间（Asia/Shanghai）计算，避免浏览器本地时区把同一天拆到不同日期或月份。

export const APP_TIME_ZONE = "Asia/Shanghai";

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiDateKey(input: Date | string = new Date()): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = dateKeyFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function shanghaiMonthKey(input: Date | string = new Date()): string {
  return shanghaiDateKey(input).slice(0, 7);
}

export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}
