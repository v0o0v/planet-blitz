/**
 * Kargon enemy roster — M1's four role slots (spec §몹 매트릭스, R6).
 *
 * Data only: each entry pairs a movement component with an attack component and
 * tuning numbers. The pattern engine (src/sim/patterns) executes these; adding
 * planets/enemies later means adding rows here, not editing the world loop.
 *
 * Balance note: tier multipliers and the wave budget table come from the spec
 * (§수치 초안). The per-enemy HP / contact-damage / cadence values below are M1
 * prototype tuning (not spec-mandated) — first pass, expected to move during the
 * fun-gate tuning loop (plan Phase 4, task 20).
 */

import type { EnemyDef } from '../src/sim/patterns/types.js';
import { HAZARD_LAVA } from '../src/sim/patterns/types.js';
import { BERDAN_DEFS } from './planets/berdan.js';
import { NIFLHEIM_DEFS } from './planets/niflheim.js';
import { ARKE_DEFS } from './planets/arke.js';
import { TOXAR_DEFS } from './planets/toxar.js';
import { KRAS_DEFS } from './planets/kras.js';

/** 파쇄차 — 돌격형: slow straight rush, sprays 4 fragments on wall impact. */
export const CHARGER: EnemyDef = {
  id: 'kargon-charger',
  role: 'charger',
  typeIndex: 0,
  radius: 36,
  hp: 34,
  contactDamage: 12,
  speed: 300,
  movement: 'chargeStraight',
  attack: { kind: 'fragments', count: 4, speed: 520, damage: 6, bulletRadius: 6, bulletLife: 70 },
  fireCooldown: 40,
  xpValue: 3,
};

/** 박격포 — 사수형: keeps range, telegraphs an impact zone then bursts. */
export const GUNNER: EnemyDef = {
  id: 'kargon-gunner',
  role: 'gunner',
  typeIndex: 1,
  radius: 32,
  hp: 26,
  contactDamage: 8,
  speed: 180,
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 48, radius: 140, damage: 16 },
  fireCooldown: 130,
  xpValue: 4,
};

/**
 * 용암샘 — 특수형: rooted, periodically raises a line of lava pillars.
 *
 * ## `attack.damage` 8 → 16 (2026-08-04) — 카르곤의 **유일한 행성 전용 난이도 축**
 * 카르곤은 밴드(60~80%) 위 82.2% 로 3회차 미착수였다. 이 무대는 뱀서류(=모드 0, 미지정 기본값)
 * 라 **모드 게이트형 레버를 만들 수 없다** — `SHRINK_INTERVAL_SCALE`·`objectiveModeDamageScale`
 * 과 같은 형태를 뱀서류에 걸면 planetMode 미지정 런(침공·튜토리얼 등)까지 전부 딸려 온다.
 *
 * 남는 것은 **로스터**인데, 카르곤 로스터 4종 중 셋(파쇄차 0 · 박격포 1 · 수리드론 3)은
 * `data/invasion/formations.ts` 와 `encounters/light.ts`(수호자)가 typeIndex 로 참조한다.
 * **용암샘(typeIndex 2)만 어디에서도 참조되지 않는다** — 그래서 이것이 침공을 건드리지 않고
 * 카르곤에만 닿는 유일한 자리다. 그리고 패배 런의 `지형피해분` 0.866 이 이 무대의 지배적
 * 피해원이 바로 이 용암 기둥임을 가리키고 있었다.
 *
 * | 기둥 피해 | 클리어율 | 보스도달 | 런내 레벨업 |
 * |---|---|---|---|
 * | 8(전) | 82.2% | 91.9s | 7.0 |
 * | 12 | 80.5% | 92.1s | 6.9 |
 * | **16** | **79.3%** | **90.5s** | **6.8** |
 * | 24 | 73.1% | 90.4s | 6.7 |
 *
 * ⚠️ **저단(8→12)이 고단(12→24)보다 무디다** — 12 에서 −1.6pp 인데 24 에서 −9.1pp 다. 8→12 만
 * 보고 "레버가 약하다"고 판단하면 안 된다(아르케 압박 축과 같은 부류의 비선형이다). 그래도
 * 한 번에 2배를 넘기지 마라 — 24 는 밴드를 아래로 뚫는다.
 *
 * ⚠️ **의뢰 파급**: 로스터는 의뢰 구간에도 실리므로 카르곤을 포함하는 의뢰가 그만큼 어려워진다.
 * 페이싱 상수(`SEGMENTS.killGoal` 등)는 건드리지 않았으므로 **구간 수만큼 곱해지는 종류의
 * 파급은 아니다**(큐 §P5 와 구분하라).
 * TODO(밸런스): 출시 전 튜닝.
 */
export const LAVA_SPRING: EnemyDef = {
  id: 'kargon-lava-spring',
  role: 'special',
  typeIndex: 2,
  radius: 44,
  hp: 60,
  contactDamage: 10,
  speed: 0,
  movement: 'stationary',
  attack: { kind: 'lava', windup: 54, activeTicks: 90, pillars: 6, radius: 92, damage: 16 },
  fireCooldown: 200,
  xpValue: 8,
};

/** 수리드론 — 지원형: drifts to wounded allies and heals them (priority kill). */
export const REPAIR_DRONE: EnemyDef = {
  id: 'kargon-repair-drone',
  role: 'support',
  typeIndex: 3,
  radius: 30,
  hp: 30,
  contactDamage: 6,
  speed: 260,
  movement: 'seekWounded',
  attack: { kind: 'heal', range: 220, healPerTick: 3 },
  fireCooldown: 12,
  xpValue: 5,
};

/** Hazard subtype re-export so the world hazard resolver can tag lava damage. */
export { HAZARD_LAVA };

/** All M1 enemies, indexed by role for wave spawning. */
export const KARGON_ROSTER = {
  charger: CHARGER,
  gunner: GUNNER,
  special: LAVA_SPRING,
  support: REPAIR_DRONE,
} as const;

/**
 * Lookup by stable typeIndex (used when reconstructing behaviour from state).
 * 카르곤 0~3 → 베르단 4~9 → 니플헤임 10~15 → 아르케 16~21 → 톡사르 22~27 → 크라스 28~33
 * 순으로 append — typeIndex는 전역 고유하며 entity.enemyType이 이 배열의 인덱스이므로 절대
 * 재정렬/재번호 금지(해시 불변).
 */
export const ENEMY_BY_TYPE: readonly EnemyDef[] = [
  CHARGER,
  GUNNER,
  LAVA_SPRING,
  REPAIR_DRONE,
  ...BERDAN_DEFS,
  ...NIFLHEIM_DEFS,
  ...ARKE_DEFS,
  ...TOXAR_DEFS,
  ...KRAS_DEFS,
];
