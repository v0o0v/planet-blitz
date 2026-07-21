/**
 * 침공 L3 — 코어방 기물 레지스트리 (M7a · L5-core-room).
 *
 * 기물은 코어방의 **정적 방어 구조물**이다. 배치 스키마상 기물 슬롯은
 * `InvasionLayers.l3.props[i]`(= {@link InvasionRef})뿐이고 **좌표를 담지 않는다** — 소켓
 * 인덱스 i 가 곧 위치이기 때문이다({@link PROP_SOCKET_OFFSETS}). 좌표를 스키마에서 빼면
 * ①위조 표면이 줄고(좌표 조작 불가) ②SQL·EF·클라 3자가 대조할 필드가 줄며 ③배치 UI 가
 * "어느 소켓에 무엇을" 만 고르면 되어 단순해진다.
 *
 * 결정론(ADR-0005): 전부 정수 리터럴 + 정수 산술. RNG·wall-clock 미사용.
 * 배열 인덱스 = `catalogId` 계약이며 **append-only** 다(M7c 풀 카탈로그는 뒤에만 추가).
 */

import { HAZARD_MORTAR, HAZARD_SLOW } from '../../src/sim/patterns/types.js';
import { TWO_PI, cos, sin } from '../../src/sim/math.js';

// ---------------------------------------------------------------------------
// 기물 역할 코드 (엔티티 `enemyType` 에 실려 스텝 디스패치·렌더 분화를 겸한다)
// ---------------------------------------------------------------------------

/** ① 실드 발생기: 살아 있는 동안 코어에 재생 보호막을 건다(= 먼저 파괴 강제). */
export const PROP_SHIELD_GENERATOR = 0;
/** ② 중력 앵커: 주기적으로 플레이어 위치에 감속 장판(HAZARD_SLOW)을 융기시킨다. */
export const PROP_GRAVITY_ANCHOR = 1;
/** ③ 고정 주포: 사거리·LOS 안의 플레이어에게 단발 직사한다(선회 없음). */
export const PROP_FIXED_CANNON = 2;
/**
 * ④ 회복 파일런(M7c): 주기적으로 **반경 안의 아군 방어체**(보스·수호·다른 기물)를 정수 회복한다.
 * 유일하게 플레이어를 직접 건드리지 않는 역할이라, "처치 우선순위를 뒤트는" 압박이 본질이다.
 */
export const PROP_REPAIR_PYLON = 3;
/**
 * ⑤ 기만 홀로그램(M7c): 코어와 같은 실루엣·조준 우선순위를 갖는 **가짜 코어**.
 *
 * 이 역할만 엔티티 kind 가 `'prop'` 이 아니라 **`'decoyCore'`** 다. `'core'` 로 만들면
 * `compact()` 가 파괴 즉시 `victory` 를 세워 침공이 가짜 코어로 끝난다(world.ts 의 core→victory
 * 경로는 kind 로만 판별한다). 유니크 '신기루 코어'가 이미 같은 이유로 별도 kind 를 쓴 선례를
 * 그대로 따른다. 모듈이 스폰하는 신기루 코어와 구분하려고 `enemyType` 에 이 역할 코드를
 * 싣는다(모듈 신기루는 `enemyType === -1`).
 */
export const PROP_DECOY_HOLOGRAM = 4;
/**
 * ⑥ 자폭 지뢰군(M7c): 자기 주위 고정 링 좌표에 폭발 지뢰(단발 HAZARD_MORTAR)를 순차 부설한다.
 * 중력 앵커가 **플레이어를 따라다니는 감속**이라면 이쪽은 **기물 주변 고정 지역 거부**다 —
 * "이 기물에 붙어서 때리면 아프다"가 역할이라 서로 겹치지 않는다.
 */
export const PROP_MINE_SWARM = 5;
/** 기물 역할 수. */
export const PROP_ROLE_COUNT = 6;

