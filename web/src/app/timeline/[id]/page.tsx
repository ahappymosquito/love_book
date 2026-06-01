"use client";

// Event detail screen with avatar-aware author rendering, stable-hover comment reactions, media stream, and submission state.

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Trash2,
  CalendarHeart,
  Sparkles,
  Lock,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { AuthGate } from "@/components/auth-gate";
import { TimelineHeader } from "@/components/timeline-header";
import { Avatar } from "@/components/avatar";
import { Composer } from "@/components/composer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImageThumb } from "@/components/image-thumb";
import { Lightbox } from "@/components/lightbox";
import { LoadingScreen } from "@/components/loading-screen";
import { VisibilityBadge } from "@/components/visibility-badge";
import { VoicePlayer } from "@/components/voice-player";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { formatAbsolute, formatRelative } from "@/lib/format";
import type {
  CommentOut,
  CommentReactionSummary,
  CommentReactionType,
  EventDetail,
  ImageOut,
  UserOut,
  VoiceOut,
} from "@/lib/types";
import { cn } from "@/lib/cn";

interface PendingComment {
  kind: "comment";
  pendingId: string;
  text: string;
  authorId: number;
  createdAt: string;
}
interface PendingVoice {
  kind: "voice";
  pendingId: string;
  authorId: number;
  durationMs: number;
  blobUrl: string;
  createdAt: string;
}
interface PendingImage {
  kind: "image";
  pendingId: string;
  authorId: number;
  blobUrl: string;
  createdAt: string;
}
type Pending = PendingComment | PendingVoice | PendingImage;

const COMMENT_REACTIONS: {
  type: CommentReactionType;
  label: string;
  Icon: typeof ThumbsUp;
}[] = [
  { type: "like", label: "点赞", Icon: ThumbsUp },
  { type: "dislike", label: "倒赞", Icon: ThumbsDown },
];

export default function EventDetailPage() {
  return (
    <AuthGate>
      <EventDetailInner />
    </AuthGate>
  );
}

