// 已登录页面的内容宽度表：主内容容器用 PAGE_MAIN_WIDTH_CLASS 加 px-4 / sm:px-6，顶部栏玻璃和底边栏外壳用扣掉左右内边距后的同宽值，桌面端三者左右边缘对齐；
// 6xl / 7xl 在 2xl（≥1536px）大屏上继续放宽，让手账对开页、Todo 三栏、周期和习惯看板把屏幕用起来。

export type PageWidth = "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl";

export const PAGE_MAIN_WIDTH_CLASS: Record<PageWidth, string> = {
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl 2xl:max-w-[84rem]",
  "7xl": "max-w-7xl 2xl:max-w-[96rem]",
};

export const PAGE_CHROME_WIDTH_CLASS: Record<PageWidth, string> = {
  "2xl": "max-w-[39rem]",
  "3xl": "max-w-[45rem]",
  "4xl": "max-w-[53rem]",
  "5xl": "max-w-[61rem]",
  "6xl": "max-w-[69rem] 2xl:max-w-[81rem]",
  "7xl": "max-w-[77rem] 2xl:max-w-[93rem]",
};

export const PAGE_CHROME_WIDTH_SM_CLASS: Record<PageWidth, string> = {
  "2xl": "sm:max-w-[39rem]",
  "3xl": "sm:max-w-[45rem]",
  "4xl": "sm:max-w-[53rem]",
  "5xl": "sm:max-w-[61rem]",
  "6xl": "sm:max-w-[69rem] 2xl:max-w-[81rem]",
  "7xl": "sm:max-w-[77rem] 2xl:max-w-[93rem]",
};

export function pageWidthForPath(pathname: string): PageWidth {
  if (
    pathname === "/timeline" ||
    pathname.startsWith("/todo") ||
    pathname.startsWith("/habits") ||
    pathname.startsWith("/cycle") ||
    pathname.startsWith("/journal")
  ) {
    return "7xl";
  }
  if (pathname.startsWith("/me") || /^\/timeline\/[^/]+/.test(pathname)) return "6xl";
  if (pathname.startsWith("/create")) return "2xl";
  return "5xl";
}
