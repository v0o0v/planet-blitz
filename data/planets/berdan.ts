/**
 * 베르단(Berdan) 행성 로스터 — M2 두 번째 행성(plan Phase E1, AC8).
 *
 * 곤충 군체 테마의 잡몹 4종(돌격·사수·특수·지원 역할 슬롯) + 엘리트 2종. 카르곤과
 * 동일한 컴포넌트 엔진(src/sim/patterns)을 재사용하며, 데이터 행만 추가한다. 전투
 * 감각을 카르곤과 차별화하기 위해 이동/사거리/탄속/체력 튜닝을 다르게 잡았다(군체는
 * 개별 위협은 낮되 수가 많고 빠르게 달라붙는 성향).
 *
 * typeIndex는 카르곤(0~3) 뒤에 append(4~9). ENEMY_BY_TYPE(data/enemies.ts)에
 * 전역 순서로 등록되어 enemyDefFor가 entity.enemyType으로 역참조한다 — 절대 재번호
 * 매기지 않는다(해시/리플레이 불변).
 *
 * 밸런스 수치는 M2 1차 튜닝값(spec §5) — 재미 게이트 루프에서 이동 예정.
 *
 * 주의(렌더/M3): 특수형 '산성 분비샘'은 엔진 재사용을 위해 HAZARD_LAVA 해저드 서브
 * 타입을 그대로 쓴다(기계적으로 동일한 지속 장판). 곤충 테마 전용 산성 비주얼은
 * 렌더 레인(별도)에서 해저드 서브타입 태그를 늘려 분화할 수 있다.
 */

import type { EnemyDef, EnemyRole } from '../../src/sim/patterns/types.js';
import type { WaveCard } from '../waves.js';

// --- 잡몹 4종(역할 슬롯) ---------------------------------------------------

/** 일벌레 돌격체 — 돌격형: 카르곤 파쇄차보다 빠르고 약한 유충 산포 러시. */
export const WORKER_RUSHER: EnemyDef = {
  id: 'berdan-worker-rusher',
  role: 'charger',
  typeIndex: 4,
  radius: 32,
  hp: 24,
  contactDamage: 10,
  speed: 380,
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 5, speed: 560, damage: 5, bulletRadius: 5, bulletLife: 64 },
  fireCooldown: 46,
  xpValue: 3,
};

/** 침뱉기 병정 — 사수형: 짧은 윈드업의 산성 침을 근거리에서 반복 투척. */
export const SPITTER: EnemyDef = {
  id: 'berdan-spitter',
  role: 'gunner',
  typeIndex: 5,
  radius: 30,
  hp: 22,
  contactDamage: 7,
  speed: 220,
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 40, radius: 120, damage: 13 },
  fireCooldown: 110,
  xpValue: 4,
};

/** 산성 분비샘 — 특수형: 뿌리내린 채 산성 기둥 라인을 주기적으로 융기(HAZARD_LAVA 재사용). */
export const ACID_GLAND: EnemyDef = {
  id: 'berdan-acid-gland',
  role: 'special',
  typeIndex: 6,
  radius: 42,
  hp: 54,
  contactDamage: 9,
  speed: 0,
  movement: 'stationary',
  attack: { kind: 'lava', windup: 50, activeTicks: 84, pillars: 7, radius: 88, damage: 8 },
  fireCooldown: 190,
  xpValue: 8,
};

/** 여왕유모 — 지원형: 부상 아군에게 붙어 지속 치유(우선 처치 대상). */
export const BROOD_NURSE: EnemyDef = {
  id: 'berdan-brood-nurse',
  role: 'support',
  typeIndex: 7,
  radius: 28,
  hp: 28,
  contactDamage: 5,
  speed: 300,
  movement: 'seekWounded',
  attack: { kind: 'heal', range: 240, healPerTick: 4 },
  fireCooldown: 10,
  xpValue: 5,
};

// --- 엘리트 2종 -------------------------------------------------------------

/** 파수병정 — 엘리트: 완강한 사수형 변종. 넓은 산탄 포위 + 높은 체력. */
export const SENTINEL: EnemyDef = {
  id: 'berdan-sentinel',
  role: 'gunner',
  typeIndex: 8,
  radius: 44,
  hp: 180,
  contactDamage: 14,
  speed: 170,
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 44, radius: 180, damage: 18 },
  fireCooldown: 96,
  xpValue: 16,
};

/** 분열유충모체 — 엘리트: 돌격하며 대량의 유충 파편을 터뜨리는 군체 핵심. */
export const BROOD_MOTHER: EnemyDef = {
  id: 'berdan-brood-mother',
  role: 'charger',
  typeIndex: 9,
  radius: 50,
  hp: 220,
  contactDamage: 18,
  speed: 300,
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 10, speed: 540, damage: 7, bulletRadius: 6, bulletLife: 76 },
  fireCooldown: 70,
  xpValue: 18,
};

/** 베르단 역할 로스터(웨이브 카드가 역할로 참조). */
export const BERDAN_ROSTER: Record<EnemyRole, EnemyDef> = {
  charger: WORKER_RUSHER,
  gunner: SPITTER,
  special: ACID_GLAND,
  support: BROOD_NURSE,
};

/** 베르단 엘리트 정예(웨이브 카드가 elite 인덱스로 참조). */
export const BERDAN_ELITES: readonly EnemyDef[] = [SENTINEL, BROOD_MOTHER];

/** ENEMY_BY_TYPE append 순서용(카르곤 4~9). */
export const BERDAN_DEFS: readonly EnemyDef[] = [
  WORKER_RUSHER,
  SPITTER,
  ACID_GLAND,
  BROOD_NURSE,
  SENTINEL,
  BROOD_MOTHER,
];

/**
 * 베르단 웨이브 카드 풀. 카르곤과 달리 군체 물량(다수 돌격) 중심이며, 후반 카드에서
 * 엘리트 2종(파수병정·분열유충모체)을 정예 스폰으로 섞는다. 카드는 역할(role) 또는
 * 엘리트 인덱스(elite)로 스폰 대상을 지정한다(WaveCard.spawns 판별 유니온).
 */
export const BERDAN_CARD_POOL: readonly WaveCard[] = [
  { id: 'brd-worker-swarm', formation: 'ring', spawns: [{ role: 'charger', count: 6 }] },
  { id: 'brd-spitter-line', formation: 'edges', spawns: [{ role: 'gunner', count: 4 }] },
  {
    id: 'brd-mixed-brood',
    formation: 'ring',
    spawns: [
      { role: 'charger', count: 3 },
      { role: 'gunner', count: 2 },
    ],
  },
  { id: 'brd-acid-field', formation: 'cluster', spawns: [{ role: 'special', count: 2 }] },
  {
    id: 'brd-nurse-escort',
    formation: 'ring',
    spawns: [
      { role: 'support', count: 1 },
      { role: 'charger', count: 4 },
    ],
  },
  { id: 'brd-encircle', formation: 'ring', spawns: [{ role: 'charger', count: 8 }] },
  {
    id: 'brd-sentinel-guard',
    formation: 'edges',
    spawns: [
      { elite: 0, count: 1 },
      { role: 'gunner', count: 2 },
    ],
  },
  {
    id: 'brd-brood-charge',
    formation: 'line',
    spawns: [
      { elite: 1, count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
];
