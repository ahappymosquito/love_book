// 花田拾光纯 Canvas 绘制：姿态驱动的代码小狗、几何障碍和哈希花田，不依赖任何图片资源。

import {
  playerBoxes,
  type CollisionBox,
  type RunnerChapterId,
  type RunnerMetrics,
  type RunnerObstacle,
  type RunnerObstacleKind,
  type RunnerPickup,
  type RunnerState,
} from "./xiaohua-runner";

export const CHAPTER_SKY: Record<RunnerChapterId, string> = {
  dawn: "#f0b48a",
  noon: "#7ec8ea",
  dusk: "#d57a58",
  night: "#1a2238",
};

const GOLD = "#e4b56c";
const GOLD_DEEP = "#c48c45";
const CREAM = "#f6ead4";
const WHITE = "#fff8ee";
const EAR = "#c47a4a";
const INK = "#3a2a28";
const PINK = "#e8a39a";
const ROSE = "#d98990";
const GREEN = "#6f9d7d";
const GREEN_DEEP = "#4f7d62";

export type PuppyAction = "idle" | "run" | "jump" | "crouch" | "stumble" | "celebrate";

export interface PuppyPose {
  action: PuppyAction;
  breath: number;
  bob: number;
  tail: number;
  ear: number;
  blink: number;
  frontPhase: number;
  hindPhase: number;
  stretch: number;
  squash: number;
  sit: number;
  tilt: number;
}

export function hashUnit(value: number): number {
  const unit = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return unit - Math.floor(unit);
}

export function unionBoxes(boxes: CollisionBox[]): CollisionBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const bottom = Math.min(...boxes.map((box) => box.bottom));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.max(...boxes.map((box) => box.bottom + box.height));
  return { x: left, bottom, width: right - left, height: top - bottom };
}

export function puppyAction(state: RunnerState, celebrating: boolean): PuppyAction {
  if (state.status === "gameover") return celebrating ? "celebrate" : "stumble";
  if (state.y > 0.001) return "jump";
  if (state.crouching) return "crouch";
  if (state.status === "playing") return "run";
  return "idle";
}

export function puppyPose(state: RunnerState, time: number, celebrating: boolean, reducedMotion: boolean): PuppyPose {
  const action = puppyAction(state, celebrating);
  const quiet = reducedMotion ? 0 : 1;
  const pose: PuppyPose = {
    action,
    breath: 1,
    bob: 0,
    tail: 0.18,
    ear: 0,
    blink: 0,
    frontPhase: 0,
    hindPhase: 0,
    stretch: 1,
    squash: 1,
    sit: 0,
    tilt: 0,
  };

  if (action === "idle") {
    pose.breath = 1 + Math.sin(time * 2.2) * 0.03 * quiet;
    pose.bob = quiet ? Math.sin(time * 2.2) * 0.012 : 0;
    pose.tail = quiet ? Math.sin(time * 3.4) * 0.5 + 0.15 : 0.15;
    pose.ear = quiet ? Math.sin(time * 1.4) * 0.08 : 0;
    pose.blink = !reducedMotion && time % 4.6 < 0.12 ? 1 : 0;
    return pose;
  }

  if (action === "run") {
    const phase = state.distance * 2.35 + state.elapsed * 2;
    pose.frontPhase = Math.sin(phase);
    pose.hindPhase = Math.sin(phase + Math.PI);
    pose.bob = Math.abs(Math.sin(phase)) * 0.045 * quiet;
    pose.tail = Math.sin(phase * 1.15) * 0.62 * quiet + 0.1;
    pose.ear = -0.1 + Math.sin(phase) * 0.1 * quiet;
    pose.breath = 1 + Math.sin(phase * 2) * 0.02 * quiet;
    return pose;
  }

  if (action === "jump") {
    const rising = state.velocityY > 0;
    pose.stretch = rising ? 1.08 : 1.02;
    pose.squash = rising ? 0.9 : 0.96;
    pose.frontPhase = rising ? 0.85 : 0.35;
    pose.hindPhase = rising ? 0.55 : 0.2;
    pose.ear = -0.42;
    pose.tail = 0.55;
    pose.tilt = rising ? -0.08 : 0.06;
    return pose;
  }

  if (action === "crouch") {
    pose.squash = 0.72;
    pose.stretch = 1.08;
    pose.bob = -0.02;
    pose.ear = 0.28;
    pose.tail = -0.2;
    pose.frontPhase = -0.15;
    pose.hindPhase = -0.2;
    return pose;
  }

  if (action === "stumble") {
    pose.tilt = -0.2;
    pose.squash = 0.88;
    pose.ear = 0.35;
    pose.tail = -0.35;
    pose.blink = 1;
    return pose;
  }

  pose.sit = 0.78;
  pose.tail = Math.sin(time * 9) * 0.75 * quiet + 0.2;
  pose.bob = Math.abs(Math.sin(time * 6)) * 0.05 * quiet;
  pose.ear = 0.12;
  pose.blink = !reducedMotion && time % 2.8 < 0.1 ? 1 : 0;
  return pose;
}

