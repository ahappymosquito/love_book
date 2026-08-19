"use client";

// 全视口「花田拾光」画布：光景染色、拾光物、连击飘字、小心心与结算，并保持分侧触控与登录浮层暂停。

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleHelp, Expand, Pause, Play, RotateCcw, X } from "lucide-react";
import {
  RUNNER_CHAPTER_LABELS,
  RUNNER_MAX_LIVES,
  RUNNER_STARTING_LIVES,
  RUNNER_STEP,
  createRunnerMetrics,
  createRunnerState,
  jumpRunner,
  pauseRunner,
  releaseRunnerJump,
  runnerPointerAction,
  setRunnerCrouch,
  startRunner,
  stepRunner,
  type RunnerChapterId,
  type RunnerMetrics,
  type RunnerObstacleKind,
  type RunnerPickup,
  type RunnerState,
  type RunnerStatus,
} from "@/lib/xiaohua-runner";

const ASSET_PATHS = {
  dog: "/game/xiaohua-runner-atlas.webp",
  far: "/game/runner-scene-far.webp",
  mid: "/game/runner-scene-mid.webp",
  ground: "/game/runner-scene-ground.webp",
  obstacles: "/game/runner-obstacles.webp",
  bird: "/game/runner-bird.webp",
} as const;
const ACTION_ROW = { idle: 0, run: 1, jump: 2, crouch: 3, stumble: 4, celebrate: 5 } as const;
const ACTION_FRAMES = { idle: 4, run: 8, jump: 8, crouch: 6, stumble: 6, celebrate: 6 } as const;
const OBSTACLE_COLUMN: Record<Exclude<RunnerObstacleKind, "bird">, number> = { rock: 0, stump: 1, log: 2, bramble: 3 };
const OBSTACLE_SOURCE: Record<Exclude<RunnerObstacleKind, "bird">, { x: number; y: number; width: number; height: number }> = {
  rock: { x: 5, y: 90, width: 246, height: 156 },
  stump: { x: 18, y: 38, width: 220, height: 208 },
  log: { x: 5, y: 151, width: 246, height: 95 },
  bramble: { x: 8, y: 110, width: 240, height: 136 },
};
const BIRD_SOURCE = [
  { x: 12, y: 59, width: 167, height: 73 },
  { x: 8, y: 60, width: 176, height: 71 },
  { x: 9, y: 60, width: 173, height: 71 },
  { x: 48, y: 51, width: 96, height: 89 },
  { x: 8, y: 55, width: 175, height: 81 },
  { x: 9, y: 60, width: 174, height: 72 },
] as const;
const CHAPTER_SKY: Record<RunnerChapterId, string> = {
  dawn: "#f0b48a",
  noon: "#67cbea",
  dusk: "#d57a58",
  night: "#1a2238",
};

type RunnerAssets = Record<keyof typeof ASSET_PATHS, HTMLImageElement>;
type AssetStatus = "loading" | "ready" | "error";

export interface XiaohuaRunnerProps {
  leaderboardBest?: number | null;
  pauseRequested?: boolean;
  interactionBlocked?: boolean;
  celebrating?: boolean;
  onStart?: () => void;
  onGameOver?: (score: number) => void;
}

