"use client";

// Code-drawn SVG gift box with five wrapping papers (rose dots, peach gingham, sage leaves, cream stripes, starry night), ribbon and bow; supports wrapped/opening/open stages for the timeline card, wrap-form preview, and unwrap choreography, animating only transform and opacity.

import { useId } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { GiftWrapStyle } from "@/lib/types";

export type GiftBoxStage = "wrapped" | "untying" | "lid-off" | "open";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function PaperPattern({ id, wrapStyle }: { id: string; wrapStyle: GiftWrapStyle }) {
  const motif = { fill: "var(--gift-motif)" };
  if (wrapStyle === "rose") {
    return (
      <pattern id={id} width="14" height="14" patternUnits="userSpaceOnUse">
        <rect width="14" height="14" style={{ fill: "var(--gift-paper)" }} />
        <circle cx="3.5" cy="3.5" r="1.8" style={motif} />
        <circle cx="10.5" cy="10.5" r="1.8" style={motif} />
      </pattern>
    );
  }
  if (wrapStyle === "peach") {
    return (
      <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" style={{ fill: "var(--gift-paper)" }} />
        <rect width="8" height="16" style={{ ...motif, opacity: 0.45 }} />
        <rect width="16" height="8" style={{ ...motif, opacity: 0.45 }} />
      </pattern>
    );
  }
  if (wrapStyle === "sage") {
    return (
      <pattern id={id} width="18" height="18" patternUnits="userSpaceOnUse">
        <rect width="18" height="18" style={{ fill: "var(--gift-paper)" }} />
        <ellipse cx="5" cy="5" rx="3.6" ry="1.6" transform="rotate(-35 5 5)" style={motif} />
        <ellipse cx="13" cy="13" rx="3.6" ry="1.6" transform="rotate(35 13 13)" style={motif} />
      </pattern>
    );
  }
  if (wrapStyle === "cream") {
    return (
      <pattern id={id} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="12" height="12" style={{ fill: "var(--gift-paper)" }} />
        <rect width="4" height="12" style={motif} />
      </pattern>
    );
  }
  return (
    <pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse">
      <rect width="24" height="24" style={{ fill: "var(--gift-paper)" }} />
      <path d="m6 3 1 2.3 2.4.3-1.8 1.6.5 2.4L6 8.4 3.9 9.6l.5-2.4L2.6 5.6 5 5.3Z" style={motif} />
      <circle cx="17" cy="15" r="1" style={motif} />
      <circle cx="20" cy="5" r="0.7" style={motif} />
      <circle cx="9" cy="19" r="0.8" style={motif} />
    </pattern>
  );
}

export function GiftBoxArt({
  wrapStyle,
  stage = "wrapped",
  idle = false,
  reducedMotion = false,
  className,
  inside,
  label,
}: {
  wrapStyle: GiftWrapStyle;
  stage?: GiftBoxStage;
  idle?: boolean;
  reducedMotion?: boolean | null;
  className?: string;
  inside?: ReactNode;
  label?: string;
}) {
  const rawId = useId();
  const patternId = `gift-paper-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paperFill = `url(#${patternId})`;
  const instant = { duration: 0 };
  const bowGone = stage !== "wrapped";
  const lidOff = stage === "lid-off" || stage === "open";
  const ribbon = { fill: "var(--gift-ribbon)" };
  const ribbonShade = { fill: "var(--gift-ribbon-shade)" };

  return (
    <div
      className={cn("gift-box-art", `gift-paper-${wrapStyle}`, idle && !reducedMotion && stage === "wrapped" && "gift-box-idle", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 160 160" className="block h-full w-full overflow-visible">
        <defs>
          <PaperPattern id={patternId} wrapStyle={wrapStyle} />
        </defs>

        <ellipse cx="80" cy="150" rx="58" ry="6" style={{ fill: "var(--gift-shadow)" }} />

        {inside && lidOff ? <g>{inside}</g> : null}

        <rect x="22" y="72" width="116" height="74" rx="7" style={{ fill: paperFill }} />
        <rect x="22" y="72" width="116" height="10" style={{ fill: "var(--gift-shadow)" }} opacity="0.55" />
        <rect x="72" y="72" width="16" height="74" style={ribbon} />
        <rect x="22" y="72" width="116" height="74" rx="7" fill="none" style={{ stroke: "var(--gift-edge)" }} strokeWidth="1.5" />

        <motion.g
          initial={false}
          animate={
            lidOff
              ? reducedMotion
                ? { opacity: 0 }
                : { x: 34, y: -48, rotate: 16, opacity: 1 }
              : { x: 0, y: 0, rotate: 0, opacity: 1 }
          }
          transition={reducedMotion ? instant : { duration: 0.42, ease: EASE }}
          style={{ transformOrigin: "80px 64px", transformBox: "view-box" }}
        >
          <rect x="14" y="52" width="132" height="24" rx="6" style={{ fill: paperFill }} />
          <rect x="72" y="52" width="16" height="24" style={ribbon} />
          <rect x="14" y="52" width="132" height="24" rx="6" fill="none" style={{ stroke: "var(--gift-edge)" }} strokeWidth="1.5" />
        </motion.g>

        <motion.g
          initial={false}
          animate={bowGone ? (reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: -10 }) : { opacity: 1, scale: 1, y: 0 }}
          transition={reducedMotion ? instant : { duration: 0.34, ease: EASE }}
          style={{ transformOrigin: "80px 50px", transformBox: "view-box" }}
        >
          <path d="M80 50 C64 30 44 30 46 44 C48 56 66 54 80 50Z" style={ribbon} />
          <path d="M80 50 C96 30 116 30 114 44 C112 56 94 54 80 50Z" style={ribbon} />
          <path d="M80 50 C70 42 58 40 56 45" fill="none" style={{ stroke: "var(--gift-ribbon-shade)" }} strokeWidth="1.4" />
          <path d="M80 50 C90 42 102 40 104 45" fill="none" style={{ stroke: "var(--gift-ribbon-shade)" }} strokeWidth="1.4" />
          <path d="M76 52 L66 70 L72 68 L74 74 Z" style={ribbonShade} />
          <path d="M84 52 L94 70 L88 68 L86 74 Z" style={ribbonShade} />
          <circle cx="80" cy="50" r="6.5" style={ribbonShade} />
        </motion.g>
      </svg>
    </div>
  );
}

export function GiftCardPeek() {
  return (
    <>
      <rect x="40" y="40" width="80" height="48" rx="4" style={{ fill: "var(--gift-card)" }} />
      <path d="M80 70c-6-4.2-10-8-10-12.4a5 5 0 0 1 10-1.6 5 5 0 0 1 10 1.6c0 4.4-4 8.2-10 12.4Z" style={{ fill: "var(--gift-ribbon)" }} />
    </>
  );
}
