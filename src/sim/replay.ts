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
import { INVASION_HASH_VERSION } from './invasion/constants.js';
import { GUARDIAN_SNAPSHOT_FIELDS } from './invasion/normalize.js';
import type {
  Invasion3Config,
  InvasionGuardianPlacement,
  InvasionRef,
  InvasionRuntime,
} from './invasion/types.js';

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

/** 엔티티 필드 1건을 접는 방식. `f64` = IEEE-754 8바이트 원문, `u32` = ToUint32 4바이트. */
export type EntityFoldMode = 'f64' | 'u32';

/**
 * `hashEntity` 의 폴드 레이아웃 **골든 계약**(M7a 에서 aux0/aux1 append 로 1회 확정).
 *
 * 이 배열은 문서가 아니라 테스트가 강제하는 계약이다 — tests/invasionHash.test.ts 가 이
 * 목록만 보고 독립 구현으로 해시를 재계산해 {@link hashEntity} 와 바이트 비교한다. 따라서
 * 코드와 배열 중 **한쪽만** 바뀌면 즉시 실패한다. 순서·모드 변경은 곧 리플레이 포맷 변경이므로
 * 기존 항목은 재배치 금지, 신규 필드는 **맨 뒤에만 append**(M7b/M7c 는 aux 재활용이 원칙).
 * `dead` 는 해시 시점에 항상 false 인 과도 상태라 의도적으로 제외한다.
 */
export const ENTITY_HASH_LAYOUT: readonly (readonly [keyof Entity, EntityFoldMode])[] = [
  ['id', 'u32'],
  // kind 는 KIND_CODE 를 거쳐 u32 로 접힌다(여기서는 원본 필드명으로 표기).
  ['kind', 'u32'],
  ['x', 'f64'],
  ['y', 'f64'],
  ['vx', 'f64'],
  ['vy', 'f64'],
  ['angle', 'f64'],
  ['radius', 'f64'],
  ['hp', 'f64'],
  ['maxHp', 'f64'],
  ['timer', 'u32'],
  ['dashCooldown', 'u32'],
  ['iframes', 'u32'],
  ['enemyType', 'u32'],
  ['cooldown', 'u32'],
  ['phase', 'u32'],
  ['life', 'u32'],
  ['damage', 'f64'],
  ['pierce', 'u32'],
  ['targetX', 'f64'],
  ['targetY', 'f64'],
  ['ownerId', 'u32'],
  // --- M7a 범용 확장 슬롯(APPEND-ONLY, **조건부 꼬리**) ---
  // aux0·aux1 이 **둘 다 0 이면 이 두 폴드는 생략**된다(기존 리플레이 바이트 불변). 어느
  // 한쪽이라도 0 이 아니면 둘 다 이 순서로 접힌다. 골든 테스트는 aux 가 0 이 아닌 엔티티로
  // 순서를 대조하고, 0 인 경우는 "생략" 을 별도로 검증한다.
  ['aux0', 'u32'],
  ['aux1', 'u32'],
];

/** 조건부 꼬리(둘 다 0 이면 생략되는 폴드)의 필드 이름. 골든 테스트가 참조한다. */
export const ENTITY_HASH_OPTIONAL_TAIL: readonly (keyof Entity)[] = ['aux0', 'aux1'];

/**
 * 엔티티 1건을 해시에 접는다. 순서·모드는 {@link ENTITY_HASH_LAYOUT} 이 정본이다.
 * (테스트가 독립 구현과 대조할 수 있도록 export 한다 — 런타임 호출부는 hashWorld 뿐이다.)
 */
