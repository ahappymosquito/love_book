"use client";

// Event detail screen with mobile viewport guards, explicit-save meeting session organization for either user's events, warm scrapbook reading layout, avatar-aware authors, stable-hover reactions, media stream, submission state, and bottom-nav-covering composer.

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Loader2,
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
  EventKind,
  ImageOut,
  MeetingSessionOut,
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
  const [meetingSessions, setMeetingSessions] = useState<MeetingSessionOut[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingKind, setUpdatingKind] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [data, sessions] = await Promise.all([
        api.getEvent(eventId),
        api.listMeetingSessions().catch(() => []),
      ]);
      setEvent(data);
      setMeetingSessions(sessions);
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

  async function handleToggleMeetingKind() {
    if (!event || updatingKind) return;
    const nextKind: EventKind = event.event_kind === "offline_meeting" ? "memory" : "offline_meeting";
    const previous = event;
    setUpdatingKind(true);
    setEvent({ ...event, event_kind: nextKind });
    try {
      const updated = await api.updateEvent(event.id, { event_kind: nextKind });
      setEvent(updated);
      toast.success(nextKind === "offline_meeting" ? "已放进见面时间河流" : "已取消见面标记");
    } catch {
      setEvent(previous);
    } finally {
      setUpdatingKind(false);
    }
  }

  async function handleAssignMeetingSession(meetingSessionId: number | null) {
    if (!event) return null;
    const previous = event;
    setEvent({ ...event, meeting_session_id: meetingSessionId });
    try {
      const updated = await api.updateEvent(event.id, { meeting_session_id: meetingSessionId });
      setEvent(updated);
      setMeetingSessions(await api.listMeetingSessions().catch(() => meetingSessions));
      return updated;
    } catch {
      setEvent(previous);
      return null;
    }
  }

  async function handleCreateMeetingSession(payload: { title: string }) {
    if (!event) return null;
    const meetingSession = await api.createMeetingSession(payload);
    setMeetingSessions((sessions) => [meetingSession, ...sessions]);
    const updated = await handleAssignMeetingSession(meetingSession.id);
    return updated;
  }

  async function handleRenameMeetingSession(meetingSessionId: number, title: string) {
    const updatedSession = await api.updateMeetingSession(meetingSessionId, { title });
    setMeetingSessions((sessions) =>
      sessions.map((session) => (session.id === updatedSession.id ? updatedSession : session)),
    );
    setEvent((previous) =>
      previous?.meeting_session_id === updatedSession.id
        ? { ...previous, meeting_session: updatedSession }
        : previous,
    );
    return updatedSession;
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
  const isMeeting = event.event_kind === "offline_meeting";
  const submission = event.submission_state;
  const locked = !submission.unlocked && event.visibility_mode === "mutual_submit";

  return (
    <div className="viewport-guard relative z-[60] min-h-dvh w-full bg-[rgb(var(--cream)/1)] pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]">
      <TimelineHeader
        back={{ href: "/timeline" }}
        title="一笔小事"
        rightSlot={
          isMine ? (
            <>
              <button
                onClick={handleToggleMeetingKind}
                disabled={updatingKind}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-full transition focus-ring disabled:cursor-wait disabled:opacity-60",
                  isMeeting
                    ? "bg-rose/12 text-rose-deep hover:bg-rose/18"
                    : "text-ink-soft hover:bg-peach/16 hover:text-rose-deep",
                )}
                aria-label={isMeeting ? "取消线下见面标记" : "标记为线下见面"}
                title={isMeeting ? "取消线下见面标记" : "标记为线下见面"}
              >
                <CalendarHeart className="h-5 w-5" />
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="grid h-10 w-10 place-items-center rounded-full text-rose-deep hover:bg-rose-deep/10 focus-ring"
                aria-label="删除事件"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </>
          ) : undefined
        }
      />

      <div ref={containerRef} className="mx-auto w-full max-w-3xl min-w-0 px-4 pt-4 sm:px-6 pb-8">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32 }}
          className="glass-card rounded-3xl p-5 sm:p-6"
        >
          <div className="flex items-center gap-2 flex-wrap">
            {isMeeting && (
              <span className="pill inline-flex items-center gap-1.5 bg-rose/10 text-rose-deep">
                <CalendarHeart className="h-3 w-3" />
                线下见面
              </span>
            )}
            <VisibilityBadge mode={event.visibility_mode} />
            {event.occurred_at && (
              <span className="pill inline-flex items-center gap-1.5 bg-peach/22 text-ink-soft">
                <CalendarHeart className="h-3 w-3" />
                {formatAbsolute(event.occurred_at)}
              </span>
            )}
          </div>

          <h1 className="mt-3 font-display text-2xl font-bold leading-snug text-ink sm:text-3xl">
            {event.title}
          </h1>

          {event.description && (
            <p className="mt-3 whitespace-pre-wrap font-sc text-[15px] leading-relaxed text-ink-soft">
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

        <MeetingSessionOrganizer
          event={event}
          sessions={meetingSessions}
          onAssign={handleAssignMeetingSession}
          onCreateAndAssign={handleCreateMeetingSession}
          onRenameSession={handleRenameMeetingSession}
        />

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
          <div className="mt-4 flex items-start gap-3 rounded-2xl bg-peach/20 px-4 py-3 hairline">
            <Lock className="h-4 w-4 text-rose-deep mt-0.5" />
            <p className="font-sc text-xs text-ink-soft leading-relaxed">
              这是一条「双方提交后可见」的记录。等你们都写下一点，就会一起解开。
            </p>
          </div>
        )}

        {submission.unlocked && event.contents.comments.length + event.contents.voices.length + event.contents.images.length > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-sage/18 px-4 py-2 font-sc text-xs text-ink-soft">
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
                            ? "rounded-2xl rounded-tr-md bg-rose text-white shadow-soft"
                            : "rounded-2xl rounded-tl-md bg-peach/18 text-ink hairline",
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
              ? "rounded-2xl rounded-tr-md bg-rose text-white shadow-soft"
              : "rounded-2xl rounded-tl-md bg-peach/18 text-ink hairline",
          )}
        >
          {text}
          {pending && <span className="ml-2 text-[10px] opacity-80">发送中...</span>}
        </div>

        {canReact && (
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 z-20 hidden -translate-y-1/2 gap-1 rounded-full bg-surface-raised/95 p-1 opacity-0 shadow-soft transition-opacity duration-200 md:flex hairline",
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
                    : "bg-peach/20 text-ink-soft hairline",
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
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
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
        selected ? "bg-rose text-white" : "bg-peach/24 text-ink-soft hover:bg-rose/12 hover:text-rose-deep",
      )}
      aria-label={reaction.label}
      aria-pressed={selected}
      title={reaction.label}
    >
      <Icon className={cn(large ? "h-6 w-6" : "h-4 w-4")} />
    </button>
  );
}

