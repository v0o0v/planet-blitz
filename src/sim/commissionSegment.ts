/**
 * 의뢰 런 **구간 전환 층** (계획 §A-2·§A-4 · PA 레인 계약 §4·§6).
 *
 * 다구간 의뢰는 구간마다 **새 월드를 만든다**. 그래서 sim 을 한 틱 전진시키는 함수가
 * `stepWorld`(월드를 제자리에서 바꾼다)가 아니라 {@link stepRun}(**월드를 반환한다**)이 된다.
 *
 * ## 호출 순서 계약은 하나다
 * **전환은 `stepWorld` 직후·다음 `stepWorld` 이전.** 그 사이에 아무것도 끼우지 않는다.
 *
 * ⚠️ **이 계약을 어겼을 때의 증상이 지독하다**: 클라도 서버도 **둘 다 `runReplay`** 를 쓰므로
 * 해시는 절대 갈리지 않는다. 대신 **실제 플레이한 런과 정산·재검증되는 런이 갈린다** —
 * 어떤 해시 게이트도 울리지 않고 조용히 통과한다(PR#191 계열 결함).
 *
 * ## ⚠️ 호출부는 월드 참조를 루프 밖에 캐시하면 안 된다
 * {@link stepRun} 이 새 객체를 돌려주므로, 스텝 루프 앞에서 잡아 둔 참조는 전환 직후
 * **죽은 월드**를 가리킨다. 죽은 월드로 정산하면 마지막 구간의 전리품·XP 가 통째로 사라지고
 * 화면엔 "정산이 이상하다"로만 보인다. `tests/commissionWorldRebind.test.ts` 가 호출부
 * 3곳(`main.ts` 티커 · 하네스 `ff`/`step`)의 재조회를 소스 수준에서 잠근다.
 *
 * ## ⚠️ EF 배포 조건 — "재배포 불요"는 **침공 트래픽에 한해** 참이다
 * 이 레인은 `supabase/` 를 한 줄도 안 고쳤고(`verify-run/verifyCore.ts` diff 0) 무의뢰 런의
 * 해시가 바이트 불변이라, **배포된 `verify-invasion` 을 재배포하지 않아도 기존 침공은 계속
 * accept 된다.** 거기까지가 참이다.
 *
 * 그런데 그 배포 번들은 `src/sim` 을 통째로 담으므로 **구 `runReplay`(월드를 한 번만 만들고
 * `stepWorld` 로 도는 루프)를 그대로 들고 있다.** 따라서:
 *
 * - **의뢰 런을 검증하는 EF 는 반드시 이 커밋 이후 소스로 번들해야 한다.** 구 소스로 번들하면
 *   서버 재실행이 구간 전환을 하지 않아 `finalState` 가 1구간에서 멈추고, `verifyCore.ts` 가
 *   읽는 `victory`/`gameOver` 가 둘 다 `false` 라 **모든 의뢰 리플레이가 `outcome-mismatch` 로
 *   100% 거부**된다.
 * - 이 저장소는 **정확히 그 실수를 이미 한 번 했다** — M8 배선 이전 커밋으로 번들해 배포하고
 *   문서만 "완료"였으며 그동안 침공이 계속 거부되고 있었다. 그래서 배포 절차 정본
 *   (`.omc/skills/planet-blitz-supabase-deploy-workflow.md`)이 **번들 소스 커밋을 기록하고
 *   `origin/main` 최신인지 대조하라**를 단계로 못 박고 있다.
 *
 * `verify-run` 은 배포 대상이 **아니다**(`deno.json` 에 `bundle` 태스크가 없고 "배포 전 로컬 확인
 * 전용"이라고 적혀 있다). 대상은 **새로 만들 `verify-commission`** 이다.
 *
 * ## 마지막 틱 전환 금지 (구조적으로 막을 수 없는 축 — 자인한다)
 * 중간 구간의 **마지막 입력 프레임** 뒤에 전환이 일어나면 `runReplay` 의 `finalState` 가 한 틱도
 * 안 돈 새 월드가 되어 `victory`/`gameOver` 가 둘 다 `false` 다 → 서버 `verify-run` 이
 * `outcome-mismatch` 를 낸다. 입력 로그 길이는 sim 이 모르는 정보라 여기서 막을 방법이 없다.
 * 리플레이를 만드는 쪽(클라 루프)이 런 종료 후에도 입력을 기록하지 않는 한 발생하지 않는다.
 */

import type { InputFrame, WorldConfig, WorldState } from './world.js';
import { createWorld, stepWorld } from './world.js';
import { carryAcrossSegment } from './commissionCarry.js';
import type { CommissionRunConfig, SegmentSpec } from '../run/commission.js';
import { planetContent } from '../../data/planets/index.js';

/**
 * 다음 구간의 시드 — `(런 시드, 구간 인덱스)` 의 순수 함수다.
 *
 * `state.rng` 는 마스터 스트림이고 런 내내 **소비되지 않는다**(하위 스트림은 전부 `fork` 파생).
 * 그래서 그 상태는 사실상 런 시드의 별명이고, 여기서 `fork` 로 파생하면 서버가 같은 리플레이를
 * 재실행할 때 정확히 같은 값을 얻는다. `fork` 는 부모를 전진시키지 않으므로 직전 구간 월드의
 * 해시 상태에도 영향이 없다.
 *
 * 구간 인덱스를 섞는 것이 핵심이다 — 안 섞으면 같은 행성·같은 단계가 반복되는 의뢰에서
 * 2구간이 1구간과 **완전히 같은 무대**가 된다.
 */
