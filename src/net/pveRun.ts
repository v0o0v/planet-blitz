/**
 * PvE 런 서버 기록의 순수 로직(M4 Phase F · F4 착수 조건 이행 — 계획 §4).
 *
 * 이 모듈은 네트워크·`@supabase/supabase-js` 를 전혀 import 하지 않는다 — 리플레이
 * 재실행으로 제출용 결과(해시 스트림 포함)를 만드는 결정론 순수 함수뿐이라 vitest 로
 * 단독 검증된다(profileSync 규율과 동일). 실제 서버 IO 는 `gateway.ts`(SupabaseGateway),
 * 오케스트레이션은 `index.ts`(recordPveRun)가 담당한다.
 *
 * 서버는 이 리플레이를 전수 재실행(verify-pve-sample EF)해 hashStream 을 대조하므로,
 * 침공 제출({@link ../net/invasion.ts buildClientResult})과 **동일한 hashStream 계약**을
 * 유지한다 — 틱별 uint32 상태 해시. 다만 PvE 는 방어자·래더가 없어 승/패 외에 게임오버
 * 플래그까지 함께 담아, 재실행 결과 대조(outcome)가 승리/게임오버 어느 종료 상태에서도
 * 정직 런을 오거부하지 않도록 한다(침공은 승리==!게임오버로 수렴하지만 PvE 는 아님).
 */

import type { Replay } from '../sim/replay.js';
import { runReplay } from '../sim/replay.js';

/**
 * 클라이언트가 PvE 런과 함께 제출하는 잠정 결과(증거). 서버가 리플레이를 재실행해 이
 * 값과 대조한다. `hashStream` 은 틱별 `hashWorld` 값(uint32) — 조작 시 서버 재실행과
 * 불일치해 rejected 로 확정되고 계정이 플래그된다.
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
  /** 틱별 상태 해시 스트림(uint32 배열, 길이 === finalTick). */
  hashStream: number[];
}

/**
 * 리플레이를 재실행해 제출용 {@link PveRunResult}(해시 스트림 포함)를 만든다. 결정론이라
 * 같은 리플레이면 항상 같은 값이 나오고, 서버 재실행이 이 값을 그대로 대조한다(ADR-0005).
 */
export function buildPveRunResult(replay: Replay): PveRunResult {
  const res = runReplay(replay);
  return {
    victory: res.finalState.victory,
    gameOver: res.finalState.gameOver,
    finalTick: replay.inputs.length,
    finalHash: res.finalHash,
    hashStream: res.hashes,
  };
}
