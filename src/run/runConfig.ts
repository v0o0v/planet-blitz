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
import type { WorldConfig, LoadoutConfig } from '../sim/world.js';
import type { Invasion3Config } from '../sim/invasion/index.js';
import type { CommissionEquipRules, CommissionRunConfig } from './commission.js';
import {
  COMMISSION_ELITE_WAVE_SEGMENTS,
  COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
} from './commissionConstants.js';
import { EQUIP_SLOTS, RARITY_CODE } from '../items/types.js';
import type { EquipSlotId, Item } from '../items/types.js';
import { UNIQUE_REGISTRY } from '../items/uniques.js';
import { computeLoadoutStats, deriveSkillAffixLv } from '../items/loadout.js';
import { shipBonusBp } from '../../data/lineage.js';
import { activeShip } from '../save/profile.js';
import type { Profile } from '../save/profile.js';
import { normalizeShipTypeId } from '../../data/ships/index.js';
import { planetContent } from '../../data/planets/index.js';
import { normalizePerformance } from '../../data/guardian.js';
import { NEUTRAL_MULT_CENTI } from '../economy/planetPopularity.js';
import { activeById, wireIdOf } from '../../data/ships/actives/index.js';
import { ACTIVE_SLOT_COUNT, ACTIVE_WIRE_EMPTY } from '../../data/ships/actives/types.js';

/** 무대 선택값 — 프로필에서 파생되지 **않는** 입력만 여기 온다. */
export interface RunConfigOpts {
  /** 행성 인덱스. 침공 런은 0. */
  planet: number;
  /** 침략 단계(1..∞, ADR-0022). 침공 런은 1(단계 무관). */
  stage: number;
  /**
   * 이 런에 주입된 촉매 id 배열(런 1회 소모품, ADR-0029). 미지정 = `[]`(무촉매). **침공 런은
   * 항상 `[]`**(촉매는 PvE 전용). Lane 4 픽커가 성계 지도에서 이 배열을 채워 넘긴다.
   */
  catalysts?: number[];
  /**
   * 서버 소모 영수증 런 id(Lane 3). 촉매 소모 RPC 성공 시 발급되며, 정산이 이 id 로 서버측
   * 영수증을 조회한다. 무촉매/오프라인 런은 미지정. sim 은 읽지 않는 순수 메타(해시 무영향).
   */
  runId?: string;
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
  pilot?: {
    equipped: Item[];
    skillInvest: number[];
    typeId: number;
    performanceCP: number;
    /** 퇴역 순간 박제된 액티브 장착 2칸(ADR-0041 · 계획 PM-3). 길이 2, 빈 슬롯 `null`. */
    activeSlots: (string | null)[];
  };
  /**
   * 행성 인기 보상 배율 스탬프(ADR-0038). `{ centi, epoch }` 를 통째로 넘기며, **PvE 경로에서만**
   * 전달한다 — 침공·예비역 소집·하네스는 미지정이라 `planetMultCenti` 가 스탬프되지 않고
   * `hashWorld` 꼬리 폴드도 실행되지 않는다(바이트 불변, EF 재배포 불필요).
   *
   * ⚠️ 두 필드를 **한 객체로** 받는 것이 계약이다: 배율과 그 배율이 나온 epoch 은 짝이라야
   * 정산이 서버에 "이 epoch 의 표로 재산정하라"고 말할 수 있다. 따로 받으면 한쪽만 스탬프되는
   * 배선 누락이 열린다(이 저장소가 8번 겪은 결함 유형).
   */
  planetMult?: { centi: number; epoch: number };
  /**
   * 의뢰 런 설정(의뢰서 시스템, 계획 §A-1). **의뢰 경로에서만** 전달한다 — 미지정이면
   * `commission` 필드가 아예 스탬프되지 않아 기존 PvE·침공 런의 config 가 바이트 불변이다.
   *
   * `segmentIndex` 를 포함해 통째로 받는 것이 계약이다: 구간 전환은 이 객체를 계승하고
   * `segmentIndex` 만 갱신한 새 config 로 다음 월드를 만든다. 인덱스를 따로 받으면
   * "구간은 넘어갔는데 인덱스는 그대로"인 배선 누락이 열린다.
   */
  commission?: CommissionRunConfig;
}

