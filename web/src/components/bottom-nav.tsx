"use client";

// Bottom app navigation for authenticated user pages, with timeline, cycle, create, todo, and profile destinations.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BookHeart, ListTodo, Moon, Plus } from "lucide-react";
import { Avatar } from "./avatar";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";

const USER_APP_PREFIXES = ["/timeline", "/create", "/cycle", "/todo", "/me"];

function isUserAppPath(pathname: string): boolean {
  return USER_APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function activeKey(pathname: string): "timeline" | "cycle" | "create" | "todo" | "me" {
  if (pathname.startsWith("/cycle")) return "cycle";
  if (pathname.startsWith("/create")) return "create";
  if (pathname.startsWith("/todo")) return "todo";
  if (pathname.startsWith("/me")) return "me";
  return "timeline";
}

export function BottomNav() {
  const pathname = usePathname();
  const { hydrated, me, token } = useAppStore();

  if (!hydrated || !token || !me || !isUserAppPath(pathname)) return null;

  const active = activeKey(pathname);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.55rem)] pt-2"
      aria-label="底部导航"
    >
      <div className="mx-auto grid h-[72px] max-w-[520px] grid-cols-5 items-center rounded-[1.45rem] border border-line/75 bg-surface/95 px-2 shadow-glow backdrop-blur-md">
        <NavItem href="/timeline" label="首页" active={active === "timeline"} icon={<BookHeart className="h-5 w-5" />} />
        <NavItem href="/cycle" label="周期" active={active === "cycle"} icon={<Moon className="h-5 w-5" />} />
        <Link
          href="/create"
          className={cn(
            "group mx-auto -mt-8 grid h-[64px] w-[64px] place-items-center rounded-full text-white shadow-glow transition duration-200 focus-ring active:translate-y-0.5",
            active === "create"
              ? "bg-rose-deep"
              : "bg-gradient-to-br from-rose-deep via-rose to-peach-deep hover:brightness-[1.03]",
          )}
          aria-label="记一笔"
          aria-current={active === "create" ? "page" : undefined}
        >
          <Plus className="h-7 w-7 transition duration-200 group-hover:scale-105" />
        </Link>
        <NavItem href="/todo" label="Todo" active={active === "todo"} icon={<ListTodo className="h-5 w-5" />} />
        <Link
          href="/me"
          className={cn(
            "mx-auto flex min-h-[56px] w-full max-w-[72px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-medium transition duration-200 focus-ring",
            active === "me" ? "bg-rose/10 text-rose-deep" : "text-ink-muted hover:bg-peach/18 hover:text-rose-deep",
          )}
          aria-current={active === "me" ? "page" : undefined}
        >
          <Avatar user={me.user} size="sm" />
          <span className="leading-none">我的</span>
        </Link>
      </div>
    </nav>
  );
}

function NavItem({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "mx-auto flex min-h-[56px] w-full max-w-[72px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-medium transition duration-200 focus-ring active:translate-y-0.5",
        active ? "bg-rose/10 text-rose-deep" : "text-ink-muted hover:bg-peach/18 hover:text-rose-deep",
      )}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span className="leading-none">{label}</span>
    </Link>
  );
}
