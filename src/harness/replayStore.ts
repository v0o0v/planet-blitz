/**
 * 하네스 리플레이 보관·요약 (개발 도구, DEV 전용 — ADR-0008).
 *
 * 치트 패널의 리플레이 섹션이 "현재 런/최근 런을 재생하고, JSON 을 복사·붙여넣기하고, 요약
 * 한 줄을 보여 주는" 조작을 하기 위한 **순수 변환**만 담당한다. 재생 자체는 `src/ui/replaySpectate.ts`
 * + main.ts 의 `beginSpectate` 가 하고, 이 모듈은 그 경로에 넣을 값을 만들고 검증한다.
 *
 * ⚠️ **이 모듈은 서버 제출·검증과 무관하다(ADR-0050 삭제 대상이 아니다).** 여기서 다루는
 * 리플레이는 항상 **호스트(main.ts)가 직접 넘긴 자기 런**이거나 사람이 로컬에서 붙여넣은
 * JSON 이다 — 서버에서 받아 오지 않고, 서버에 제출하지도 않는다. 서버 침공 관전(상대 리플레이를
 * 서버에서 받아 보는 기능)은 ADR-0050 으로 폐지됐지만, 그 폐지는 `fetchInvasionReplay`/
 * `startSpectate`(main.ts, 서버 IO)를 지운 것이지 이 로컬 도구를 지운 것이 아니다.
 *
 * ## shape 검증을 재구현하지 않는 이유
 * 재생 가능 여부의 정본은 `isPlayableReplay`(replaySpectate.ts:28)다 — seed 가 유한수이고
 * inputs 가 비어 있지 않은 배열인지. 하네스가 별도 술어를 두면 "하네스에선 되는데 재생 화면에선
 * 거부되는" 괴리가 생기므로 **그 함수를 그대로 재사용**한다.
 *
 * ## parseReplay 는 절대 throw 하지 않는다
 * 붙여넣기 입력은 사람이 손으로 자른 JSON 조각인 경우가 흔하다. 파싱 실패·shape 불일치를
 * 예외로 올리면 치트 패널 클릭 하나가 하네스 전체를 멈춘다. 실패는 전부 `null` 이고, 호출부가
 * 안내 문구를 띄운다(`src/net/**` 공개 함수의 "절대 throw 안 함" 규율과 같은 결).
 *
 * 프로덕션 미포함: 하네스 배선(main.ts DEV 블록) 전용 import.
 */

import { TICK_RATE } from '../sim/constants.js';
import { INVASION_TOTAL_TICKS } from '../sim/invasion/index.js';
import type { Replay } from '../sim/replay.js';
import { isPlayableReplay } from '../ui/replaySpectate.js';

/** 리플레이 1건의 표시 요약(치트 패널 한 줄). */
export interface ReplaySummary {
  /** 월드 시드. */
  seed: number;
  /** 기록된 입력 프레임 수 = 재실행 틱 수. */
  ticks: number;
  /** 재생 길이(초, 반올림 정수). 60틱 = 1초. */
  durationSec: number;
  /** 침공 런 여부. */
  invasion: boolean;
}

/**
 * 요약 파생(순수). **침공 판정은 `config.invasion3` 존재 여부**다 —
 * `WorldConfig.invasion3`(src/sim/world.ts:651)가 있는 런만 3레이어 침공이고, sim 자신도 같은
 * 술어로 분기한다(world.ts:413 "`state.config.invasion3 !== undefined` 로만"). 별도 플래그를
 * 만들면 그 순간 두 판정이 갈린다.
 */
export function replaySummary(replay: Replay): ReplaySummary {
  const ticks = Array.isArray(replay.inputs) ? replay.inputs.length : 0;
  return {
    seed: replay.seed,
    ticks,
    durationSec: Math.round(ticks / TICK_RATE),
    invasion: replay.config?.invasion3 !== undefined,
  };
}

/** 리플레이 → JSON 문자열(복사용). 압축·필드 생략 없음 — 붙여넣어 그대로 재생돼야 한다. */
export function serializeReplay(replay: Replay): string {
  return JSON.stringify(replay);
}

/**
 * 붙여넣기 리플레이의 틱 상한. 침공 총 예산(300초)의 4배로, 실제 런에서 나올 수 있는 길이는
 * 전부 통과하면서 손으로 만든 거대 입력은 막는다.
 *
 * 왜 상한이 필요한가: `verifyReplay`(harness/core.ts)는 `runReplay` 를 **동기 루프**로 돌린다.
 * `inputs` 길이에 제한이 없으면 수천만 프레임짜리 JSON 하나로 하네스 탭이 복구 불능으로
 * 멈춘다(보안 리뷰 MEDIUM-1). 자기 런에서 뽑은 리플레이는 이 경로를 타지 않으므로
 * (`playReplay()`/`verifyReplay()` 는 호스트에서 직접 받는다) 상한이 정상 사용을 막지 않는다.
 */
export const MAX_PASTED_REPLAY_TICKS = INVASION_TOTAL_TICKS * 4;

/**
 * JSON 문자열 → 리플레이. 파싱 실패든 shape 불일치든 **전부 `null`**(throw 금지).
 *
 * 통과 기준은 관전 경로와 동일한 {@link isPlayableReplay} 이고, 그 위에 **붙여넣기 입력에만**
 * 필요한 방어 세 겹을 더한다:
 *   ① 틱 상한({@link MAX_PASTED_REPLAY_TICKS}) — 동기 재실행 정지 방지
 *   ② `inputs` 원소가 객체인가 — `[null, null, …]` 은 정본 술어를 통과하지만 재생 루프
 *      (try/catch 없음)에서 매 프레임 throw 한다
 *   ③ `config` 가 객체인가 — 그대로 `createWorld` 로 들어가는 값이다
 * 정본 술어(`isPlayableReplay`)는 건드리지 않는다 — 자기 런 리플레이에는 이 검사가 불필요하고,
 * 관전 경로와 판정이 갈리면 "하네스에선 되는데 관전에선 거부되는" 괴리가 생긴다.
 */
export function parseReplay(json: string): Replay | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isPlayableReplay(parsed)) return null;
  if (parsed.inputs.length > MAX_PASTED_REPLAY_TICKS) return null;
  for (const frame of parsed.inputs) {
    if (typeof frame !== 'object' || frame === null) return null;
  }
  if (parsed.config !== undefined && (typeof parsed.config !== 'object' || parsed.config === null))
    return null;
  return parsed;
}
