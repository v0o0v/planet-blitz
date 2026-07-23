/**
 * 크라스(Kras) 행성 로스터 — Lane9 여섯 번째 행성(ADR-0021 §6, index 5).
 *
 * 파괴·관통 테마의 잡몹 4종(돌격·사수·특수·지원 역할 슬롯) + 엘리트 2종. 기존 컴포넌트
 * 엔진(src/sim/patterns)을 재사용하며 데이터 행만 추가한다. 크라스는 블록격파(blockBreak)
 * 모드로 도는 행성이라(planets/index.ts) 단단하게 밀어붙이고 고관통 포격으로 벽을 부수는
 * 성향을 수치로 반영했다(개체는 무겁고 파괴력이 높다).
 *
 * typeIndex는 톡사르(22~27) 뒤에 append(28~33). ENEMY_BY_TYPE(data/enemies.ts)에 전역
 * 순서로 등록되어 enemyDefFor가 entity.enemyType으로 역참조한다 — 절대 재번호 금지
 * (해시/리플레이 불변).
 *
 * 주의(렌더/엔진): 특수형 '분쇄 토템'은 엔진 재사용을 위해 HAZARD_LAVA 해저드 서브타입을
 * 그대로 쓴다(기계적으로 동일한 지속 장판, 렌더가 파괴 비주얼로 분화 가능).
 *
 * 밸런스 수치는 전부 플레이스홀더다(// TODO(밸런스)) — 출시 직전 일괄 튜닝 패스에서 확정한다.
 */

import type { EnemyDef, EnemyRole } from '../../src/sim/patterns/types.js';
import type { WaveCard } from '../waves.js';

// --- 잡몹 4종(역할 슬롯) ---------------------------------------------------

/** 파쇄 강습체 — 돌격형: 무겁게 밀어붙이고 충돌 시 파편을 흩뿌린다. */
export const BREAKER: EnemyDef = {
  id: 'kras-breaker',
  role: 'charger',
  typeIndex: 28,
  radius: 38, // TODO(밸런스)
  hp: 44, // TODO(밸런스)
  contactDamage: 13, // TODO(밸런스)
  speed: 250, // TODO(밸런스)
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 5, speed: 500, damage: 6, bulletRadius: 6, bulletLife: 72 }, // TODO(밸런스)
  fireCooldown: 52, // TODO(밸런스)
  xpValue: 4, // TODO(밸런스)
};

/** 관통 포수 — 사수형: 긴 윈드업의 고관통 포격을 원거리에서 지정. */
export const PIERCER: EnemyDef = {
  id: 'kras-piercer',
  role: 'gunner',
  typeIndex: 29,
  radius: 34, // TODO(밸런스)
  hp: 30, // TODO(밸런스)
  contactDamage: 8, // TODO(밸런스)
  speed: 150, // TODO(밸런스)
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 54, radius: 132, damage: 19 }, // TODO(밸런스)
  fireCooldown: 126, // TODO(밸런스)
  xpValue: 5, // TODO(밸런스)
};

/** 분쇄 토템 — 특수형: 뿌리내린 채 파괴 기둥 라인을 융기(HAZARD_LAVA 재사용). */
export const CRUSHER_TOTEM: EnemyDef = {
  id: 'kras-crusher-totem',
  role: 'special',
  typeIndex: 30,
  radius: 46, // TODO(밸런스)
  hp: 72, // TODO(밸런스)
  contactDamage: 10, // TODO(밸런스)
  speed: 0,
  movement: 'stationary',
  attack: { kind: 'lava', windup: 56, activeTicks: 100, pillars: 7, radius: 96, damage: 10 }, // TODO(밸런스)
  fireCooldown: 210, // TODO(밸런스)
  xpValue: 9, // TODO(밸런스)
};

/** 잔해 회수체 — 지원형: 손상된 아군에 붙어 지속 수복(우선 처치 대상). */
export const SALVAGE_DRONE: EnemyDef = {
  id: 'kras-salvage-drone',
  role: 'support',
  typeIndex: 31,
  radius: 30, // TODO(밸런스)
  hp: 34, // TODO(밸런스)
  contactDamage: 6, // TODO(밸런스)
  speed: 250, // TODO(밸런스)
  movement: 'seekWounded',
  attack: { kind: 'heal', range: 240, healPerTick: 5 }, // TODO(밸런스)
  fireCooldown: 12, // TODO(밸런스)
  xpValue: 6, // TODO(밸런스)
};

