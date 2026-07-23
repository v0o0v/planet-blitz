/**
 * 톡사르(Toxar) 행성 로스터 — Lane9 다섯 번째 행성(ADR-0021 §6, index 4).
 *
 * 부식·중독 테마의 잡몹 4종(돌격·사수·특수·지원 역할 슬롯) + 엘리트 2종. 카르곤~아르케와
 * 동일한 컴포넌트 엔진(src/sim/patterns)을 재사용하며 데이터 행만 추가한다. 톡사르는 오염
 * 확산(contamination) 모드로 도는 행성이라(planets/index.ts) 산성 장판·지속 피해 성향을
 * 수치로 반영했다(개별 위협은 낮되 붙으면 계속 갉아먹는다).
 *
 * typeIndex는 아르케(16~21) 뒤에 append(22~27). ENEMY_BY_TYPE(data/enemies.ts)에 전역
 * 순서로 등록되어 enemyDefFor가 entity.enemyType으로 역참조한다 — 절대 재번호 금지
 * (해시/리플레이 불변).
 *
 * 주의(렌더/엔진): 특수형 '부식 분비강'은 엔진 재사용을 위해 HAZARD_LAVA 해저드 서브타입을
 * 그대로 쓴다(기계적으로 동일한 지속 장판, 렌더가 부식 비주얼로 분화 가능).
 *
 * 밸런스 수치는 전부 플레이스홀더다(// TODO(밸런스)) — 출시 직전 일괄 튜닝 패스에서 확정한다.
 */

import type { EnemyDef, EnemyRole } from '../../src/sim/patterns/types.js';
import type { WaveCard } from '../waves.js';

// --- 잡몹 4종(역할 슬롯) ---------------------------------------------------

/** 부식 돌격체 — 돌격형: 산성 파편을 흩뿌리며 달라붙는 잡몹. */
export const CORRODER: EnemyDef = {
  id: 'toxar-corroder',
  role: 'charger',
  typeIndex: 22,
  radius: 32, // TODO(밸런스)
  hp: 26, // TODO(밸런스)
  contactDamage: 10, // TODO(밸런스)
  speed: 360, // TODO(밸런스)
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 5, speed: 540, damage: 5, bulletRadius: 5, bulletLife: 66 }, // TODO(밸런스)
  fireCooldown: 48, // TODO(밸런스)
  xpValue: 3, // TODO(밸런스)
};

/** 독액 분사체 — 사수형: 짧은 윈드업의 독성 착탄 지대를 원거리에서 지정. */
export const VENOM_SPITTER: EnemyDef = {
  id: 'toxar-venom-spitter',
  role: 'gunner',
  typeIndex: 23,
  radius: 30, // TODO(밸런스)
  hp: 22, // TODO(밸런스)
  contactDamage: 7, // TODO(밸런스)
  speed: 220, // TODO(밸런스)
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 42, radius: 124, damage: 13 }, // TODO(밸런스)
  fireCooldown: 112, // TODO(밸런스)
  xpValue: 4, // TODO(밸런스)
};

/** 부식 분비강 — 특수형: 뿌리내린 채 산성 기둥 라인을 융기(HAZARD_LAVA 재사용). */
export const BLIGHT_GLAND: EnemyDef = {
  id: 'toxar-blight-gland',
  role: 'special',
  typeIndex: 24,
  radius: 42, // TODO(밸런스)
  hp: 56, // TODO(밸런스)
  contactDamage: 9, // TODO(밸런스)
  speed: 0,
  movement: 'stationary',
  attack: { kind: 'lava', windup: 52, activeTicks: 90, pillars: 7, radius: 90, damage: 8 }, // TODO(밸런스)
  fireCooldown: 196, // TODO(밸런스)
  xpValue: 8, // TODO(밸런스)
};

/** 역병 정비체 — 지원형: 부상 아군에게 붙어 지속 치유(우선 처치 대상). */
export const PLAGUE_TENDER: EnemyDef = {
  id: 'toxar-plague-tender',
  role: 'support',
  typeIndex: 25,
  radius: 28, // TODO(밸런스)
  hp: 30, // TODO(밸런스)
  contactDamage: 5, // TODO(밸런스)
  speed: 300, // TODO(밸런스)
  movement: 'seekWounded',
  attack: { kind: 'heal', range: 240, healPerTick: 4 }, // TODO(밸런스)
  fireCooldown: 10, // TODO(밸런스)
  xpValue: 5, // TODO(밸런스)
};

