// Device-independent Xiaohua Runner engine: responsive metrics, fixed-step physics, silhouette collisions, and Chrome-style obstacle pacing.

export const RUNNER_STEP = 1 / 60;
export const RUNNER_BASE_SPEED = 3.15;
export const RUNNER_MAX_SPEED = 5.1;
export const RUNNER_ACCELERATION = 0.015;
export const RUNNER_STANDING_HEIGHT = 1;
export const RUNNER_AIRTIME = 0.88;
export const RUNNER_JUMP_APEX = 1.45;
export const RUNNER_GRAVITY = (8 * RUNNER_JUMP_APEX) / (RUNNER_AIRTIME * RUNNER_AIRTIME);
export const RUNNER_JUMP_VELOCITY = (4 * RUNNER_JUMP_APEX) / RUNNER_AIRTIME;
export const RUNNER_PLAYER_X = 0.78;
export const RUNNER_BIRD_START = 18;
export const RUNNER_DOUBLE_START = 40;
export const RUNNER_ACTION_WINDOW = 1.08;

export type RunnerStatus = "idle" | "playing" | "paused" | "gameover";
export type RunnerObstacleKind = "rock" | "stump" | "log" | "bramble" | "bird";
export type RunnerActionRequirement = "jump" | "crouch";

export interface RunnerViewport {
  width: number;
  height: number;
}

export interface RunnerMetrics {
  orientation: "portrait" | "landscape";
  frame: { x: number; y: number; width: number; height: number };
  groundBaseline: number;
  standingHeight: number;
  bodyUnit: number;
  spriteSize: number;
  worldWidth: number;
  playerScreenX: number;
}

export interface RunnerObstacle {
  id: number;
  groupId: number;
  x: number;
  width: number;
  height: number;
  bottom: number;
  kind: RunnerObstacleKind;
  requirement: RunnerActionRequirement;
}

export interface RunnerState {
  status: RunnerStatus;
  elapsed: number;
  distance: number;
  score: number;
  speed: number;
  y: number;
  velocityY: number;
  crouchHeld: boolean;
  crouching: boolean;
  obstacles: RunnerObstacle[];
  obstacleHistory: RunnerObstacleKind[];
  nextObstacleId: number;
  nextGroupId: number;
  nextSpawnIn: number;
}

const OBSTACLE_SPECS: Record<RunnerObstacleKind, Omit<RunnerObstacle, "id" | "groupId" | "x" | "kind">> = {
  rock: { width: 0.78, height: 0.57, bottom: 0, requirement: "jump" },
  stump: { width: 0.68, height: 0.72, bottom: 0, requirement: "jump" },
  log: { width: 1.02, height: 0.43, bottom: 0, requirement: "jump" },
  bramble: { width: 0.98, height: 0.48, bottom: 0, requirement: "jump" },
  bird: { width: 0.94, height: 0.37, bottom: 0.53, requirement: "crouch" },
};

interface CollisionBox {
  x: number;
  bottom: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createRunnerMetrics(viewport: RunnerViewport): RunnerMetrics {
  const safeWidth = Math.max(1, viewport.width);
  const safeHeight = Math.max(1, viewport.height);
  const portrait = safeHeight > safeWidth;
  const ratio = portrait ? 3 / 4 : 16 / 9;
  const availableWidth = portrait ? Math.max(1, safeWidth - 16) : Math.min(1440, safeWidth);
  const availableHeight = portrait ? safeHeight : Math.min(810, safeHeight);
  let width = Math.min(availableWidth, availableHeight * ratio);
  let height = width / ratio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }
  width = Math.floor(width);
  height = Math.floor(height);
  const x = Math.floor((safeWidth - width) / 2);
  const y = Math.floor((safeHeight - height) / 2);
  const shortSide = Math.min(width, height);
  const standingHeight = portrait
    ? clamp(shortSide * 0.28, 112, 128)
    : clamp(shortSide * 0.198, 96, 168);
  const bodyUnit = standingHeight * 0.96;
  const spriteSize = standingHeight * (192 / 146);
  const worldWidth = width / bodyUnit;
  return {
    orientation: portrait ? "portrait" : "landscape",
    frame: { x, y, width, height },
    groundBaseline: Math.round(y + height * 0.705),
    standingHeight,
    bodyUnit,
    spriteSize,
    worldWidth,
    playerScreenX: x + RUNNER_PLAYER_X * bodyUnit,
  };
}