export function puppyVisualBox(state: RunnerState, pose: PuppyPose): CollisionBox {
  const core = unionBoxes(playerBoxes(state));
  const padX = 0.06;
  const padY = pose.action === "crouch" ? 0.03 : 0.08;
  return {
    x: core.x - padX,
    bottom: Math.max(0, core.bottom - 0.02 + pose.bob * 0.2),
    width: core.width + padX * 2,
    height: core.height * pose.squash * pose.breath + padY,
  };
}

function snap(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

function worldX(metrics: RunnerMetrics, x: number): number {
  return metrics.frame.x + x * metrics.bodyUnit;
}

function worldY(metrics: RunnerMetrics, bottom: number): number {
  return metrics.groundBaseline - bottom * metrics.standingHeight;
}

function fillEllipse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  color: string,
  rotation = 0,
) {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.fillStyle = color;
  context.beginPath();
  context.ellipse(0, 0, Math.max(0.5, radiusX), Math.max(0.5, radiusY), 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function strokeEllipse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  color: string,
  width: number,
  rotation = 0,
) {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.ellipse(0, 0, Math.max(0.5, radiusX), Math.max(0.5, radiusY), 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function contactShadow(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, alpha = 0.22) {
  context.save();
  context.fillStyle = `rgba(58, 42, 40, ${alpha})`;
  context.beginPath();
  context.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawFlower(context: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  const petal = size * 0.28;
  context.fillStyle = color;
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
    fillEllipse(context, cx + Math.cos(angle) * petal, cy + Math.sin(angle) * petal, petal * 0.55, petal * 0.38, color, angle);
  }
  fillEllipse(context, cx, cy, petal * 0.42, petal * 0.42, "#f4d27a");
}

function drawHeart(context: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  context.fillStyle = ROSE;
  context.beginPath();
  const width = size * 0.5;
  const height = size * 0.46;
  context.moveTo(cx, cy + height * 0.55);
  context.bezierCurveTo(cx - width, cy + height * 0.08, cx - width * 0.85, cy - height * 0.62, cx, cy - height * 0.18);
  context.bezierCurveTo(cx + width * 0.85, cy - height * 0.62, cx + width, cy + height * 0.08, cx, cy + height * 0.55);
  context.fill();
}

function drawLetter(context: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const width = size * 0.72;
  const height = size * 0.5;
  context.fillStyle = "#f7efe2";
  context.strokeStyle = "#c9896a";
  context.lineWidth = Math.max(1.4, size * 0.06);
  context.beginPath();
  context.roundRect(cx - width / 2, cy - height / 2, width, height, 3);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(cx - width / 2, cy - height / 2);
  context.lineTo(cx, cy);
  context.lineTo(cx + width / 2, cy - height / 2);
  context.stroke();
}

function drawSky(context: CanvasRenderingContext2D, metrics: RunnerMetrics, chapter: RunnerChapterId, time: number, reducedMotion: boolean) {
  const { x, y, width, height } = metrics.frame;
  const sky = context.createLinearGradient(0, y, 0, y + height);
  if (chapter === "dawn") {
    sky.addColorStop(0, "#f4c4a0");
    sky.addColorStop(0.42, "#f7d7b8");
    sky.addColorStop(1, "#e7eec4");
  } else if (chapter === "noon") {
    sky.addColorStop(0, "#7ec8ea");
    sky.addColorStop(0.45, "#c5eaf4");
    sky.addColorStop(1, "#e3f3c4");
  } else if (chapter === "dusk") {
    sky.addColorStop(0, "#e88962");
    sky.addColorStop(0.4, "#f0b07a");
    sky.addColorStop(1, "#c9a070");
  } else {
    sky.addColorStop(0, "#141a2e");
    sky.addColorStop(0.48, "#243056");
    sky.addColorStop(1, "#1c2a28");
  }
  context.fillStyle = sky;
  context.fillRect(x, y, width, height);

  const cx = x + width * (chapter === "dawn" ? 0.18 : chapter === "dusk" ? 0.82 : 0.78);
  const cy = y + height * (chapter === "dusk" ? 0.22 : chapter === "night" ? 0.16 : 0.14);
  const radius = Math.max(16, height * (chapter === "night" ? 0.035 : 0.05));
  if (chapter === "night") {
    context.fillStyle = "rgba(248, 236, 210, 0.55)";
    for (let index = 0; index < (reducedMotion ? 12 : 28); index += 1) {
      const px = x + hashUnit(index + 3) * width;
      const py = y + hashUnit(index + 19) * height * 0.42;
      const twinkle = reducedMotion ? 0.55 : 0.35 + (Math.sin(time * 1.6 + index) + 1) * 0.25;
      context.globalAlpha = twinkle;
      context.fillRect(Math.round(px), Math.round(py), 2, 2);
    }
    context.globalAlpha = 1;
    fillEllipse(context, cx, cy, radius, radius, "rgba(248, 236, 210, 0.94)");
    fillEllipse(context, cx + radius * 0.38, cy - radius * 0.18, radius * 0.82, radius * 0.82, CHAPTER_SKY.night);
  } else {
    const glow = chapter === "dusk" ? "rgba(255, 168, 92, 0.28)" : chapter === "dawn" ? "rgba(255, 196, 132, 0.26)" : "rgba(255, 236, 170, 0.22)";
    fillEllipse(context, cx, cy, radius * 2.4, radius * 2.4, glow);
    fillEllipse(context, cx, cy, radius, radius, chapter === "dusk" ? "#ffa85c" : chapter === "dawn" ? "#ffc484" : "#ffe8aa");
  }
}

function hillPath(context: CanvasRenderingContext2D, left: number, width: number, baseline: number, amplitude: number, frequency: number, phase: number) {
  context.beginPath();
  context.moveTo(left - 8, baseline + 80);
  for (let x = left - 8; x <= left + width + 8; x += 8) {
    const y = baseline - Math.sin(x * frequency + phase) * amplitude - Math.sin(x * frequency * 0.37 + phase * 1.7) * amplitude * 0.45;
    context.lineTo(x, y);
  }
  context.lineTo(left + width + 8, baseline + 80);
  context.closePath();
  context.fill();
}

function drawHills(context: CanvasRenderingContext2D, metrics: RunnerMetrics, scroll: number, chapter: RunnerChapterId) {
  const far = chapter === "night" ? "#2b3a4e" : chapter === "dusk" ? "#c98468" : chapter === "dawn" ? "#d7a07a" : "#8fbf9a";
  const mid = chapter === "night" ? "#334656" : chapter === "dusk" ? "#c47258" : chapter === "dawn" ? "#c98b6a" : "#6fa87c";
  context.fillStyle = far;
  hillPath(context, metrics.frame.x, metrics.frame.width, metrics.groundBaseline - metrics.standingHeight * 1.55, 38, 0.006, -scroll * 0.002);
  context.fillStyle = mid;
  hillPath(context, metrics.frame.x, metrics.frame.width, metrics.groundBaseline - metrics.standingHeight * 0.92, 28, 0.008, -scroll * 0.0045 + 1.2);
}

function drawMeadow(context: CanvasRenderingContext2D, metrics: RunnerMetrics, scroll: number, chapter: RunnerChapterId, time: number, reducedMotion: boolean) {
  const { x, width } = metrics.frame;
  const ground = metrics.groundBaseline;
  const wind = reducedMotion ? 0 : Math.sin(time * 1.4) * 3;

  context.fillStyle = chapter === "night" ? "#2f4a3c" : chapter === "dusk" ? "#6d8a58" : "#7dae6a";
  context.fillRect(x, ground - 18, width, metrics.frame.y + metrics.frame.height - (ground - 18));

  const path = context.createLinearGradient(0, ground - 22, 0, ground + 28);
  path.addColorStop(0, chapter === "night" ? "#3e5c48" : "#8fbf74");
  path.addColorStop(1, chapter === "night" ? "#2a4034" : "#6f9458");
  context.fillStyle = path;
  context.fillRect(x, ground - 8, width, 36);

  const spacing = 26;
  const start = Math.floor((scroll * 0.4 - 40) / spacing);
  const end = start + Math.ceil(width / spacing) + 4;
  for (let index = start; index <= end; index += 1) {
    const seed = hashUnit(index * 17.3);
    const px = x + index * spacing - ((scroll * 0.4) % spacing) + seed * 8;
    const kind = seed;
    if (kind < 0.18) {
      context.fillStyle = chapter === "night" ? "#3d5344" : "#5d8a52";
      context.fillRect(px, ground - 34 - seed * 16, 4, 36 + seed * 16);
      context.fillRect(px - 5, ground - 22 - seed * 10, 14, 4);
    } else if (kind < 0.42) {
      fillEllipse(context, px, ground - 16 - seed * 10, 16 + seed * 10, 12 + seed * 6, chapter === "night" ? "#355544" : "#5f9a62");
    } else if (kind < 0.62 && !reducedMotion) {
      const color = seed > 0.52 ? "#f2b3ae" : seed > 0.48 ? "#f7d7a6" : "#d98990";
      drawFlower(context, px, ground - 22 - seed * 8, 11 + seed * 6, color);
    }
  }

  const tuft = Math.max(14, Math.floor(width / 28));
  context.strokeStyle = chapter === "night" ? "#6f8f72" : "#4f7a48";
  context.lineWidth = 1.4;
  context.lineCap = "round";
  for (let index = 0; index < tuft; index += 1) {
    const seed = hashUnit(index + Math.floor(scroll));
    const px = x + ((index * 97 + scroll * 18) % (width + 30)) - 10;
    const height = 8 + seed * 10;
    context.beginPath();
    context.moveTo(px, ground + 2);
    context.quadraticCurveTo(px + wind * 0.4 + (seed - 0.5) * 4, ground - height * 0.5, px + wind + (seed - 0.5) * 6, ground - height);
    context.stroke();
  }
}

function drawObstacleShape(
  context: CanvasRenderingContext2D,
  obstacle: RunnerObstacle,
  metrics: RunnerMetrics,
  elapsed: number,
  dpr: number,
) {
  const x = snap(worldX(metrics, obstacle.x), dpr);
  const width = obstacle.width * metrics.bodyUnit;
  const height = obstacle.height * metrics.standingHeight;
  const top = snap(worldY(metrics, obstacle.bottom + obstacle.height), dpr);
  const bottom = snap(worldY(metrics, obstacle.bottom), dpr);
  const cx = x + width / 2;

  if (obstacle.bottom <= 0.02) {
    contactShadow(context, cx, metrics.groundBaseline + 3, width * 0.42, Math.max(3, height * 0.05), 0.28);
  }

  if (obstacle.kind === "rock") {
    fillEllipse(context, cx - width * 0.12, bottom - height * 0.38, width * 0.38, height * 0.4, "#8d7a6a");
    fillEllipse(context, cx + width * 0.16, bottom - height * 0.32, width * 0.34, height * 0.34, "#a08a78");
    fillEllipse(context, cx, bottom - height * 0.18, width * 0.46, height * 0.22, "#7a6758");
    strokeEllipse(context, cx, bottom - height * 0.32, width * 0.46, height * 0.42, "rgba(58, 42, 40, 0.35)", 1.5);
    return;
  }

  if (obstacle.kind === "stump") {
    context.fillStyle = "#b88858";
    context.beginPath();
    context.roundRect(cx - width * 0.28, top + height * 0.18, width * 0.56, height * 0.82, 6);
    context.fill();
    fillEllipse(context, cx, top + height * 0.22, width * 0.3, height * 0.16, "#d7b48a");
    context.strokeStyle = "#8a6240";
    context.lineWidth = 1.6;
    context.beginPath();
    context.ellipse(cx, top + height * 0.22, width * 0.18, height * 0.08, 0, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.ellipse(cx, top + height * 0.22, width * 0.1, height * 0.04, 0, 0, Math.PI * 2);
    context.stroke();
    return;
  }

  if (obstacle.kind === "log") {
    context.save();
    context.fillStyle = "#a56c42";
    context.beginPath();
    context.roundRect(x + width * 0.04, top + height * 0.12, width * 0.92, height * 0.76, height * 0.38);
    context.fill();
    context.strokeStyle = "#7a4c2c";
    context.lineWidth = 1.5;
    for (let index = 0; index < 4; index += 1) {
      const lx = x + width * (0.22 + index * 0.18);
      context.beginPath();
      context.moveTo(lx, top + height * 0.22);
      context.quadraticCurveTo(lx + 4, top + height * 0.5, lx, top + height * 0.78);
      context.stroke();
    }
    fillEllipse(context, x + width * 0.08, top + height * 0.5, height * 0.28, height * 0.36, "#d8b48a");
    context.restore();
    return;
  }

  if (obstacle.kind === "bramble") {
    fillEllipse(context, cx, bottom - height * 0.42, width * 0.48, height * 0.48, "#5f8a52");
    fillEllipse(context, cx - width * 0.18, bottom - height * 0.28, width * 0.28, height * 0.3, "#6f9a5c");
    fillEllipse(context, cx + width * 0.2, bottom - height * 0.3, width * 0.26, height * 0.28, "#4e7a44");
    context.strokeStyle = "#3d5c38";
    context.lineWidth = 1.8;
    context.lineCap = "round";
    for (let index = 0; index < 7; index += 1) {
      const angle = -Math.PI * 0.15 - index * 0.22;
      const px = cx + Math.cos(angle) * width * 0.22;
      const py = bottom - height * 0.42 + Math.sin(angle) * height * 0.28;
      context.beginPath();
      context.moveTo(px, py);
      context.lineTo(px + Math.cos(angle) * 10, py + Math.sin(angle) * 10);
      context.stroke();
    }
    return;
  }

  const flap = Math.sin(elapsed * 12) * 0.55;
  contactShadow(context, cx, metrics.groundBaseline + 2, width * 0.22, 3, 0.12);
  fillEllipse(context, cx, top + height * 0.55, width * 0.28, height * 0.28, "#d8c4a8");
  context.save();
  context.translate(cx, top + height * 0.5);
  context.rotate(-0.35 + flap);
  fillEllipse(context, -width * 0.18, 0, width * 0.34, height * 0.12, "#c9b08c");
  context.restore();
  context.save();
  context.translate(cx, top + height * 0.5);
  context.rotate(0.35 - flap);
  fillEllipse(context, width * 0.18, 0, width * 0.34, height * 0.12, "#b89a74");
  context.restore();
  fillEllipse(context, cx + width * 0.22, top + height * 0.48, height * 0.16, height * 0.16, "#eee0c8");
  fillEllipse(context, cx + width * 0.28, top + height * 0.46, 2.2, 2.2, INK);
}

function drawPickupItem(
  context: CanvasRenderingContext2D,
  pickup: RunnerPickup,
  metrics: RunnerMetrics,
  time: number,
  dpr: number,
  reducedMotion: boolean,
) {
  const width = pickup.width * metrics.bodyUnit;
  const height = pickup.height * metrics.standingHeight;
  const x = snap(worldX(metrics, pickup.x), dpr);
  const bob = reducedMotion ? 0 : Math.sin(time * 4 + pickup.id) * Math.max(2, height * 0.08);
  const y = snap(worldY(metrics, pickup.bottom + pickup.height) - bob, dpr);
  const cx = x + width / 2;
  const cy = y + height / 2;
  contactShadow(context, cx, metrics.groundBaseline + 3, width * 0.28, 3, 0.16);
  if (pickup.kind === "heart") drawHeart(context, cx, cy, height);
  else if (pickup.kind === "letter") drawLetter(context, cx, cy, height);
  else drawFlower(context, cx, cy, height, "#f2a3a0");
}

function drawLeg(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  lift: number,
  length: number,
  thickness: number,
) {
  const footY = y + length - lift * length * 0.55;
  const kneeY = y + length * 0.45 - lift * length * 0.25;
  context.strokeStyle = GOLD_DEEP;
  context.fillStyle = GOLD;
  context.lineWidth = thickness;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + lift * thickness * 0.4, kneeY);
  context.lineTo(x + lift * thickness * 0.15, footY);
  context.stroke();
  fillEllipse(context, x + lift * thickness * 0.15, footY + thickness * 0.15, thickness * 0.55, thickness * 0.32, CREAM);
}

function drawPuppy(
  context: CanvasRenderingContext2D,
  state: RunnerState,
  metrics: RunnerMetrics,
  pose: PuppyPose,
  dpr: number,
  reducedMotion: boolean,
) {
  if (state.invincibleFor > 0 && !reducedMotion && Math.floor(state.elapsed * 16) % 2 === 0) return;

  const box = unionBoxes(playerBoxes(state));
  const screen = {
    x: snap(worldX(metrics, box.x), dpr),
    y: snap(worldY(metrics, box.bottom + box.height), dpr),
    w: box.width * metrics.bodyUnit,
    h: box.height * metrics.standingHeight,
  };
  const localX = (lx: number) => screen.x + lx * screen.w;
  const localY = (ly: number) => screen.y + screen.h - (ly * pose.squash + pose.bob) * screen.h;

  contactShadow(
    context,
    localX(0.48),
    metrics.groundBaseline + 3,
    screen.w * 0.32,
    Math.max(3, screen.h * 0.05),
    state.y > 0.05 ? 0.08 : 0.22,
  );

  context.save();
  context.translate(localX(0.48), localY(0.42));
  context.rotate(pose.tilt);
  context.scale(pose.stretch, pose.breath);

  const unit = screen.h;
  const tailAngle = -2.4 + pose.tail;
  context.strokeStyle = GOLD_DEEP;
  context.lineWidth = Math.max(4, unit * 0.08);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-unit * 0.42, unit * 0.02);
  context.quadraticCurveTo(
    -unit * 0.58,
    -unit * (0.18 + pose.sit * 0.08),
    -unit * 0.46 + Math.cos(tailAngle) * unit * 0.28,
    -unit * 0.02 + Math.sin(tailAngle) * unit * 0.28,
  );
  context.stroke();

  drawLeg(context, -unit * 0.16, unit * 0.08, pose.hindPhase, unit * 0.42, unit * 0.11);
  drawLeg(context, -unit * 0.02, unit * 0.1, -pose.hindPhase * 0.85, unit * 0.4, unit * 0.1);

  fillEllipse(context, 0, 0, unit * 0.42, unit * 0.28, GOLD);
  fillEllipse(context, unit * 0.02, unit * 0.14, unit * 0.2, unit * 0.1, CREAM);

  drawLeg(context, unit * 0.16, unit * 0.1, pose.frontPhase, unit * 0.4, unit * 0.1);
  drawLeg(context, unit * 0.3, unit * 0.08, -pose.frontPhase * 0.9, unit * 0.38, unit * 0.1);

  const headX = unit * 0.38;
  const headY = -unit * (0.28 - pose.sit * 0.12);
  fillEllipse(context, headX - unit * 0.22, headY + unit * 0.08, unit * 0.16, unit * 0.12, GOLD, 0.4);

  context.save();
  context.translate(headX - unit * 0.02, headY - unit * 0.16);
  context.rotate(-0.7 + pose.ear);
  fillEllipse(context, 0, 0, unit * 0.13, unit * 0.22, EAR);
  fillEllipse(context, 0, unit * 0.02, unit * 0.07, unit * 0.14, PINK);
  context.restore();
  context.save();
  context.translate(headX + unit * 0.12, headY - unit * 0.14);
  context.rotate(0.35 + pose.ear * 0.6);
  fillEllipse(context, 0, 0, unit * 0.11, unit * 0.2, GOLD_DEEP);
  fillEllipse(context, 0, unit * 0.02, unit * 0.06, unit * 0.12, PINK);
  context.restore();

  fillEllipse(context, headX, headY, unit * 0.24, unit * 0.22, GOLD);
  fillEllipse(context, headX + unit * 0.04, headY - unit * 0.04, unit * 0.1, unit * 0.12, WHITE);
  fillEllipse(context, headX + unit * 0.16, headY + unit * 0.04, unit * 0.16, unit * 0.12, CREAM, 0.15);
  fillEllipse(context, headX + unit * 0.08, headY + unit * 0.06, unit * 0.07, unit * 0.05, PINK);

  const eyeY = headY - unit * 0.02;
  if (pose.blink > 0.5) {
    context.strokeStyle = INK;
    context.lineWidth = Math.max(1.5, unit * 0.025);
    context.beginPath();
    context.moveTo(headX + unit * 0.1, eyeY);
    context.lineTo(headX + unit * 0.18, eyeY + unit * 0.01);
    context.stroke();
  } else {
    fillEllipse(context, headX + unit * 0.14, eyeY, unit * 0.045, unit * 0.05, WHITE);
    fillEllipse(context, headX + unit * 0.155, eyeY + unit * 0.005, unit * 0.028, unit * 0.032, INK);
    fillEllipse(context, headX + unit * 0.168, eyeY - unit * 0.01, unit * 0.01, unit * 0.01, WHITE);
  }
  fillEllipse(context, headX + unit * 0.28, headY + unit * 0.05, unit * 0.045, unit * 0.035, INK);

  drawFlower(context, headX - unit * 0.02, headY - unit * 0.2, unit * 0.16, ROSE);
  drawFlower(context, headX + unit * 0.1, headY - unit * 0.22, unit * 0.13, "#f2b3ae");
  drawFlower(context, headX - unit * 0.12, headY - unit * 0.16, unit * 0.12, "#f7d7a6");

  fillEllipse(context, unit * 0.14, unit * 0.2, unit * 0.045, unit * 0.045, GREEN);
  fillEllipse(context, unit * 0.14, unit * 0.2, unit * 0.018, unit * 0.018, GREEN_DEEP);
  context.strokeStyle = GREEN_DEEP;
  context.lineWidth = Math.max(1.2, unit * 0.02);
  context.beginPath();
  context.moveTo(unit * 0.14, unit * 0.16);
  context.lineTo(unit * 0.14, unit * 0.05);
  context.stroke();

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
    const x = snap(worldX(metrics, popup.x), dpr);
    const y = snap(worldY(metrics, popup.y), dpr);
    context.strokeText(popup.text, x, y);
    context.fillText(popup.text, x, y);
  }
  context.restore();
}

function drawAmbientPetals(
  context: CanvasRenderingContext2D,
  metrics: RunnerMetrics,
  time: number,
  chapter: RunnerChapterId,
) {
  const count = chapter === "night" ? 5 : 8;
  for (let index = 0; index < count; index += 1) {
    const drift = (time * (10 + index) + index * 80) % (metrics.frame.width + 40);
    const x = metrics.frame.x + drift - 20;
    const y = metrics.frame.y + ((index * 97) % 100) / 100 * metrics.frame.height * 0.48 + Math.sin(time + index) * 8;
    context.globalAlpha = 0.35;
    drawFlower(context, x, y, 10 + (index % 3) * 2, index % 2 === 0 ? "#f2b3ae" : "#f7d7a6");
  }
  context.globalAlpha = 1;
}

function drawFireflies(context: CanvasRenderingContext2D, metrics: RunnerMetrics, time: number) {
  context.fillStyle = "rgba(255, 226, 150, 0.7)";
  for (let index = 0; index < 7; index += 1) {
    const px = metrics.frame.x + ((index * 140 + time * 18) % metrics.frame.width);
    const py = metrics.frame.y + metrics.frame.height * 0.52 + Math.sin(time * 2 + index) * 10;
    context.globalAlpha = 0.35 + (Math.sin(time * 3 + index) + 1) * 0.2;
    context.fillRect(Math.round(px), Math.round(py), 2, 2);
  }
  context.globalAlpha = 1;
}

export const OBSTACLE_KINDS: RunnerObstacleKind[] = ["rock", "stump", "log", "bramble", "bird"];

export function drawScene(
  context: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  state: RunnerState,
  metrics: RunnerMetrics,
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
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const scroll = state.status === "playing" || state.status === "paused"
    ? state.distance * metrics.bodyUnit
    : reducedMotion
      ? 0
      : renderTime * 28;

  drawSky(context, metrics, state.chapter, renderTime, reducedMotion);
  drawHills(context, metrics, scroll, state.chapter);
  drawMeadow(context, metrics, scroll, state.chapter, renderTime, reducedMotion);
  if (!reducedMotion && (state.status === "idle" || state.chapter !== "noon")) {
    drawAmbientPetals(context, metrics, renderTime, state.chapter);
  }
  if (state.chapter === "night" && !reducedMotion) drawFireflies(context, metrics, renderTime);

  for (const pickup of state.pickups) drawPickupItem(context, pickup, metrics, renderTime, dpr, reducedMotion);
  for (const obstacle of state.obstacles) drawObstacleShape(context, obstacle, metrics, state.elapsed, dpr);
  drawLandingDust(context, state, metrics, dpr);
  drawPuppy(context, state, metrics, puppyPose(state, renderTime, celebrating, reducedMotion), dpr, reducedMotion);
  drawPopups(context, state, metrics, dpr);
  context.restore();
}

export function obstacleVisualBox(obstacle: RunnerObstacle): CollisionBox {
  return {
    x: obstacle.x,
    bottom: obstacle.bottom,
    width: obstacle.width,
    height: obstacle.height,
  };
}

export function collisionFitsVisual(visual: CollisionBox, collision: CollisionBox): boolean {
  return collision.x >= visual.x - 0.001
    && collision.bottom >= visual.bottom - 0.001
    && collision.x + collision.width <= visual.x + visual.width + 0.001
    && collision.bottom + collision.height <= visual.bottom + visual.height + 0.001;
}