function EventDetailInner() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);
  const router = useRouter();
  const me = useAppStore((s) => s.me)!;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getEvent(eventId);
      setEvent(data);
    } catch {
      router.replace("/timeline");
    }
  }, [eventId, router]);

  useEffect(() => {
    if (Number.isNaN(eventId)) return;
    void load();
  }, [eventId, load]);

  async function refreshContents() {
    try {
      const c = await api.getContents(eventId);
      setEvent((prev) => (prev ? { ...prev, contents: c, submission_state: c.submission_state } : prev));
    } catch {
      // toast handled
    }
  }

  function replaceComment(updated: CommentOut) {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        contents: {
          ...prev.contents,
          comments: prev.contents.comments.map((comment) => (comment.id === updated.id ? updated : comment)),
        },
      };
    });
  }

  async function handleToggleCommentReaction(comment: CommentOut, reactionType: CommentReactionType) {
    const previous = comment;
    const selected = comment.reactions.find((reaction) => reaction.reacted_by_me)?.reaction_type;
    const nextComment = {
      ...comment,
      reactions: nextReactionSummaries(comment.reactions, reactionType),
    };
    replaceComment(nextComment);
    try {
      const updated =
        selected === reactionType
          ? await api.deleteCommentReaction(comment.id)
          : await api.setCommentReaction(comment.id, reactionType);
      replaceComment(updated);
    } catch {
      replaceComment(previous);
    }
  }

  function lookupAuthor(authorId: number): UserOut {
    if (!event) return me.user;
    if (authorId === me.user.id) return me.user;
    if (authorId === me.counterpart.id) return me.counterpart;
    return me.user;
  }

  const stream = useMemo(() => {
    if (!event) return [];
    type StreamItem =
      | { kind: "comment"; data: CommentOut; pending?: false }
      | { kind: "voice"; data: VoiceOut; pending?: false }
      | { kind: "image"; data: ImageOut; pending?: false }
      | { kind: "comment-pending"; data: PendingComment }
      | { kind: "voice-pending"; data: PendingVoice }
      | { kind: "image-pending"; data: PendingImage };

    const items: StreamItem[] = [];
    for (const c of event.contents.comments) items.push({ kind: "comment", data: c });
    for (const v of event.contents.voices) items.push({ kind: "voice", data: v });
    for (const i of event.contents.images) items.push({ kind: "image", data: i });
    for (const p of pending) {
      if (p.kind === "comment") items.push({ kind: "comment-pending", data: p });
      if (p.kind === "voice") items.push({ kind: "voice-pending", data: p });
      if (p.kind === "image") items.push({ kind: "image-pending", data: p });
    }
    const timeOf = (it: StreamItem) => {
      if (
        it.kind === "comment-pending" ||
        it.kind === "voice-pending" ||
        it.kind === "image-pending"
      ) {
        return new Date(it.data.createdAt).getTime();
      }
      return new Date(it.data.created_at).getTime();
    };
    items.sort((a, b) => timeOf(a) - timeOf(b));
    return items;
  }, [event, pending]);

  async function handleSendText(text: string) {
    const tempId = `c-${Date.now()}`;
    const createdAt = new Date().toISOString();
    setPending((p) => [
      ...p,
      { kind: "comment", pendingId: tempId, text, authorId: me.user.id, createdAt },
    ]);
    try {
      await api.postComment(eventId, text);
      setPending((p) => p.filter((x) => x.kind !== "comment" || x.pendingId !== tempId));
      await refreshContents();
    } catch {
      setPending((p) => p.filter((x) => x.kind !== "comment" || x.pendingId !== tempId));
    }
  }

  async function handleUploadVoice(blob: Blob, durationMs: number) {
    const tempId = `v-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const blobUrl = URL.createObjectURL(blob);
    setPending((p) => [
      ...p,
      {
        kind: "voice",
        pendingId: tempId,
        durationMs,
        authorId: me.user.id,
        blobUrl,
        createdAt,
      },
    ]);
    try {
      await api.postVoice(eventId, blob, durationMs);
      await refreshContents();
    } catch {
      // toast handled
    } finally {
      setPending((p) => {
        const next = p.filter((x) => !(x.kind === "voice" && x.pendingId === tempId));
        return next;
      });
      URL.revokeObjectURL(blobUrl);
    }
  }

  async function handlePickImages(files: File[]) {
    const additions: PendingImage[] = files.map((f, i) => ({
      kind: "image",
      pendingId: `i-${Date.now()}-${i}`,
      authorId: me.user.id,
      blobUrl: URL.createObjectURL(f),
      createdAt: new Date(Date.now() + i).toISOString(),
    }));
    setPending((p) => [...p, ...additions]);

    let ok = 0;
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      const tempId = additions[idx].pendingId;
      try {
        await api.postImage(eventId, file);
        ok++;
      } catch {
        // toast handled
      } finally {
        setPending((p) => {
          const next = p.filter((x) => !(x.kind === "image" && x.pendingId === tempId));
          return next;
        });
        URL.revokeObjectURL(additions[idx].blobUrl);
      }
    }
    if (ok > 0) await refreshContents();
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteEvent(eventId);
      toast.success("已删除这条记录");
      router.replace("/timeline");
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (!event) {
    return (
      <>
        <TimelineHeader back={{ href: "/timeline" }} />
        <LoadingScreen />
      </>
    );
  }

  const creator = lookupAuthor(event.creator_id);
  const isMine = event.creator_id === me.user.id;
  const submission = event.submission_state;
  const locked = !submission.unlocked && event.visibility_mode === "mutual_submit";

  return (
    <div className="min-h-dvh w-full">
      <TimelineHeader
        back={{ href: "/timeline" }}
        title="一笔小事"
        rightSlot={
          isMine ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="h-10 w-10 grid place-items-center rounded-full hover:bg-rose-deep/10 text-rose-deep focus-ring"
              aria-label="删除事件"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          ) : undefined
        }
      />

      <div ref={containerRef} className="max-w-3xl mx-auto px-5 sm:px-6 pt-4 scroll-pad-bottom">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32 }}
          className="glass-card rounded-3xl p-6 sm:p-7"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <VisibilityBadge mode={event.visibility_mode} />
            {event.occurred_at && (
              <span className="pill bg-cream-deep/70 text-ink-soft inline-flex items-center gap-1.5">
                <CalendarHeart className="h-3 w-3" />
                {formatAbsolute(event.occurred_at)}
              </span>
            )}
          </div>

          <h1 className="font-display text-3xl sm:text-4xl text-ink leading-snug mt-3">
            {event.title}
          </h1>

          {event.description && (
            <p className="font-sc text-[15px] text-ink-soft mt-3 leading-relaxed whitespace-pre-wrap">
              {event.description}
            </p>
          )}

          <div className="mt-5 flex items-center gap-3">
            <Avatar user={creator} size="sm" />
            <div>
              <p className="font-sc text-xs text-ink-muted">由 {creator.display_name} 起笔</p>
              <p className="font-sc text-[11px] text-ink-muted/80" title={formatAbsolute(event.created_at)}>
                {formatRelative(event.created_at)}
              </p>
            </div>
          </div>
        </motion.section>

        {/* Submission state */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.32 }}
          className="mt-4 grid grid-cols-2 gap-3"
        >
          <SubmissionTile
            user={me.user}
            submitted={submission.current_user_submitted}
            mine
          />
          <SubmissionTile
            user={me.counterpart}
            submitted={submission.counterpart_submitted}
          />
        </motion.section>

        {locked && (
          <div className="mt-4 rounded-2xl bg-rose/8 hairline px-4 py-3 flex items-start gap-3">
            <Lock className="h-4 w-4 text-rose-deep mt-0.5" />
            <p className="font-sc text-xs text-ink-soft leading-relaxed">
              这是一条「双方提交后可见」的记录。等你们都写下一点，就会一起解开。
            </p>
          </div>
        )}

        {submission.unlocked && event.contents.comments.length + event.contents.voices.length + event.contents.images.length > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sage/15 text-sage text-xs font-sc">
            <Sparkles className="h-3 w-3" />
            已解锁双方的全部内容
          </div>
        )}

        {/* Stream */}
        <section className="mt-6 space-y-4">
          {stream.length === 0 && (
            <div className="text-center font-sc text-sm text-ink-muted py-10">
              这里还没有内容。说点什么吧 ↓
            </div>
          )}

          <AnimatePresence initial={false}>
            {stream.map((item, idx) => {
              const authorId =
                item.kind === "comment-pending" ||
                item.kind === "voice-pending" ||
                item.kind === "image-pending"
                  ? item.data.authorId
                  : item.data.author_id;
              const time =
                item.kind === "comment-pending" ||
                item.kind === "voice-pending" ||
                item.kind === "image-pending"
                  ? item.data.createdAt
                  : item.data.created_at;
              const author = lookupAuthor(authorId);
              const isMine = authorId === me.user.id;
              const itemKey =
                item.kind === "comment-pending" ||
                item.kind === "voice-pending" ||
                item.kind === "image-pending"
                  ? `pending-${item.data.pendingId}`
                  : `${item.kind}-${item.data.id}`;

              return (
                <motion.div
                  key={itemKey}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(idx * 0.02, 0.2) }}
                  className={cn(
                    "flex gap-3 items-end",
                    isMine ? "flex-row-reverse" : "flex-row",
                  )}
                >
                  <Avatar user={author} size="sm" />

                  <div
                    className={cn(
                      "max-w-[78%] flex flex-col gap-1",
                      isMine ? "items-end" : "items-start",
                    )}
                  >
                    <div className="flex items-baseline gap-2 px-1">
                      <span className="font-sc text-[11px] text-ink-soft">{author.display_name}</span>
                      <span className="font-sc text-[10px] text-ink-muted/80" title={formatAbsolute(time)}>
                        {formatRelative(time)}
                      </span>
                    </div>

                    {item.kind === "comment" && (
                      <CommentBubble
                        comment={item.data}
                        text={item.data.text}
                        isMine={isMine}
                        onToggleReaction={handleToggleCommentReaction}
                      />
                    )}
                    {item.kind === "comment-pending" && (
                      <div
                        className={cn(
                          "px-4 py-2.5 max-w-full font-sc text-[15px] leading-relaxed whitespace-pre-wrap break-words opacity-70",
                          isMine
                            ? "rounded-2xl rounded-tr-md bg-rose text-white"
                            : "rounded-2xl rounded-tl-md bg-surface-raised/85 hairline text-ink",
                        )}
                      >
                        {item.data.text}
                        <span className="ml-2 text-[10px] opacity-80">发送中…</span>
                      </div>
                    )}

                    {item.kind === "voice" && (
                      <VoicePlayer
                        voiceId={item.data.id}
                        durationMs={item.data.duration_ms}
                        mine={isMine}
                      />
                    )}
                    {item.kind === "voice-pending" && (
                      <VoicePlayer
                        voiceId={-1}
                        durationMs={item.data.durationMs}
                        mine={isMine}
                        pending
                        localUrl={item.data.blobUrl}
                      />
                    )}

                    {item.kind === "image" && (
                      <ImageThumb
                        imageId={item.data.id}
                        onClick={(u) => setLightbox(u)}
                      />
                    )}
                    {item.kind === "image-pending" && (
                      <ImageThumb
                        imageId={-1}
                        pending
                        localUrl={item.data.blobUrl}
                        onClick={(u) => setLightbox(u)}
                      />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </section>
      </div>

      <Composer
        onSendText={handleSendText}
        onPickImages={handlePickImages}
        onUploadVoice={handleUploadVoice}
      />

      <Lightbox url={lightbox} onClose={() => setLightbox(null)} />

      <ConfirmDialog
        open={confirmDelete}
        title="删除这条记录？"
        description="一旦删除，连带的评论、语音、图片都会一并消失。要确认吗？"
        confirmLabel="删除"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function nextReactionSummaries(
  reactions: CommentReactionSummary[],
  targetType: CommentReactionType,
): CommentReactionSummary[] {
  const selected = reactions.find((reaction) => reaction.reacted_by_me)?.reaction_type;
  const counts = new Map<CommentReactionType, number>();
  for (const reaction of reactions) {
    counts.set(reaction.reaction_type, reaction.count);
  }
  if (selected) {
    counts.set(selected, Math.max(0, (counts.get(selected) ?? 0) - 1));
  }
  const nextSelected = selected === targetType ? null : targetType;
  if (nextSelected) {
    counts.set(nextSelected, (counts.get(nextSelected) ?? 0) + 1);
  }
  return COMMENT_REACTIONS.flatMap(({ type }) => {
    const count = counts.get(type) ?? 0;
    return count > 0
      ? [
          {
            reaction_type: type,
            count,
            reacted_by_me: type === nextSelected,
          },
        ]
      : [];
  });
}

function CommentBubble({
  comment,
  text,
  isMine,
  pending,
  onToggleReaction,
}: {
  comment?: CommentOut;
  text: string;
  isMine: boolean;
  pending?: boolean;
  onToggleReaction?: (comment: CommentOut, reactionType: CommentReactionType) => void | Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactionHoverOpen, setReactionHoverOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const selectedType = comment?.reactions.find((reaction) => reaction.reacted_by_me)?.reaction_type;
  const canReact = Boolean(comment && onToggleReaction && !pending);

  function clearLongPress() {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function startLongPress(event: PointerEvent<HTMLDivElement>) {
    if (!canReact || event.pointerType === "mouse") return;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      setPickerOpen(true);
      longPressTimer.current = null;
    }, 460);
  }

  function toggleReaction(reactionType: CommentReactionType) {
    if (!comment || !onToggleReaction) return;
    void onToggleReaction(comment, reactionType);
    setPickerOpen(false);
  }

  return (
    <div className={cn("max-w-full", isMine ? "items-end" : "items-start")}>
      <div
        className="relative max-w-full"
        onMouseEnter={() => {
          if (canReact) setReactionHoverOpen(true);
        }}
        onMouseLeave={() => setReactionHoverOpen(false)}
      >
        <div
          onPointerDown={startLongPress}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
          onContextMenu={(event) => {
            if (canReact) event.preventDefault();
          }}
          className={cn(
            "px-4 py-2.5 max-w-full font-sc text-[15px] leading-relaxed whitespace-pre-wrap break-words select-text",
            pending && "opacity-70",
            isMine
              ? "rounded-2xl rounded-tr-md bg-rose text-white"
              : "rounded-2xl rounded-tl-md bg-surface-raised/85 hairline text-ink",
          )}
        >
          {text}
          {pending && <span className="ml-2 text-[10px] opacity-80">发送中...</span>}
        </div>

        {canReact && (
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 z-20 hidden -translate-y-1/2 gap-1 rounded-full bg-surface-raised/95 p-1 opacity-0 shadow-soft hairline transition-opacity duration-150 md:flex",
              reactionHoverOpen && "pointer-events-auto opacity-100",
              isMine ? "right-full mr-1" : "left-full ml-1",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-0 h-full w-3",
                isMine ? "-right-3" : "-left-3",
              )}
            />
            {COMMENT_REACTIONS.map((reaction) => (
              <ReactionIconButton
                key={reaction.type}
                reaction={reaction}
                selected={selectedType === reaction.type}
                onClick={() => toggleReaction(reaction.type)}
              />
            ))}
          </div>
        )}
      </div>

      {comment && comment.reactions.length > 0 && (
        <div className={cn("mt-1 flex flex-wrap gap-1.5 px-1", isMine ? "justify-end" : "justify-start")}>
          {comment.reactions.map((reaction) => {
            const config = COMMENT_REACTIONS.find((item) => item.type === reaction.reaction_type);
            if (!config) return null;
            const Icon = config.Icon;
            return (
              <button
                key={reaction.reaction_type}
                type="button"
                onClick={() => toggleReaction(reaction.reaction_type)}
                disabled={!canReact}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors focus-ring",
                  reaction.reacted_by_me
                    ? "bg-rose/18 text-rose-deep"
                    : "bg-surface-raised/80 text-ink-soft hairline",
                  canReact ? "cursor-pointer hover:bg-rose/12" : "cursor-default",
                )}
                aria-pressed={reaction.reacted_by_me}
                aria-label={`${config.label} ${reaction.count}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{reaction.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {pickerOpen && canReact && (
          <motion.div
            className="fixed inset-0 z-50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="选择留言表情"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/30"
              aria-label="关闭表情选择"
              onClick={() => setPickerOpen(false)}
            />
            <motion.div
              initial={{ y: 32 }}
              animate={{ y: 0 }}
              exit={{ y: 24 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-surface-raised p-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] shadow-glow hairline"
            >
              <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line" />
              <div className="flex items-center justify-center gap-4">
                {COMMENT_REACTIONS.map((reaction) => (
                  <ReactionIconButton
                    key={reaction.type}
                    reaction={reaction}
                    selected={selectedType === reaction.type}
                    onClick={() => toggleReaction(reaction.type)}
                    large
                  />
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReactionIconButton({
  reaction,
  selected,
  onClick,
  large,
}: {
  reaction: (typeof COMMENT_REACTIONS)[number];
  selected: boolean;
  onClick: () => void;
  large?: boolean;
}) {
  const Icon = reaction.Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid place-items-center rounded-full transition-colors focus-ring",
        large ? "h-14 w-14" : "h-9 w-9",
        selected ? "bg-rose text-white" : "bg-cream-deep/70 text-ink-soft hover:bg-rose/12 hover:text-rose-deep",
      )}
      aria-label={reaction.label}
      aria-pressed={selected}
      title={reaction.label}
    >
      <Icon className={cn(large ? "h-6 w-6" : "h-4 w-4")} />
    </button>
  );
}

function SubmissionTile({
  user,
  submitted,
  mine,
}: {
  user: UserOut;
  submitted: boolean;
  mine?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl p-4 hairline",
        submitted ? "bg-sage/10" : "bg-cream-deep/40",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar user={user} size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-sc text-sm text-ink truncate">
            {user.display_name}
            {mine && <span className="text-ink-muted text-xs ml-1">(你)</span>}
          </p>
          <p
            className={cn(
              "font-sc text-xs flex items-center gap-1 mt-0.5",
              submitted ? "text-sage" : "text-ink-muted",
            )}
          >
            {submitted ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                已写下
              </>
            ) : (
              <>
                <Circle className="h-3 w-3" />
                还没写
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