function MeetingSessionOrganizer({
  event,
  sessions,
  onAssign,
  onCreateAndAssign,
  onRenameSession,
}: {
  event: EventDetail;
  sessions: MeetingSessionOut[];
  onAssign: (meetingSessionId: number | null) => EventDetail | null | void | Promise<EventDetail | null | void>;
  onCreateAndAssign: (payload: { title: string }) => EventDetail | null | void | Promise<EventDetail | null | void>;
  onRenameSession: (meetingSessionId: number, title: string) => MeetingSessionOut | void | Promise<MeetingSessionOut | void>;
}) {
  const savedSessionId = event.meeting_session_id ? String(event.meeting_session_id) : "";
  const initialSession = sessions.find((session) => String(session.id) === savedSessionId);
  const [selectedSessionId, setSelectedSessionId] = useState(savedSessionId);
  const [assignmentStatus, setAssignmentStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [newTitle, setNewTitle] = useState(event.title);
  const [newTitleTouched, setNewTitleTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editTitle, setEditTitle] = useState(initialSession?.title ?? "");
  const [renameStatus, setRenameStatus] = useState<"idle" | "saving" | "saved">("idle");
  const selectedOptionSession = sessions.find((session) => String(session.id) === selectedSessionId);

  useEffect(() => {
    setSelectedSessionId(savedSessionId);
    setAssignmentStatus((status) => (status === "saving" ? "saved" : "idle"));
  }, [event.id, savedSessionId]);

  useEffect(() => {
    if (!newTitleTouched) setNewTitle(event.title);
  }, [event.title, newTitleTouched]);

  useEffect(() => {
    setEditTitle(selectedOptionSession?.title ?? "");
    setRenameStatus("idle");
  }, [selectedOptionSession?.id, selectedOptionSession?.title]);

  const assignmentChanged = selectedSessionId !== savedSessionId;
  const canRename = Boolean(selectedOptionSession && editTitle.trim() && editTitle.trim() !== selectedOptionSession.title);

  function changeSelectedSession(value: string) {
    setSelectedSessionId(value);
    setAssignmentStatus(value === savedSessionId ? "idle" : "dirty");
  }

  async function saveAssignment() {
    if (!assignmentChanged || assignmentStatus === "saving") return;
    setAssignmentStatus("saving");
    const updated = await onAssign(selectedSessionId ? Number(selectedSessionId) : null);
    if (updated) {
      toast.success(selectedSessionId ? "已整理到这次见面" : "已移出见面场次");
      setAssignmentStatus("saved");
    } else {
      setAssignmentStatus("dirty");
    }
  }

  async function createAndAssign() {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    try {
      const updated = await onCreateAndAssign({ title: newTitle.trim() });
      if (updated) {
        toast.success("已新建场次并整理进去");
        setAssignmentStatus("saved");
        setNewTitle(event.title);
        setNewTitleTouched(false);
      }
    } finally {
      setCreating(false);
    }
  }

  async function saveSessionTitle() {
    if (!selectedOptionSession || !canRename || renameStatus === "saving") return;
    setRenameStatus("saving");
    try {
      await onRenameSession(selectedOptionSession.id, editTitle.trim());
      setRenameStatus("saved");
      toast.success("场次名称已保存");
    } catch {
      setRenameStatus("idle");
    }
  }

  return (
    <section className="mt-4 rounded-3xl bg-peach/12 p-4 hairline sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-sc text-xs font-medium text-rose-deep">见面场次</p>
          <p className="mt-1 font-sc text-sm text-ink-soft">双方都可以整理归属；内容和发生时间仍只按原权限编辑。</p>
        </div>
        <span className="pill inline-flex items-center gap-1 bg-rose/10 text-rose-deep">
          <CalendarHeart className="h-3.5 w-3.5" />
          {event.meeting_session?.title ?? "未整理"}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <select
          className="input-field font-sc"
          value={selectedSessionId}
          disabled={assignmentStatus === "saving" || creating}
          onChange={(selectEvent) => changeSelectedSession(selectEvent.target.value)}
        >
          <option value="">未整理</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!assignmentChanged || assignmentStatus === "saving" || creating}
            onClick={() => void saveAssignment()}
          >
            {assignmentStatus === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
            保存归属
          </button>
          {assignmentStatus === "dirty" && <span className="font-sc text-xs text-rose-deep">还没保存</span>}
          {assignmentStatus === "saved" && (
            <span className="inline-flex items-center gap-1 font-sc text-xs text-sage">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已保存
            </span>
          )}
        </div>

        {selectedOptionSession && (
          <div className="grid gap-2 rounded-2xl bg-surface-raised/72 p-3 hairline">
            <label className="font-sc text-xs font-medium text-ink-muted">场次标题</label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className="input-field font-sc"
                value={editTitle}
                maxLength={200}
                disabled={renameStatus === "saving"}
                onChange={(inputEvent) => {
                  setEditTitle(inputEvent.target.value);
                  setRenameStatus("idle");
                }}
              />
              <button
                type="button"
                className="btn-ghost inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canRename || renameStatus === "saving"}
                onClick={() => void saveSessionTitle()}
              >
                {renameStatus === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
                保存名称
              </button>
            </div>
            {renameStatus === "saved" && (
              <span className="inline-flex items-center gap-1 font-sc text-xs text-sage">
                <CheckCircle2 className="h-3.5 w-3.5" />
                名称已保存
              </span>
            )}
          </div>
        )}

        <div className="grid gap-3 rounded-2xl bg-surface-raised/72 p-3 hairline">
          <input
            className="input-field font-sc"
            placeholder="新场次名称，例如：周末见面"
            value={newTitle}
            maxLength={200}
            disabled={creating}
            onChange={(inputEvent) => {
              setNewTitleTouched(true);
              setNewTitle(inputEvent.target.value);
            }}
          />
          <p className="font-sc text-[11px] leading-relaxed text-ink-muted">
            新场次默认用这条小事的标题，日期范围会由归入其中的事件自动计算。
          </p>
          <button
            type="button"
            className="btn-ghost inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!newTitle.trim() || creating}
            onClick={() => void createAndAssign()}
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            新建并归入
          </button>
        </div>
      </div>
    </section>
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
        submitted ? "bg-sage/18" : "bg-peach/18",
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
