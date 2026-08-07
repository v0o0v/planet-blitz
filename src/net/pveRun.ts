/**
 * PvE 런 서버 기록의 순수 로직(M4 Phase F · F4 착수 조건 이행 — 계획 §4).
 *
 * 이 모듈은 네트워크·`@supabase/supabase-js` 를 전혀 import 하지 않는다 — 리플레이
 * 재실행으로 결정론 결과를 만드는 순수 함수뿐이라 vitest 로 단독 검증된다(profileSync
 * 규율과 동일). 실제 서버 IO 는 `gateway.ts`(SupabaseGateway), 오케스트레이션은
 * `index.ts`(recordPveRun)가 담당한다.
 *
 * ⚠️ **서버 재실행 검증은 없다(ADR-0050).** PvE 는 이미 ADR-0026 이 리플레이 업로드·
 * `verify-pve-sample` 재검증을 폐기하고 정산 요약 + 3중 캡으로 전환했고(재화·아이템은
 * 서버 원장이 별도로 강제한다), ADR-0050 이 남은 침공·의뢰 경로의 hashStream 대조까지
 * 마저 걷어냈다. `buildPveRunResult` 는 실제 제출부에서 쓰이지 않는(호출부 0건) 순수
 * 결정론 함수로 남아 리플레이 재실행이 항상 같은 결과를 내는 것만 계속 못박는다.
 */

import type { Replay } from '../sim/replay.js';
import { runReplay } from '../sim/replay.js';

/**
 * 리플레이 재실행 결과(순수 결정론 스냅샷). 서버 대조용 증거가 아니다 — 서버는 이
 * 값을 재실행해 비교하지 않는다(ADR-0050, ADR-0026).
 */
export interface PveRunResult {
  /** 재실행 최종 상태의 승리 여부(코어 클리어 등). */
  victory: boolean;
  /** 재실행 최종 상태의 게임오버(격추/시간초과) 여부. */
  gameOver: boolean;
  /** 리플레이 총 틱 수(= inputs 길이). */
  finalTick: number;
  /** 최종 상태 해시(uint32). */
  finalHash: number;
}

/**
 * 리플레이를 재실행해 {@link PveRunResult} 를 만든다. 결정론이라 같은 리플레이면 항상
 * 같은 값이 나온다 — 밸런스 계측·회귀 감지가 전제하는 성질이지(ADR-0050 §2), 서버 제출
 * 대조용은 아니다.
 */
export function buildPveRunResult(replay: Replay): PveRunResult {
  const res = runReplay(replay);
  return {
    victory: res.finalState.victory,
    gameOver: res.finalState.gameOver,
    finalTick: replay.inputs.length,
    finalHash: res.finalHash,
  };
}
