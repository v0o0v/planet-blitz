/**
 * Replay recording, playback and deterministic state hashing (ADR-0005).
 *
 * A replay is fully described by a seed plus the per-tick input log. Re-running
 * `[seed + inputs]` through the world must reproduce the exact same state on any
 * platform. To verify that cheaply we hash the world state after every tick and
 * compare hash streams — the client records hashes live, the server recomputes
 * them from the submitted replay, and any divergence flags a mismatch.
 *
 * The hash is FNV-1a (32-bit). Floating-point fields are hashed by their raw
 * IEEE-754 bit pattern (via a DataView), so two states hash equal only if every
 * double is bit-identical — the strongest possible determinism check.
 */

import type { InputFrame, WorldState, WorldConfig } from './world.js';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from './world.js';
import type { Entity } from './entities.js';
import { KIND_CODE } from './entities.js';
import { normalizeMaintenance } from './defense.js';

/** A recorded run: everything needed to deterministically reproduce it. */
export interface Replay {
  seed: number;
  /** Optional config override; defaults are assumed when absent. */
  config?: WorldConfig;
  /** Input frame for each tick, in order. */
  inputs: InputFrame[];
}

// ---------------------------------------------------------------------------
// FNV-1a hashing with exact float64 bit patterns.
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const scratch = new ArrayBuffer(8);
const scratchF64 = new Float64Array(scratch);
const scratchBytes = new Uint8Array(scratch);