export function createRunnerState(): RunnerState {
  return {
    status: "idle",
    elapsed: 0,
    distance: 0,
    score: 0,
    speed: RUNNER_BASE_SPEED,
    y: 0,
    velocityY: 0,
    crouchHeld: false,
    crouching: false,
    obstacles: [],
    obstacleHistory: [],
    nextObstacleId: 1,
    nextGroupId: 1,
    nextSpawnIn: RUNNER_BASE_SPEED * 0.55,
  };
}

export function startRunner(state: RunnerState): RunnerState {
  if (state.status === "paused") return { ...state, status: "playing" };
  if (state.status === "playing") return state;
  return { ...createRunnerState(), status: "playing" };
}

export function pauseRunner(state: RunnerState): RunnerState {
  return state.status === "playing" ? { ...state, status: "paused", crouching: false } : state;
}

export function jumpRunner(state: RunnerState): RunnerState {
  if (state.status !== "playing" || state.y > 0.001) return state;
  return { ...state, crouching: false, velocityY: RUNNER_JUMP_VELOCITY };
}

export function setRunnerCrouch(state: RunnerState, held: boolean): RunnerState {
  return {
    ...state,
    crouchHeld: held,
    crouching: held && state.status === "playing" && state.y <= 0.001,
  };
}

export function runnerSpeed(elapsed: number): number {
  return Math.min(RUNNER_MAX_SPEED, RUNNER_BASE_SPEED + Math.max(0, elapsed) * RUNNER_ACCELERATION);
}

export function runnerScore(distance: number): number {
  return Math.max(0, Math.floor((distance * 10) / RUNNER_BASE_SPEED));
}

function chooseGroundKind(random: () => number, history: RunnerObstacleKind[]): RunnerObstacleKind {
  const allKinds: RunnerObstacleKind[] = ["rock", "stump", "log", "bramble"];
  const repeated = history.length >= 2 && history.at(-1) === history.at(-2) ? history.at(-1) : null;
  const kinds = repeated ? allKinds.filter((kind) => kind !== repeated) : allKinds;
  return kinds[Math.min(kinds.length - 1, Math.floor(random() * kinds.length))];
}

function makeObstacle(kind: RunnerObstacleKind, x: number, id: number, groupId: number): RunnerObstacle {
  return { id, groupId, x, kind, ...OBSTACLE_SPECS[kind] };
}

export interface GeneratedObstacleGroup {
  obstacles: RunnerObstacle[];
  history: RunnerObstacleKind[];
  nextObstacleId: number;
  nextGroupId: number;
  nextSpawnIn: number;
}

export function generateObstacleGroup(
  elapsed: number,
  speed: number,
  nextObstacleId: number,
  nextGroupId: number,
  random: () => number = Math.random,
  history: RunnerObstacleKind[] = [],
): GeneratedObstacleGroup {
  const spawnX = RUNNER_PLAYER_X + speed * 2.25;
  const obstacles: RunnerObstacle[] = [];
  const latestTwoAreBirds = history.length >= 2 && history.at(-1) === "bird" && history.at(-2) === "bird";
  const birdChance = elapsed < RUNNER_BIRD_START ? 0 : Math.min(0.46, 0.24 + (elapsed - RUNNER_BIRD_START) * 0.003);
  const doubleChance = elapsed < RUNNER_DOUBLE_START ? 0 : Math.min(0.42, 0.16 + (elapsed - RUNNER_DOUBLE_START) * 0.004);
  const makeGround = () => chooseGroundKind(random, [...history, ...obstacles.map((item) => item.kind)]);

  if (random() < doubleChance) {
    const firstIsBird = random() < 0.5;
    const firstKind = firstIsBird ? "bird" : makeGround();
    const secondKind = firstIsBird ? makeGround() : "bird";
    const separation = speed * (RUNNER_ACTION_WINDOW + random() * 0.2);
    obstacles.push(makeObstacle(firstKind, spawnX, nextObstacleId, nextGroupId));
    obstacles.push(makeObstacle(secondKind, spawnX + separation, nextObstacleId + 1, nextGroupId));
  } else {
    const kind = !latestTwoAreBirds && random() < birdChance ? "bird" : makeGround();
    obstacles.push(makeObstacle(kind, spawnX, nextObstacleId, nextGroupId));
  }

  const lastObstacle = obstacles.at(-1)!;
  const groupSpan = lastObstacle.x + lastObstacle.width - obstacles[0].x;
  const difficultyBase = elapsed < 20 ? 1.75 : elapsed < 55 ? 1.45 : 1.25;
  const chromeLikeMinGap = lastObstacle.width * speed + difficultyBase;
  const randomizedGap = chromeLikeMinGap * (1 + random() * 0.5);
  const nextHistory = [...history, ...obstacles.map((item) => item.kind)].slice(-2);
  return {
    obstacles,
    history: nextHistory,
    nextObstacleId: nextObstacleId + obstacles.length,
    nextGroupId: nextGroupId + 1,
    nextSpawnIn: groupSpan + randomizedGap,
  };
}

