"use client";

// Sticky app header with lively scrapbook navigation, logout, current user avatar display, emoji fallback, and private avatar image upload.

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
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  if (!me) return null;

  async function onPickAvatar(emoji: string) {
    if (!me) return;
    try {
      const updated = await api.patchMe({ avatar: emoji });
      setMe({ ...me, user: { ...me.user, ...updated } });
      toast.success("头像已更新");
    } catch {
      // toast handled
    }
  }

  async function onUploadAvatar(file: File) {
    if (!me) return;
    setUploadingAvatar(true);
    try {
      const updated = await api.uploadMyAvatar(file);
      setMe({ ...me, user: { ...me.user, ...updated } });
      toast.success("头像图片已更新");
      setPicking(false);
    } catch {
      // toast handled
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function onDeleteAvatarImage() {
    if (!me) return;
    setUploadingAvatar(true);
    try {
      const updated = await api.deleteMyAvatar();
      setMe({ ...me, user: { ...me.user, ...updated } });
      toast.success("头像图片已清除");
    } catch {
      // toast handled
    } finally {
      setUploadingAvatar(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-30 frosted-bar pt-[env(safe-area-inset-top,0px)]">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          {back ? (
            <Link
              href={back.href}
              className="grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-ink/5 focus-ring"
              aria-label={back.label || "返回"}
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          ) : (
            <button
              onClick={() => setPicking(true)}
              className="group relative inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition hover:bg-ink/5 focus-ring"
              aria-label="编辑头像"
            >
              <Avatar user={me.user} size="md" />
              <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-cream bg-rose text-white shadow-soft">
                <Pencil className="h-2.5 w-2.5" />
              </span>
            </button>
          )}

          <div className="flex-1 min-w-0">
            {title ? (
              <h1 className="truncate font-display text-lg font-semibold text-ink sm:text-xl">{title}</h1>
            ) : (
              <div>
                <p className="truncate font-display text-base font-semibold leading-tight text-ink sm:text-lg">
                  {me.user.display_name}
                </p>
                <p className="font-sc text-[11px] text-ink-muted">
                  和 {me.counterpart.display_name} 一起
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
              className="grid h-10 w-10 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 focus-ring"
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
        hasImage={me.user.avatar_has_image}
        uploading={uploadingAvatar}
        onClose={() => setPicking(false)}
        onPick={onPickAvatar}
        onUpload={onUploadAvatar}
        onDeleteImage={onDeleteAvatarImage}
        title="挑一个属于你的样子"
      />
    </>
  );
}
