/**
 * 파워업 **선택 정책** — 밸런스 격자의 파워업 축.
 *
 * ## 왜 필요한가 — 원인 축을 못 재는 상태였다
 * `pnpm balance` 격자는 오토파일럿이 항상 **오퍼 0번**을 고르므로(`src/sim/autopilot.ts`)
 * 파워업 조합의 강약이 전혀 갈리지 않았다(`docs/balance-check.md` §6 자인). 그런데 2026-08-03
 * 침공 붕괴의 확정 원인은 **파워업 상한 −10% 너프 단독**이었다(밸런스 큐 §R7) — 즉 이 리포는
 * 자기 붕괴의 원인 축을 재는 계측기를 갖고 있지 않았다. 이 모듈이 그 구멍을 메운다.
 *
 * ## 무엇을 재는 축인가 — **오퍼가 아니라 선택**이다
 * 파워업 3택 추첨(`drawPowerupChoices`)은 **런 시작 config 만** 읽는다(무기 타입 · 스킬 투자 ·
 * 모드 · 액티브 슬롯). 벤치 프로필은 액티브를 장착하지 않으므로 `skillInvest` 를 바꾸는
 * 파워업(24·25번)이 pool 에 들어오지 않고, 따라서 **가중치가 런 내내 상수**다. 즉 같은 시드에서
 * 정책을 바꿔도 **오퍼 추첨 스트림이 같은 순서로 소비된다** — 정책 간 비교가 짝지어진다
 * (paired). 이 축이 재는 것은 "무엇이 제시되는가"가 아니라 "제시된 것 중 무엇을 고르는가"다.
 *
 * ## 계열 분류는 **하드코딩이 아니라 실제 변이 관찰**로 정한다
 * `POWERUPS` 는 append-only 로 계속 늘어난다. 여기에 id 목록을 적으면 그 목록이 조용히
 * 낡는다 — 이 리포가 반복해서 겪은 결함이 정확히 "카탈로그는 늘었는데 목록이 안 늘어 조용히
 * 빠짐"이다(`axes.ts` 헤더). 그래서 각 파워업의 `apply` 를 **최소 스텁 상태**에 한 번 걸어 보고
 * **무엇이 실제로 바뀌었는지**로 계열을 정한다. 새 파워업은 자동으로 분류된다.
 *
 * 어떤 필드도 안 바뀌면 `'unknown'` 이 되고 `tests/balanceHarness.test.ts` 가 **큰 소리로
 * 실패**한다(조용한 미분류 금지) — 스텁이 못 보는 새 축이 생겼다는 신호다.
 *
 * ## 실측 (2026-08-04, 밸런스 큐 §R26)
 * 정책 5종 × 1,050런에서 클리어율 폭은 **3.8pp** 였다(기준선 69.0 · 화력 65.7 · 생존 69.5 ·
 * 기동 69.0 · 최약근사 67.6%). 행성 편차 24.7pp 대비 한 자릿수 아래다 — 다만 시드 1개라
 * 비대조 SE ≈ 3.2pp 이므로 **순위가 아니라 "폭의 상한"으로만** 읽어라.
 *
 * ## ⚠️ 자인 — **진짜 "무-파워업" 대조군은 구조적으로 불가능하다**
 * 레벨업 프리즈는 유효한 픽이 올 때까지 월드를 정지시키고(`stepWorld` 의 `pendingLevelUp`
 * 블록), 범위 밖 인덱스는 프리즈를 **소비하지 않는다**(고의 설계 — 위조 프레임이 빌드 선택을
 * 건너뛰지 못하게). 즉 "아무것도 안 고르는 런"은 타임아웃까지 얼어붙는다. sim 을 고치지 않고는
 * 0-파워업 런을 만들 수 없으므로, 대조군은 {@link POWERUP_POLICY_MINIMAL}(전투 기여가 가장
 * 낮은 계열 우선)로 **근사**한다. 이 축의 값은 "파워업을 껐을 때"가 아니라 **"가장 약하게
 * 골랐을 때"** 로 읽어라.
 */

import type { WorldState } from '../../sim/world.js';
import { POWERUPS } from '../../sim/powerups.js';