// --- 엘리트 2종 -------------------------------------------------------------

/** 공성 포대 — 엘리트: 완강한 관통 포수 변종. 광역 고관통 포격 + 높은 체력. */
export const SIEGE_BATTERY: EnemyDef = {
  id: 'kras-siege-battery',
  role: 'gunner',
  typeIndex: 32,
  radius: 48, // TODO(밸런스)
  hp: 250, // TODO(밸런스)
  contactDamage: 15, // TODO(밸런스)
  speed: 140, // TODO(밸런스)
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 50, radius: 214, damage: 24 }, // TODO(밸런스)
  fireCooldown: 100, // TODO(밸런스)
  xpValue: 19, // TODO(밸런스)
};

/** 파멸 거병 — 엘리트: 단단하게 돌격하며 파편을 살포하는 파괴 군단 핵심. */
export const DEVASTATOR: EnemyDef = {
  id: 'kras-devastator',
  role: 'charger',
  typeIndex: 33,
  radius: 54, // TODO(밸런스)
  hp: 310, // TODO(밸런스)
  contactDamage: 20, // TODO(밸런스)
  speed: 250, // TODO(밸런스)
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 10, speed: 520, damage: 8, bulletRadius: 6, bulletLife: 80 }, // TODO(밸런스)
  fireCooldown: 74, // TODO(밸런스)
  xpValue: 21, // TODO(밸런스)
};

/** 크라스 역할 로스터(웨이브 카드가 역할로 참조). */
export const KRAS_ROSTER: Record<EnemyRole, EnemyDef> = {
  charger: BREAKER,
  gunner: PIERCER,
  special: CRUSHER_TOTEM,
  support: SALVAGE_DRONE,
};

/** 크라스 엘리트 정예(웨이브 카드가 elite 인덱스로 참조). */
export const KRAS_ELITES: readonly EnemyDef[] = [SIEGE_BATTERY, DEVASTATOR];

/** ENEMY_BY_TYPE append 순서용(톡사르 뒤 28~33). */
export const KRAS_DEFS: readonly EnemyDef[] = [
  BREAKER,
  PIERCER,
  CRUSHER_TOTEM,
  SALVAGE_DRONE,
  SIEGE_BATTERY,
  DEVASTATOR,
];

/**
 * 크라스 웨이브 카드 풀. 파괴·관통답게 단단한 돌격 + 고관통 원거리 포격을 섞고, 후반
 * 카드에서 엘리트 2종(공성 포대·파멸 거병)을 정예 스폰으로 편성한다.
 */
export const KRAS_CARD_POOL: readonly WaveCard[] = [
  { id: 'kra-breaker-push', formation: 'line', spawns: [{ role: 'charger', count: 4 }] },
  { id: 'kra-piercer-line', formation: 'edges', spawns: [{ role: 'gunner', count: 4 }] },
  {
    id: 'kra-mixed-siege',
    formation: 'ring',
    spawns: [
      { role: 'charger', count: 2 },
      { role: 'gunner', count: 3 },
    ],
  },
  { id: 'kra-totem-field', formation: 'cluster', spawns: [{ role: 'special', count: 2 }] },
  {
    id: 'kra-drone-escort',
    formation: 'ring',
    spawns: [
      { role: 'support', count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
  {
    id: 'kra-heavy-column',
    formation: 'edges',
    spawns: [
      { role: 'special', count: 1 },
      { role: 'gunner', count: 2 },
      { role: 'support', count: 1 },
    ],
  },
  {
    id: 'kra-battery-guard',
    formation: 'edges',
    spawns: [
      { elite: 0, count: 1 },
      { role: 'gunner', count: 2 },
    ],
  },
  {
    id: 'kra-devastator-charge',
    formation: 'line',
    spawns: [
      { elite: 1, count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
];