/**
 * 기물 1종의 스펙. 역할별로 쓰지 않는 필드는 0 이다(TurretSpec 선례 — 플랫 구조가 분기 없는
 * 데이터 검증·직렬화를 쉽게 한다).
 */
export interface PropSpec {
  /** 안정 식별자. i18n 키 = `def3.prop.<id>.name` / `.desc`(L9 카탈로그 규약). */
  readonly id: string;
  /** 역할 코드(PROP_* — 스텝 디스패치 키). */
  readonly role: number;
  /** 내구도(플레이어 탄에 파괴됨). */
  readonly hp: number;
  /** 히트박스 반지름. */
  readonly radius: number;
  /** [실드 발생기] 코어에 공급하는 보호막 HP(1기당). 그 외 0. */
  readonly shieldHp: number;
  /**
   * [중력 앵커·회복 파일런·자폭 지뢰군] 주기 행동의 재장전 간격(틱). 정비도로 스케일. 그 외 0.
   */
  readonly periodTicks: number;
  /** [중력 앵커·자폭 지뢰군] 장판/지뢰 반지름 · 예열 · 활성 · 피해. 그 외 0. */
  readonly hazardRadius: number;
  readonly hazardWindup: number;
  readonly hazardActive: number;
  readonly hazardDamage: number;
  /**
   * [고정 주포] 사거리 / [회복 파일런] 회복 반경 / [자폭 지뢰군] 지뢰 부설 링 반지름.
   * 그 외 0. 셋 다 "이 기물이 영향을 미치는 거리"라 한 필드를 공유한다.
   */
  readonly range: number;
  readonly fireCooldown: number;
  readonly damage: number;
  readonly bulletSpeed: number;
  readonly bulletRadius: number;
  readonly bulletLife: number;
  /** [회복 파일런] 펄스당 회복량(강화 3축으로 스케일). 그 외 0. */
  readonly healAmount: number;
  /**
   * [자폭 지뢰군] 부설 링의 고정 슬롯 수. 펄스마다 슬롯을 하나씩 돌며 지뢰를 깐다 —
   * 좌표가 슬롯 인덱스의 순수 함수라 RNG 없이도 부설 위치가 흩어진다. 그 외 0.
   */
  readonly patternCount: number;
}

/**
 * 기물 카탈로그. **배열 인덱스 = catalogId(계약, append-only)**.
 * M7a 임시 카탈로그 3종 → M7c 에서 6종으로 확장(뒤에만 추가).
 */