/**
 * 파워업이 실제로 건드리는 축.
 *
 * - `offense` — 무기 스탯(피해 · 탄수 · 관통 · 발사 간격 · 탄속 · 사거리 · 확산)
 * - `survival` — 최대 HP
 * - `mobility` — 이동 속도 · 대시 재충전 · 젬 흡수 반경
 * - `active` — 액티브 스킬 계열 투자(장착 런에서만 후보에 오른다)
 * - `unknown` — 스텁이 관측하지 못했다. **분류 실패 신호**이지 "효과 없음"이 아니다.
 */
export type PowerupLine = 'offense' | 'survival' | 'mobility' | 'active' | 'unknown';

/**
 * `apply` 관찰용 최소 스텁. `POWERUPS` 의 모든 `apply` 가 읽거나 쓰는 필드만 담는다.
 *
 * 전체 `WorldState` 를 만들지 않는 이유는 비용이 아니라 **격리**다 — `createWorld` 를 부르면
 * 분류가 행성·시드에 의존하게 되고, 그러면 워커마다 다른 분류가 나올 수 있다. 스텁은 상수다.
 *
 * `config.activeSlots`·`config.skillInvest` 를 **일부러 비워 둔다**: 액티브 강화(`bumpActiveTree`)
 * 가 무연산으로 빠져나가므로 그 두 개만 관찰로 못 가른다. 대신 그 둘은 데이터에 명시 태그
 * (`activeSlot`)가 있으므로 태그로 가른다 — 태그가 있는 축까지 관찰로 추정할 이유가 없다.
 *
 * ## ⚠️ 기준값이 작으면 **정수 반올림이 변이를 삼킨다** (2026-08-03 실측 → 2026-08-04 해소)
 * 처음에는 실제 기본값(발사 간격 6틱)을 그대로 썼는데, `fp-cadence`(발사 간격 −8%)가
 * `round(6 × 0.92) = 6` 이라 **아무것도 안 바뀌어** `'unknown'` 으로 분류됐다. 이것은 분류기의
 * 결함이 아니라 `powerups.ts` 헤더가 경고하던 그 함정(정수 틱)이 실물로 드러난 것이다 —
 * **분류기가 신설 즉시 진짜 결함을 잡았다**(밸런스 큐 §R27 → 처방 §R39).
 *
 * 발사 간격 축은 고정소수점(`fireCooldownQ`, 1/256틱)으로 바뀌어 해소됐다. 그래도 스텁
 * 기준값은 **크게 유지한다** — 분류는 "이 파워업이 **어느 축을 건드리려 하는가**"만 알면 되고,
 * 무기별 실제 기본값에서 먹히는지는 이 축이 답할 질문이 아니다(그건 실측 런의 몫이다).
 * 큰 기준값은 앞으로 추가될 감소형 배율에 대해서도 분류를 안전하게 만든다.
 *
 * ⚠️ 스텁 필드명은 sim 과 **정확히 같아야** 한다(`fireCooldownQ`). 이름이 어긋나면 `apply` 가
 * 스텁에 없는 필드를 만들어 관찰은 성공하지만 **분류가 sim 과 무관해진다.**
 */
function makeProbe(): { s: WorldState; snapshot: () => string } {
  const player = { maxHp: 10000, hp: 10000 };
  const s = {
    weapon: {
      weaponType: 0,
      damage: 10000,
      bulletCount: 1,
      pierce: 0,
      fireCooldownQ: 10000,
      bulletSpeed: 10000,
      range: 10000,
      spread: 0,
    },
    config: { playerSpeed: 10000, dashCooldownTicks: 10000, playerHp: 10000 },
    entities: [player],
    magnetRadius: 10000,
  } as unknown as WorldState;
  const snapshot = () =>
    JSON.stringify([s.weapon, s.config, s.magnetRadius, player.maxHp, player.hp]);
  return { s, snapshot };
}