export function hashEntity(hash: number, e: Entity): number {
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
  // --- M7a 범용 확장 슬롯(APPEND-ONLY, 조건부) ---
  // 둘 다 0 이면 **아무것도 접지 않는다** → aux 를 쓰지 않는 기존 엔티티(PvE 전량·구 침공
  // 전량)의 해시가 바이트 단위로 완전 불변이다(계보 마일스톤 폴드와 같은 규율). 덕분에
  // fixtures.json 과 tests/defenseCardSim.test.ts 의 골든 해시가 그대로 살아 회귀 가드가
  // 유지된다. 어느 한쪽이라도 0 이 아니면 **둘 다** 고정 폭으로 접는다(부분 폴드 금지 —
  // (1,0) 과 (0,1) 이 갈려야 한다).
  if (e.aux0 !== 0 || e.aux1 !== 0) {
    h = hashU32(h, e.aux0 >>> 0);
    h = hashU32(h, e.aux1 >>> 0);
  }
  // `dead` is transient (always false at hash time) and is deliberately omitted.
  return h;
}

// ---------------------------------------------------------------------------
// 침공 3레이어 해시 블록 v2 (M7a · L1-determinism)
//
// ## 왜 v2 인가
// 구 침공 블록(아래 `config.invasion` 분기)은 침공 → 수호 → 마일스톤 → 카드로 조건부 접기가
// 4단 중첩돼 있다. 3레이어 배치(웨이브 6 · 소켓 N · 기물 6 · 모듈 2 · 보스 · 코어)와 런타임
// 페이즈 상태를 그 위에 얹으면 5단이 되고, **순서를 한 곳만 틀려도 클라(Node)와 서버(Deno)
// 재실행이 갈려 전 침공이 오거부**된다. 그래서 3레이어는 중첩을 늘리지 않고 **평탄한 별도
// 블록**으로 새로 판다.
//
// ## 평탄 직렬화 규율
//   - 조건부 접기가 없다. 슬롯이 비어 있어도 `있음 플래그(0) + 필드 0` 를 **항상 같은 바이트
//     수만큼** 접는다. "비었으니 안 접는다" 규칙이 없으면 순서 실수 자체가 생기지 않는다.
//   - 전 필드 정수다(hashU32 만 쓴다). 스키마가 정수 도메인으로 확정돼 있어(L0) hashFloat 가
//     필요 없고, 그만큼 f64 비트 표현 갈림의 여지도 사라진다.
//   - 길이 프리픽스로 배열을 감싸 소켓 수가 다른 맵 템플릿이 서로 다른 해시를 낸다.
//
// ## 하위 호환
// `config.invasion3` 이 없으면 블록을 통째로 건너뛴다 → **PvE·구 침공 리플레이는 이 블록에
// 관해 바이트 불변**이다(엔티티 aux 폴드만 fixtures 재생성으로 흡수). 구 침공 블록은 한 줄도
// 수정하지 않았다 — 신·구 병존이 M7a 웨이브 0~2 의 정상 상태이고, 삭제는 L11 레인 몫이다.
// ---------------------------------------------------------------------------

/** Ref 5필드 폴드 폭(있음 플래그 제외). 슬롯이 비어도 같은 폭을 0 으로 채운다. */
const REF_FOLD_WIDTH = 5;

/** 배치 참조 1건(있음 플래그 + 정수 5필드). null 이면 전부 0 — 폭은 항상 같다. */
function hashRefSlot(hash: number, ref: InvasionRef | null | undefined): number {
  let h = hash;
  if (ref === null || ref === undefined) {
    h = hashU32(h, 0);
    for (let i = 0; i < REF_FOLD_WIDTH; i++) h = hashU32(h, 0);
    return h;
  }
  h = hashU32(h, 1);
  h = hashU32(h, ref.catalogId >>> 0);
  h = hashU32(h, ref.level >>> 0);
  h = hashU32(h, ref.ascension >>> 0);
  h = hashU32(h, ref.affixSeed >>> 0);
  h = hashU32(h, ref.rarity >>> 0);
  return h;
}

/** 고정 길이 슬롯 배열(길이 프리픽스 + 슬롯별 고정 폭). */
function hashRefSlots(hash: number, slots: readonly (InvasionRef | null)[]): number {
  let h = hashU32(hash, slots.length >>> 0);
  for (const s of slots) h = hashRefSlot(h, s);
  return h;
}

