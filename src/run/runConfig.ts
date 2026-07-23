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
import { planetContent } from '../../data/planets/index.js';
import { normalizePerformance } from '../../data/guardian.js';

/** 무대 선택값 — 프로필에서 파생되지 **않는** 입력만 여기 온다. */
export interface RunConfigOpts {
  /** 행성 인덱스. 침공 런은 0. */
  planet: number;
  /** 침략 단계(1..∞, ADR-0022). 침공 런은 1(단계 무관). */
  stage: number;
  /** 시드가 제안한 변칙을 수락했는가(침공은 항상 false). */
  anomalyAccepted?: boolean;
  /** 보스 전 세그먼트 상한(튜토리얼 단축판). 미지정 = 무제한. */
  maxSegments?: number;
  /** 3레이어 침공 설정(ADR-0017). 있으면 침공 런, 없으면 PvE. */
  invasion3?: Invasion3Config;
  /**
   * 예비역 소집(ADR-0024): 활성 기체 대신 이 수호 빌드로 출격한다. **침공 경로에서만** 전달한다.
   * 호출부가 고른 `GuardianRecord` 의 `build`(타입·장착 장비·스킬 투자)에 남은 성능%를 얹어
   * 만든 스냅샷이다. `equipped` 는 `equippedItems(profile)` 산출처럼 `EQUIP_SLOTS` 관련 순서의
   * 배열이다(무기/보조 선택이 순서 계약). 미지정 = 활성 기체 출격(기존 거동 불변).
   */
  pilot?: { equipped: Item[]; skillInvest: number[]; typeId: number; performanceCP: number };
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
 *
 * 행성 모드(ADR-0021, Lane2)도 여기서 **단일 정본**으로 스탬프한다 — 레지스트리
 * `planetContent(planet).mode` 가 정본이라 데이터 주도다. shipType 처럼 항상 명시하되
 * 값이 0(vampire)이면 `hashWorld` 꼬리 폴드가 미실행이라 뱀서류/침공 해시가 불변이다.
 *
 * ## 예비역 소집(ADR-0024) — opt-in 신규 입력
 * `opts.pilot` 이 있으면(침공 경로에서만 전달) 활성 기체 대신 예비역 빌드에서 loadout 을
 * 파생한다. 아래 소스 선택(`typeId`/`skillInvest`/`equipped`)은 **순수 additive** 라
 * `opts.pilot` 미지정 시 산술이 활성 기체 경로와 **바이트 동일**하다 — perf 감쇠 곱은
 * 소집 때만 실행된다(스트라이커 해시 골든 `tests/shipHashBaseline.test.ts` 가 못 박는다).
 */
export function buildRunConfig(profile: Profile, opts: RunConfigOpts): WorldConfig {
  const pilot = opts.pilot;
  const ship = activeShip(profile);
  // 소집이면 예비역 빌드에서, 아니면 활성 기체에서 소스를 고른다. 손상 세이브 방어: 범위 밖
  // typeId 는 스트라이커로 되돌린다(설계서 §6 — clamp 가 아니라 0).
  const typeId = normalizeShipTypeId(pilot !== undefined ? pilot.typeId : ship.typeId);
  // 복사본이다. 런 중 연구소 투자가 라이브 월드로 새지 않게(그리고 리플레이 스냅샷이
  // 나중에 변하지 않게) 반드시 잘라서 싣는다.
  const skillInvest = (pilot !== undefined ? pilot.skillInvest : ship.skillInvest).slice();
  // 소집은 스냅샷 장비를 그대로 쓴다(프로필 재조회 금지). 계보 기체 가지(ADR-0007)는 계정
  // 단위 파일럿 버프라 소집이든 활성이든 동일하게 얹는다(계정의 버프는 무엇을 타든 적용).
  // loadout 은 config 로 리플레이에 스냅샷되므로 서버 재실행 검증(EF)과 호환된다.
  const { loadout } = computeLoadoutStats(
    pilot !== undefined ? pilot.equipped : equippedItems(profile),
    skillInvest,
    shipBonusBp(profile.lineage),
    typeId,
  );
  // 성능% 감쇠(소집 전용) — resolveGuardianStats 철학 그대로: **크기(피해·HP)만** 스케일하고
  // 기하(발사 간격·탄속·사거리 등)는 불변이다. perf 는 centi-percent [5000,10000] 이라 완전
  // 성능(10000)이면 damageMult ×1·maxHpAdd round(x×1)=x 로 무연산 → 활성 빌드와 loadout 바이트
  // 동일(소집==활성 증명). maxHpAdd 는 단일 나눗셈+Math.round 로 정수 안정(scaleStat 규율).
  // 결과 loadout 은 config.loadout 로 스냅샷돼 EF 가 재파생 없이 그대로 리플레이한다 — 서버
  // 재해석이 없으므로 Node 내부 결정론만 필요하다(Math.random/Date.now 미사용).
  if (pilot !== undefined) {
    const perf = normalizePerformance(pilot.performanceCP);
    loadout.damageMult *= perf / 10000;
    loadout.maxHpAdd = Math.round((loadout.maxHpAdd * perf) / 10000);
  }
  return {
    ...DEFAULT_CONFIG,
    planet: opts.planet,
    // 단계 정본 클램프: [1,∞) 정수. sim(stageParams: s<1→1)과 hashWorld 폴드(replay.ts)를
    // 대칭으로 맞춰 stage:0/음수가 흘러도 결정론이 어긋나지 않게 한다(리뷰 LOW — 잠재 지뢰).
    stage: Math.max(1, opts.stage | 0),
    anomalyAccepted: opts.anomalyAccepted ?? false,
    loadout,
    skillInvest,
    // **항상 명시한다** — 스트라이커도 `shipType: 0` 을 싣는다. 값 의미는 미지정과 동일하고
    // (`state.config.shipType ?? 0`) 해시도 불변이지만, 리플레이를 재실행하는 EF 가 타입을
    // **추론이 아니라 명시**로 읽게 된다(설계서 §4). 훗날 시그니처 없는 타입이 추가돼도
    // "필드가 없으니 스트라이커겠지" 라는 추론이 조용히 깨지지 않는다.
    shipType: typeId,
    // 행성 모드는 레지스트리(PlanetContent.mode)가 정본이다(데이터 주도, ADR-0021).
    // shipType 과 같이 **항상 명시** — 서버(EF)가 추론이 아니라 명시로 읽는다. 침공 런은
    // planet 0(카르곤=vampire) 이라 mode 0 → 폴드 미실행 → verify-invasion 무영향.
    planetMode: planetContent(opts.planet).mode,
    ...(opts.maxSegments !== undefined ? { maxSegments: opts.maxSegments } : {}),
    ...(opts.invasion3 !== undefined ? { invasion3: opts.invasion3 } : {}),
  };
}
