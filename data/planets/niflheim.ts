/**
 * 니플헤임(Niflheim) 행성 로스터 — M3 세 번째 행성(plan B1, AC4).
 *
 * 빙설·유령 함대 테마의 잡몹 4종(돌격·사수·특수·지원 역할 슬롯) + 엘리트 2종. 카르곤·
 * 베르단과 동일한 컴포넌트 엔진(src/sim/patterns)을 재사용하며 데이터 행만 추가한다.
 * 유령 함대답게 개체는 빠르고 원거리 냉기 압박이 강하되 접촉 위협은 낮게 잡았다.
 *
 * typeIndex는 베르단(4~9) 뒤에 append(10~15). ENEMY_BY_TYPE(data/enemies.ts)에 전역
 * 순서로 등록되어 enemyDefFor가 entity.enemyType으로 역참조한다 — 절대 재번호 금지
 * (해시/리플레이 불변).
 *
 * 주의(렌더/엔진): 특수형 '서리 균열'은 엔진 재사용을 위해 HAZARD_LAVA 해저드 서브
 * 타입을 그대로 쓴다(기계적으로 동일한 지속 장판, 렌더가 냉기 비주얼로 분화 가능).
 *
 * 밸런스 수치는 M3 1차 튜닝값(spec §5) — 재미 게이트 루프에서 이동 예정.
 */

import type { EnemyDef, EnemyRole } from '../../src/sim/patterns/types.js';
import type { WaveCard } from '../waves.js';

// --- 잡몹 4종(역할 슬롯) ---------------------------------------------------

/** 유령 요격기 — 돌격형: 위상 이동하듯 빠르게 파고드는 유령 전투기. */
export const WRAITH_INTERCEPTOR: EnemyDef = {
  id: 'niflheim-wraith-interceptor',
  role: 'charger',
  typeIndex: 10,
  radius: 30,
  hp: 20,
  contactDamage: 9,
  speed: 420,
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 6, speed: 600, damage: 5, bulletRadius: 5, bulletLife: 60 },
  fireCooldown: 44,
  xpValue: 3,
};

/** 서리 포수 — 사수형: 넓은 서리 파편 낙하 지대를 원거리에서 지정. */
export const FROST_GUNNER: EnemyDef = {
  id: 'niflheim-frost-gunner',
  role: 'gunner',
  typeIndex: 11,
  radius: 32,
  hp: 24,
  contactDamage: 7,
  speed: 190,
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 46, radius: 150, damage: 15 },
  fireCooldown: 118,
  xpValue: 4,
};

/** 서리 균열 — 특수형: 뿌리내린 채 서리 기둥 라인을 융기(HAZARD_LAVA 재사용). */
export const RIME_FISSURE: EnemyDef = {
  id: 'niflheim-rime-fissure',
  role: 'special',
  typeIndex: 12,
  radius: 44,
  hp: 58,
  contactDamage: 9,
  speed: 0,
  movement: 'stationary',
  attack: { kind: 'lava', windup: 52, activeTicks: 96, pillars: 8, radius: 92, damage: 9 },
  fireCooldown: 200,
  xpValue: 8,
};

/** 냉기 정비선 — 지원형: 손상된 유령 함선에 붙어 지속 수복(우선 처치 대상). */
export const CRYO_TENDER: EnemyDef = {
  id: 'niflheim-cryo-tender',
  role: 'support',
  typeIndex: 13,
  radius: 28,
  hp: 30,
  contactDamage: 5,
  speed: 290,
  movement: 'seekWounded',
  attack: { kind: 'heal', range: 250, healPerTick: 4 },
  fireCooldown: 10,
  xpValue: 5,
};

// --- 엘리트 2종 -------------------------------------------------------------

/** 서리 파수병 — 엘리트: 완강한 서리 사수. 광역 낙하 지대 + 높은 체력. */
export const FROST_SENTINEL: EnemyDef = {
  id: 'niflheim-frost-sentinel',
  role: 'gunner',
  typeIndex: 14,
  radius: 46,
  hp: 200,
  contactDamage: 14,
  speed: 160,
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 46, radius: 200, damage: 20 },
  fireCooldown: 92,
  xpValue: 17,
};

/** 유령 모함 — 엘리트: 돌격하며 유령 편대 파편을 대량 살포하는 함대 핵심. */
export const SPECTRAL_CARRIER: EnemyDef = {
  id: 'niflheim-spectral-carrier',
  role: 'charger',
  typeIndex: 15,
  radius: 52,
  hp: 240,
  contactDamage: 18,
  speed: 300,
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 12, speed: 560, damage: 7, bulletRadius: 6, bulletLife: 78 },
  fireCooldown: 68,
  xpValue: 19,
};

/** 니플헤임 역할 로스터(웨이브 카드가 역할로 참조). */
export const NIFLHEIM_ROSTER: Record<EnemyRole, EnemyDef> = {
  charger: WRAITH_INTERCEPTOR,
  gunner: FROST_GUNNER,
  special: RIME_FISSURE,
  support: CRYO_TENDER,
};

/** 니플헤임 엘리트 정예(웨이브 카드가 elite 인덱스로 참조). */
export const NIFLHEIM_ELITES: readonly EnemyDef[] = [FROST_SENTINEL, SPECTRAL_CARRIER];

/** ENEMY_BY_TYPE append 순서용(베르단 뒤 10~15). */
export const NIFLHEIM_DEFS: readonly EnemyDef[] = [
  WRAITH_INTERCEPTOR,
  FROST_GUNNER,
  RIME_FISSURE,
  CRYO_TENDER,
  FROST_SENTINEL,
  SPECTRAL_CARRIER,
];

/**
 * 니플헤임 웨이브 카드 풀. 유령 함대답게 빠른 돌격 + 원거리 서리 포격을 섞고, 후반
 * 카드에서 엘리트 2종(서리 파수병·유령 모함)을 정예 스폰으로 편성한다.
 */
export const NIFLHEIM_CARD_POOL: readonly WaveCard[] = [
  { id: 'nfl-wraith-dive', formation: 'edges', spawns: [{ role: 'charger', count: 5 }] },
  { id: 'nfl-frost-line', formation: 'edges', spawns: [{ role: 'gunner', count: 4 }] },
  {
    id: 'nfl-mixed-fleet',
    formation: 'ring',
    spawns: [
      { role: 'charger', count: 3 },
      { role: 'gunner', count: 2 },
    ],
  },
  { id: 'nfl-rime-field', formation: 'cluster', spawns: [{ role: 'special', count: 2 }] },
  {
    id: 'nfl-tender-escort',
    formation: 'ring',
    spawns: [
      { role: 'support', count: 1 },
      { role: 'charger', count: 4 },
    ],
  },
  { id: 'nfl-encircle', formation: 'ring', spawns: [{ role: 'charger', count: 8 }] },
  {
    id: 'nfl-sentinel-guard',
    formation: 'edges',
    spawns: [
      { elite: 0, count: 1 },
      { role: 'gunner', count: 2 },
    ],
  },
  {
    id: 'nfl-carrier-charge',
    formation: 'line',
    spawns: [
      { elite: 1, count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
];