/**
 * 수호 배치 1기(있음 플래그 + 좌표·성능·계보·마일스톤 + 스냅샷 12필드).
 * 스냅샷 필드 순서는 {@link GUARDIAN_SNAPSHOT_FIELDS}(정규화 모듈의 직렬화 계약)를 그대로
 * 따른다 — 순서 정의가 두 군데로 갈리지 않게 한 곳만 읽는다.
 */
function hashGuardianSlot(hash: number, g: InvasionGuardianPlacement | null | undefined): number {
  let h = hash;
  if (g === null || g === undefined) {
    h = hashU32(h, 0);
    for (let i = 0; i < 5 + GUARDIAN_SNAPSHOT_FIELDS.length; i++) h = hashU32(h, 0);
    return h;
  }
  h = hashU32(h, 1);
  h = hashU32(h, g.x >>> 0);
  h = hashU32(h, g.y >>> 0);
  h = hashU32(h, g.performanceCP >>> 0);
  h = hashU32(h, g.lineageBonusBp >>> 0);
  h = hashU32(h, g.milestones >>> 0);
  const snap = g.snapshot as unknown as Record<string, number>;
  for (const key of GUARDIAN_SNAPSHOT_FIELDS) {
    h = hashU32(h, (snap[key as string] ?? 0) >>> 0);
  }
  return h;
}

/**
 * 3레이어 설정·런타임의 보유자 뷰.
 *
 * `WorldConfig.invasion3` 와 `WorldState.invasion3`(런타임)·`invasion3Bombs` 는 world.ts 소유
 * 레인(L2)이 선언한다. 통합 게이트에서 실제 필드명(`invasion3`)으로 확정했다 — 최초 계약안의
 * `invasionRuntime` 은 world.ts 에 존재하지 않아 런타임 폴드가 항상 present=0 으로 접히는
 * '봉인 미작동' 결함이었다.
 */
interface Invasion3Carrier {
  readonly config: { readonly invasion3?: Invasion3Config };
  readonly invasion3?: InvasionRuntime;
  readonly invasion3Bombs?: number;
}

