"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, LogOut, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "./avatar";
import { AvatarPicker } from "./avatar-picker";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";

interface TimelineHeaderProps {
  title?: string;
  back?: { href: string; label?: string };
  rightSlot?: React.ReactNode;
}

export function TimelineHeader({ title, back, rightSlot }: TimelineHeaderProps) {
  const router = useRouter();
  const me = useAppStore((s) => s.me);
  const setMe = useAppStore((s) => s.setMe);
  const logout = useAppStore((s) => s.logout);
  const [picking, setPicking] = useState(false);

  if (!me) return null;

  async function onPickAvatar(emoji: string) {
    if (!me) return;
    try {
      const updated = await api.patchMe({ avatar: emoji });
      setMe({ ...me, user: { ...me.user, avatar: updated.avatar, display_name: updated.display_name } });
      toast.success("头像已更新");
    } catch {
      // toast handled
    }
  }

  return (
    <>
      <header className="sticky top-0 z-30 frosted-bar pt-[env(safe-area-inset-top,0px)]">
        <div className="max-w-3xl mx-auto px-5 sm:px-6 h-16 flex items-center gap-3">
          {back ? (
            <Link
              href={back.href}
              className="h-10 w-10 grid place-items-center rounded-full hover:bg-ink/5 focus-ring text-ink"
              aria-label={back.label || "返回"}
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          ) : (
            <button
              onClick={() => setPicking(true)}
              className="group relative inline-flex items-center gap-2 focus-ring rounded-full pl-1 pr-3 py-1 hover:bg-ink/5 transition"
              aria-label="编辑头像"
            >
              <Avatar emoji={me.user.avatar} name={me.user.display_name} size="md" />
              <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-rose text-white grid place-items-center shadow-soft border-2 border-cream">
                <Pencil className="h-2.5 w-2.5" />
              </span>
            </button>
          )}

          <div className="flex-1 min-w-0">
            {title ? (
              <h1 className="font-display text-lg sm:text-xl text-ink truncate">{title}</h1>
            ) : (
              <div>
                <p className="font-display text-base sm:text-lg text-ink leading-tight truncate">
                  {me.user.display_name}
                </p>
                <p className="font-sc text-[11px] text-ink-muted">
                  与 {me.counterpart.display_name} 一起
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {rightSlot}
            <button
              onClick={() => {
                logout();
                toast.success("已退出，期待再见");
                router.replace("/");
              }}
              className="h-10 w-10 grid place-items-center rounded-full hover:bg-ink/5 focus-ring text-ink-soft"
              aria-label="退出"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <AvatarPicker
        open={picking}
        current={me.user.avatar}
        onClose={() => setPicking(false)}
        onPick={onPickAvatar}
        title="挑一个属于你的样子"
      />
    </>
  );
}