function fnvByte(hash: number, byte: number): number {
  return Math.imul(hash ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/** Fold a float64's 8 raw bytes into the running hash. */
function hashFloat(hash: number, value: number): number {
  scratchF64[0] = value;
  let h = hash;
  for (let i = 0; i < 8; i++) {
    h = fnvByte(h, scratchBytes[i] as number);
  }
  return h;
}

/** Fold a uint32 into the running hash. */
function hashU32(hash: number, value: number): number {
  let h = hash;
  h = fnvByte(h, value & 0xff);
  h = fnvByte(h, (value >>> 8) & 0xff);
  h = fnvByte(h, (value >>> 16) & 0xff);
  h = fnvByte(h, (value >>> 24) & 0xff);
  return h;
}

function hashEntity(hash: number, e: Entity): number {
  let h = hash;
  h = hashU32(h, e.id);
  h = hashU32(h, KIND_CODE[e.kind]);
  h = hashFloat(h, e.x);
  h = hashFloat(h, e.y);
  h = hashFloat(h, e.vx);
  h = hashFloat(h, e.vy);
  h = hashFloat(h, e.angle);
  h = hashFloat(h, e.radius);
  h = hashFloat(h, e.hp);
  h = hashFloat(h, e.maxHp);
  h = hashU32(h, e.timer >>> 0);
  h = hashU32(h, e.dashCooldown >>> 0);
  h = hashU32(h, e.iframes >>> 0);
  h = hashU32(h, e.enemyType >>> 0);
  h = hashU32(h, e.cooldown >>> 0);
  h = hashU32(h, e.phase >>> 0);
  h = hashU32(h, e.life >>> 0);
  h = hashFloat(h, e.damage);
  h = hashU32(h, e.pierce >>> 0);
  h = hashFloat(h, e.targetX);
  h = hashFloat(h, e.targetY);
  h = hashU32(h, e.ownerId >>> 0);
  // `dead` is transient (always false at hash time) and is deliberately omitted.
  return h;
}

/**
 * Deterministic 32-bit hash of a world state. Captures tick, RNG stream states,
 * weapon/wave runtime and every entity field (floats by exact bit pattern).
 */
export function hashWorld(state: WorldState): number {
  let h = FNV_OFFSET;
  h = hashU32(h, state.tick >>> 0);
  h = hashU32(h, state.rng.getState());
  h = hashU32(h, state.waveRng.getState());
  h = hashU32(h, state.powerupRng.getState());
  h = hashU32(h, state.supplyRng.getState());
  h = hashU32(h, state.worldRng.getState());
  // World config (arena size, movement/dash/i-frame tuning). Two runs with
  // different configs must hash apart even before any entity diverges.
  const cfg = state.config;
  h = hashFloat(h, cfg.arenaWidth);
  h = hashFloat(h, cfg.arenaHeight);
  h = hashFloat(h, cfg.playerSpeed);
  h = hashFloat(h, cfg.dashSpeed);
  h = hashU32(h, cfg.dashCooldownTicks >>> 0);
  h = hashU32(h, cfg.dashIframes >>> 0);
  h = hashU32(h, cfg.hitIframes >>> 0);
  h = hashFloat(h, cfg.playerHp);
  // Weapon stats (mutated by Phase 3 powerups) — every amplification hook.
  const w = state.weapon;
  h = hashU32(h, w.fireCooldown >>> 0);
  h = hashFloat(h, w.bulletSpeed);
  h = hashFloat(h, w.damage);
  h = hashU32(h, w.bulletCount >>> 0);
  h = hashFloat(h, w.spread);
  h = hashU32(h, w.pierce >>> 0);
  h = hashFloat(h, w.bulletRadius);
  h = hashFloat(h, w.range);
  h = hashU32(h, w.bulletLife >>> 0);
  // Wave runtime. (구 segmentTimer 위치를 segmentElapsed가 그대로 승계 — 폴드 순서 불변.)
  h = hashU32(h, state.wave.segmentIndex >>> 0);
  h = hashU32(h, state.wave.segmentElapsed >>> 0);
  h = hashU32(h, state.wave.cardTimer >>> 0);
  h = hashU32(h, state.wave.boss ? 1 : 0);
  h = hashU32(h, state.wave.done ? 1 : 0);
  h = hashU32(h, state.kills >>> 0);
  h = hashU32(h, state.gems >>> 0);
  // Progression (Phase 3).
  h = hashU32(h, state.xp >>> 0);
  h = hashU32(h, state.xpTotal >>> 0);
  h = hashU32(h, state.level >>> 0);
  h = hashU32(h, state.combo >>> 0);
  h = hashU32(h, state.comboTimer >>> 0);
  h = hashU32(h, state.maxCombo >>> 0);
  h = hashFloat(h, state.magnetRadius);
  h = hashU32(h, state.magnetBuffTicks >>> 0);
  h = hashU32(h, state.resources >>> 0);
  h = hashU32(h, state.pendingLevelUp ? 1 : 0);
  h = hashU32(h, state.powerupChoices.length >>> 0);
  for (const c of state.powerupChoices) h = hashU32(h, c >>> 0);
  h = hashU32(h, state.supplyNextIndex >>> 0);
  h = hashU32(h, state.bossSpawned ? 1 : 0);
  h = hashU32(h, state.gameOver ? 1 : 0);
  h = hashU32(h, state.victory ? 1 : 0);
  h = hashU32(h, state.entities.length >>> 0);
  for (const e of state.entities) {
    h = hashEntity(h, e);
  }
  // --- M2 farming loop (APPEND-ONLY; never reorder the folds above) ---
  // Weapon archetype, the new RNG streams, the resolved anomaly, the loadout-
  // derived config block and the collected loot are all determinism inputs, so
  // they must be captured. Appended at the very end so M1's field order is
  // untouched (a format bump vs recorded M1 hashes is accepted, plan §2/§6).
  h = hashU32(h, state.weapon.weaponType >>> 0);
  h = hashU32(h, state.dropRng.getState());
  h = hashU32(h, state.eliteRng.getState());
  h = hashU32(h, state.anomalyRng.getState());
  h = hashU32(h, (state.anomaly.kind & 0xffff) >>> 0);
  h = hashU32(h, state.anomaly.active ? 1 : 0);
  const cfg2 = state.config;
  h = hashU32(h, (cfg2.planet ?? 0) >>> 0);
  h = hashU32(h, (cfg2.tier ?? 0) >>> 0);
  h = hashU32(h, cfg2.anomalyAccepted ? 1 : 0);
  const lo = cfg2.loadout;
  h = hashU32(h, lo ? 1 : 0);
  if (lo !== undefined) {
    h = hashU32(h, lo.weaponType >>> 0);
    h = hashU32(h, lo.subWeaponType >>> 0);
    h = hashFloat(h, lo.damageMult);
    h = hashFloat(h, lo.fireRateMult);
    h = hashU32(h, lo.bulletCountAdd >>> 0);
    h = hashU32(h, lo.pierceAdd >>> 0);
    h = hashFloat(h, lo.bulletSpeedMult);
    h = hashFloat(h, lo.spreadAdd);
    h = hashFloat(h, lo.rangeAdd);
    h = hashFloat(h, lo.moveSpeedMult);
    h = hashFloat(h, lo.maxHpAdd);
    h = hashFloat(h, lo.dashCdMult);
    h = hashFloat(h, lo.magnetMult);
    h = hashFloat(h, lo.xpMult);
    h = hashU32(h, lo.uniqueMask >>> 0);
    // M3 원소 어픽스 파생(상태이상) — loadout 블록 뒤에 append-only.
    h = hashU32(h, lo.fireDmg >>> 0);
    h = hashU32(h, lo.coldSlow >>> 0);
    h = hashU32(h, lo.lightning >>> 0);
  }
  h = hashU32(h, state.loot.length >>> 0);
  for (const r of state.loot) {
    h = hashU32(h, r.seed >>> 0);
    h = hashU32(h, r.rarity >>> 0);
    h = hashU32(h, r.planet >>> 0);
    h = hashU32(h, r.tier >>> 0);
  }
  // --- M3 (APPEND-ONLY; never reorder the folds below or above) ---
  // 통합 시 확정한 순서: (1) Lane2 감속 잔여 틱 → (2) Lane1 스킬 투자 스냅샷.
  // 이 순서는 이후 절대 변경 금지. 신규 M3 필드는 아래 (2) 뒤에만 append.
  // (1) 플레이어 감속 잔여 틱(감속 지대). 결정론 입력이므로 접는다.
  h = hashU32(h, state.playerSlowTicks >>> 0);
  // (2) 스킬 투자 스냅샷: 빌드 시점에 cfg.loadout에 이미 접혔지만, 재현/감사용으로
  // 접는다 — 스킬 유/무 런이 발산 전에도 해시가 갈리고, 서버가 벡터를 정확히 재도출.
  // 길이 프리픽스로 미존재/빈 벡터를 구분.
  const invest = state.config.skillInvest;
  h = hashU32(h, (invest?.length ?? 0) >>> 0);
  if (invest !== undefined) {
    for (const v of invest) h = hashU32(h, v >>> 0);
  }
  // (3) 튜토리얼 단축판 세그먼트 상한(결정론 입력). 미존재(풀 런)=0, 존재=값+1로
  // 접어 undefined와 0을 구분한다. 신규 필드는 이 아래에만 append.
  const maxSeg = state.config.maxSegments;
  h = hashU32(h, (maxSeg === undefined ? 0 : maxSeg + 1) >>> 0);
  // (4) 처치 할당 게이트 상태(ADR-0011): 세그먼트 진입 시 kills 스냅샷 + 현재 세그먼트
  // 목표 처치 수. 결정론 상태이므로 접는다(급행 소환 램프의 segmentElapsed는 위 wave
  // runtime 블록에서 이미 접힘). 신규 필드는 이 아래에만 append.
  h = hashU32(h, state.wave.segmentBaseKills >>> 0);
  h = hashU32(h, state.wave.segmentKillGoal >>> 0);
  // --- M4 침공 방어 배치(APPEND-ONLY, 조건부) ---
  // PvE 런은 config.invasion이 undefined라 이 블록을 통째로 건너뛴다 → 기존 fixtures 해시가
  // 바이트 단위로 완전 불변(방어 엔티티도 PvE엔 없어 위 엔티티 루프도 불변). 침공 런만 제한
  // 시간·배치(코어·포탑 유형/좌표·장애물 AABB)를 결정론 입력으로 접어, 서버가 정확한 config로
  // 재현했는지 검증한다(방어 엔티티 스폰으로 이미 발산하지만 config 자체도 봉인). 신규 침공
  // 필드는 이 블록 안 최후미에만 append.
  const inv = state.config.invasion;
  if (inv !== undefined) {
    h = hashU32(h, inv.timeLimitTicks >>> 0);
    const lay = inv.layout;
    h = hashFloat(h, lay.core.x);
    h = hashFloat(h, lay.core.y);
    h = hashU32(h, lay.turrets.length >>> 0);
    for (const t of lay.turrets) {
      h = hashU32(h, t.type >>> 0);
      h = hashFloat(h, t.x);
      h = hashFloat(h, t.y);
    }
    h = hashU32(h, lay.obstacles.length >>> 0);
    for (const o of lay.obstacles) {
      h = hashFloat(h, o.x);
      h = hashFloat(h, o.y);
      h = hashFloat(h, o.halfW);
      h = hashFloat(h, o.halfH);
    }
    // 정비도(풍화, ADR-0006) — 정수 centi-percent(정규화 본). 침공 블록 최후미에 append.
    // 미지정(완전 정비)과 명시 10000 이 같은 값으로 접혀 거동과 정합한다. 정비도를 위조
    // (예: 방치 기지를 100% 라 주장)하면 서버가 권위 정비도로 재실행 → 발사 간격이 달라져
    // 엔티티 상태부터 발산하고, 이 폴드로 config 자체도 봉인된다. 신규 침공 필드는 이 아래.
    h = hashU32(h, normalizeMaintenance(inv.maintenance) >>> 0);
    // --- M5 수호 기체(APPEND-ONLY, 이중 조건부) ---
    // guardians 필드가 없거나 빈 배열이면 이 블록을 통째로 건너뛴다 → **수호 미포함 침공/PvE
    // 런의 해시가 바이트 단위로 완전 불변**(기존 M4 fixtures 회귀 0). 수호 포함 런만 스냅샷·
    // 성능%·계보 보너스·좌표를 결정론 입력으로 접어, 서버가 권위 값으로 재현했는지 봉인한다
    // (수호 엔티티 스폰으로 이미 발산하지만 config 자체도 함께 봉인 — 정비도 폴드와 동일 철학).
    // 신규 수호 필드는 이 스냅샷 폴드 최후미에만 append.
    const gs = lay.guardians;
    if (gs !== undefined && gs.length > 0) {
      h = hashU32(h, gs.length >>> 0);
      for (const g of gs) {
        h = hashFloat(h, g.x);
        h = hashFloat(h, g.y);
        h = hashU32(h, (g.performanceCP ?? 0) >>> 0);
        h = hashU32(h, (g.lineageBonusBp ?? 0) >>> 0);
        const s = g.snapshot;
        h = hashU32(h, s.preset >>> 0);
        h = hashFloat(h, s.radius);
        h = hashFloat(h, s.hp);
        h = hashFloat(h, s.contactDamage);
        h = hashU32(h, s.fireCooldown >>> 0);
        h = hashFloat(h, s.bulletDamage);
        h = hashFloat(h, s.bulletSpeed);
        h = hashFloat(h, s.bulletRadius);
        h = hashU32(h, s.bulletLife >>> 0);
        h = hashFloat(h, s.range);
        h = hashFloat(h, s.moveSpeed);
        h = hashFloat(h, s.standoff);
        // --- M5 계보 마일스톤(APPEND-ONLY, 조건부) ---
        // 마일스톤 비트마스크가 0(미해금)이면 **아무것도 접지 않아** 마일스톤 이전에 기록된 수호
        // 포함 리플레이의 해시가 바이트 단위로 완전 불변이다(하위 호환 — 필드 미존재 = 0 = 무접기).
        // 마일스톤 해금 런만 마스크를 봉인해, 서버가 권위 계보 레벨로 재도출한 마스크와 대조한다
        // (부풀린 마일스톤 위조는 재실행 발산 + 이 폴드 불일치로 이중 차단). 신규 필드는 이 아래.
        const ms = (g.milestones ?? 0) >>> 0;
        if (ms !== 0) h = hashU32(h, ms);
      }
    }
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Recording & playback.
// ---------------------------------------------------------------------------

/**
 * Records the input log of a live run so it can be replayed/verified later.
 * The host loop calls {@link record} once per tick with the resolved input.
 */
export class ReplayRecorder {
  readonly seed: number;
  readonly config: WorldConfig;
  private readonly inputs: InputFrame[] = [];

  constructor(seed: number, config: WorldConfig = DEFAULT_CONFIG) {
    this.seed = seed;
    this.config = config;
  }

  record(input: InputFrame): void {
    // Store a copy so later mutation of a shared input object cannot corrupt it.
    this.inputs.push({ ...input });
  }

  get length(): number {
    return this.inputs.length;
  }

  toReplay(): Replay {
    return { seed: this.seed, config: this.config, inputs: this.inputs.map((i) => ({ ...i })) };
  }
}

/** Result of replaying a run to completion. */
export interface ReplayResult {
  finalState: WorldState;
  /** Hash of the world after each tick, in order. Length === inputs.length. */
  hashes: number[];
  /** Hash of the final state (also equal to the last element of `hashes`). */
  finalHash: number;
}

/**
 * Run a replay from scratch, capturing the per-tick state hash. Deterministic:
 * calling this twice with the same replay yields identical hash arrays.
 */
export function runReplay(replay: Replay): ReplayResult {
  const state = createWorld(replay.seed, replay.config ?? DEFAULT_CONFIG);
  const hashes: number[] = [];
  for (const input of replay.inputs) {
    stepWorld(state, input);
    hashes.push(hashWorld(state));
  }
  const finalHash = hashes.length > 0 ? (hashes[hashes.length - 1] as number) : hashWorld(state);
  return { finalState: state, hashes, finalHash };
}

/**
 * Advance an existing world by a full input log, returning per-tick hashes.
 * Useful for driving a live world while also collecting a hash stream.
 */
export function stepThrough(state: WorldState, inputs: InputFrame[]): number[] {
  const hashes: number[] = [];
  for (const input of inputs) {
    stepWorld(state, input);
    hashes.push(hashWorld(state));
  }
  return hashes;
}

/** Convenience: an input log of `n` idle ticks. */
export function idleInputs(n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    out.push(emptyInput());
  }
  return out;
}