/**
 * 그 장비가 **의뢰 제약(장비축)에 걸리는가** — 걸리면 출격 조립에서 빠진다.
 *
 * ## 왜 "빼는 것"이 유일한 강제 수단인가
 * 제약 계약은 **위반이 원천 불가능한 축만** 쓴다(CONTEXT `주문` · ADR-0044). 장비를 끌고
 * 나갈 수 있게 두고 sim 이 감시하는 형태였다면 감시기·위반 카운터·처벌 규칙이 전부 필요하고,
 * 그 셋은 서버가 리플레이로 재현할 수 없는 상태를 만든다. 여기서 빼면 그 장비는 `loadout` 에
 * 아예 반영되지 않고, `loadout` 은 리플레이 스냅샷에 실려 **서버 EF 재실행과 자동으로 정합**
 * 이다 — 서버는 제출된 `config.loadout` 을 자기 payload 의 제약과 대조하는 것만으로 준수를
 * 증명한다.
 *
 * @param slotId `EQUIP_SLOTS` 의 위치 id. `bannedSlots` 는 `SlotKind`(module 하나)가 아니라
 *   **위치**(module0/module1 따로)로 지정하므로 여기서 그 id 로 비교해야 한다.
 */
function equipBanned(rules: CommissionEquipRules, slotId: EquipSlotId, item: Item): boolean {
  if (rules.bannedSlots?.includes(slotId) === true) return true;
  if (rules.maxRarity !== undefined && RARITY_CODE[item.rarity] > rules.maxRarity) return true;
  const banned = rules.bannedUniqueIds;
  if (banned !== undefined && banned.length > 0 && item.uniqueId !== undefined) {
    // `bannedUniqueIds` 의 정수 정본은 `UniqueDef.bit`(= `LoadoutConfig.uniqueMask` 에 OR 되는
    // 비트)다. 문자열 id 를 wire 로 쓰지 않는 이유는 payload 가 jsonb 이고 서버·클라가 같은
    // 정수를 봐야 하기 때문이며, bit 는 이미 append-only 로 고정된 유일한 정수 축이다.
    const bit = UNIQUE_REGISTRY.get(item.uniqueId)?.bit;
    if (bit !== undefined && banned.includes(bit)) return true;
  }
  return false;
}

/**
 * 활성 기체의 장착 아이템을 `EQUIP_SLOTS` 순서로 모은다. **순서가 계약이다** —
 * `computeLoadoutStats` 의 어픽스 합산은 순서 무관이지만 무기/보조 선택(`find`)은 아니다.
 *
 * `rules` 가 있으면(의뢰 제약 계약) 걸리는 항목을 **건너뛴다**. 건너뛰기는 순서를 보존하므로
 * 위 계약이 유지된다 — 재배치가 아니라 결손이다.
 */
function equippedItems(profile: Profile, rules?: CommissionEquipRules): Item[] {
  const ship = activeShip(profile);
  const out: Item[] = [];
  for (const id of EQUIP_SLOTS) {
    const it = ship.equipped[id];
    if (it === undefined) continue;
    if (rules !== undefined && equipBanned(rules, id, it)) continue;
    out.push(it);
  }
  return out;
}

/**
 * 의뢰 출격의 **봉인 로드아웃**(서버 계약 §5-2 ⑤ · §7 게이트 3) — `consume_commission` 에 실을
 * `p_loadout` 값을 낸다.
 *
 * ⚠️ **`buildRunConfig` 가 같은 프로필로 굽는 `config.loadout` 과 반드시 같은 값이어야 한다.**
 * 서버는 이 값을 `loadout_sealed` 로 저장해 두었다가, 제출된 리플레이의 `config.loadout` 과
 * 대조해 "출격 후 편집"을 잡는다(`commission-loadout-mismatch`). 여기서 따로 계산하면
 * "출격 UI 에서 본 로드아웃과 실제로 도는 런의 로드아웃이 어긋나는" 결함이 열리므로, 이 함수는
 * `buildRunConfig` 와 **같은 함수·같은 인자 순서**(`equippedItems` → `computeLoadoutStats`)로만
 * 계산한다. 소집(`pilot`)·촉매 배율은 여기 관여하지 않는다 — 의뢰 런은 그 둘과 상호배타다
 * (`buildRunConfig` 의 pilot 금지 가드).
 */
