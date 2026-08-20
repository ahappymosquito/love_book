// 小花「花田拾光」引擎：设备无关物理、跳蹲输入、连跳与短按收跳、拾光物、连击、小心心、光景章节和剪影碰撞。

export const RUNNER_STEP = 1 / 60;
export const RUNNER_BASE_SPEED = 3.15;
export const RUNNER_MAX_SPEED = 5.1;
export const RUNNER_ACCELERATION = 0.015;
export const RUNNER_STANDING_HEIGHT = 1;
export const RUNNER_AIRTIME = 0.88;
export const RUNNER_JUMP_APEX = 1.45;
export const RUNNER_GRAVITY = (8 * RUNNER_JUMP_APEX) / (RUNNER_AIRTIME * RUNNER_AIRTIME);
export const RUNNER_JUMP_VELOCITY = (4 * RUNNER_JUMP_APEX) / RUNNER_AIRTIME;
export const RUNNER_DOUBLE_JUMP_SCALE = 0.88;
export const RUNNER_PLAYER_X = 0.78;
export const RUNNER_BIRD_START = 18;
export const RUNNER_DOUBLE_START = 40;
export const RUNNER_DOUBLE_JUMP_START = 22;
export const RUNNER_ACTION_WINDOW = 1.08;
export const RUNNER_JUMP_BUFFER = 0.1;
export const RUNNER_HIT_IFRAMES = 1.15;
export const RUNNER_STARTING_LIVES = 2;
export const RUNNER_MAX_LIVES = 3;
export const RUNNER_NEAR_MISS_PAD = 0.14;
export const RUNNER_PICKUP_POINTS = { petal: 6, heart: 12, letter: 22 } as const;
export const RUNNER_NEAR_MISS_POINTS = 4;
export const RUNNER_CHAPTER_AT = { noon: 22, dusk: 48, night: 80 } as const;

export type RunnerStatus = "idle" | "playing" | "paused" | "gameover";
export type RunnerObstacleKind = "rock" | "stump" | "log" | "bramble" | "bird";
export type RunnerActionRequirement = "jump" | "crouch";
export type RunnerPointerAction = "jump" | "crouch" | null;
export type RunnerPickupKind = "petal" | "heart" | "letter";
export type RunnerChapterId = "dawn" | "noon" | "dusk" | "night";

export interface RunnerPointerInput {
  pointerType: string;
  button: number;
  clientX: number;
  bounds: { left: number; width: number };
}

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

export interface RunnerPickup {
  id: number;
  x: number;
  width: number;
  height: number;
  bottom: number;
  kind: RunnerPickupKind;
}

export interface RunnerPopup {
  id: number;
  x: number;
  y: number;
  text: string;
  age: number;
}

export interface RunnerState {
  status: RunnerStatus;
  elapsed: number;
  distance: number;
  score: number;
  bonusScore: number;
  speed: number;
  y: number;
  velocityY: number;
  crouchHeld: boolean;
  crouching: boolean;
  jumpHeld: boolean;
  jumpCut: boolean;
  jumpBuffer: number;
  jumpsRemaining: number;
  lives: number;
  invincibleFor: number;
  combo: number;
  maxCombo: number;
  petals: number;
  letters: number;
  chapter: RunnerChapterId;
  obstacles: RunnerObstacle[];
  pickups: RunnerPickup[];
  popups: RunnerPopup[];
  obstacleHistory: RunnerObstacleKind[];
  clearedObstacleIds: number[];
  nextObstacleId: number;
  nextGroupId: number;
  nextPickupId: number;
  nextPopupId: number;
  nextSpawnIn: number;
  shake: number;
  landDust: number;
}

const OBSTACLE_SPECS: Record<RunnerObstacleKind, Omit<RunnerObstacle, "id" | "groupId" | "x" | "kind">> = {
  rock: { width: 0.78, height: 0.57, bottom: 0, requirement: "jump" },
  stump: { width: 0.68, height: 0.72, bottom: 0, requirement: "jump" },
  log: { width: 1.02, height: 0.43, bottom: 0, requirement: "jump" },
  bramble: { width: 0.98, height: 0.48, bottom: 0, requirement: "jump" },
  bird: { width: 0.94, height: 0.37, bottom: 0.53, requirement: "crouch" },
};

