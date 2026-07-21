/**
 * 런 설정 조립 — **단일 정본** (M8 설계서 §7 W3-L7, §10-2).
 *
 * `Profile` 에서 출발해 `createWorld` 에 넣을 {@link WorldConfig} 를 만든다. PvE 출격 ·
 * 정식 침공 · DEV 하네스 침공 **세 경로가 전부 이 함수 하나만** 쓴다.
 *
 * ## 왜 함수로 뽑았나 — 이 저장소에서 8번 재발한 결함의 구조적 원인
 * M8 이전에는 같은 조립이 `src/main.ts` 안에 **3중복**돼 있었다(:706 정식 침공 · :772 하네스
 * 침공 · :930 PvE). 그래서 "저장은 되는데 런에 안 닿는" 결함이 구조적으로 필연이었다 —
 * 어떤 레인이 새 필드(`Ship.typeId` 같은)를 배선할 때 1~2곳만 고치면, 나머지 경로는 조용히
 * 옛 거동으로 돌아가고 **단위 테스트는 전부 그린**이다. 설계서 §10-2 가 정확히 이 지점을
 * 예측했다.
 *
 * ⚠️ **신규 런 입력은 반드시 여기에만 추가한다.** 호출부에서 config 를 손보지 마라.
 * `tests/shipIntegration.test.ts` 의 grep 게이트가 `main.ts` 에 조립이 되살아나는 것을 막는다.
 *
 * ## 결정론 계약 (ADR-0005)
 * 순수 함수다 — Math.random / Date.now / 전역 상태를 읽지 않는다. 같은 `Profile` 은 항상
 * 같은 `WorldConfig` 를 낸다. `skillInvest` 는 **복사본**(`.slice()`)이라 런이 도는 동안
 * 프로필 편집(연구소 투자)이 라이브 월드로 새지 않는다.
 *
 * ## 스트라이커 해시 불변 (설계서 §5 다섯 겹 방어 중 3번)
 * `shipType` 은 항상 명시하되, 값이 0(스트라이커)이면 신규 경로가 전부 조기 탈출한다:
 * 시그니처 비트 없음(`signatureBit = -1`) · baseBp 전 축 0 → 무연산 · `hashWorld` 꼬리 폴드
 * 미실행. 즉 스트라이커 런의 per-tick 해시는 M8 이전과 **바이트 동일**하다
 * (`tests/shipHashBaseline.test.ts` 의 골든이 이것을 배열 전체로 증명한다).
 */

import { DEFAULT_CONFIG } from '../sim/world.js';
import type { WorldConfig } from '../sim/world.js';
import type { Invasion3Config } from '../sim/invasion/index.js';
import { EQUIP_SLOTS } from '../items/types.js';
import type { Item } from '../items/types.js';
import { computeLoadoutStats } from '../items/loadout.js';
import { shipBonusBp } from '../../data/lineage.js';
import { activeShip } from '../save/profile.js';
import type { Profile } from '../save/profile.js';
import { normalizeShipTypeId } from '../../data/ships/index.js';

/** 무대 선택값 — 프로필에서 파생되지 **않는** 입력만 여기 온다. */
export interface RunConfigOpts {
  /** 행성 인덱스. 침공 런은 0. */
  planet: number;
  /** 난이도 티어. 침공 런은 0. */
  tier: number;
  /** 시드가 제안한 변칙을 수락했는가(침공은 항상 false). */
  anomalyAccepted?: boolean;
  /** 보스 전 세그먼트 상한(튜토리얼 단축판). 미지정 = 무제한. */
  maxSegments?: number;
  /** 3레이어 침공 설정(ADR-0017). 있으면 침공 런, 없으면 PvE. */
  invasion3?: Invasion3Config;
}

/**
 * 활성 기체의 장착 아이템을 `EQUIP_SLOTS` 순서로 모은다. **순서가 계약이다** —
 * `computeLoadoutStats` 의 어픽스 합산은 순서 무관이지만 무기/보조 선택(`find`)은 아니다.
 */
function equippedItems(profile: Profile): Item[] {
  const ship = activeShip(profile);
  const out: Item[] = [];
  for (const id of EQUIP_SLOTS) {
    const it = ship.equipped[id];
    if (it !== undefined) out.push(it);
  }
  return out;
}

/**
 * 런 설정 조립 **단일 정본**. 세 호출부(정식 침공 · 하네스 침공 · PvE)가 전부 이것을 쓴다.
 *
 * 투자 벡터의 정본은 **활성 기체**(`Ship.skillInvest`)다 — 계정 단위 `Profile.skillInvest` 는
 * M8 에서 삭제됐다(설계서 §6). 기체 타입(`Ship.typeId`)은 세 갈래로 런에 도달한다:
 *  1. `computeLoadoutStats(..., typeId)` — 섀시 baseBp · 타입별 트리 파생 · 시그니처 비트 OR-in
 *  2. `WorldConfig.shipType` — sim 의 시그니처 게이트(`world.ts`)와 `hashWorld` 꼬리 폴드
 *  3. `skillInvest` 길이 — 타입별 노드 수(스트라이커 63, 비온 78 …)가 해시에 그대로 접힌다
 */
export function buildRunConfig(profile: Profile, opts: RunConfigOpts): WorldConfig {
  const ship = activeShip(profile);
  // 손상 세이브 방어: 범위 밖 typeId 는 스트라이커로 되돌린다(설계서 §6 — clamp 가 아니라 0).
  const typeId = normalizeShipTypeId(ship.typeId);
  // 복사본이다. 런 중 연구소 투자가 라이브 월드로 새지 않게(그리고 리플레이 스냅샷이
  // 나중에 변하지 않게) 반드시 잘라서 싣는다.
  const skillInvest = ship.skillInvest.slice();
  // 계보 기체 가지(ADR-0007)를 장비·스킬 위에 겹친다. loadout 은 config 로 리플레이에
  // 스냅샷되므로 서버 재실행 검증(EF)과 호환된다.
  const { loadout } = computeLoadoutStats(
    equippedItems(profile),
    skillInvest,
    shipBonusBp(profile.lineage),
    typeId,
  );
  return {
    ...DEFAULT_CONFIG,
    planet: opts.planet,
    tier: opts.tier,
    anomalyAccepted: opts.anomalyAccepted ?? false,
    loadout,
    skillInvest,
    // **항상 명시한다** — 스트라이커도 `shipType: 0` 을 싣는다. 값 의미는 미지정과 동일하고
    // (`state.config.shipType ?? 0`) 해시도 불변이지만, 리플레이를 재실행하는 EF 가 타입을
    // **추론이 아니라 명시**로 읽게 된다(설계서 §4). 훗날 시그니처 없는 타입이 추가돼도
    // "필드가 없으니 스트라이커겠지" 라는 추론이 조용히 깨지지 않는다.
    shipType: typeId,
    ...(opts.maxSegments !== undefined ? { maxSegments: opts.maxSegments } : {}),
    ...(opts.invasion3 !== undefined ? { invasion3: opts.invasion3 } : {}),
  };
}
