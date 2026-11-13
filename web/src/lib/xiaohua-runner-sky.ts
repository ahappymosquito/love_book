// 花田拾光天色：晨光→午后→黄昏→星夜的连续天色时钟、低饱和暖色关键帧插值（量化缓存）、4×4 Bayer 有序抖动天空像素与抖动暗角，全部为纯函数。

import { RUNNER_CHAPTER_AT } from "./xiaohua-runner";

export type Rgb = readonly [number, number, number];

export const WORLD_COLOR_KEYS = [
  "skyTop",
  "skyMid",
  "horizon",
  "hillFar",
  "hillMid",
  "ground",
  "groundShade",
  "sun",
  "glow",
  "star",
  "flowerA",
  "flowerB",
  "firefly",
  "flash",
] as const;

export type WorldColorKey = (typeof WORLD_COLOR_KEYS)[number];
export type WorldKeyframe = Record<WorldColorKey, string>;

export const WORLD_KEYFRAMES: readonly WorldKeyframe[] = [
  {
    skyTop: "#e7d3d8",
    skyMid: "#f2dfd8",
    horizon: "#f8e7d6",
    hillFar: "#e8d2cb",
    hillMid: "#dcc6bc",
    ground: "#f3ebe3",
    groundShade: "#e6d7ca",
    sun: "#f6cfae",
    glow: "#f8e0cc",
    star: "#fff6ea",
    flowerA: "#d99a9e",
    flowerB: "#e9b896",
    firefly: "#f3dca4",
    flash: "#fff8f1",
  },
  {
    skyTop: "#e2e7dc",
    skyMid: "#eff0e5",
    horizon: "#f8f3ea",
    hillFar: "#e0e4d5",
    hillMid: "#cfd9c5",
    ground: "#f6f1ea",
    groundShade: "#e8e0d3",
    sun: "#f9e5bf",
    glow: "#fbefd9",
    star: "#fffaf0",
    flowerA: "#d8949b",
    flowerB: "#eabf90",
    firefly: "#f3dca4",
    flash: "#fffaf3",
  },
  {
    skyTop: "#b98b97",
    skyMid: "#dba79f",
    horizon: "#efc4a2",
    hillFar: "#c99b93",
    hillMid: "#b58780",
    ground: "#edd4bc",
    groundShade: "#ddbca2",
    sun: "#f0a98b",
    glow: "#f3c3a3",
    star: "#fde8d6",
    flowerA: "#c9737b",
    flowerB: "#e6a180",
    firefly: "#f4d99b",
    flash: "#fff3ea",
  },
  {
    skyTop: "#1d1a25",
    skyMid: "#29222f",
    horizon: "#3b2f37",
    hillFar: "#30262f",
    hillMid: "#261f25",
    ground: "#2a2422",
    groundShade: "#221c1b",
    sun: "#f1e3cc",
    glow: "#4a3d46",
    star: "#f3e6d0",
    flowerA: "#a8676f",
    flowerB: "#b98a73",
    firefly: "#ead79a",
    flash: "#f6ebdd",
  },
];

export interface RunnerSpritePalette {
  paper: string;
  ink: string;
  accent: string;
}

export type RunnerWorldPalette = Record<WorldColorKey, string> & {
  key: number;
  clock: number;
  stars: number;
  fireflies: number;
  petals: number;
  skyStops: readonly [Rgb, Rgb, Rgb];
  moonPalette: RunnerSpritePalette;
};

export const RUNNER_SKY_TRANSITION = 7;
export const RUNNER_SKY_STEPS = 32;
export const SKY_BANDS = 9;
export const SKY_VIGNETTE_SHADE = 0.94;

const CHAPTER_TIMES = [RUNNER_CHAPTER_AT.noon, RUNNER_CHAPTER_AT.dusk, RUNNER_CHAPTER_AT.night] as const;
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const KEYFRAME_RGB = WORLD_KEYFRAMES.map((frame) => {
  const rgb = {} as Record<WorldColorKey, Rgb>;
  for (const key of WORLD_COLOR_KEYS) rgb[key] = parseHex(frame[key]);
  return rgb;
});
const PALETTE_CACHE = new Map<number, RunnerWorldPalette>();

export function hashUnit(value: number): number {
  const unit = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return unit - Math.floor(unit);
}

export function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex(rgb: Rgb): string {
  const value = (Math.round(rgb[0]) << 16) | (Math.round(rgb[1]) << 8) | Math.round(rgb[2]);
  return `#${value.toString(16).padStart(6, "0")}`;
}