/**
 * ## ⚠️ 명시적 한계 — `skillAffixLv` 는 **일부러 봉인하지 않는다** (사용자 판정 2026-08-07)
 *
 * 이 함수가 봉인하는 것은 `LoadoutConfig` 뿐이다. 스킬 어픽스 축 레벨(`skillAffixLv`)은 별도
 * config 필드라 봉인에 안 들어가고, 따라서 **EF 게이트 3 의 대조로는 그 축의 위조가 안 잡힌다.**
 *
 * 봉인하지 않기로 한 근거는 "작아서"가 아니라 **더 큰 구멍이 그 옆에 열려 있어서**다 —
 * ADR-0050 으로 서버 재실행이 사라지면서 승패(`claim.outcome.victory`)를 **서버가 클라 주장
 * 그대로 믿는다.** 스킬을 위조할 것도 없이 "이겼다"고 하면 되는 상태에서 이 한 축만 봉인해도
 * 실효 방어가 거의 안 늘고, 서버 계약 §5-2 개정 + EF 재배포 + 기존 봉인 행 grandfather 비용만
 * 치른다.
 *
 * **대신 무제한 위조만 막았다** — `skillLv()`(`src/items/skills.ts`)가 가산분을
 * `SKILL_AFFIX_LV_MAX` 로 자른다. 파생 쪽 클램프는 클라에만 걸려 신뢰 경계 밖이었다.
 *
 * ⭐ **이 한계를 닫는 조건은 「봉인 추가」가 아니라 「승패를 서버가 판정하게 되는 것」이다.**
 * ADR-0050 §3 단계 1(아이템 서버 원장)이 그 방향이고, 그때 이 절을 다시 열어라.
 */
