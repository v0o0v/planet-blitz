/**
 * 아르케(Arke) 행성 로스터 — M3 네 번째 행성(plan B2, AC4).
 *
 * 고대 기계 테마의 잡몹 4종(돌격·사수·특수·지원 역할 슬롯) + 엘리트 2종. 기존 컴포넌트
 * 엔진(src/sim/patterns)을 재사용하며 데이터 행만 추가한다. 고대 기계답게 개체는
 * 느리되 단단하고 정밀한 포격으로 압박한다(니플헤임의 빠른 유령 함대와 대비).
 *
 * typeIndex는 니플헤임(10~15) 뒤에 append(16~21). ENEMY_BY_TYPE(data/enemies.ts)에
 * 전역 순서로 등록되어 enemyDefFor가 entity.enemyType으로 역참조한다 — 절대 재번호
 * 금지(해시/리플레이 불변).
 *
 * 주의(렌더/엔진): 특수형 '분쇄 토템'은 엔진 재사용을 위해 HAZARD_LAVA 해저드 서브
 * 타입을 그대로 쓴다(기계적으로 동일한 지속 장판, 렌더가 기계 비주얼로 분화 가능).
 *
 * 밸런스 수치는 M3 1차 튜닝값(spec §5) — 재미 게이트 루프에서 이동 예정.
 */

import type { EnemyDef, EnemyRole } from '../../src/sim/patterns/types.js';
import type { WaveCard } from '../waves.js';

// --- 잡몹 4종(역할 슬롯) ---------------------------------------------------

/** 파쇄 골렘 — 돌격형: 느리지만 단단하게 밀어붙이고 충돌 시 파편을 흩뿌린다. */
export const CRUSHER_GOLEM: EnemyDef = {
  id: 'arke-crusher-golem',
  role: 'charger',
  typeIndex: 16,
  radius: 38,
  hp: 42,
  contactDamage: 13,
  speed: 250,
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 5, speed: 500, damage: 6, bulletRadius: 6, bulletLife: 72 },
  fireCooldown: 52,
  xpValue: 4,
};

/** 정밀 포탑 — 사수형: 긴 윈드업의 고위력 정밀 포격을 원거리에서 지정. */
export const PRECISION_TURRET: EnemyDef = {
  id: 'arke-precision-turret',
  role: 'gunner',
  typeIndex: 17,
  radius: 34,
  hp: 30,
  contactDamage: 8,
  speed: 150,
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 54, radius: 130, damage: 19 },
  fireCooldown: 128,
  xpValue: 5,
};

/** 분쇄 토템 — 특수형: 뿌리내린 채 기계 기둥 라인을 융기(HAZARD_LAVA 재사용). */
export const GRIND_TOTEM: EnemyDef = {
  id: 'arke-grind-totem',
  role: 'special',
  typeIndex: 18,
  radius: 46,
  hp: 70,
  contactDamage: 10,
  speed: 0,
  movement: 'stationary',
  attack: { kind: 'lava', windup: 56, activeTicks: 100, pillars: 7, radius: 96, damage: 10 },
  fireCooldown: 210,
  xpValue: 9,
};

/** 복원 드로이드 — 지원형: 손상된 기계에 붙어 지속 수복(우선 처치 대상). */
export const RESTORE_DROID: EnemyDef = {
  id: 'arke-restore-droid',
  role: 'support',
  typeIndex: 19,
  radius: 30,
  hp: 34,
  contactDamage: 6,
  speed: 250,
  movement: 'seekWounded',
  attack: { kind: 'heal', range: 240, healPerTick: 5 },
  fireCooldown: 12,
  xpValue: 6,
};

// --- 엘리트 2종 -------------------------------------------------------------

/** 수호 포대 — 엘리트: 완강한 정밀 포탑 변종. 광역 정밀 포격 + 높은 체력. */
export const GUARDIAN_BATTERY: EnemyDef = {
  id: 'arke-guardian-battery',
  role: 'gunner',
  typeIndex: 20,
  radius: 48,
  hp: 240,
  contactDamage: 15,
  speed: 140,
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 50, radius: 210, damage: 24 },
  fireCooldown: 100,
  xpValue: 19,
};

/** 고대 파괴자 — 엘리트: 단단하게 돌격하며 파편을 살포하는 기계 군단 핵심. */
export const ANCIENT_BREAKER: EnemyDef = {
  id: 'arke-ancient-breaker',
  role: 'charger',
  typeIndex: 21,
  radius: 54,
  hp: 300,
  contactDamage: 20,
  speed: 250,
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 10, speed: 520, damage: 8, bulletRadius: 6, bulletLife: 80 },
  fireCooldown: 74,
  xpValue: 21,
};

/** 아르케 역할 로스터(웨이브 카드가 역할로 참조). */
export const ARKE_ROSTER: Record<EnemyRole, EnemyDef> = {
  charger: CRUSHER_GOLEM,
  gunner: PRECISION_TURRET,
  special: GRIND_TOTEM,
  support: RESTORE_DROID,
};

/** 아르케 엘리트 정예(웨이브 카드가 elite 인덱스로 참조). */
export const ARKE_ELITES: readonly EnemyDef[] = [GUARDIAN_BATTERY, ANCIENT_BREAKER];

/** ENEMY_BY_TYPE append 순서용(니플헤임 뒤 16~21). */
export const ARKE_DEFS: readonly EnemyDef[] = [
  CRUSHER_GOLEM,
  PRECISION_TURRET,
  GRIND_TOTEM,
  RESTORE_DROID,
  GUARDIAN_BATTERY,
  ANCIENT_BREAKER,
];

/**
 * 아르케 웨이브 카드 풀. 고대 기계답게 단단한 돌격 + 정밀 원거리 포격을 섞고, 후반
 * 카드에서 엘리트 2종(수호 포대·고대 파괴자)을 정예 스폰으로 편성한다.
 */
export const ARKE_CARD_POOL: readonly WaveCard[] = [
  { id: 'ark-golem-push', formation: 'line', spawns: [{ role: 'charger', count: 4 }] },
  { id: 'ark-turret-line', formation: 'edges', spawns: [{ role: 'gunner', count: 4 }] },
  {
    id: 'ark-mixed-legion',
    formation: 'ring',
    spawns: [
      { role: 'charger', count: 2 },
      { role: 'gunner', count: 3 },
    ],
  },
  { id: 'ark-totem-field', formation: 'cluster', spawns: [{ role: 'special', count: 2 }] },
  {
    id: 'ark-droid-escort',
    formation: 'ring',
    spawns: [
      { role: 'support', count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
  {
    id: 'ark-heavy-column',
    formation: 'edges',
    spawns: [
      { role: 'special', count: 1 },
      { role: 'gunner', count: 2 },
      { role: 'support', count: 1 },
    ],
  },
  {
    id: 'ark-battery-guard',
    formation: 'edges',
    spawns: [
      { elite: 0, count: 1 },
      { role: 'gunner', count: 2 },
    ],
  },
  {
    id: 'ark-breaker-charge',
    formation: 'line',
    spawns: [
      { elite: 1, count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
];