// --- 엘리트 2종 -------------------------------------------------------------

/** 독소 파수병 — 엘리트: 완강한 사수형 변종. 넓은 독성 포위 + 높은 체력. */
export const TOXIN_SENTINEL: EnemyDef = {
  id: 'toxar-toxin-sentinel',
  role: 'gunner',
  typeIndex: 26,
  radius: 44, // TODO(밸런스)
  hp: 190, // TODO(밸런스)
  contactDamage: 14, // TODO(밸런스)
  speed: 170, // TODO(밸런스)
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 44, radius: 184, damage: 18 }, // TODO(밸런스)
  fireCooldown: 96, // TODO(밸런스)
  xpValue: 16, // TODO(밸런스)
};

/** 부패 거수 — 엘리트: 돌격하며 대량의 산성 파편을 터뜨리는 오염 핵심. */
export const ROT_BEHEMOTH: EnemyDef = {
  id: 'toxar-rot-behemoth',
  role: 'charger',
  typeIndex: 27,
  radius: 50, // TODO(밸런스)
  hp: 230, // TODO(밸런스)
  contactDamage: 18, // TODO(밸런스)
  speed: 300, // TODO(밸런스)
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 10, speed: 540, damage: 7, bulletRadius: 6, bulletLife: 76 }, // TODO(밸런스)
  fireCooldown: 70, // TODO(밸런스)
  xpValue: 18, // TODO(밸런스)
};

/** 톡사르 역할 로스터(웨이브 카드가 역할로 참조). */
export const TOXAR_ROSTER: Record<EnemyRole, EnemyDef> = {
  charger: CORRODER,
  gunner: VENOM_SPITTER,
  special: BLIGHT_GLAND,
  support: PLAGUE_TENDER,
};

/** 톡사르 엘리트 정예(웨이브 카드가 elite 인덱스로 참조). */
export const TOXAR_ELITES: readonly EnemyDef[] = [TOXIN_SENTINEL, ROT_BEHEMOTH];

/** ENEMY_BY_TYPE append 순서용(아르케 뒤 22~27). */
export const TOXAR_DEFS: readonly EnemyDef[] = [
  CORRODER,
  VENOM_SPITTER,
  BLIGHT_GLAND,
  PLAGUE_TENDER,
  TOXIN_SENTINEL,
  ROT_BEHEMOTH,
];

/**
 * 톡사르 웨이브 카드 풀. 부식·중독답게 독성 장판(특수)과 지속 압박(사수)을 섞고, 후반
 * 카드에서 엘리트 2종(독소 파수병·부패 거수)을 정예 스폰으로 편성한다.
 */
export const TOXAR_CARD_POOL: readonly WaveCard[] = [
  { id: 'tox-corroder-rush', formation: 'ring', spawns: [{ role: 'charger', count: 6 }] },
  { id: 'tox-venom-line', formation: 'edges', spawns: [{ role: 'gunner', count: 4 }] },
  {
    id: 'tox-mixed-blight',
    formation: 'ring',
    spawns: [
      { role: 'charger', count: 3 },
      { role: 'gunner', count: 2 },
    ],
  },
  { id: 'tox-blight-field', formation: 'cluster', spawns: [{ role: 'special', count: 2 }] },
  {
    id: 'tox-tender-escort',
    formation: 'ring',
    spawns: [
      { role: 'support', count: 1 },
      { role: 'charger', count: 4 },
    ],
  },
  { id: 'tox-encircle', formation: 'ring', spawns: [{ role: 'charger', count: 8 }] },
  {
    id: 'tox-sentinel-guard',
    formation: 'edges',
    spawns: [
      { elite: 0, count: 1 },
      { role: 'gunner', count: 2 },
    ],
  },
  {
    id: 'tox-behemoth-charge',
    formation: 'line',
    spawns: [
      { elite: 1, count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
];
