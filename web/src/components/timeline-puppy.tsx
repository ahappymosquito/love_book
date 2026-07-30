"use client";

// Lightweight 2D Timeline mascot that plays bounded sprite actions and pauses outside the visible page.

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type PuppyAction = "idle" | "wave" | "curious" | "celebrate";

interface TimelinePuppyProps {
  className?: string;
  cue?: number;
  cueAction?: Exclude<PuppyAction, "idle">;
  label?: string;
}

const FRAME_X = ["0%", "20%", "40%", "60%", "80%", "100%"] as const;
const FRAME_Y: Record<PuppyAction, string> = {
  idle: "0%",
  wave: "33.3333%",
  curious: "66.6667%",
  celebrate: "100%",
};
const ACTION_TIMINGS: Record<PuppyAction, { durations: readonly number[]; loop: boolean }> = {
  idle: { durations: [420, 130, 130, 220, 180, 480], loop: true },
  wave: { durations: [150, 150, 150, 170, 180, 320], loop: false },
  curious: { durations: [180, 190, 180, 220, 190, 320], loop: false },
  celebrate: { durations: [140, 140, 160, 170, 190, 320], loop: false },
};

export function TimelinePuppy({
  className,
  cue = 0,
  cueAction = "curious",
  label = "和小狗打个招呼",
}: TimelinePuppyProps) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const lastCueRef = useRef(cue);
  const greetingCountRef = useRef(0);
  const [action, setAction] = useState<PuppyAction>("idle");
  const [frame, setFrame] = useState(0);
  const [inViewport, setInViewport] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  const play = useCallback((nextAction: Exclude<PuppyAction, "idle">) => {
    setAction(nextAction);
    setFrame(0);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(entry.isIntersecting),
      { rootMargin: "80px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (lastCueRef.current === cue) return;
    lastCueRef.current = cue;
    if (!reducedMotion) play(cueAction);
  }, [cue, cueAction, play, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) {
      if (action !== "idle") setAction("idle");
      if (frame !== 0) setFrame(0);
      return;
    }
    if (!inViewport || !pageVisible) return;

    const timing = ACTION_TIMINGS[action];
    const timer = window.setTimeout(() => {
      if (frame < timing.durations.length - 1) {
        setFrame((value) => value + 1);
      } else if (timing.loop) {
        setFrame(0);
      } else {
        setAction("idle");
        setFrame(0);
      }
    }, timing.durations[frame]);

    return () => window.clearTimeout(timer);
  }, [action, frame, inViewport, pageVisible, reducedMotion]);

  const displayedAction = reducedMotion ? "idle" : action;
  const displayedFrame = reducedMotion ? 0 : frame;

  return (
    <button
      ref={rootRef}
      type="button"
      className={cn("timeline-puppy-button focus-ring", className)}
      onClick={() => {
        if (reducedMotion) return;
        const nextAction = greetingCountRef.current % 2 === 0 ? "wave" : "celebrate";
        greetingCountRef.current += 1;
        play(nextAction);
      }}
      aria-label={label}
    >
      <span
        className="timeline-puppy-frame"
        style={{
          backgroundPosition: `${FRAME_X[displayedFrame]} ${FRAME_Y[displayedAction]}`,
        }}
        aria-hidden="true"
      />
    </button>
  );
}