const PICKUP_SIZE: Record<RunnerPickupKind, { width: number; height: number }> = {
  petal: { width: 0.34, height: 0.34 },
  heart: { width: 0.36, height: 0.34 },
  letter: { width: 0.38, height: 0.3 },
};

export const RUNNER_CHAPTER_LABELS: Record<RunnerChapterId, string> = {
  dawn: "晨光花田",
  noon: "午后微风",
  dusk: "黄昏小路",
  night: "星夜归途",
};

export interface CollisionBox {
  x: number;
  bottom: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function runnerPointerAction(input: RunnerPointerInput): RunnerPointerAction {
  if (input.pointerType === "mouse") {
    if (input.button === 0) return "jump";
    if (input.button === 2) return "crouch";
    return null;
  }
  const midpoint = input.bounds.left + input.bounds.width / 2;
  return input.clientX < midpoint ? "crouch" : "jump";
}

export function createRunnerMetrics(viewport: RunnerViewport): RunnerMetrics {
  const safeWidth = Math.max(1, viewport.width);
  const safeHeight = Math.max(1, viewport.height);
  const portrait = safeHeight > safeWidth;
  const width = Math.floor(safeWidth);
  const height = Math.floor(safeHeight);
  const standingHeight = portrait
    ? clamp(height * 0.145, 104, 136)
    : clamp(height * 0.198, 96, 180);
  const bodyUnit = standingHeight * 0.96;
  const spriteSize = standingHeight * (192 / 146);
  const worldWidth = width / bodyUnit;
  return {
    orientation: portrait ? "portrait" : "landscape",
    frame: { x: 0, y: 0, width, height },
    groundBaseline: Math.round(height * 0.705),
    standingHeight,
    bodyUnit,
    spriteSize,
    worldWidth,
    playerScreenX: RUNNER_PLAYER_X * bodyUnit,
  };
}

export function runnerChapter(elapsed: number): RunnerChapterId {
  if (elapsed < RUNNER_CHAPTER_AT.noon) return "dawn";
  if (elapsed < RUNNER_CHAPTER_AT.dusk) return "noon";
  if (elapsed < RUNNER_CHAPTER_AT.night) return "dusk";
  return "night";
}

export function runnerChapterLabel(elapsed: number): string {
  return RUNNER_CHAPTER_LABELS[runnerChapter(elapsed)];
}

export function runnerMaxJumps(elapsed: number): number {
  return elapsed >= RUNNER_DOUBLE_JUMP_START ? 2 : 1;
}

export function runnerComboMultiplier(combo: number): number {
  return 1 + Math.min(10, Math.max(0, combo)) * 0.2;
}

export function createRunnerState(): RunnerState {
  return {
    status: "idle",
    elapsed: 0,
    distance: 0,
    score: 0,
    bonusScore: 0,
    speed: RUNNER_BASE_SPEED,
    y: 0,
    velocityY: 0,
    crouchHeld: false,
    crouching: false,
    jumpHeld: false,
    jumpCut: false,
    jumpBuffer: 0,
    jumpsRemaining: 1,
    lives: RUNNER_STARTING_LIVES,
    invincibleFor: 0,
    combo: 0,
    maxCombo: 0,
    petals: 0,
    letters: 0,
    chapter: "dawn",
    obstacles: [],
    pickups: [],
    popups: [],
    obstacleHistory: [],
    clearedObstacleIds: [],
    nextObstacleId: 1,
    nextGroupId: 1,
    nextPickupId: 1,
    nextPopupId: 1,
    nextSpawnIn: RUNNER_BASE_SPEED * 0.55,
    shake: 0,
    landDust: 0,
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

function launchJump(state: RunnerState, velocity: number, remaining: number): RunnerState {
  return {
    ...state,
    crouching: false,
    jumpHeld: true,
    jumpCut: false,
    jumpBuffer: 0,
    velocityY: velocity,
    jumpsRemaining: remaining,
  };
}

export function jumpRunner(state: RunnerState): RunnerState {
  if (state.status !== "playing") return { ...state, jumpHeld: true };
  const grounded = state.y <= 0.001;
  if (grounded) {
    return launchJump(state, RUNNER_JUMP_VELOCITY, runnerMaxJumps(state.elapsed) - 1);
  }
  if (state.jumpsRemaining > 0 && state.elapsed >= RUNNER_DOUBLE_JUMP_START) {
    return launchJump(state, RUNNER_JUMP_VELOCITY * RUNNER_DOUBLE_JUMP_SCALE, state.jumpsRemaining - 1);
  }
  return { ...state, jumpHeld: true, jumpBuffer: RUNNER_JUMP_BUFFER };
}

export function releaseRunnerJump(state: RunnerState): RunnerState {
  return { ...state, jumpHeld: false };
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

export function runnerTotalScore(distance: number, bonusScore: number): number {
  return runnerScore(distance) + Math.max(0, Math.floor(bonusScore));
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

function makePickup(kind: RunnerPickupKind, x: number, bottom: number, id: number): RunnerPickup {
  return { id, x, bottom, kind, ...PICKUP_SIZE[kind] };
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

export function generatePickupsForGroup(
  obstacles: RunnerObstacle[],
  elapsed: number,
  combo: number,
  nextPickupId: number,
  random: () => number = Math.random,
): { pickups: RunnerPickup[]; nextPickupId: number } {
  const pickups: RunnerPickup[] = [];
  let id = nextPickupId;
  const first = obstacles[0];
  if (first && first.requirement === "jump" && random() < (elapsed < 4 ? 0.55 : 0.88)) {
    pickups.push(makePickup("petal", first.x + first.width * 0.18, 0.98, id));
    id += 1;
  }
  const bird = obstacles.find((item) => item.kind === "bird");
  if (bird && random() < 0.62) {
    pickups.push(makePickup("petal", bird.x + bird.width * 0.2, 1.08, id));
    id += 1;
  }
  if (elapsed >= RUNNER_CHAPTER_AT.noon && combo >= 2 && random() < 0.28) {
    const last = obstacles.at(-1)!;
    pickups.push(makePickup("letter", last.x + last.width + 0.42, 1.58, id));
    id += 1;
  }
  if (elapsed >= 26 && random() < 0.14) {
    pickups.push(makePickup("heart", first.x - 0.95, 0.52, id));
    id += 1;
  }
  return { pickups, nextPickupId: id };
}

function boxesOverlap(left: CollisionBox, right: CollisionBox): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.bottom < right.bottom + right.height
    && left.bottom + left.height > right.bottom;
}

export function playerBoxes(state: RunnerState): CollisionBox[] {
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

export function obstacleBox(obstacle: RunnerObstacle): CollisionBox {
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

function pickupBox(pickup: RunnerPickup): CollisionBox {
  return {
    x: pickup.x + 0.04,
    bottom: pickup.bottom + 0.03,
    width: pickup.width - 0.08,
    height: pickup.height - 0.06,
  };
}

export function runnerCollides(state: RunnerState, obstacle: RunnerObstacle): boolean {
  const target = obstacleBox(obstacle);
  return playerBoxes(state).some((box) => boxesOverlap(box, target));
}

export function runnerCollects(state: RunnerState, pickup: RunnerPickup): boolean {
  const target = pickupBox(pickup);
  return playerBoxes(state).some((box) => boxesOverlap(box, target));
}

function isNearMiss(state: RunnerState, obstacle: RunnerObstacle): boolean {
  const box = obstacleBox(obstacle);
  const padded: CollisionBox = {
    x: box.x - RUNNER_NEAR_MISS_PAD,
    bottom: box.bottom - RUNNER_NEAR_MISS_PAD,
    width: box.width + RUNNER_NEAR_MISS_PAD * 2,
    height: box.height + RUNNER_NEAR_MISS_PAD * 2,
  };
  return playerBoxes(state).some((box) => boxesOverlap(box, padded));
}

function pushPopup(state: Pick<RunnerState, "popups" | "nextPopupId">, x: number, y: number, text: string): Pick<RunnerState, "popups" | "nextPopupId"> {
  return {
    popups: [...state.popups, { id: state.nextPopupId, x, y, text, age: 0 }].slice(-8),
    nextPopupId: state.nextPopupId + 1,
  };
}

function awardPoints(bonusScore: number, combo: number, base: number): number {
  return bonusScore + Math.round(base * runnerComboMultiplier(combo));
}

export function stepRunner(
  state: RunnerState,
  delta: number,
  _worldWidth: number,
  random: () => number = Math.random,
): RunnerState {
  if (state.status !== "playing" || delta <= 0) return state;
  const dt = Math.min(delta, 0.05);
  const previousElapsed = state.elapsed;
  const elapsed = previousElapsed + dt;
  const speed = runnerSpeed(elapsed);
  const distance = state.distance + speed * dt;
  const chapter = runnerChapter(elapsed);
  let velocityY = state.velocityY;
  let y = state.y;
  let jumpCut = state.jumpCut;
  let jumpsRemaining = state.jumpsRemaining;
  let jumpBuffer = Math.max(0, state.jumpBuffer - dt);
  let landDust = Math.max(0, state.landDust - dt);
  const wasAirborne = state.y > 0.001;

  if (!state.jumpHeld && !jumpCut && velocityY > 0) {
    velocityY *= 0.42;
    jumpCut = true;
  }

  if (y > 0 || velocityY > 0) {
    y += velocityY * dt - 0.5 * RUNNER_GRAVITY * dt * dt;
    velocityY -= RUNNER_GRAVITY * dt;
    if (y <= 0 && velocityY < 0) {
      y = 0;
      velocityY = 0;
    }
  }

  if (wasAirborne && y <= 0.001) {
    landDust = 0.28;
    jumpCut = false;
    jumpsRemaining = runnerMaxJumps(elapsed);
    if (jumpBuffer > 0) {
      velocityY = RUNNER_JUMP_VELOCITY;
      jumpsRemaining = runnerMaxJumps(elapsed) - 1;
      jumpBuffer = 0;
      jumpCut = false;
      y = 0;
    }
  }

  if (previousElapsed < RUNNER_DOUBLE_JUMP_START && elapsed >= RUNNER_DOUBLE_JUMP_START && y > 0.001) {
    jumpsRemaining += 1;
  }

  let obstacles = state.obstacles
    .map((obstacle) => ({ ...obstacle, x: obstacle.x - speed * dt }))
    .filter((obstacle) => obstacle.x + obstacle.width > -0.5);
  let pickups = state.pickups
    .map((pickup) => ({ ...pickup, x: pickup.x - speed * dt }))
    .filter((pickup) => pickup.x + pickup.width > -0.5);
  let nextSpawnIn = state.nextSpawnIn - speed * dt;
  let nextObstacleId = state.nextObstacleId;
  let nextGroupId = state.nextGroupId;
  let nextPickupId = state.nextPickupId;
  let obstacleHistory = state.obstacleHistory;
  if (nextSpawnIn <= 0) {
    const generated = generateObstacleGroup(elapsed, speed, nextObstacleId, nextGroupId, random, obstacleHistory);
    const extra = generatePickupsForGroup(generated.obstacles, elapsed, state.combo, nextPickupId, random);
    obstacles = [...obstacles, ...generated.obstacles];
    pickups = [...pickups, ...extra.pickups];
    nextSpawnIn += generated.nextSpawnIn;
    nextObstacleId = generated.nextObstacleId;
    nextGroupId = generated.nextGroupId;
    nextPickupId = extra.nextPickupId;
    obstacleHistory = generated.history;
  }

  const crouching = state.crouchHeld && y <= 0.001;
  let nextState: RunnerState = {
    ...state,
    elapsed,
    distance,
    score: runnerTotalScore(distance, state.bonusScore),
    speed,
    y,
    velocityY,
    crouching,
    jumpCut,
    jumpBuffer,
    jumpsRemaining,
    chapter,
    obstacles,
    pickups,
    obstacleHistory,
    nextObstacleId,
    nextGroupId,
    nextPickupId,
    nextSpawnIn,
    landDust,
    invincibleFor: Math.max(0, state.invincibleFor - dt),
    shake: Math.max(0, state.shake - dt),
    popups: state.popups
      .map((popup) => ({ ...popup, age: popup.age + dt, y: popup.y + dt * 0.55 }))
      .filter((popup) => popup.age < 0.7),
  };

  if (previousElapsed < RUNNER_DOUBLE_JUMP_START && elapsed >= RUNNER_DOUBLE_JUMP_START) {
    const announced = pushPopup(nextState, RUNNER_PLAYER_X, nextState.y + 1.05, "可以再跳一次");
    nextState = { ...nextState, ...announced };
  }

  for (const pickup of [...nextState.pickups]) {
    if (!runnerCollects(nextState, pickup)) continue;
    const points = RUNNER_PICKUP_POINTS[pickup.kind];
    const bonusScore = awardPoints(nextState.bonusScore, nextState.combo, points);
    let lives = nextState.lives;
    let petals = nextState.petals;
    let letters = nextState.letters;
    let label = `+${Math.round(points * runnerComboMultiplier(nextState.combo))}`;
    if (pickup.kind === "petal") petals += 1;
    if (pickup.kind === "letter") letters += 1;
    if (pickup.kind === "heart") {
      if (lives < RUNNER_MAX_LIVES) {
        lives += 1;
        label = "小心心 +1";
      }
    }
    const popup = pushPopup(nextState, pickup.x, pickup.bottom + pickup.height, label);
    nextState = {
      ...nextState,
      ...popup,
      lives,
      petals,
      letters,
      bonusScore,
      score: runnerTotalScore(nextState.distance, bonusScore),
      pickups: nextState.pickups.filter((item) => item.id !== pickup.id),
    };
  }

  let combo = nextState.combo;
  let maxCombo = nextState.maxCombo;
  let bonusScore = nextState.bonusScore;
  let clearedObstacleIds = nextState.clearedObstacleIds;
  let popups = nextState.popups;
  let nextPopupId = nextState.nextPopupId;
  for (const obstacle of nextState.obstacles) {
    if (obstacle.x + obstacle.width > RUNNER_PLAYER_X) continue;
    if (clearedObstacleIds.includes(obstacle.id)) continue;
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    clearedObstacleIds = [...clearedObstacleIds, obstacle.id].slice(-24);
    if (isNearMiss(nextState, obstacle)) {
      bonusScore = awardPoints(bonusScore, combo, RUNNER_NEAR_MISS_POINTS);
      const popup = pushPopup({ popups, nextPopupId }, obstacle.x, obstacle.bottom + obstacle.height + 0.2, "擦肩");
      popups = popup.popups;
      nextPopupId = popup.nextPopupId;
    }
  }
  nextState = {
    ...nextState,
    combo,
    maxCombo,
    bonusScore,
    score: runnerTotalScore(nextState.distance, bonusScore),
    clearedObstacleIds,
    popups,
    nextPopupId,
  };

  const hitting = nextState.invincibleFor <= 0 && nextState.obstacles.some((obstacle) => runnerCollides(nextState, obstacle));
  if (!hitting) return nextState;
  if (nextState.lives > 1) {
    return {
      ...nextState,
      lives: nextState.lives - 1,
      combo: 0,
      invincibleFor: RUNNER_HIT_IFRAMES,
      shake: 0.22,
      velocityY: Math.max(nextState.velocityY, RUNNER_JUMP_VELOCITY * 0.28),
      crouching: false,
    };
  }
  return { ...nextState, lives: 0, combo: 0, shake: 0.28, status: "gameover" };
}