export function commissionSealedLoadout(profile: Profile, rules?: CommissionEquipRules): LoadoutConfig {
  const ship = activeShip(profile);
  const typeId = normalizeShipTypeId(ship.typeId);
  const { loadout } = computeLoadoutStats(
    equippedItems(profile, rules),
    shipBonusBp(profile.lineage),
    typeId,
    // ⚠️ 조종사 레벨(§R51)을 **여기도 반드시** 넘긴다. 의뢰 런은 PvE 경로라 `buildRunConfig` 가
    // 이 배율을 적용하는데, 봉인만 안 넘기면 두 값이 갈려 서버 게이트 3 이 정상 출격을
    // `commission-loadout-mismatch` 로 거부한다 — 이 함수 머리말의 계약이 바로 그것이다.
    activeShip(profile).level,
  );
  return loadout;
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
  // 의뢰 무대가 비어 있으면 sim 의 "마지막 구간인가" 판정(`segmentIndex >= segments.length - 1`)이
  // **항상 참**이 되어 **첫 보스 처치가 곧바로 `victory`** 다 — 그리고 그 victory 는 확정 유니크
  // 지급 경로로 간다(ADR-0044·0045). 조립 지점에서 막는 것이 가장 싸다: sim 안에서 던지면
  // 서버 EF 가 500 을 내고, 서버는 어차피 자기 payload 로 덮어쓰므로 여기가 유일한 클라 관문이다.
  if (opts.commission !== undefined && opts.commission.segments.length === 0) {
    throw new Error('buildRunConfig: 의뢰 런의 segments 가 비어 있다 — 무대 없는 의뢰는 성립하지 않는다');
  }
  // 의뢰 런 + 예비역 소집은 성립하지 않는 조합이다(소집은 침공 경로 전용, 침공과 의뢰는 상호
  // 배타). 막는 이유는 배선이 아니라 **제약 우회**다 — 소집 경로는 박제된 `pilot.equipped` 를
  // 그대로 쓰므로 아래 장비축 필터를 통과하지 않는다. 조용히 허용하면 "제약이 걸린 의뢰인데
  // 금지 장비를 낀 채 도는 런"이 만들어지고, 그 런은 서버 대조에서야 거부된다.
  if (opts.commission !== undefined && opts.pilot !== undefined) {
    throw new Error('buildRunConfig: 의뢰 런에는 예비역 소집(pilot)을 실을 수 없다 — 장비축 제약이 우회된다');
  }
  // 현상금 표적인데 `bounty` 블록이 없으면 `stepBountyEscape` 가 첫 줄에서 무연산으로 빠져
  // **도주 기제 전체가 조용히 사라진다** — 구간이 보스 처치로만 닫히므로 이 주문의 유일한 실패
  // 경로가 없어져 **항상 성공하는 의뢰**가 된다. 그리고 서버 EF 는 같은 소스로 같은 결정을
  // 내리므로 해시가 일치해 accept 된다. 어떤 게이트도 울리지 않으니 여기서 던진다.
  if (opts.commission !== undefined && opts.commission.order === 'bounty' && opts.commission.bounty === undefined) {
    throw new Error('buildRunConfig: 현상금 표적 의뢰에 bounty 블록이 없다 — 도주 기제가 통째로 사라진다');
  }
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
  //
  // 의뢰 제약 계약(장비축)은 **여기서** 걸러야 한다 — 이 목록이 `loadout` 과 `skillAffixLv`
  // 둘 다의 소스가 되고, 그 값들이 리플레이 스냅샷에 실려 서버 EF 재실행과 정합이 된다
  // (`equipBanned` 주석). `skillAffixLv` 를 원본 `ship.equipped` 에서 따로 파생하면 의뢰
  // 장비축 금지가 우회된다(affixes.md ⑤-2c) — 그래서 아래 두 파생이 **같은 배열**을 쓴다.
  const equippedForLoadout =
    pilot !== undefined ? pilot.equipped : equippedItems(profile, opts.commission?.constraints?.equipRules);
  // 조종사 레벨 성장(§R51 — `loadout.ts` `PILOT_LEVEL_GROWTH_PER_LEVEL` 이 정본).
  //
  // ## 침공 레벨 게이트 — 2026-08-10(사용자 결정) 개방
  // ⚠️ 예비역 소집(`pilot !== undefined`)은 여전히 **레벨 1**(= 무연산)로 봉인돼 있다 — 이번
  // 결정 범위 밖이다. 아래는 **침공(`opts.invasion3`) 게이트가 왜 봉인됐다가 왜 풀렸는지**의
  // 기록이다.
  //
  // ### 봉인 이력(2026-08-XX ~ 2026-08-09)
  // 이 배율은 원래 PvE 축이다. 침공에 걸면 **한쪽에만 걸렸다**: 방어측 수호는
  // `retirementPayload`(`src/save/guardianLifecycle.ts`)가 레벨을 안 넘기고 넘길 수도 없다
  // (`GuardianBuild` 에 레벨 칸이 없고, 넣으면 저장된 수호 행 전량의 재파생 + 서버 데이터
  // 변경이 따라붙는다). 즉 공격측만 최대 ×4.69 를 받는 **비대칭 주입**이 됐다.
  //
  // 침공 밴드는 PR#397 로 중위 54.9 / 상한 55 로 맞춰진 상태였다 — 여유가 0.1pp 미만이라
  // 이 축을 흘리면 그 자체로 회귀였다. 그리고 계측기(`src/bench/invasionBands.ts`)는 레벨 1
  // 프로필과 리터럴 `GEAR_REFERENCE` 로 재므로 **밴드 테스트가 이 누출을 못 잡는다** — 이
  // 저장소가 반복해 온 「조용한 미발현」의 정확한 형태라, 게이트가 아니라 여기서 막았다.
  //
  // ### 해제 근거(2026-08-10)
  // ⭐ 여는 조건은 「침공에도 레벨을 넘기는 것」이 아니라 **방어측에 대응 축이 생기는 것**이었다
  // — 그 축이 이제 생겼다: `Invasion3Config.defenseBonusBp`(`src/sim/invasion/defenseBonus.ts`)가
  // 계보 수호 가지 보너스를 기지 전체로 확장했다. 사용자 결정: 침공에서도 조종사 레벨 배율을
  // 살리고, 대응 축은 계보 수호 가지로 맞춘다(곱선 상한을 공격측 Lv100 ×4.69 에 대응하도록
  // 상향 — `data/lineage.ts` `GUARDIAN_BONUS_CAP_BP`).
  //
  // ⚠️ **미완**: `defenseBonusBp` 는 아직 서버 권위 주입 경로가 없다 — 현재 채워지는 경로는
  // 하네스(`src/harness/**`)뿐이다. 위 문단이 지적한 두 사실(밴드 여유 0.1pp 미만 · 계측기가
  // 이 누출을 못 잡는다)은 여전히 참이다 — 다만 지금은 **밸런스를 사용자가 하네스로 직접
  // 재정의하는 중**이라 그 리스크를 감수하고 연다. 서버 권위 주입이 붙기 전까지 이 게이트는
  // 하네스 밖 실제 서비스에서는 방어측 보정 없이 공격측만 강화된 채로 나갈 수 있다.
  const pilotLevel = pilot !== undefined ? 1 : activeShip(profile).level;
  const { loadout } = computeLoadoutStats(
    equippedForLoadout,
    shipBonusBp(profile.lineage),
    typeId,
    pilotLevel,
  );
  // 스킬 어픽스 축별 레벨(ADR-0049, affixes.md ①-5) — `skillInvest` 와 완전히 분리된 이중
  // 벡터다. 전부 0이면 아래에서 필드 자체를 스탬프하지 않는다(조건부 스탬프, `planetMultCenti`
  // 선례) → 어픽스 없는 런의 config·해시가 바이트 불변이다.
  const skillAffixLv = deriveSkillAffixLv(equippedForLoadout);
  // 성능% 감쇠(소집 전용) — resolveGuardianStats 철학 그대로: **크기(피해·HP)만** 스케일하고
  // 기하(발사 간격·탄속·사거리 등)는 불변이다. perf 는 centi-percent [5000,10000] 이라 완전
  // 성능(10000)이면 damageMult ×1·maxHpAdd round(x×1)=x 로 무연산 → 활성 빌드와 loadout 바이트
  // 동일(소집==활성 증명). maxHpAdd 는 단일 나눗셈+Math.round 로 정수 안정(scaleStat 규율).
  // 결과 loadout 은 config.loadout 로 스냅샷돼 EF 가 재파생 없이 그대로 리플레이한다 — 서버
  // 재해석이 없으므로 Node 내부 결정론만 필요하다(Math.random/Date.now 미사용).
  // 액티브 장착 슬롯 → wire 정수 2칸. 소집이면 박제된 슬롯, 아니면 활성 기체 슬롯을 읽는다.
  // 정규화 규율은 `normalizeShip` 과 같다 — 그 기체 타입의 스킬이 아니면 빈 슬롯으로 떨어진다
  // (`wireIdOf` 가 -1 을 돌려주고, 아래에서 `shipTypeId` 를 한 번 더 검사한다).
  // **둘 다 비면 빈 배열**이라 아래 조건부 스탬프가 필드를 아예 싣지 않는다 → 골든 JSON 바이트 불변.
  const slotIds = pilot !== undefined ? pilot.activeSlots : ship.activeSlots;
  const wire: number[] = [];
  for (let i = 0; i < ACTIVE_SLOT_COUNT; i++) {
    const id = slotIds[i];
    const def = typeof id === 'string' ? activeById(id) : undefined;
    wire.push(def !== undefined && def.shipTypeId === typeId ? wireIdOf(def.id) : ACTIVE_WIRE_EMPTY);
  }
  const activeSlotsWire = wire.some((w) => w !== ACTIVE_WIRE_EMPTY) ? wire : [];
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
    // 촉매 주입 배열(ADR-0029) — **단일 정본 스탬프**. 미지정 = `[]`(무촉매). 침공 런은 호출부가
    // `[]` 를 넘긴다. 정규화·배율 해석은 sim(resolveCatalystMods)·해시(hashWorld)가 한다.
    catalysts: opts.catalysts ?? [],
    // 서버 소모 영수증 런 id — 있을 때만 스탬프(exactOptionalPropertyTypes: undefined 대입 금지).
    ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
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
    // 행성 인기 배율(ADR-0038) — **중립(100)이면 아예 스탬프하지 않는다.** shipType/planetMode 처럼
    // "항상 명시"하지 않는 이유는 조건부 해시 폴드의 불변식을 **필드 부재로도** 성립시켜, 침공·
    // 오프라인 런의 config 직렬화(리플레이 스냅샷)까지 기존과 바이트 동일하게 두기 위함이다.
    // ⚠️ **의뢰 런은 인기 배율을 스탬프하지 않는다**(계획 D13). 의뢰 보상은 종이에 적힌 확정분
    // 이라 행성 인기와 무관하고, 배율이 실리면 서버가 payload 대조 시 "없어야 할 축"을 보게 된다.
    // 호출부가 실수로 planetMult 를 넘겨도 여기서 막는다 — 조건을 호출부 규율에 맡기면 이
    // 저장소가 8번 겪은 "한 경로만 고쳐서 새는" 결함이 그대로 재현된다.
    ...(opts.commission === undefined &&
    opts.planetMult !== undefined &&
    opts.planetMult.centi !== NEUTRAL_MULT_CENTI
      ? { planetMultCenti: opts.planetMult.centi | 0 }
      : {}),
    // epoch 은 배율이 중립이어도 싣는다 — 정산이 "어느 표를 봤는가"를 서버에 말해야 서버가 자기
    // 스냅샷으로 재산정할 수 있고, 중립 배율도 그 표의 정당한 값이기 때문이다. sim 미사용·비해시.
    ...(opts.commission === undefined && opts.planetMult !== undefined
      ? { planetMultEpoch: opts.planetMult.epoch | 0 }
      : {}),
    // 액티브 스킬 장착 슬롯(ADR-0041) — **둘 다 비면 필드 자체를 싣지 않는다**(planetMultCenti
    // 선례). 이것이 계획 PM-4("장착은 되는데 런에 안 닿는다", 이 저장소 지배적 실패 모드)의
    // 유일한 배선 지점이다. `Ship`→`WorldConfig` 경로는 이 함수뿐이고, 소집(`opts.pilot`)
    // 분기도 여기서 같이 처리된다. 문자열 id → wire 정수 변환도 **여기 한 곳에서만** 한다.
    ...(activeSlotsWire.length > 0 ? { activeSlots: activeSlotsWire } : {}),
    // 보스 전 일반 세그먼트 상한. 호출자가 명시로 준 값이 **항상 우선**하고(하네스·튜토리얼
    // 단축판), 미지정 의뢰 런에만 의뢰 기본값이 실린다.
    //
    // ⚠️ 의뢰 런에 이 상한이 없으면 구간마다 PvE 웨이브 표를 **끝까지** 소화해야 보스가 나와
    // `COMMISSION_SEGMENT_TICK_CAP` 을 구조적으로 넘긴다 — 그리고 그 초과는 클라에서 아무
    // 증상 없이 통과했다가 **서버 EF 의 틱 예산 게이트에서 런 전체가 거부**된다.
    //
    // ⚠️ **정예 소집령(`order: 'elite'`)만 별도로 낮은 값을 쓴다**(`COMMISSION_ELITE_WAVE_SEGMENTS`,
    // 2026-08-01 Phase G 실측 재조정). 그 주문은 잡몹 유입이 0 이라(`commissionSuppressesCardSpawns`)
    // `SEGMENTS[].killGoal` 을 오직 겹침 소환 트리클로 채워야 하는데, 기본값(3세그 먼트, killGoal
    // 합계 109)을 그대로 물리면 96시드 실측 34시드가 `COMMISSION_SEGMENT_TICK_CAP` 을 넘겼다
    // (최대 5.9배). 문제가 상수 자체가 아니라 배선이었다는 근거는
    // `COMMISSION_ELITE_WAVE_SEGMENTS` 주석을 봐라.
    ...(opts.maxSegments !== undefined
      ? { maxSegments: opts.maxSegments }
      : opts.commission !== undefined
        ? {
            maxSegments:
              opts.commission.order === 'elite'
                ? COMMISSION_ELITE_WAVE_SEGMENTS
                : COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
          }
        : {}),
    ...(opts.invasion3 !== undefined ? { invasion3: opts.invasion3 } : {}),
    // 의뢰 런 설정 — **조건부 스탬프**(planetMultCenti·activeSlots 선례). 미지정이면 필드 자체를
    // 싣지 않아 기존 런의 config 직렬화가 바이트 동일하다. 이것이 `Commission`→`WorldConfig` 의
    // **유일한 배선 지점**이다(호출부에서 config 를 손보지 마라 — 파일 머리말 계약).
    ...(opts.commission !== undefined ? { commission: opts.commission } : {}),
    // 스킬 어픽스 축별 레벨(ADR-0049) — **전 축 0이면 필드 자체를 싣지 않는다**(위
    // `planetMultCenti`/`activeSlots`/`commission` 과 같은 조건부 스탬프 규율). 어픽스
    // 없는 런의 config 직렬화·해시가 기존과 바이트 동일해야 골든 대조가 성립한다
    // (affixes.md ⑤-2).
    ...(skillAffixLv.some((v) => v !== 0) ? { skillAffixLv } : {}),
  };
}
