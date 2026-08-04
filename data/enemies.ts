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
  // 130 → 260 (2026-08-04, "해저드가 너무 많이 나온다"). 박격포는 1발 = 장판 1장이라 개수를
  // 반으로 줄이는 손잡이가 **주기밖에 없다**(용암 계열은 `pillars` 로 줄인다). 피해·반경은
  // 그대로 두었다 — 사용자가 요청한 축은 "얼마나 아픈가"가 아니라 "얼마나 자주 깔리는가"다.
  fireCooldown: 260,
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
  // `pillars` 6 → 3 (2026-08-04, "해저드가 너무 많이 나온다"). 시전 1회당 장판 수를 반으로
  // 줄인다 — 쿨다운을 늘리는 대신 이쪽을 고른 이유는 ①융기 예고(windup 54)의 리듬이 이 적의
  // 정체성이고 ②위 표가 실측한 축은 `damage` 라 그 값을 보존해야 대조가 살아 있기 때문이다.
  attack: { kind: 'lava', windup: 54, activeTicks: 90, pillars: 3, radius: 92, damage: 16 },
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

// ---------------------------------------------------------------------------
// 카르곤 엘리트 2종 (2026-08-04 — 사용자 요청 "다른 행성처럼 6종으로")
// ---------------------------------------------------------------------------
//
// 카르곤만 `elites: []` 였다. 그 공백은 세 곳에서 조용히 드러났다:
//  1. 성계 지도 전장 정찰 창이 카르곤만 4마리(다른 행성은 6마리),
//  2. 웨이브 카드 풀에 정예 카드가 없어 **카드 추첨으로는 정예가 영영 안 나오고**,
//  3. `stepEliteSummons`(정예 소집령)가 로스터로 폴백해 "정예"가 일반몹이었다.
//
// ⚠️ **typeIndex 는 34·35 다 — 카르곤 0~3 옆에 끼워 넣지 않는다.** `entity.enemyType` 이
// `ENEMY_BY_TYPE` 의 **배열 인덱스**이고 그 값이 해시에 들어가므로, 4번 자리에 삽입하면
// 베르단 이후 30종의 번호가 전부 밀려 **모든 골든·리플레이가 무효**가 된다. append-only 는
// 이 배열의 계약이다(파일 하단 주석). 그래서 정의는 행성별 블록과 **떨어져** 맨 뒤에 붙는다.
//
// ⚠️ 새 카드 2장이 카르곤 카드 풀에 들어가므로 **카르곤 런의 골든 해시는 바뀐다**(풀 길이가
// 8 → 10 이라 추첨 결과가 통째로 갈린다). 정예 소집령(카르곤) 리플레이도 폴백이 사라져 바뀐다.
// 이것은 부작용이 아니라 요청의 내용이다 — 정예가 실제로 나오게 하는 것이 목적이다.

/** 용암 포대 — 엘리트: 완강한 박격포 변종. 광역 용암탄 + 높은 체력. */
export const LAVA_BATTERY: EnemyDef = {
  id: 'kargon-lava-battery',
  role: 'gunner',
  typeIndex: 34,
  radius: 46, // TODO(밸런스)
  // ⚠️ 다른 행성 정예(180~250)보다 **가볍다** — 카르곤은 온보딩 무대(단계1 기준선)다.
  //
  // ## 난이도 영향은 실측했고, 사용자가 수용한 값이다 (2026-08-04)
  // 60시드 오토파일럿 1200틱 실측: **1200틱 생존 29 → 21 / 60**, **런내 레벨≥2 45 → 33 / 60**.
  // 정예 스탯을 다섯 단계로 낮춰 봤지만(HP 190→80까지) 격차가 남았다 — 원인이 스탯이 아니라
  // **카드 2/10 이 느린 웨이브로 대체되는 것**이기 때문이다(처치·XP 속도가 그만큼 준다).
  // 그래서 스탯을 더 깎아 "정예"를 무의미하게 만드는 대신, 난이도 상승을 받아들이고 값을
  // 정예답게 되돌렸다. 출시 전 밸런스 일괄 패스에서 다시 본다.
  hp: 140, // TODO(밸런스)
  contactDamage: 13, // TODO(밸런스)
  speed: 160, // TODO(밸런스)
  movement: 'standoff',
  attack: { kind: 'mortar', windup: 48, radius: 160, damage: 16 }, // TODO(밸런스)
  fireCooldown: 240, // 120 → 240 (해저드 반감, GUNNER 와 같은 이유) TODO(밸런스)
  xpValue: 24, // TODO(밸런스)
};

/**
 * 용암 거인 — 엘리트: 뿌리내린 채 용암 기둥을 대량으로 융기시키는 거대 기계.
 *
 * ⚠️ **둘째 정예를 돌격형(다른 행성의 관례)으로 만들지 않았다.** 처음에 `chargeStraight` 정예로
 * 뒀더니 `tests/enemyVisual.test.ts` 의 **돌진 예고 듀티**가 최악 셀에서 35.6% → 41~52% 로 뛰었다
 * (호위를 빼도 41.3%). 카르곤 차저(파쇄차)의 예고가 길어 이 행성만 예고 예산이 이미 빠듯한데,
 * 오래 사는 정예(HP 240)가 그 신호를 계속 켜 두기 때문이다 — "예고가 배경이 되는" 상태다.
 * 특수형으로 돌리면 그 축을 아예 안 건드리면서 카르곤의 정체성(용암 지대)에 더 붙는다.
 */
export const MAGMA_COLOSSUS: EnemyDef = {
  id: 'kargon-magma-colossus',
  role: 'special',
  typeIndex: 35,
  radius: 52, // TODO(밸런스)
  // 위 용암 포대와 같은 이유로 가볍다(카르곤 = 온보딩 기준선).
  hp: 180, // TODO(밸런스)
  contactDamage: 15, // TODO(밸런스)
  speed: 0,
  movement: 'stationary',
  // `pillars` 6 → 3 (해저드 반감, 용암 포대와 같은 이유).
  attack: { kind: 'lava', windup: 56, activeTicks: 88, pillars: 3, radius: 96, damage: 14 }, // TODO(밸런스)
  fireCooldown: 210, // TODO(밸런스)
  xpValue: 28, // TODO(밸런스)
};

/** 카르곤 엘리트 정예(웨이브 카드가 elite 인덱스로 참조 — 다른 행성과 같은 규약). */
export const KARGON_ELITES: readonly EnemyDef[] = [LAVA_BATTERY, MAGMA_COLOSSUS];

/** ENEMY_BY_TYPE append 순서용(크라스 뒤 34~35 — 위 ⚠️ 참조). */
export const KARGON_ELITE_DEFS: readonly EnemyDef[] = [LAVA_BATTERY, MAGMA_COLOSSUS];

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
 * → **카르곤 엘리트 34~35** 순으로 append — typeIndex는 전역 고유하며 entity.enemyType이 이
 * 배열의 인덱스이므로 절대 재정렬/재번호 금지(해시 불변).
 *
 * ⚠️ 마지막 두 칸이 카르곤 소속인데 카르곤 블록에서 **멀리 떨어져** 있는 것은 실수가 아니다 —
 * append-only 계약을 지키는 유일한 자리라서다(위 카르곤 엘리트 절의 ⚠️).
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
  ...KARGON_ELITE_DEFS,
];
