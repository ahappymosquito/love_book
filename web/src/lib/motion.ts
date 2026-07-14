// Shared Love Book motion durations, easing, and Framer Motion transitions for restrained product feedback.

export const MOTION_DURATION = {
  press: 0.1,
  fast: 0.16,
  state: 0.22,
  layout: 0.28,
  emphasis: 0.36,
} as const;

export const MOTION_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const MOTION_TRANSITIONS = {
  press: { duration: MOTION_DURATION.press, ease: MOTION_EASE },
  fast: { duration: MOTION_DURATION.fast, ease: MOTION_EASE },
  state: { duration: MOTION_DURATION.state, ease: MOTION_EASE },
  layout: { duration: MOTION_DURATION.layout, ease: MOTION_EASE },
  emphasis: { duration: MOTION_DURATION.emphasis, ease: MOTION_EASE },
  overlay: { duration: MOTION_DURATION.fast, ease: MOTION_EASE },
  exit: { duration: MOTION_DURATION.fast, ease: MOTION_EASE },
  reduced: { duration: MOTION_DURATION.press, ease: "linear" as const },
} as const;