function segmentSeed(prev: WorldState, nextIndex: number): number {
  return prev.rng.fork(nextIndex).getState();
}

/**
 * 무대 차집합 — 계승 config 위에 덮어쓸 **좁은 리터럴**(계약 §4).
 *
 * ⚠️ `arenaWidth`/`arenaHeight`/`maxSegments` 는 **의도적으로 빠져 있다.** 계약 초안은 이 셋을
 * 열거했지만, 실측 결과 이 저장소에서 아레나 크기는 행성·단계에서 파생되지 않는다
 * (`arenaWidth` 를 쓰는 곳은 `DEFAULT_CONFIG`·벤치·Deno 하네스뿐 — 행성 레지스트리에 없다).
 * 여기서 `DEFAULT_CONFIG` 값으로 덮으면 커스텀 아레나로 도는 하네스·벤치 런이 2구간에서
 * 조용히 기본 아레나로 되돌아간다. **파생되지 않는 값을 "무대 차집합"에 넣으면 그건 차집합이
 * 아니라 리셋이다.** 훗날 행성별 아레나가 생기면 그때 이 리터럴에 추가한다.
 *
 * `planetMode` 를 여기서 다시 파생하는 이유: 모드의 단일 정본은 `planetContent(planet).mode`
 * 이고(`SegmentSpec` 에 `mode` 필드를 두지 않는 이유와 같다), 계승만 하면 1구간 행성의 모드가
 * 2구간 행성에 그대로 붙어 "카르곤인데 수축" 같은 불가능한 조합이 만들어진다.
 */
function stageOverride(
  seg: SegmentSpec,
  nextIndex: number,
  cm: CommissionRunConfig,
): Partial<WorldConfig> {
  return {
    planet: seg.planet,
    // 단계 클램프 규율은 `buildRunConfig` 와 대칭이다([1,∞) 정수).
    stage: Math.max(1, seg.stage | 0),
    planetMode: planetContent(seg.planet).mode,
    // ⚠️ **새 객체**다. `{ ...cm, segmentIndex }` 가 아니라 in-place 증가를 쓰면 직전 구간
    // 월드의 config 까지 함께 바뀌고, 그 config 는 리플레이 스냅샷에 실려 있다
    // (`CommissionRunConfig` 전 필드 `readonly` 가 그 실수를 타입으로 막는다).
    commission: { ...cm, segmentIndex: nextIndex },
  };
}

/**
 * 구간을 하나 전진시켜 **새 월드**를 만든다. 전환할 것이 없으면 `prev` 를 그대로 돌려준다
 * (항등 반환이 계약 — 호출부가 `next !== prev` 로 전환 여부를 판별한다).
 *
 * ⚠️ **첫 줄이 종료 플래그 우선순위 계약이다**(계약 §A-3b): `gameOver`/`victory` 는
 * `segmentDone` 을 **무조건 이긴다.** 보스를 죽인 그 틱에 잔존 적·탄이 플레이어를 죽이면
 * `checkGameOver` 가 같은 틱에 `gameOver` 를 세우는데, 루프 층이 `segmentDone` 만 보면
 * **죽은 런이 다음 구간을 연다.**
 */
export function advanceCommissionSegment(prev: WorldState): WorldState {
  if (prev.gameOver || prev.victory) return prev;
  const cm = prev.config.commission;
  if (cm === undefined) return prev;
  const nextIndex = cm.segmentIndex + 1;
  const seg = cm.segments[nextIndex];
  // 마지막 구간에서는 전환이 없다 — `endCommissionSegment` 의 분기 ②③ 이 이미 런을 끝냈다.
  if (seg === undefined) return prev;

  const cfg: WorldConfig = { ...prev.config, ...stageOverride(seg, nextIndex, cm) };
  // `preDerived: true` — 계승 config 에는 로드아웃·촉매 파생이 **이미 구워져 있다**. 다시 구우면
  // 구간마다 스탯이 곱해진다(계약 §4). 이 플래그 없이도 테스트가 그린이 되는 형태라
  // `tests/commissionSegment.test.ts` 의 "파워업 0회 스탯 동일" 이 유일한 방어다.
  const next = createWorld(segmentSeed(prev, nextIndex), cfg, { preDerived: true });
  carryAcrossSegment(prev, next);
  return next;
}

/**
 * 런을 한 틱 전진시킨다 — **월드 참조가 바뀔 수 있다**(다구간 의뢰의 구간 전환).
 *
 * 무의뢰 런에서는 `stepWorld` 한 번 + 항등 반환이라 기존 경로와 산술이 완전히 같다.
 *
 * 프리즈(레벨업 대기) 중에는 전환하지 않는다 — 파워업 선택이 소비되지 않은 채 무대가 바뀌면
 * 선택지가 사라진다. `segmentDone` 은 런타임에 남아 프리즈가 풀린 다음 틱에 전환된다
 * (그래서 이 신호가 실제로 해시 스트림에 나타나며, 그것이 의뢰 꼬리 폴드가 `segmentDone` 을
 * 접는 이유다).
 *
 * ⚠️ 조우 detour 가드는 **두지 않는다.** 의뢰 런은 `encounterRuntime` 자체를 세우지 않으므로
 * (계약 §9) 도달 불가 사문 코드가 된다.
 */
export function stepRun(state: WorldState, input: InputFrame): WorldState {
  stepWorld(state, input);
  const rt = state.commissionRuntime;
  if (rt === undefined || rt.segmentDone !== 1) return state;
  if (state.gameOver || state.victory) return state;
  if (state.pendingLevelUp) return state;
  return advanceCommissionSegment(state);
}
