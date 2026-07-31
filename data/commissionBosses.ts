/**
 * 의뢰 보스 **카탈로그 단일 정본** (계획 §Phase F).
 *
 * ## 왜 별도 축인가
 * 행성 보스는 `PlanetContent.boss` 로 **행성에만** 매달려 있다(`data/planets/index.ts`).
 * 의뢰 보스는 행성이 아니라 **주문 종류**가 고른다 — 연쇄 원정은 여러 행성을 거치므로
 * "어느 행성인가"로는 애초에 결정될 수 없다. 그래서 선택 축을 하나 더 둔다.
 *
 * ## `enemyType` 규약 — 여기가 계약의 핵심이다
 * 보스 엔티티의 `enemyType` 은 원래 **행성 인덱스**였고 렌더가 그것으로 3D 모델·2D 스프라이트를
 * 고른다. 의뢰 보스는 그 인덱스 공간을 **행성 수 뒤에 append** 해서 쓴다:
 *
 * ```
 *   0..5  행성 보스 (카르곤·베르단·니플헤임·아르케·톡사르·크라스)
 *   6..8  의뢰 보스 (연쇄 원정·정예 소집령·현상금 표적)
 * ```
 *
 * 이 규약의 이점 두 가지:
 *  - **신규 `EntityKind` 를 만들지 않는다.** `hashEntity` 레이아웃 규율을 건드리지 않고,
 *    `compact()` 의 기존 보스 사망 분기(= `endCommissionSegment` 호출 지점)를 그대로 탄다.
 *  - **무의뢰 런은 바이트 불변이다.** 의뢰가 아니면 `enemyType` 에 여전히 행성 인덱스가
 *    들어가며 값이 한 비트도 달라지지 않는다.
 *
 * ⚠️ {@link COMMISSION_BOSS_ENEMY_TYPE_BASE} 는 **행성 보스 수와 반드시 같아야** 한다.
 * 어긋나면 의뢰 보스가 행성 보스 모델을 뒤집어쓰거나(작으면) 렌더가 빈 슬롯을 집는다(크면).
 * 둘 다 조용히 잘못된 그림이 나올 뿐 아무 게이트도 울리지 않으므로,
 * `tests/commissionBossCatalog.test.ts` 가 이 등식을 잠근다.
 *
 * ## append-only
 * 이 배열의 **인덱스는 wire 값**이다(`CommissionBounty.targetKind` · 보스 `enemyType`).
 * 재배치하면 이미 발령된 의뢰의 표적이 조용히 바뀐다. 항상 끝에만 추가하라.
 */

import type { BossDef } from './boss.js';
import type { CommissionOrder } from '../src/run/commission.js';
import { COMMISSION_SALVAGE_MAW } from './bosses/commission-salvage-maw.js';
import { COMMISSION_WARLORD_CROWN } from './bosses/commission-warlord-crown.js';
import { COMMISSION_RUNNER_WRAITH } from './bosses/commission-runner-wraith.js';

/**
 * 의뢰 보스가 차지하는 `enemyType` 인덱스 공간의 시작점 = **행성 보스 수**.
 * 위 헤더의 ⚠️ 를 읽어라. 테스트가 등식을 잠근다.
 */
export const COMMISSION_BOSS_ENEMY_TYPE_BASE = 6;

/** 의뢰 보스 카탈로그. **append-only** — 인덱스가 wire 값이다. */
export const COMMISSION_BOSSES: readonly BossDef[] = [
  COMMISSION_SALVAGE_MAW, // 0 — 연쇄 원정
  COMMISSION_WARLORD_CROWN, // 1 — 정예 소집령
  COMMISSION_RUNNER_WRAITH, // 2 — 현상금 표적
];

/**
 * 주문 종류 → 의뢰 보스 카탈로그 인덱스.
 *
 * **제약 계약은 전용 보스를 두지 않고 연쇄 원정용을 공유한다.** 제약 계약의 정체성은 보스가
 * 아니라 출격 전 제한(장비·성장 축)이며, 그 제한을 묻는 것은 "제한된 채로 표준 전투를
 * 완수할 수 있는가"다. 전용 보스를 만들면 그 질문이 보스 기믹으로 옮겨가 흐려진다.
 */
export function commissionBossIndex(order: CommissionOrder): number {
  switch (order) {
    case 'elite':
      return 1;
    case 'bounty':
      return 2;
    case 'chain':
    case 'constraint':
      return 0;
  }
}

/** 그 주문의 의뢰 보스 정의. */
export function commissionBossDef(order: CommissionOrder): BossDef {
  const def = COMMISSION_BOSSES[commissionBossIndex(order)];
  if (def === undefined) throw new Error('commission boss catalog hole');
  return def;
}

/** 그 주문의 의뢰 보스가 엔티티에 실을 `enemyType` 값. */
export function commissionBossEnemyType(order: CommissionOrder): number {
  return COMMISSION_BOSS_ENEMY_TYPE_BASE + commissionBossIndex(order);
}