export const L3_PROPS: readonly PropSpec[] = [
  // ① 실드 발생기 — 스스로 공격하지 않는 대신 코어를 통째로 막는다. 코어를 때리기 전에
  //    반드시 이걸 먼저 부수게 만드는 것이 존재 이유(공격 순서 강제).
  {
    id: 'shieldGenerator',
    role: PROP_SHIELD_GENERATOR,
    hp: 900,
    radius: 52,
    shieldHp: 1400,
    periodTicks: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    hazardDamage: 0,
    range: 0,
    fireCooldown: 0,
    damage: 0,
    bulletSpeed: 0,
    bulletRadius: 0,
    bulletLife: 0,
    healAmount: 0,
    patternCount: 0,
  },
  // ② 중력 앵커 — 감속 지대(M3 HAZARD_SLOW 재사용)를 주기적으로 깔아 회피 여유를 깎는다.
  {
    id: 'gravityAnchor',
    role: PROP_GRAVITY_ANCHOR,
    hp: 700,
    radius: 46,
    shieldHp: 0,
    periodTicks: 180,
    hazardRadius: 300,
    hazardWindup: 30,
    hazardActive: 150,
    hazardDamage: 3,
    range: 0,
    fireCooldown: 0,
    damage: 0,
    bulletSpeed: 0,
    bulletRadius: 0,
    bulletLife: 0,
    healAmount: 0,
    patternCount: 0,
  },
  // ③ 고정 주포 — 코어방의 순수 화력. 사거리·LOS 게이트는 포탑과 동일 규율.
  {
    id: 'fixedCannon',
    role: PROP_FIXED_CANNON,
    hp: 800,
    radius: 48,
    shieldHp: 0,
    periodTicks: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    hazardDamage: 0,
    range: 1050,
    fireCooldown: 66,
    damage: 16,
    bulletSpeed: 900,
    bulletRadius: 11,
    bulletLife: 140,
    healAmount: 0,
    patternCount: 0,
  },
  // ④ 회복 파일런(M7c) — 스스로는 아무도 때리지 않지만, 살려 두면 보스·수호·다른 기물이
  //    계속 되살아난다. 파일런을 먼저 지울 것인가 보스를 계속 밀 것인가의 선택을 만든다.
  {
    id: 'repairPylon',
    role: PROP_REPAIR_PYLON,
    hp: 620,
    radius: 44,
    shieldHp: 0,
    periodTicks: 120,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    hazardDamage: 0,
    range: 620,
    fireCooldown: 0,
    damage: 0,
    bulletSpeed: 0,
    bulletRadius: 0,
    bulletLife: 0,
    healAmount: 40,
    patternCount: 0,
  },
  // ⑤ 기만 홀로그램(M7c) — 코어와 같은 실루엣·조준 우선순위를 갖는 가짜 코어. 파괴해도
  //    승리가 서지 않는다(kind = decoyCore). 자동 조준을 통째로 낭비시키는 것이 화력이다.
  {
    id: 'decoyHologram',
    role: PROP_DECOY_HOLOGRAM,
    hp: 2200,
    radius: 88,
    shieldHp: 0,
    periodTicks: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    hazardDamage: 0,
    range: 0,
    fireCooldown: 0,
    damage: 0,
    bulletSpeed: 0,
    bulletRadius: 0,
    bulletLife: 0,
    healAmount: 0,
    patternCount: 0,
  },
  // ⑥ 자폭 지뢰군(M7c) — 자기 주위 링에 단발 폭발 지뢰를 순차 부설한다. 근접 사격 자세를
  //    벌주는 지역 거부. 예열이 짧아 "붙으면 아프다"가 즉시 읽힌다.
  {
    id: 'mineSwarm',
    role: PROP_MINE_SWARM,
    hp: 540,
    radius: 42,
    shieldHp: 0,
    periodTicks: 96,
    hazardRadius: 150,
    hazardWindup: 24,
    hazardActive: 18,
    hazardDamage: 14,
    range: 260,
    fireCooldown: 0,
    damage: 0,
    bulletSpeed: 0,
    bulletRadius: 0,
    bulletLife: 0,
    healAmount: 0,
    patternCount: 6,
  },
];

/** 등록된 기물 수. */
export const L3_PROP_COUNT = L3_PROPS.length;

/**
 * catalogId → 스펙. 범위 밖은 `null`(빈 소켓 취급)이다. 보스와 달리 폴백하지 않는다 —
 * 기물은 "비움"이 정상 상태이므로(결정 #22: 빈 기물 소켓은 기본 수비대 충원 대상 아님),
 * 미지의 catalogId 를 임의 기물로 승격시키면 방어자가 배치하지 않은 화력이 생긴다.
 */
export function propSpec(catalogId: number): PropSpec | null {
  const s = L3_PROPS[catalogId];
  return s !== undefined ? s : null;
}

// ---------------------------------------------------------------------------
// 소켓 좌표 (코어 상대 오프셋 — 인덱스 = props 배열 인덱스)
// ---------------------------------------------------------------------------

/**
 * 기물 소켓 6개의 **코어 상대 오프셋**(정수 월드 유닛). 인덱스 = `l3.props` 인덱스.
 * 코어(반지름 90)를 둘러싼 반지름 360 링에 6등분 배치한다 — 어느 방향에서 진입해도 최소
 * 2기가 사선에 걸리도록 대칭으로 두었다. 좌표는 **정수 리터럴**이라 f64 삼각함수 파생이
 * 재현을 가르지 않는다(코어 좌표 자체도 정수라 절대 좌표도 정수).
 */