function snap(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

function drawLoopingLayer(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  metrics: RunnerMetrics,
  distancePixels: number,
) {
  const tileHeight = metrics.frame.height;
  const tileWidth = Math.round(tileHeight * (image.naturalWidth / image.naturalHeight));
  const offset = Math.round(((distancePixels % tileWidth) + tileWidth) % tileWidth);
  let index = -1;
  for (let x = metrics.frame.x - offset; x < metrics.frame.x + metrics.frame.width + tileWidth; x += tileWidth) {
    context.save();
    if (index % 2 !== 0) {
      context.translate(x * 2 + tileWidth, 0);
      context.scale(-1, 1);
    }
    context.drawImage(image, x, metrics.frame.y, tileWidth, tileHeight);
    context.restore();
    index += 1;
  }
}

function drawCelestial(context: CanvasRenderingContext2D, metrics: RunnerMetrics, chapter: RunnerChapterId, time: number) {
  const { x, y, width, height } = metrics.frame;
  const cx = x + width * (chapter === "dawn" ? 0.18 : chapter === "dusk" ? 0.82 : 0.78);
  const cy = y + height * (chapter === "dusk" ? 0.22 : chapter === "night" ? 0.16 : 0.14);
  const radius = Math.max(16, height * (chapter === "night" ? 0.035 : 0.048));
  context.save();
  if (chapter === "night") {
    context.fillStyle = "rgba(248, 236, 210, 0.94)";
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = chapter === "night" ? "#1a2238" : "#243056";
    context.beginPath();
    context.arc(cx + radius * 0.38, cy - radius * 0.18, radius * 0.82, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255, 248, 230, 0.55)";
    for (let index = 0; index < 28; index += 1) {
      const px = x + ((index * 97 + 13) % 1000) / 1000 * width;
      const py = y + ((index * 53 + 29) % 420) / 1000 * height * 0.42;
      const twinkle = 0.35 + (Math.sin(time * 1.6 + index) + 1) * 0.25;
      context.globalAlpha = twinkle;
      context.fillRect(Math.round(px), Math.round(py), 2, 2);
    }
  } else {
    context.fillStyle = chapter === "dusk" ? "rgba(255, 168, 92, 0.92)" : chapter === "dawn" ? "rgba(255, 196, 132, 0.88)" : "rgba(255, 236, 170, 0.55)";
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawChapterAtmosphere(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  chapter: RunnerChapterId,
  time: number,
  reducedMotion: boolean,
) {
  const { x, y, width, height } = metrics.frame;
  context.save();
  if (chapter !== "noon") {
    const sky = context.createLinearGradient(0, y, 0, y + height * 0.46);
    if (chapter === "dawn") {
      sky.addColorStop(0, "rgba(255, 186, 142, 0.42)");
      sky.addColorStop(1, "rgba(255, 186, 142, 0)");
    } else if (chapter === "dusk") {
      sky.addColorStop(0, "rgba(232, 108, 74, 0.46)");
      sky.addColorStop(1, "rgba(232, 108, 74, 0)");
    } else {
      sky.addColorStop(0, "rgba(18, 26, 52, 0.78)");
      sky.addColorStop(0.72, "rgba(18, 26, 52, 0.28)");
      sky.addColorStop(1, "rgba(18, 26, 52, 0)");
    }
    context.fillStyle = sky;
    context.fillRect(x, y, width, height * 0.5);
  }
  context.globalCompositeOperation = "multiply";
  context.fillStyle = chapter === "dawn"
    ? "rgba(255, 214, 176, 0.22)"
    : chapter === "dusk"
      ? "rgba(255, 146, 96, 0.28)"
      : chapter === "night"
        ? "rgba(92, 108, 168, 0.38)"
        : "rgba(255, 255, 255, 0)";
  if (chapter !== "noon") context.fillRect(x, y, width, height);
  context.globalCompositeOperation = "source-over";
  drawCelestial(context, metrics, chapter, time);
  if (chapter === "night" && !reducedMotion) {
    context.fillStyle = "rgba(255, 226, 150, 0.7)";
    for (let index = 0; index < 7; index += 1) {
      const px = x + ((index * 140 + time * 18) % width);
      const py = y + height * 0.52 + Math.sin(time * 2 + index) * 10;
      context.globalAlpha = 0.35 + (Math.sin(time * 3 + index) + 1) * 0.2;
      context.fillRect(Math.round(px), Math.round(py), 2, 2);
    }
  }
  context.restore();
}

function drawPixelFlower(context: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  const petal = size * 0.28;
  context.fillStyle = color;
  for (const [dx, dy] of [[-petal, 0], [petal, 0], [0, -petal], [0, petal]]) {
    context.beginPath();
    context.ellipse(cx + dx, cy + dy, petal * 0.72, petal * 0.52, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = "#f4d27a";
  context.beginPath();
  context.arc(cx, cy, petal * 0.42, 0, Math.PI * 2);
  context.fill();
}

function drawPixelHeart(context: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  context.fillStyle = "#e07080";
  context.beginPath();
  const w = size * 0.5;
  const h = size * 0.46;
  context.moveTo(cx, cy + h * 0.55);
  context.bezierCurveTo(cx - w, cy + h * 0.08, cx - w * 0.85, cy - h * 0.62, cx, cy - h * 0.18);
  context.bezierCurveTo(cx + w * 0.85, cy - h * 0.62, cx + w, cy + h * 0.08, cx, cy + h * 0.55);
  context.fill();
}

function drawPixelLetter(context: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const w = size * 0.72;
  const h = size * 0.5;
  context.fillStyle = "#f7efe2";
  context.fillRect(cx - w / 2, cy - h / 2, w, h);
  context.strokeStyle = "#c9896a";
  context.lineWidth = Math.max(1.5, size * 0.06);
  context.strokeRect(cx - w / 2, cy - h / 2, w, h);
  context.beginPath();
  context.moveTo(cx - w / 2, cy - h / 2);
  context.lineTo(cx, cy);
  context.lineTo(cx + w / 2, cy - h / 2);
  context.stroke();
}

function drawPickup(
  context: CanvasRenderingContext2D,
  pickup: RunnerPickup,
  metrics: RunnerMetrics,
  time: number,
  dpr: number,
  reducedMotion: boolean,
) {
  const width = pickup.width * metrics.bodyUnit;
  const height = pickup.height * metrics.standingHeight;
  const x = snap(metrics.frame.x + pickup.x * metrics.bodyUnit, dpr);
  const bob = reducedMotion ? 0 : Math.sin(time * 4 + pickup.id) * Math.max(2, height * 0.08);
  const y = snap(metrics.groundBaseline - (pickup.bottom + pickup.height) * metrics.standingHeight - bob, dpr);
  const cx = x + width / 2;
  const cy = y + height / 2;
  context.save();
  context.fillStyle = pickup.kind === "heart" ? "rgba(224, 112, 128, 0.22)" : pickup.kind === "letter" ? "rgba(244, 210, 122, 0.22)" : "rgba(255, 176, 168, 0.2)";
  context.beginPath();
  context.ellipse(cx, metrics.groundBaseline + 3, width * 0.28, 3, 0, 0, Math.PI * 2);
  context.fill();
  if (pickup.kind === "heart") drawPixelHeart(context, cx, cy, height);
  else if (pickup.kind === "letter") drawPixelLetter(context, cx, cy, height);
  else drawPixelFlower(context, cx, cy, height, "#f2a3a0");
  context.restore();
}

function drawPopups(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  metrics: RunnerMetrics,
  dpr: number,
) {
  context.save();
  context.font = `700 ${Math.max(12, metrics.standingHeight * 0.13)}px ui-monospace, monospace`;
  context.textAlign = "center";
  for (const popup of state.popups) {
    const alpha = Math.max(0, 1 - popup.age / 0.7);
    context.globalAlpha = alpha;
    context.fillStyle = "#fff7ef";
    context.strokeStyle = "rgba(32, 24, 22, 0.45)";
    context.lineWidth = 3;
    const x = snap(metrics.frame.x + popup.x * metrics.bodyUnit, dpr);
    const y = snap(metrics.groundBaseline - popup.y * metrics.standingHeight, dpr);
    context.strokeText(popup.text, x, y);
    context.fillText(popup.text, x, y);
  }
  context.restore();
}

function drawLandingDust(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  metrics: RunnerMetrics,
  dpr: number,
) {
  if (state.landDust <= 0) return;
  const strength = state.landDust / 0.28;
  const x = snap(metrics.playerScreenX + metrics.bodyUnit * 0.28, dpr);
  context.save();
  context.fillStyle = `rgba(92, 74, 48, ${0.22 * strength})`;
  context.beginPath();
  context.ellipse(x, metrics.groundBaseline + 2, metrics.bodyUnit * 0.28 * (1.4 - strength), 4 * strength + 2, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawAmbientPetals(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  time: number,
  chapter: RunnerChapterId,
) {
  context.save();
  const count = chapter === "night" ? 5 : 8;
  for (let index = 0; index < count; index += 1) {
    const drift = (time * (10 + index) + index * 80) % (metrics.frame.width + 40);
    const x = metrics.frame.x + drift - 20;
    const y = metrics.frame.y + ((index * 97) % 100) / 100 * metrics.frame.height * 0.48 + Math.sin(time + index) * 8;
    context.globalAlpha = 0.35;
    drawPixelFlower(context, x, y, 10 + (index % 3) * 2, index % 2 === 0 ? "#f2b3ae" : "#f7d7a6");
  }
  context.restore();
}

function drawObstacle(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  obstacle: RunnerState["obstacles"][number],
  metrics: RunnerMetrics,
  assets: RunnerAssets,
  dpr: number,
) {
  const x = snap(metrics.frame.x + obstacle.x * metrics.bodyUnit, dpr);
  const drawOutlined = (
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => {
    const outline = Math.max(1.5, metrics.standingHeight * 0.014);
    context.save();
    context.globalAlpha = 0.62;
    context.filter = "brightness(0) saturate(100%)";
    for (const [offsetX, offsetY] of [[-outline, 0], [outline, 0], [0, -outline], [0, outline]] as const) {
      context.drawImage(image, sx, sy, sw, sh, dx + offsetX, dy + offsetY, dw, dh);
    }
    context.restore();
    context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  };
  if (obstacle.kind === "bird") {
    const frame = Math.floor(state.elapsed * 10) % 6;
    const source = BIRD_SOURCE[frame];
    const width = metrics.bodyUnit * obstacle.width;
    const height = metrics.standingHeight * obstacle.height;
    const bottom = metrics.groundBaseline - obstacle.bottom * metrics.standingHeight;
    drawOutlined(assets.bird, frame * 192 + source.x, source.y, source.width, source.height, x, snap(bottom - height, dpr), width, height);
    return;
  }
  const source = OBSTACLE_SOURCE[obstacle.kind];
  const width = obstacle.width * metrics.bodyUnit;
  const height = obstacle.height * metrics.standingHeight;
  context.save();
  context.fillStyle = "rgba(21, 48, 24, 0.34)";
  context.beginPath();
  context.ellipse(x + width / 2, metrics.groundBaseline + Math.max(2, height * 0.025), width * 0.46, Math.max(3, height * 0.055), 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
  drawOutlined(
    assets.obstacles,
    OBSTACLE_COLUMN[obstacle.kind] * 256 + source.x,
    source.y,
    source.width,
    source.height,
    x,
    snap(metrics.groundBaseline - height, dpr),
    width,
    height,
  );
}

function drawScene(
  context: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  state: RunnerState,
  metrics: RunnerMetrics,
  assets: RunnerAssets,
  reducedMotion: boolean,
  celebrating: boolean,
  renderTime: number,
  dpr: number,
) {
  context.clearRect(0, 0, viewportWidth, viewportHeight);
  context.save();
  context.beginPath();
  context.rect(metrics.frame.x, metrics.frame.y, metrics.frame.width, metrics.frame.height);
  context.clip();
  if (!reducedMotion && state.shake > 0) {
    const magnitude = state.shake * 10;
    context.translate(Math.sin(renderTime * 70) * magnitude, Math.cos(renderTime * 63) * magnitude * 0.6);
  }
  context.imageSmoothingEnabled = false;
  drawLoopingLayer(context, assets.far, metrics, state.distance * metrics.bodyUnit * 0.035);
  drawLoopingLayer(context, assets.mid, metrics, state.distance * metrics.bodyUnit * 0.16);
  drawLoopingLayer(context, assets.ground, metrics, state.distance * metrics.bodyUnit * 0.78);
  drawChapterAtmosphere(context, metrics, state.chapter, renderTime, reducedMotion);
  if (state.status === "idle" && !reducedMotion) drawAmbientPetals(context, metrics, renderTime, state.chapter);
  for (const pickup of state.pickups) drawPickup(context, pickup, metrics, renderTime, dpr, reducedMotion);
  for (const obstacle of state.obstacles) drawObstacle(context, state, obstacle, metrics, assets, dpr);
  drawLandingDust(context, state, metrics, dpr);

  const action: keyof typeof ACTION_ROW = state.status === "gameover"
    ? (celebrating ? "celebrate" : "stumble")
    : state.y > 0.001
      ? "jump"
      : state.crouching
        ? "crouch"
        : state.status === "playing"
          ? "run"
          : "idle";
  const actionTime = action === "celebrate" ? renderTime : state.elapsed;
  const frame = reducedMotion && (action === "idle" || action === "celebrate")
    ? 0
    : Math.floor(actionTime * (action === "run" ? 11 : 8)) % ACTION_FRAMES[action];
  const squash = !reducedMotion && state.landDust > 0.12 && action !== "jump" ? 0.9 : 1;
  const spriteHeight = metrics.spriteSize * squash;
  const dogX = snap(metrics.playerScreenX - metrics.bodyUnit * 0.08, dpr);
  const dogY = snap(
    metrics.groundBaseline - spriteHeight - state.y * metrics.standingHeight + metrics.spriteSize * (8 / 192),
    dpr,
  );
  const hiddenByIframes = state.invincibleFor > 0 && !reducedMotion && Math.floor(state.elapsed * 16) % 2 === 0;
  if (!hiddenByIframes) {
    context.drawImage(
      assets.dog,
      frame * 192,
      ACTION_ROW[action] * 192,
      192,
      192,
      dogX,
      dogY,
      metrics.spriteSize,
      spriteHeight,
    );
  }
  drawPopups(context, state, metrics, dpr);
  context.restore();
}

function HeartPips({ lives }: { lives: number }) {
  return (
    <span className="runner-hearts" aria-label={`还剩 ${lives} 颗小心心`}>
      {Array.from({ length: RUNNER_MAX_LIVES }, (_, index) => (
        <span key={index} data-filled={index < lives ? "true" : "false"}>♥</span>
      ))}
    </span>
  );
}

export function XiaohuaRunner({ leaderboardBest, pauseRequested = false, interactionBlocked = false, celebrating = false, onStart, onGameOver }: XiaohuaRunnerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(createRunnerState());
  const assetsRef = useRef<RunnerAssets | null>(null);
  const gameOverScoreRef = useRef<number | null>(null);
  const pausedByPanelRef = useRef(false);
  const lastChapterRef = useRef<RunnerChapterId>("dawn");
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [lives, setLives] = useState(RUNNER_STARTING_LIVES);
  const [petals, setPetals] = useState(0);
  const [chapter, setChapter] = useState<RunnerChapterId>("dawn");
  const [chapterToast, setChapterToast] = useState<string | null>(null);
  const [crouching, setCrouching] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [assetStatus, setAssetStatus] = useState<AssetStatus>("loading");
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [metrics, setMetrics] = useState<RunnerMetrics | null>(null);
  const [showHint, setShowHint] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const touchCrouchPointerRef = useRef<number | null>(null);
  const inputBlocked = interactionBlocked || helpOpen;

  const syncUi = useCallback((state: RunnerState) => {
    setStatus((value) => (value === state.status ? value : state.status));
    setScore((value) => (value === state.score ? value : state.score));
    setCombo((value) => (value === state.combo ? value : state.combo));
    setMaxCombo((value) => (value === state.maxCombo ? value : state.maxCombo));
    setLives((value) => (value === state.lives ? value : state.lives));
    setPetals((value) => (value === state.petals ? value : state.petals));
    setCrouching((value) => (value === state.crouching ? value : state.crouching));
    setChapter((value) => (value === state.chapter ? value : state.chapter));
    if (state.status === "playing" && state.chapter !== lastChapterRef.current) {
      lastChapterRef.current = state.chapter;
      if (state.chapter !== "dawn") setChapterToast(RUNNER_CHAPTER_LABELS[state.chapter]);
    }
    if (state.status === "idle" || state.status === "gameover") lastChapterRef.current = state.chapter;
  }, []);

  const play = useCallback(() => {
    if (assetStatus !== "ready" || inputBlocked) return;
    const wasNewRun = stateRef.current.status === "idle" || stateRef.current.status === "gameover";
    stateRef.current = startRunner(stateRef.current);
    gameOverScoreRef.current = null;
    if (wasNewRun) {
      lastChapterRef.current = "dawn";
      setChapterToast(null);
      setShowHint(true);
      onStart?.();
    }
    syncUi(stateRef.current);
  }, [assetStatus, inputBlocked, onStart, syncUi]);

  const jump = useCallback(() => {
    if (assetStatus !== "ready" || inputBlocked || stateRef.current.status === "gameover") return;
    const wasNewRun = stateRef.current.status === "idle";
    if (wasNewRun) {
      stateRef.current = startRunner(stateRef.current);
      gameOverScoreRef.current = null;
      lastChapterRef.current = "dawn";
      setChapterToast(null);
      onStart?.();
    }
    stateRef.current = jumpRunner(stateRef.current);
    syncUi(stateRef.current);
  }, [assetStatus, inputBlocked, onStart, syncUi]);

  const releaseJump = useCallback(() => {
    stateRef.current = releaseRunnerJump(stateRef.current);
  }, []);

  const crouch = useCallback((held: boolean) => {
    if (assetStatus !== "ready") return;
    if (!held) {
      stateRef.current = setRunnerCrouch(stateRef.current, false);
      syncUi(stateRef.current);
      return;
    }
    if (inputBlocked || stateRef.current.status === "gameover") return;
    if (stateRef.current.status === "idle") {
      stateRef.current = startRunner(stateRef.current);
      gameOverScoreRef.current = null;
      lastChapterRef.current = "dawn";
      setChapterToast(null);
      onStart?.();
    }
    stateRef.current = setRunnerCrouch(stateRef.current, held);
    syncUi(stateRef.current);
  }, [assetStatus, inputBlocked, onStart, syncUi]);

  const markOperated = useCallback(() => setShowHint(false), []);

  useEffect(() => {
    if (status !== "playing" || !showHint) return;
    const timeout = window.setTimeout(() => setShowHint(false), 3_500);
    return () => window.clearTimeout(timeout);
  }, [showHint, status]);

  useEffect(() => {
    if (!chapterToast) return;
    const timeout = window.setTimeout(() => setChapterToast(null), 2_200);
    return () => window.clearTimeout(timeout);
  }, [chapterToast]);

  const applyOverlayBlock = useCallback((blocked: boolean) => {
    if (blocked) {
      if (stateRef.current.status === "playing") {
        pausedByPanelRef.current = true;
        stateRef.current = pauseRunner(stateRef.current);
        syncUi(stateRef.current);
      }
      return;
    }
    if (pausedByPanelRef.current && stateRef.current.status === "paused") {
      pausedByPanelRef.current = false;
      stateRef.current = startRunner(stateRef.current);
      syncUi(stateRef.current);
    }
  }, [syncUi]);

  const setHelp = useCallback((open: boolean) => {
    setHelpOpen(open);
    applyOverlayBlock(open || pauseRequested);
  }, [applyOverlayBlock, pauseRequested]);

  useEffect(() => {
    applyOverlayBlock(pauseRequested || helpOpen);
  }, [applyOverlayBlock, helpOpen, pauseRequested]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAssetStatus("loading");
    Promise.all(Object.entries(ASSET_PATHS).map(([key, source]) => new Promise<[keyof RunnerAssets, HTMLImageElement]>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([key as keyof RunnerAssets, image]);
      image.onerror = reject;
      image.src = `${source}?v=3`;
    }))).then((entries) => {
      if (cancelled) return;
      assetsRef.current = Object.fromEntries(entries) as RunnerAssets;
      setAssetStatus("ready");
    }).catch(() => {
      if (!cancelled) setAssetStatus("error");
    });
    return () => {
      cancelled = true;
      assetsRef.current = null;
    };
  }, [assetAttempt]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => {
      const rect = shell.getBoundingClientRect();
      setMetrics(createRunnerMetrics({ width: rect.width, height: rect.height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stateRef.current = pauseRunner(stateRef.current);
        syncUi(stateRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [syncUi]);

  useEffect(() => {
    const ignoresGameKeys = (target: EventTarget | null) => (target as HTMLElement | null)?.closest("input, textarea");
    const onKeyDown = (event: KeyboardEvent) => {
      if (inputBlocked || ignoresGameKeys(event.target)) return;
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        if (!event.repeat) {
          markOperated();
          jump();
        }
      } else if (event.code === "ArrowDown" || event.code === "KeyS") {
        event.preventDefault();
        markOperated();
        crouch(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ArrowDown" || event.code === "KeyS") crouch(false);
      if (event.code === "Space" || event.code === "ArrowUp") releaseJump();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [crouch, inputBlocked, jump, markOperated, releaseJump]);

  useEffect(() => {
    const releaseRightMouse = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button === 2) crouch(false);
      if (event.pointerType === "mouse" && event.button === 0) releaseJump();
    };
    const releaseAll = () => {
      crouch(false);
      releaseJump();
    };
    window.addEventListener("pointerup", releaseRightMouse);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("pointerup", releaseRightMouse);
      window.removeEventListener("blur", releaseAll);
    };
  }, [crouch, releaseJump]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    const render = (now: number) => {
      const canvas = canvasRef.current;
      const shell = shellRef.current;
      const assets = assetsRef.current;
      if (canvas && shell && assets) {
        const rect = shell.getBoundingClientRect();
        const currentMetrics = createRunnerMetrics({ width: rect.width, height: rect.height });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
        const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
          canvas.width = nextWidth;
          canvas.height = nextHeight;
        }
        const delta = Math.min(0.1, (now - previous) / 1000);
        previous = now;
        accumulator += delta;
        while (accumulator >= RUNNER_STEP) {
          stateRef.current = stepRunner(stateRef.current, RUNNER_STEP, currentMetrics.worldWidth);
          accumulator -= RUNNER_STEP;
        }
        const context = canvas.getContext("2d");
        if (context) {
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawScene(context, rect.width, rect.height, stateRef.current, currentMetrics, assets, reducedMotion, celebrating, now / 1000, dpr);
        }
        syncUi(stateRef.current);
        if (stateRef.current.status === "gameover" && gameOverScoreRef.current !== stateRef.current.score) {
          gameOverScoreRef.current = stateRef.current.score;
          onGameOver?.(stateRef.current.score);
        }
      } else {
        previous = now;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [celebrating, onGameOver, reducedMotion, syncUi]);

  async function enterLandscape() {
    try {
      await shellRef.current?.requestFullscreen?.();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (value: "landscape") => Promise<void> };
      await orientation.lock?.("landscape");
    } catch {
      // Fullscreen and orientation lock are progressive enhancements.
    }
  }

  const interactionStyle = metrics ? {
    top: metrics.frame.y,
    left: metrics.frame.x,
    width: metrics.frame.width,
    height: metrics.frame.height,
  } : undefined;

  return (
    <div
      ref={shellRef}
      className="runner-stage"
      data-runner-status={status}
      data-chapter={chapter}
      data-crouching={crouching ? "true" : "false"}
      data-assets={assetStatus}
      data-interaction-blocked={inputBlocked ? "true" : "false"}
      data-pointer={coarsePointer ? "coarse" : "fine"}
      style={{ background: CHAPTER_SKY[chapter] }}
    >
      <canvas ref={canvasRef} className="runner-canvas" role="img" aria-label="小花在花田里拾光，电脑左键或上方向键跳跃、按住可跳得更高，右键或下方向键按住趴下，手机左侧按住趴下、右侧点按跳跃" />
      {metrics && assetStatus === "ready" && !inputBlocked && status !== "gameover" ? (
        <div
          className="runner-interaction-surface"
          style={interactionStyle}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            event.preventDefault();
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Synthetic or cancelled pointers can disappear before capture; window-level release still resets crouch.
            }
            const action = runnerPointerAction({
              pointerType: event.pointerType,
              button: event.button,
              clientX: event.clientX,
              bounds: event.currentTarget.getBoundingClientRect(),
            });
            if (!action) return;
            markOperated();
            if (action === "jump") jump();
            else {
              if (event.pointerType !== "mouse") touchCrouchPointerRef.current = event.pointerId;
              crouch(true);
            }
          }}
          onPointerUp={(event) => {
            if (event.pointerType === "mouse") {
              if (event.button === 2) crouch(false);
              if (event.button === 0) releaseJump();
              return;
            }
            if (touchCrouchPointerRef.current === event.pointerId) {
              touchCrouchPointerRef.current = null;
              crouch(false);
            }
          }}
          onPointerCancel={(event) => {
            if (touchCrouchPointerRef.current === event.pointerId) {
              touchCrouchPointerRef.current = null;
              crouch(false);
            }
          }}
          onLostPointerCapture={(event) => {
            if (touchCrouchPointerRef.current === event.pointerId) {
              touchCrouchPointerRef.current = null;
              crouch(false);
            }
          }}
          aria-hidden="true"
        />
      ) : null}
      {assetStatus === "loading" ? <div className="runner-asset-status">正在铺开花田…</div> : null}
      {assetStatus === "error" ? (
        <div className="runner-asset-status">
          <span>花田还没铺好</span>
          <button type="button" className="runner-play-button focus-ring" onClick={() => setAssetAttempt((value) => value + 1)}>重新加载</button>
        </div>
      ) : null}
      {status === "playing" && showHint ? <p className="runner-input-hint">{coarsePointer ? "左侧按住趴下 · 右侧点按跳跃" : "按住跳跃会更高 · 右键 / ↓ 趴下"}</p> : null}
      {status === "idle" ? <p className="runner-state-banner"><strong>点击草地，陪小花去拾光</strong><span>{coarsePointer ? "左侧按住趴下，右侧点按跳跃" : "左键或 ↑ 跳跃，按住跳得更高"}</span></p> : null}
      {status === "paused" ? <p className="runner-state-banner"><strong>先停一停</strong><span>花田会在你回来时接着亮</span></p> : null}
      {chapterToast ? <p className="runner-chapter-toast" aria-live="polite">{chapterToast}</p> : null}
      <div className="runner-scoreboard" aria-live="polite">
        <HeartPips lives={status === "idle" ? RUNNER_STARTING_LIVES : lives} />
        <span>本局 {score}</span>
        {combo > 1 ? <span>连击 {combo}</span> : null}
        <span className="runner-chapter-label">{RUNNER_CHAPTER_LABELS[chapter]}</span>
        {leaderboardBest != null ? <span>纪录 {leaderboardBest}</span> : null}
      </div>
      <div className="runner-controls">
        <button type="button" className="runner-icon-button focus-ring" onMouseDown={(event) => event.preventDefault()} onClick={() => setHelp(!helpOpen)} aria-label="查看玩法" aria-expanded={helpOpen}>
          <CircleHelp className="h-4 w-4" />
        </button>
        <button type="button" className="runner-icon-button focus-ring" onMouseDown={(event) => event.preventDefault()} onClick={() => void enterLandscape()} aria-label="全屏横屏游玩">
          <Expand className="h-4 w-4" />
        </button>
        {status === "playing" ? (
          <button
            type="button"
            className="runner-icon-button focus-ring"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              pausedByPanelRef.current = false;
              stateRef.current = pauseRunner(stateRef.current);
              syncUi(stateRef.current);
            }}
            aria-label="暂停游戏"
          >
            <Pause className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" className="runner-play-button focus-ring" onMouseDown={(event) => event.preventDefault()} onClick={play} disabled={assetStatus !== "ready" || inputBlocked}>
            {status === "gameover" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {status === "gameover" ? "再拾一次" : status === "paused" ? "继续拾光" : "开始拾光"}
          </button>
        )}
      </div>
      {helpOpen ? (
        <aside className="runner-help-popover" aria-label="花田拾光玩法">
          <button type="button" className="runner-close focus-ring" onClick={() => setHelp(false)} aria-label="关闭玩法"><X className="h-4 w-4" /></button>
          <strong>怎么玩</strong>
          <p>{coarsePointer ? "按住屏幕左侧趴下，松开起身；点按屏幕右侧跳跃。" : "鼠标左键或 ↑ 跳跃，按住会跳得更高；右键或 ↓ 按住趴下。"}</p>
          <p>越过石头和树桩，趴下躲开小鸟。跳起来拾花瓣，连上之后能捡到更高的信封。</p>
          <p>撞到障碍会失去一颗小心心；走得越远，天色会从晨光走到星夜。</p>
        </aside>
      ) : null}
      {status === "gameover" ? (
        <p className="runner-state-banner runner-gameover">
          <strong>这一程走到了{RUNNER_CHAPTER_LABELS[chapter]}</strong>
          <span>本局 {score} 分 · 拾到 {petals} 片花瓣 · 最高连击 {maxCombo}</span>
        </p>
      ) : null}
    </div>
  );
}