function invasion3Of(state: WorldState): Invasion3Carrier {
  return state as unknown as Invasion3Carrier;
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
    // --- 방어 카드(APPEND-ONLY, 조건부) ---
    // config.invasion.card 가 없으면(카드 미장착) 이 블록을 통째로 건너뛴다 → **카드 미장착 침공·
    // PvE 리플레이의 해시가 바이트 단위로 완전 불변**(기존 M4/M5 fixtures 회귀 0). 카드 장착 런만
    // 카드 정체성(seed·잔여 횟수)과 해석된 결정론 효력 파라미터(정적 누적·트리거 임계·유니크·런 중
    // 래치)를 접어, 서버가 권위 카드·매치업으로 재도출한 값과 대조한다(위조 시 재실행 발산 + 이
    // 폴드 불일치로 이중 차단). 매 틱 재계산 배율(*Mult)은 파생 스크래치라 접지 않는다(엔티티
    // 상태로 이미 해시에 반영). 신규 카드 필드는 이 블록 최후미에만 append.
    const card = inv.card;
    const cr = state.cardRuntime;
    if (card !== undefined && cr !== undefined) {
      h = hashU32(h, card.card.seed >>> 0);
      h = hashU32(h, card.card.chargesLeft >>> 0);
      h = hashU32(h, cr.staticTurretDamagePct >>> 0);
      h = hashU32(h, cr.staticIncomingReductionPct >>> 0);
      h = hashU32(h, cr.attackerSubCdPct >>> 0);
      h = hashU32(h, cr.reflectPct >>> 0);
      h = hashU32(h, cr.coreHpPct >>> 0);
      h = hashU32(h, cr.furyFireRatePct >>> 0);
      h = hashU32(h, cr.furyThreshold >>> 0);
      h = hashU32(h, cr.vanguardFireRatePct >>> 0);
      h = hashU32(h, cr.vanguardTicks >>> 0);
      h = hashU32(h, cr.laststandTurretDamagePct >>> 0);
      h = hashU32(h, cr.laststandPct >>> 0);
      h = hashU32(h, cr.attritionSlowPct >>> 0);
      h = hashU32(h, cr.attritionTicks >>> 0);
      h = hashU32(h, cr.entrenchReductionPct >>> 0);
      h = hashU32(h, cr.entrenchTicks >>> 0);
      h = hashU32(h, cr.forcefieldShield >>> 0);
      h = hashU32(h, cr.volleyDamage >>> 0);
      h = hashU32(h, cr.reviveCount >>> 0);
      h = hashU32(h, cr.reviveHpPct >>> 0);
      h = hashU32(h, cr.decoyHpPct >>> 0);
      h = hashU32(h, cr.decoyCount >>> 0);
      h = hashU32(h, cr.blackoutTicksLeft >>> 0);
      h = hashU32(h, cr.coreProximityFired ? 1 : 0);
      h = hashU32(h, cr.initialTurretCount >>> 0);
    }
  }
  // --- M7a 침공 3레이어 v2 (APPEND-ONLY, 조건부 · 평탄 직렬화) ---
  // 규율과 근거는 파일 상단 "침공 3레이어 해시 블록 v2" 주석 참조. 신규 3레이어 필드는
  // **이 블록 최후미(런타임 폴드 뒤)에만** append 한다.
  const carrier = invasion3Of(state);
  const inv3 = carrier.config.invasion3;
  if (inv3 !== undefined) {
    // (0) 포맷 버전 — 블록 첫 폴드. 포맷이 또 바뀌면 이 값만 올리면 구·신이 즉시 갈린다.
    h = hashU32(h, INVASION_HASH_VERSION >>> 0);
    // (1) 런 예산·정비도.
    h = hashU32(h, inv3.timeLimitTicks >>> 0);
    h = hashU32(h, normalizeMaintenance(inv3.maintenance) >>> 0);
    const L = inv3.layers;
    // (2) L1 — 웨이브 슬롯(고정 길이 6).
    h = hashRefSlots(h, L.l1.waveSlots);
    // (3) L2 — 맵 템플릿 + 설치 소켓(템플릿이 길이를 정하므로 길이 프리픽스가 곧 템플릿 봉인).
    h = hashU32(h, L.l2.templateId >>> 0);
    h = hashRefSlots(h, L.l2.sockets);
    // (4) L3 — 보스 → 수호 → 기물 → 코어 → 코어 모듈.
    h = hashRefSlot(h, L.l3.boss);
    h = hashU32(h, L.l3.guardians.length >>> 0);
    for (const g of L.l3.guardians) h = hashGuardianSlot(h, g);
    h = hashRefSlots(h, L.l3.props);
    h = hashU32(h, L.l3.core.hp >>> 0);
    h = hashU32(h, L.l3.core.x >>> 0);
    h = hashU32(h, L.l3.core.y >>> 0);
    h = hashRefSlots(h, L.l3.modules);
    // (5) 런타임 페이즈 상태(sim 권위 카메라·페이즈 머신, L2 레인 소유).
    // 페이즈 전이 틱이 해시에 들어가야 "언제 전이했는가"가 봉인된다 — 전이 틱만 다른 두 런은
    // 엔티티가 같아 보이는 순간에도 여기서 갈린다. 런타임이 아직 없으면(배선 전) 0 으로 접어
    // 폭을 유지한다.
    const rt = carrier.invasion3;
    h = hashU32(h, rt === undefined ? 0 : 1);
    h = hashU32(h, (rt?.phase ?? 0) >>> 0);
    h = hashU32(h, (rt?.phaseEnterTick ?? 0) >>> 0);
    h = hashU32(h, (rt?.scrollX ?? 0) >>> 0);
    h = hashU32(h, (rt?.scrollY ?? 0) >>> 0);
    h = hashU32(h, (rt?.accelCp ?? 0) >>> 0);
    // (6) 레이어 클리어 보너스로 적립되는 폭탄(정수, 상한 3). 자원 위조를 봉인한다.
    h = hashU32(h, (carrier.invasion3Bombs ?? 0) >>> 0);
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