export function mixRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

export function runnerDayClock(elapsed: number): number {
  let clock = 0;
  for (const at of CHAPTER_TIMES) {
    clock += smoothstep((elapsed - (at - RUNNER_SKY_TRANSITION + 1)) / RUNNER_SKY_TRANSITION);
  }
  return clock;
}

export function runnerWorldPalette(clock: number): RunnerWorldPalette {
  const last = WORLD_KEYFRAMES.length - 1;
  const key = Math.round(Math.min(last, Math.max(0, clock)) * RUNNER_SKY_STEPS);
  const cached = PALETTE_CACHE.get(key);
  if (cached) return cached;

  const quantized = key / RUNNER_SKY_STEPS;
  const index = Math.min(last - 1, Math.floor(quantized));
  const t = quantized - index;
  const colors = {} as Record<WorldColorKey, string>;
  const rgb = {} as Record<WorldColorKey, Rgb>;
  for (const name of WORLD_COLOR_KEYS) {
    rgb[name] = mixRgb(KEYFRAME_RGB[index][name], KEYFRAME_RGB[index + 1][name], t);
    colors[name] = rgbToHex(rgb[name]);
  }
  const palette: RunnerWorldPalette = {
    ...colors,
    key,
    clock: quantized,
    stars: smoothstep((quantized - 2.2) / 0.7),
    fireflies: smoothstep((quantized - 1.5) / 0.5) * (1 - 0.35 * smoothstep((quantized - 2.6) / 0.4)),
    petals: 1 - smoothstep((quantized - 1.7) / 0.8),
    skyStops: [rgb.skyTop, rgb.skyMid, rgb.horizon],
    moonPalette: { paper: colors.glow, ink: colors.sun, accent: colors.flowerA },
  };
  PALETTE_CACHE.set(key, palette);
  return palette;
}

export function bayerThreshold(x: number, y: number): number {
  return (BAYER_4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

export function ditherLevel(value: number, levels: number, x: number, y: number): number {
  const scaled = Math.min(1, Math.max(0, value)) * (levels - 1);
  const low = Math.floor(scaled);
  return scaled - low > bayerThreshold(x, y) ? Math.min(levels - 1, low + 1) : low;
}

function sampleGradient(stops: readonly [Rgb, Rgb, Rgb], t: number, out: Float32Array, offset: number) {
  const split = 0.55;
  const from = t < split ? stops[0] : stops[1];
  const to = t < split ? stops[1] : stops[2];
  const local = t < split ? t / split : (t - split) / (1 - split);
  out[offset] = from[0] + (to[0] - from[0]) * local;
  out[offset + 1] = from[1] + (to[1] - from[1]) * local;
  out[offset + 2] = from[2] + (to[2] - from[2]) * local;
}

export function skyVignette(x: number, y: number, cols: number, rows: number): boolean {
  const vx = cols > 1 ? (x / (cols - 1)) * 2 - 1 : 0;
  const vy = rows > 1 ? 1 - y / (rows - 1) : 0;
  const strength = vx * vx * 0.55 + vy * vy * 0.45;
  return strength > 0.5 && (strength - 0.5) * 1.6 > bayerThreshold(x + 2, y + 1);
}

export function buildSkyPixels(
  cols: number,
  rows: number,
  stops: readonly [Rgb, Rgb, Rgb],
  out: Uint8ClampedArray = new Uint8ClampedArray(Math.max(0, cols * rows * 4)),
): Uint8ClampedArray {
  const bands = new Float32Array(SKY_BANDS * 3);
  for (let band = 0; band < SKY_BANDS; band += 1) sampleGradient(stops, band / (SKY_BANDS - 1), bands, band * 3);
  for (let y = 0; y < rows; y += 1) {
    const t = rows > 1 ? y / (rows - 1) : 0;
    for (let x = 0; x < cols; x += 1) {
      const level = ditherLevel(t, SKY_BANDS, x, y) * 3;
      const shade = skyVignette(x, y, cols, rows) ? SKY_VIGNETTE_SHADE : 1;
      const offset = (y * cols + x) * 4;
      out[offset] = bands[level] * shade;
      out[offset + 1] = bands[level + 1] * shade;
      out[offset + 2] = bands[level + 2] * shade;
      out[offset + 3] = 255;
    }
  }
  return out;
}
