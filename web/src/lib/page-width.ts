// 已登录页面的内容宽度表：主内容容器用 max-w-* 加 px-4 / sm:px-6，顶部栏玻璃和底边栏外壳用扣掉左右内边距后的同宽值，桌面端三者左右边缘对齐。

export type PageWidth = "2xl" | "3xl" | "4xl" | "5xl" | "7xl";

export const PAGE_CHROME_WIDTH_CLASS: Record<PageWidth, string> = {
  "2xl": "max-w-[39rem]",
  "3xl": "max-w-[45rem]",
  "4xl": "max-w-[53rem]",
  "5xl": "max-w-[61rem]",
  "7xl": "max-w-[77rem]",
};

export const PAGE_CHROME_WIDTH_SM_CLASS: Record<PageWidth, string> = {
  "2xl": "sm:max-w-[39rem]",
  "3xl": "sm:max-w-[45rem]",
  "4xl": "sm:max-w-[53rem]",
  "5xl": "sm:max-w-[61rem]",
  "7xl": "sm:max-w-[77rem]",
};

export function pageWidthForPath(pathname: string): PageWidth {
  if (pathname.startsWith("/todo") || pathname.startsWith("/habits") || pathname.startsWith("/cycle")) return "7xl";
  if (pathname.startsWith("/me")) return "4xl";
  if (pathname.startsWith("/create")) return "2xl";
  if (/^\/timeline\/[^/]+/.test(pathname)) return "3xl";
  return "5xl";
}
