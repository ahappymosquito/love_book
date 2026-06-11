"use client";

// Authenticated five-slot bottom navigation with a shared liquid-glass selection lens, habit destination, settings via avatar, and compact rose create action.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookHeart, CalendarCheck2, ListTodo, Moon } from "lucide-react";
import { CreateNavAction } from "./create-nav-action";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";

const USER_APP_PREFIXES = ["/timeline", "/create", "/cycle", "/todo", "/habits", "/me"];

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

export function BottomNav() {
  const pathname = usePathname();
  const { hydrated, me, token } = useAppStore();
  const createWindowPhase = useAppStore((s) => s.createWindowPhase);
  const openCreateWindow = useAppStore((s) => s.openCreateWindow);
  const reducedMotion = useReducedMotion();

  if (!hydrated || !token || !me || !isUserAppPath(pathname)) return null;

  const active = activeKey(pathname);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.55rem)] pt-2"
      aria-label="底部导航"
    >
      <div className="liquid-nav-shell mx-auto grid h-[72px] max-w-[520px] grid-cols-5 items-center px-2 sm:max-w-5xl sm:px-4">
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
        <NavItem href="/todo" label="Todo" active={createWindowPhase === "closed" && active === "todo"} reducedMotion={reducedMotion} icon={<ListTodo className="h-5 w-5" />} />
        <NavItem href="/habits" label="习惯" active={createWindowPhase === "closed" && active === "habits"} reducedMotion={reducedMotion} icon={<CalendarCheck2 className="h-5 w-5" />} />
      </div>
    </nav>
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
            transition={reducedMotion ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
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