function classify(index: number): PowerupLine {
  const def = POWERUPS[index];
  if (def === undefined) return 'unknown';
  // 액티브 강화는 데이터에 명시 태그가 있다(스텁으로는 무연산이라 관찰로 안 갈린다).
  if (def.activeSlot !== undefined) return 'active';

  const { s, snapshot } = makeProbe();
  const before = JSON.parse(snapshot()) as [
    Record<string, number>,
    Record<string, number>,
    number,
    number,
    number,
  ];
  def.apply(s);
  const after = JSON.parse(snapshot()) as typeof before;

  const weaponChanged = JSON.stringify(before[0]) !== JSON.stringify(after[0]);
  if (weaponChanged) return 'offense';
  const hpChanged =
    before[1]['playerHp'] !== after[1]['playerHp'] || before[3] !== after[3] || before[4] !== after[4];
  if (hpChanged) return 'survival';
  const mobilityChanged =
    before[1]['playerSpeed'] !== after[1]['playerSpeed'] ||
    before[1]['dashCooldownTicks'] !== after[1]['dashCooldownTicks'] ||
    before[2] !== after[2];
  if (mobilityChanged) return 'mobility';
  return 'unknown';
}

/** 파워업 pool 인덱스 → 계열. `POWERUPS` 전수에서 파생되므로 새 항목이 자동으로 들어온다. */
export const POWERUP_LINES: readonly PowerupLine[] = POWERUPS.map((_, i) => classify(i));

// ---------------------------------------------------------------------------
// 정책
// ---------------------------------------------------------------------------

/** 정책 하나 — 오퍼에서 고를 계열의 **우선순위**다. 우선순위에 없으면 오퍼 0번으로 떨어진다. */
export interface PowerupPolicy {
  readonly id: number;
  /** 리포트 표 라벨(한글). */
  readonly label: string;
  /** 앞에서부터 오퍼에 있으면 그것을 고른다. 빈 배열 = 항상 0번(= 현행 거동). */
  readonly prefer: readonly PowerupLine[];
}

/** **기준선** — 오퍼 0번. 현행 오토파일럿과 바이트 동일하다(이 축의 대조 기준). */
export const POWERUP_POLICY_BASELINE = 0;
/** 전투 기여가 가장 낮은 계열 우선 — 진짜 0-파워업이 불가능해서 두는 **근사 대조군**. */
export const POWERUP_POLICY_MINIMAL = 4;

/**
 * 표준 파워업 정책 세트.
 *
 * **전 조합을 열거하지 않는다.** 26개 파워업의 조합은 폭발하고, 이 축이 답해야 하는 질문은
 * "어느 조합이 최적인가"가 아니라 **"파워업 선택이 클리어율을 얼마나 가르는가"** 다. 대표 계열
 * 3개 + 기준선 + 최약 근사 대조군이면 그 폭(spread)이 나온다.
 */
export const POWERUP_POLICIES: readonly PowerupPolicy[] = [
  { id: 0, label: '기준선(0번)', prefer: [] },
  { id: 1, label: '화력우선', prefer: ['offense'] },
  { id: 2, label: '생존우선', prefer: ['survival'] },
  { id: 3, label: '기동우선', prefer: ['mobility'] },
  { id: 4, label: '최약근사', prefer: ['mobility', 'survival', 'offense'] },
];

/** 정책 id → 정의. 미지 id 는 기준선으로 떨어진다(측정이 조용히 멈추지 않게). */
export function powerupPolicy(id: number): PowerupPolicy {
  return POWERUP_POLICIES.find((p) => p.id === id) ?? (POWERUP_POLICIES[0] as PowerupPolicy);
}

/**
 * 이번 레벨업에서 고를 **오퍼 인덱스**(0..3).
 *
 * `state.powerupChoices` 는 pool 인덱스 배열이고 입력 프레임에 실리는 것은 그 **배열 안의
 * 위치**다(`packPowerupPick`). 우선 계열이 오퍼에 없으면 0번으로 떨어지므로 어떤 정책이든
 * 반드시 유효한 픽을 낸다 — 범위 밖 인덱스는 프리즈를 소비하지 않아 런이 얼어붙는다.
 */
export function choosePowerupOffer(state: WorldState, policyId: number): number {
  const offers = state.powerupChoices;
  if (offers.length === 0) return 0;
  for (const line of powerupPolicy(policyId).prefer) {
    for (let i = 0; i < offers.length; i++) {
      const pool = offers[i];
      if (pool !== undefined && POWERUP_LINES[pool] === line) return i;
    }
  }
  return 0;
}
