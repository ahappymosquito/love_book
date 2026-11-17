"use client";

// Authenticated five-slot Liquid Glass navigation with unified shared-lens motion, mobile-safe width, and a prominent create action; on desktop its width follows the shared page-width table so it lines up with the header and main content.
// 往下滑读内容时底栏收起，往上滑、回到顶部附近、滑到页面底部、切换页面或打开创建窗口时立刻回来；收起状态写到 <html data-nav-hidden>，
// 让依赖 --lb-nav-clearance 的浮层（周期快速记录、提醒卡片）一起下移。减弱动效时只做淡入淡出。

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookHeart, CalendarCheck2, CalendarHeart, Moon } from "lucide-react";
import { CreateNavAction } from "./create-nav-action";
import { cn } from "@/lib/cn";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import { PAGE_CHROME_WIDTH_SM_CLASS, pageWidthForPath } from "@/lib/page-width";
import { useAppStore } from "@/lib/store";

const USER_APP_PREFIXES = ["/timeline", "/love-receipts", "/create", "/cycle", "/todo", "/habits", "/me"];
const TOP_ZONE_PX = 80;
const HIDE_AFTER_PX = 140;
const DIRECTION_SLOP_PX = 6;
const BOTTOM_ZONE_PX = 32;

function isUserAppPath(pathname: string): boolean {
  return USER_APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function activeKey(pathname: string): "timeline" | "cycle" | "create" | "todo" | "habits" | "me" {
  if (pathname.startsWith("/cycle")) return "cycle";
  if (pathname.startsWith("/create")) return "create";
  if (pathname.startsWith("/todo")) return "todo";
  if (pathname.startsWith("/habits")) return "habits";
  if (pathname.startsWith("/me")) return "me";
  return "timeline";
}

function useScrollHidden(enabled: boolean, resetKey: string): boolean {
  const [hidden, setHidden] = useState(false);
  const lastYRef = useRef(0);

  useEffect(() => {
    setHidden(false);
    lastYRef.current = window.scrollY;
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let frame = 0;
    function evaluate() {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const delta = y - lastYRef.current;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - BOTTOM_ZONE_PX;
      if (y < TOP_ZONE_PX || nearBottom) {
        setHidden(false);
      } else if (delta > DIRECTION_SLOP_PX && y > HIDE_AFTER_PX) {
        setHidden(true);
      } else if (delta < -DIRECTION_SLOP_PX) {
        setHidden(false);
      } else {
        return;
      }
      lastYRef.current = y;
    }
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(evaluate);
    }
    lastYRef.current = window.scrollY;
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return enabled && hidden;
}

export function BottomNav() {
  const pathname = usePathname();
  const { hydrated, me, token } = useAppStore();
  const createWindowPhase = useAppStore((s) => s.createWindowPhase);
  const openCreateWindow = useAppStore((s) => s.openCreateWindow);
  const reducedMotion = useReducedMotion();
  const visible = hydrated && Boolean(token) && Boolean(me) && isUserAppPath(pathname);
  const hidden = useScrollHidden(visible && createWindowPhase === "closed", pathname);

  useEffect(() => {
    const root = document.documentElement;
    if (hidden) root.dataset.navHidden = "true";
    else delete root.dataset.navHidden;
    return () => {
      delete root.dataset.navHidden;
    };
  }, [hidden]);

  if (!visible) return null;

  const active = activeKey(pathname);

  return (
    <motion.nav
      className="fixed inset-x-0 bottom-0 z-40 box-border max-w-full px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.55rem)] pt-2 sm:px-6"
      aria-label="底部导航"
      initial={false}
      animate={hidden ? (reducedMotion ? { opacity: 0 } : { y: "110%", opacity: 0.4 }) : { y: 0, opacity: 1 }}
      transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
      style={{ pointerEvents: hidden ? "none" : undefined }}
    >
      <div className={cn("liquid-nav-shell mx-auto grid h-[72px] w-full max-w-[520px] grid-cols-5 items-center px-2 sm:px-4", PAGE_CHROME_WIDTH_SM_CLASS[pageWidthForPath(pathname)])}>
        <NavItem href="/timeline" label="首页" active={createWindowPhase === "closed" && active === "timeline"} reducedMotion={reducedMotion} icon={<BookHeart className="h-5 w-5" />} />
        <NavItem href="/cycle" label="周期" active={createWindowPhase === "closed" && active === "cycle"} reducedMotion={reducedMotion} icon={<Moon className="h-5 w-5" />} />
        <CreateNavAction
          active={active === "create" || createWindowPhase === "open"}
          gathering={createWindowPhase === "gathering"}
          reducedMotion={reducedMotion}
          onOpen={() => {
            if (active !== "create" && createWindowPhase === "closed") openCreateWindow();
          }}
        />
        <NavItem href="/todo" label="约会" active={createWindowPhase === "closed" && active === "todo"} reducedMotion={reducedMotion} icon={<CalendarHeart className="h-5 w-5" />} />
        <NavItem href="/habits" label="习惯" active={createWindowPhase === "closed" && active === "habits"} reducedMotion={reducedMotion} icon={<CalendarCheck2 className="h-5 w-5" />} />
      </div>
    </motion.nav>
  );
}

function NavItem({
  href,
  label,
  active,
  icon,
  reducedMotion,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
  reducedMotion: boolean | null;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative isolate mx-auto flex min-h-[56px] w-full max-w-[72px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-medium transition-[color,transform] duration-200 ease-out focus-ring active:translate-y-0.5 sm:max-w-none",
        active ? "text-rose-deep" : "text-ink-muted hover:text-rose-deep",
      )}
      aria-current={active ? "page" : undefined}
    >
      <AnimatePresence initial={false}>
        {active && (
          <motion.span
            layoutId="bottom-nav-liquid-lens"
            className="liquid-nav-lens"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { ...MOTION_TRANSITIONS.state, duration: 0.25 }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
      <span className="relative z-10 transition-transform duration-200 ease-out group-hover:-translate-y-0.5">
        {icon}
      </span>
      <span className="relative z-10 leading-none">{label}</span>
    </Link>
  );
}