export const PROP_SOCKET_OFFSETS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 0, y: -360 },
  { x: 312, y: -180 },
  { x: 312, y: 180 },
  { x: 0, y: 360 },
  { x: -312, y: 180 },
  { x: -312, y: -180 },
];

/** 방어 보스의 **코어 상대** 스폰 오프셋(정수). 코어 앞(진입 방향)에 선다. */
export const DEFENSE_BOSS_SPAWN_OFFSET = { x: 0, y: -560 } as const;

// ---------------------------------------------------------------------------
// 강화 3축 → 스탯 스케일
// ---------------------------------------------------------------------------

/*
 * M7c 밸런스 패스(C7-balance) 재배분 — 600/2000/1200 → 140/2400/1500.
 * 이유는 `data/invasion/defenseBosses.ts` 의 같은 블록과 동일하다(레벨 축 독주 해소).
 */

/** 레벨 1단계당 전투력 가산(bp). */
export const PROP_LEVEL_BP = 140;
/** 승급 1단계당 전투력 가산(bp). */
export const PROP_ASCENSION_BP = 2400;
/** 등급 1단계당 전투력 가산(bp). */
export const PROP_RARITY_BP = 1500;

/**
 * 기물 강화 3축 → 전투력 배율(basis-point, 10000 = ×1.00). 정수 덧셈만 쓴다.
 * HP·피해·보호막에만 적용하고 기하(반지름·사거리·탄속)와 주기(틱)는 건드리지 않는다.
 */
export function propPowerBp(level: number, ascension: number, rarity: number): number {
  const lv = level < 1 ? 1 : Math.trunc(level);
  const asc = ascension < 0 ? 0 : Math.trunc(ascension);
  const rar = rarity < 0 ? 0 : Math.trunc(rarity);
  return 10000 + (lv - 1) * PROP_LEVEL_BP + asc * PROP_ASCENSION_BP + rar * PROP_RARITY_BP;
}

/** 중력 앵커 장판 subtype(코어방 스텝이 spawnHazard 에 넘긴다). */
export const PROP_SLOW_SUBTYPE = HAZARD_SLOW;

/** 자폭 지뢰군 지뢰 subtype(단발 폭발 — 감속 장판과 색·거동이 갈린다). */
export const PROP_MINE_SUBTYPE = HAZARD_MORTAR;

/**
 * 회복 파일런 펄스 1회가 아군 방어체 하나를 회복시키는 양. 강화 3축 배율을 적용한 정수다.
 * 데이터가 정본이고 스텝은 이 함수만 부른다 — 회복 산식이 sim 쪽에 흩어지지 않게.
 */
export function propHealAmount(spec: PropSpec, powerBp: number): number {
  if (spec.healAmount <= 0) return 0;
  const v = Math.round((spec.healAmount * powerBp) / 10000);
  return v < 1 ? 1 : v;
}

/**
 * 자폭 지뢰군의 `slot` 번째 부설 좌표(기물 상대 오프셋). 슬롯 인덱스의 순수 함수라 RNG 없이
 * 부설 위치가 링을 돈다. 반환은 f64 지만 **상태에 누적되지 않고** 매 펄스 슬롯에서 새로
 * 계산되므로 f64 누적 오차가 쌓일 자리가 없다(같은 슬롯 → 항상 같은 값).
 */
export function mineRingOffset(spec: PropSpec, slot: number): { x: number; y: number } {
  const n = spec.patternCount > 0 ? spec.patternCount : 1;
  const i = ((slot % n) + n) % n;
  // 삼각함수는 반드시 src/sim/math.ts 의 결정론 구현을 쓴다(ADR-0005 — 내장 Math.sin/cos 는
  // 정확 반올림이 보장되지 않아 Node↔Deno 재현 대조를 가른다).
  const ang = (i * TWO_PI) / n;
  return { x: cos(ang) * spec.range, y: sin(ang) * spec.range };
}
