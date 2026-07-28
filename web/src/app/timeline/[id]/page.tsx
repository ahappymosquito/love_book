"use client";

// Event detail screen for memories, meetings, and received gifts with editable metadata, private images, and a mobile-safe composer.

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Trash2,
  CalendarHeart,
  Check,
  Gift,
  Pencil,
  Sparkles,
  Star,
  Lock,
  ThumbsDown,
  ThumbsUp,
  X,
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
import { MeetingEditorDialog } from "@/components/meeting-editor-dialog";
import { VisibilityBadge } from "@/components/visibility-badge";
import { api } from "@/lib/api";
import { GIFT_FEELING_OPTIONS, giftFeelingMeta } from "@/lib/gift-feelings";
import { useAppStore } from "@/lib/store";
import { formatAbsolute, formatRelative, fromLocalInputValue, toLocalInputValue } from "@/lib/format";
import { MOTION_TRANSITIONS } from "@/lib/motion";
import type {
  CommentOut,
  CommentReactionSummary,
  CommentReactionType,
  EventDetail,
  ImageOut,
  GiftFeeling,
  UserOut,
  VisibilityMode,
} from "@/lib/types";
import { cn } from "@/lib/cn";

interface PendingComment {
  kind: "comment";
  pendingId: string;
  text: string;
  authorId: number;
  createdAt: string;
}
interface PendingImage {
  kind: "image";
  pendingId: string;
  authorId: number;
  blobUrl: string;
  createdAt: string;
}
type Pending = PendingComment | PendingImage;

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
  const [updatingKind, setUpdatingKind] = useState(false);
  const [meetingEditorOpen, setMeetingEditorOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editOccurredAt, setEditOccurredAt] = useState("");
  const [editVisibility, setEditVisibility] = useState<VisibilityMode>("public");
  const [editGiftRating, setEditGiftRating] = useState<number | null>(null);
  const [editGiftFeelings, setEditGiftFeelings] = useState<GiftFeeling[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

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
      | { kind: "image"; data: ImageOut; pending?: false }
      | { kind: "comment-pending"; data: PendingComment }
      | { kind: "image-pending"; data: PendingImage };

    const items: StreamItem[] = [];
    for (const c of event.contents.comments) items.push({ kind: "comment", data: c });
    if (event.event_kind !== "gift_received") {
      for (const i of event.contents.images) items.push({ kind: "image", data: i });
    }
    for (const p of pending) {
      if (p.kind === "comment") items.push({ kind: "comment-pending", data: p });
      if (p.kind === "image") items.push({ kind: "image-pending", data: p });
    }
    const timeOf = (it: StreamItem) => {
      if (
        it.kind === "comment-pending" ||
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
    if (event.meeting_session) {
      setMeetingEditorOpen(true);
      return;
    }
    const previous = event;
    setUpdatingKind(true);
    setEvent({ ...event, event_kind: event.event_kind === "gift_received" ? "gift_received" : "offline_meeting" });
    try {
      const updated = await api.updateEvent(event.id, { event_kind: "offline_meeting" });
      setEvent(updated);
      toast.success("已放进见面时间河流");
    } catch {
      setEvent(previous);
    } finally {
      setUpdatingKind(false);
    }
  }

  function beginEditing() {
    if (!event) return;
    setEditTitle(event.title);
    setEditDescription(event.description ?? "");
    setEditOccurredAt(event.occurred_at ? toLocalInputValue(new Date(event.occurred_at)) : "");
    setEditVisibility(event.visibility_mode);
    setEditGiftRating(event.gift_rating);
    setEditGiftFeelings(event.gift_feelings);
    setEditing(true);
  }

  async function saveEventEdit() {
    if (!event || !editTitle.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      const updated = await api.updateEvent(event.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        occurred_at: editOccurredAt ? fromLocalInputValue(editOccurredAt) : null,
        visibility_mode: event.event_kind === "gift_received" ? "public" : editVisibility,
        gift_rating: event.event_kind === "gift_received" ? editGiftRating : undefined,
        gift_feelings: event.event_kind === "gift_received" ? editGiftFeelings : undefined,
      });
      setEvent(updated);
      setEditing(false);
      toast.success("记录已保存");
    } finally {
      setSavingEdit(false);
    }
  }

  function toggleEditGiftFeeling(value: GiftFeeling) {
    setEditGiftFeelings((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      if (current.length >= 3) {
        toast.error("最多选择 3 个感受");
        return current;
      }
      return [...current, value];
    });
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
  const isMeeting = event.meeting_session_id !== null || event.event_kind === "offline_meeting";
  const isGift = event.event_kind === "gift_received";
  const submission = event.submission_state;
  const locked = !submission.unlocked && event.visibility_mode === "mutual_submit";

  return (
    <div className="viewport-guard relative z-[60] min-h-dvh w-full bg-[rgb(var(--cream)/1)] pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]">
      <TimelineHeader
        back={{ href: "/timeline" }}
        title={isGift ? "一份收礼" : "一笔小事"}
        rightSlot={
          isMine ? (
            <>
              <button
                onClick={beginEditing}
                disabled={editing || savingEdit}
                className="grid h-10 w-10 place-items-center rounded-full text-ink-soft transition hover:bg-peach/16 hover:text-rose-deep focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="编辑记录"
                title="编辑记录"
              >
                <Pencil className="h-4.5 w-4.5" />
              </button>
              <button
                onClick={handleToggleMeetingKind}
                disabled={updatingKind || editing}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-full transition focus-ring disabled:cursor-wait disabled:opacity-60",
                  isMeeting
                    ? "bg-rose/12 text-rose-deep hover:bg-rose/18"
                    : "text-ink-soft hover:bg-peach/16 hover:text-rose-deep",
                )}
                aria-label={isMeeting ? "编辑这次见面" : "标记为线下见面"}
                title={isMeeting ? "编辑这次见面" : "标记为线下见面"}
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
        {isGift && event.contents.images.length > 0 && (
          <section className="mb-4 grid grid-cols-2 gap-2 overflow-hidden rounded-2xl bg-surface p-2" aria-label="礼物照片">
            {event.contents.images.map((image, index) => (
              <ImageThumb
                key={image.id}
                imageId={image.id}
                onClick={(url) => setLightbox(url)}
                className={cn(
                  "!w-full",
                  index === 0 ? "col-span-2 !h-auto aspect-[16/10]" : "!h-auto aspect-square",
                )}
              />
            ))}
          </section>
        )}

        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32 }}
          className={cn("glass-card rounded-3xl p-5 sm:p-6", isGift && "content-surface rounded-2xl bg-peach/10")}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {isMeeting && (
              <span className="pill inline-flex items-center gap-1.5 bg-rose/10 text-rose-deep">
                <CalendarHeart className="h-3 w-3" />
                {event.meeting_session?.title ?? "线下见面"}
              </span>
            )}
            {isGift && (
              <span className="pill inline-flex items-center gap-1.5 bg-peach/24 text-ink">
                <Gift className="h-3.5 w-3.5 text-peach-deep" />
                收礼
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

          {editing ? (
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label htmlFor="event-edit-title" className="font-sc text-xs font-medium text-ink-muted">标题</label>
                <input
                  id="event-edit-title"
                  className="input-field font-display text-lg font-semibold"
                  value={editTitle}
                  maxLength={200}
                  autoFocus
                  disabled={savingEdit}
                  onChange={(inputEvent) => setEditTitle(inputEvent.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="event-edit-description" className="font-sc text-xs font-medium text-ink-muted">{isGift ? "反馈" : "内容"}</label>
                <textarea
                  id="event-edit-description"
                  className="input-field min-h-28 resize-y font-sc leading-relaxed"
                  value={editDescription}
                  maxLength={2000}
                  disabled={savingEdit}
                  onChange={(inputEvent) => setEditDescription(inputEvent.target.value)}
                />
              </div>
              {isGift && (
                <fieldset className="space-y-2">
                  <legend className="font-sc text-xs font-medium text-ink-muted">收到时的感受（最多 3 个）</legend>
                  <div className="flex flex-wrap gap-2">
                    {GIFT_FEELING_OPTIONS.map((option) => {
                      const selected = editGiftFeelings.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={savingEdit || (!selected && editGiftFeelings.length >= 3)}
                          onClick={() => toggleEditGiftFeeling(option.value)}
                          aria-pressed={selected}
                          className={cn(
                            "min-h-10 rounded-full px-3 font-sc text-xs transition focus-ring disabled:opacity-45",
                            selected ? "bg-peach/30 text-ink ring-1 ring-peach-deep/28" : "bg-cream-deep/55 text-ink-soft",
                          )}
                        >
                          {option.emoji} {option.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="event-edit-time" className="font-sc text-xs font-medium text-ink-muted">发生时间</label>
                  <input
                    id="event-edit-time"
                    type="datetime-local"
                    className="input-field font-sc"
                    value={editOccurredAt}
                    disabled={savingEdit}
                    onChange={(inputEvent) => setEditOccurredAt(inputEvent.target.value)}
                  />
                </div>
                {isGift ? (
                  <fieldset className="space-y-2">
                    <legend className="font-sc text-xs font-medium text-ink-muted">礼物评分（可选）</legend>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button key={star} type="button" disabled={savingEdit} onClick={() => setEditGiftRating(editGiftRating === star ? null : star)} aria-label={`${star} 星`} aria-pressed={editGiftRating === star} className="grid h-11 w-11 place-items-center rounded-full text-peach-deep transition hover:bg-peach/18 focus-ring">
                          <Star className={`h-5 w-5 ${star <= (editGiftRating ?? 0) ? "fill-current" : ""}`} />
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                <fieldset className="space-y-2">
                  <legend className="font-sc text-xs font-medium text-ink-muted">可见方式</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(["public", "mutual_submit"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={savingEdit}
                        aria-pressed={editVisibility === mode}
                        className={cn(
                          "min-h-11 rounded-2xl px-3 font-sc text-sm transition focus-ring",
                          editVisibility === mode ? "bg-rose text-white" : "bg-peach/18 text-ink-soft hover:bg-peach/28",
                        )}
                        onClick={() => setEditVisibility(mode)}
                      >
                        {mode === "public" ? "公开" : "双方提交后"}
                      </button>
                    ))}
                  </div>
                </fieldset>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-line/55 pt-4">
                <button
                  type="button"
                  className="btn-ghost inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring"
                  disabled={savingEdit}
                  onClick={() => setEditing(false)}
                >
                  <X className="h-4 w-4" />
                  取消编辑
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 font-sc text-sm focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!editTitle.trim() || savingEdit}
                  onClick={() => void saveEventEdit()}
                >
                  {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  保存记录
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="mt-3 font-display text-2xl font-bold leading-snug text-ink sm:text-3xl">
                {event.title}
              </h1>
              {event.description && (
                <p className="mt-3 max-w-[70ch] whitespace-pre-wrap font-sc text-[15px] leading-relaxed text-ink-soft">
                  {event.description}
                </p>
              )}
              {isGift && event.gift_feelings.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2" aria-label="收到时的感受">
                  {event.gift_feelings.map((feeling) => {
                    const meta = giftFeelingMeta(feeling);
                    return (
                      <span key={feeling} className="inline-flex min-h-8 items-center rounded-full bg-surface/78 px-3 font-sc text-xs text-ink-soft">
                        {meta.emoji} {meta.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {isGift && event.gift_rating && (
                <div className="mt-4 flex items-center gap-1" aria-label={`${event.gift_rating} 星`}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className={`h-5 w-5 ${star <= event.gift_rating! ? "fill-peach-deep text-peach-deep" : "text-line"}`} aria-hidden="true" />
                  ))}
                </div>
              )}
            </>
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
          <div className="mt-4 flex items-start gap-3 rounded-2xl bg-peach/20 px-4 py-3 hairline">
            <Lock className="h-4 w-4 text-rose-deep mt-0.5" />
            <p className="font-sc text-xs text-ink-soft leading-relaxed">
              这是一条「双方提交后可见」的记录。等你们都写下一点，就会一起解开。
            </p>
          </div>
        )}

        {submission.unlocked && event.contents.comments.length + event.contents.images.length > 0 && (
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
                item.kind === "image-pending"
                  ? item.data.authorId
                  : item.data.author_id;
              const time =
                item.kind === "comment-pending" ||
                item.kind === "image-pending"
                  ? item.data.createdAt
                  : item.data.created_at;
              const author = lookupAuthor(authorId);
              const isMine = authorId === me.user.id;
              const itemKey =
                item.kind === "comment-pending" ||
                item.kind === "image-pending"
                  ? `pending-${item.data.pendingId}`
                  : `${item.kind}-${item.data.id}`;

              return (
                <motion.div
                  key={itemKey}
                  layout
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={
                    reducedMotion
                      ? MOTION_TRANSITIONS.reduced
                      : { ...MOTION_TRANSITIONS.state, delay: Math.min(idx, 6) * 0.02 }
                  }
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
      />

      <Lightbox url={lightbox} onClose={() => setLightbox(null)} />

      <MeetingEditorDialog open={meetingEditorOpen} session={event.meeting_session}
        onOpenChange={setMeetingEditorOpen} onSaved={async () => load()} onDeleted={async () => load()} />

      <ConfirmDialog
        open={confirmDelete}
        title="删除这条记录？"
        description="一旦删除，连带的评论和图片都会一并消失。要确认吗？"
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
  const reducedMotion = useReducedMotion();
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
              <motion.button
                key={reaction.reaction_type}
                type="button"
                onClick={() => toggleReaction(reaction.reaction_type)}
                disabled={!canReact}
                layout
                whileTap={reducedMotion || !canReact ? undefined : { scale: 0.96 }}
                transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
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
                <motion.span
                  animate={reaction.reacted_by_me && !reducedMotion ? { scale: [1, 1.14, 1] } : { scale: 1 }}
                  transition={MOTION_TRANSITIONS.state}
                >
                  <Icon className="h-3.5 w-3.5" />
                </motion.span>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={reaction.count}
                    initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
                  >
                    {reaction.count}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>
      )}

      <AnimatePresence initial={false}>
        {pickerOpen && canReact && (
          <motion.div
            className="fixed inset-0 z-50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="选择留言表情"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.overlay}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/30"
              aria-label="关闭表情选择"
              onClick={() => setPickerOpen(false)}
            />
            <motion.div
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              transition={reducedMotion ? MOTION_TRANSITIONS.reduced : { ...MOTION_TRANSITIONS.state, duration: 0.24 }}
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
  const reducedMotion = useReducedMotion();
  const Icon = reaction.Icon;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={reducedMotion ? undefined : { scale: 0.94 }}
      transition={reducedMotion ? MOTION_TRANSITIONS.reduced : MOTION_TRANSITIONS.fast}
      className={cn(
        "grid place-items-center rounded-full transition-colors focus-ring",
        large ? "h-14 w-14" : "h-9 w-9",
        selected ? "bg-rose text-white" : "bg-peach/24 text-ink-soft hover:bg-rose/12 hover:text-rose-deep",
      )}
      aria-label={reaction.label}
      aria-pressed={selected}
      title={reaction.label}
    >
      <motion.span
        animate={selected && !reducedMotion ? { scale: [1, 1.14, 1] } : { scale: 1 }}
        transition={MOTION_TRANSITIONS.state}
      >
        <Icon className={cn(large ? "h-6 w-6" : "h-4 w-4")} />
      </motion.span>
    </motion.button>
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