function boxesOverlap(left: CollisionBox, right: CollisionBox): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.bottom < right.bottom + right.height
    && left.bottom + left.height > right.bottom;
}

function playerBoxes(state: RunnerState): CollisionBox[] {
  const lift = state.y;
  if (state.crouching) {
    return [{ x: RUNNER_PLAYER_X + 0.08, bottom: lift + 0.05, width: 0.78, height: 0.4 }];
  }
  return [
    { x: RUNNER_PLAYER_X + 0.13, bottom: lift + 0.52, width: 0.55, height: 0.41 },
    { x: RUNNER_PLAYER_X + 0.18, bottom: lift + 0.19, width: 0.59, height: 0.48 },
    { x: RUNNER_PLAYER_X + 0.24, bottom: lift + 0.03, width: 0.48, height: 0.26 },
  ];
}

function obstacleBox(obstacle: RunnerObstacle): CollisionBox {
  const horizontalInset = obstacle.kind === "rock"
    ? 0.12
    : obstacle.kind === "stump"
      ? 0.1
      : obstacle.kind === "log"
        ? 0.08
        : 0.06;
  const verticalInset = obstacle.kind === "bird" ? 0.04 : 0.05;
  return {
    x: obstacle.x + horizontalInset,
    bottom: obstacle.bottom + verticalInset,
    width: obstacle.width - horizontalInset * 2,
    height: obstacle.height - verticalInset * 2,
  };
}

export function runnerCollides(state: RunnerState, obstacle: RunnerObstacle): boolean {
  const target = obstacleBox(obstacle);
  return playerBoxes(state).some((box) => boxesOverlap(box, target));
}

export function stepRunner(
  state: RunnerState,
  delta: number,
  _worldWidth: number,
  random: () => number = Math.random,
): RunnerState {
  if (state.status !== "playing" || delta <= 0) return state;
  const dt = Math.min(delta, 0.05);
  const elapsed = state.elapsed + dt;
  const speed = runnerSpeed(elapsed);
  const distance = state.distance + speed * dt;
  let velocityY = state.velocityY;
  let y = state.y;
  if (y > 0 || velocityY > 0) {
    y += velocityY * dt - 0.5 * RUNNER_GRAVITY * dt * dt;
    velocityY -= RUNNER_GRAVITY * dt;
    if (y <= 0 && velocityY < 0) {
      y = 0;
      velocityY = 0;
    }
  }
  let obstacles = state.obstacles
    .map((obstacle) => ({ ...obstacle, x: obstacle.x - speed * dt }))
    .filter((obstacle) => obstacle.x + obstacle.width > -0.5);
  let nextSpawnIn = state.nextSpawnIn - speed * dt;
  let nextObstacleId = state.nextObstacleId;
  let nextGroupId = state.nextGroupId;
  let obstacleHistory = state.obstacleHistory;
  if (nextSpawnIn <= 0) {
    const generated = generateObstacleGroup(elapsed, speed, nextObstacleId, nextGroupId, random, obstacleHistory);
    obstacles = [...obstacles, ...generated.obstacles];
    nextSpawnIn += generated.nextSpawnIn;
    nextObstacleId = generated.nextObstacleId;
    nextGroupId = generated.nextGroupId;
    obstacleHistory = generated.history;
  }
  const crouching = state.crouchHeld && y <= 0.001;
  const nextState: RunnerState = {
    ...state,
    elapsed,
    distance,
    score: runnerScore(distance),
    speed,
    y,
    velocityY,
    crouching,
    obstacles,
    obstacleHistory,
    nextObstacleId,
    nextGroupId,
    nextSpawnIn,
  };
  return {
    ...nextState,
    status: obstacles.some((obstacle) => runnerCollides(nextState, obstacle)) ? "gameover" : "playing",
  };
}
