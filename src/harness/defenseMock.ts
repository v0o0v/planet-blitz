/**
 * 하네스 방어체 강화 모의 게이트웨이 (개발 도구, DEV 전용 — ADR-0008).
 *
 * 실 Supabase 없이 도는 하네스에서 **방어 사령부의 강화 흐름**(레벨업·승급·리롤·등급 승급·
 * 제작)을 끝까지 눌러 보기 위한 인메모리 게이트웨이다. `src/net/defenseUnits.ts` 의
 * {@link DefenseUnitsGateway} 를 **전량** 구현하므로, 치트 패널이
 * `setDefenseUnitsGatewayOverride` 로 이것을 주입하면 UI 코드를 한 줄도 고치지 않고 오프라인에서
 * 정규 경로가 돈다(`src/harness/catalystMock.ts` 가 촉매 4함수에 대해 하는 것과 같은 구조).
 *
 * ## 비용·실패 코드는 서버 계약 그대로
 * 비용은 `data/defenseUnits.ts` 의 순수 산식(`defenseUnitLevelUpCost` 등)을 그대로 부른다 —
 * 그 산식은 SQL RPC(`supabase/migrations/20260722000000_m7b_defense_units.sql`)와 미러 관계라,
 * 여기서 값을 지어내면 하네스에서 통과한 흐름이 실서버에서 거부된다. 실패 코드 문자열도 SQL 이
 * 내는 것과 같은 값을 쓴다:
 *   - `not-owned` / `max-level` / `insufficient-credits` / `insufficient-minerals` (level_up)
 *   - `max-ascension` / `insufficient-blueprints` (ascend)
 *   - `no-affix-slots` / `insufficient-minerals` (reroll)
 *   - `max-rarity` / `insufficient-blueprints` (promote)
 *   - `bad-catalog` / `storage-full` / `insufficient-funds` (craft, 20260722020000 재정의판)
 *
 * ## 서버와 일부러 다른 두 곳(관측성 우선 — 문자열은 같다)
 * ① SQL `ascend_defense_unit` 은 크레딧 부족을 `raise exception` 으로 트랜잭션째 되돌린다.
 *    모의는 **아무것도 차감하지 않은 채** `{ok:false, code:'insufficient-credits'}` 를 낸다 —
 *    throw 는 공개 API 래퍼(`call`)가 null 로 삼켜 버려 하네스에서 사유가 보이지 않기 때문이다.
 * ② SQL `craft_defense_unit` 의 설계도 부족도 같은 이유로 코드 반환이다.
 *    두 경우 모두 **부분 차감이 남지 않게** 선검사 후 일괄 적용한다.
 *
 * ## 설계도 원장은 단일 풀로 축약했다
 * 서버는 `(kind, catalog_id)` 별 장수를 센다. 하네스의 목적은 "재화가 모자라면 거부되는가"를
 * 눈으로 보는 것이라 종류별 장부까지 흉내 낼 이유가 없다. 그래서 설계도는 **종류 무관 단일
 * 풀**이고, {@link DefenseUnitsGateway.listBlueprints} 는 보유 방어체의 (kind, catalogId) 를
 * 행으로 내되 장수는 풀 잔량을 그대로 보고한다(표시용). 차감·검사는 전부 풀에서 한다.
 *
 * ## 결정론
 * 유닛·어픽스 시드는 생성자 `seed` 하나에서만 나온다(`SeededRng`). `Math.random`·`Date.now`
 * 미사용 — 같은 seed 면 같은 보관함이 나오므로 하네스 재현이 성립한다.
 *
 * 네트워크·Supabase SDK 를 import 하지 않는다. 프로덕션 미포함(하네스 DEV 블록 전용 import).
 */

import type {
  BlueprintOwned,
  DefenseUnitOwned,
  DefenseUnitUpgradeResult,
  DefenseUnitsGateway,
} from '../net/defenseUnits.js';
import type { DefenseUnitInstance, Rarity } from '../../data/defenseUnits.js';
import {
  DEFENSE_UNIT_AFFIX_RANGE,
  DEFENSE_UNIT_KINDS,
  DEFENSE_UNIT_STORAGE_CAP,
  defenseUnitAscendCost,
  defenseUnitLevelUpCost,
  defenseUnitRarityUpCost,
  defenseUnitRerollCost,
  nextRarityUp,
  rarityFromCode,
} from '../../data/defenseUnits.js';
import { CATALOG_KIND_COUNTS } from '../../data/invasion/catalog.js';
import { craftMineralCost, CRAFT_BLUEPRINT_COST } from '../../data/planets/blueprints.js';
import {
  nextAffixSeed,
  promoteDefenseUnitRarity,
  rerollDefenseUnitAffixes,
  rollDefenseUnit,
} from '../items/rollDefenseUnit.js';
import { INVASION_ASCENSION_MAX, INVASION_LEVEL_MAX } from '../sim/invasion/constants.js';
import { SeededRng } from '../sim/rng.js';

// ---------------------------------------------------------------------------
// 초기 재화 (하네스 placeholder — 실 밸런스 아님)
// ---------------------------------------------------------------------------

/** 초기 크레딧. 레벨업을 수십 번 눌러도 바닥나지 않을 만큼 넉넉히 둔다. */
export const MOCK_INITIAL_CREDITS = 200_000;
/** 초기 광물. */
export const MOCK_INITIAL_MINERALS = 4_000;
/** 초기 설계도(단일 풀). */
export const MOCK_INITIAL_BLUEPRINTS = 200;

/** 모의 원장의 재화 3종. */
export interface DefenseMockState {
  credits: number;
  minerals: number;
  blueprints: number;
}

/** 치트 패널이 잡는 제어 표면 + 주입용 게이트웨이. */
export interface DefenseMockControl {
  /**
   * `setDefenseUnitsGatewayOverride` 로 주입할 게이트웨이.
   * **팩토리(`setDefenseUnitsGatewayFactory`)가 아니다** — 그쪽은 Supabase 설정이 있을 때만
   * 호출되므로 오프라인에서는 주입 자체가 불가능하다(그게 override seam 을 만든 이유다).
   */
  gateway: DefenseUnitsGateway;
  /** 재화 일부(또는 전부) 덮어쓰기. 음수는 0 으로 접는다. */
  setCurrency(next: Partial<DefenseMockState>): void;
  /** 현재 재화 스냅샷(복사본). */
  state(): DefenseMockState;
  /** 보관함을 결정론 시드로 `count` 기 채운다(기존 목록에 이어 붙인다). */
  seedUnits(count: number): void;
  /** 보관함·재화·시드 스트림을 생성 직후 상태로 되돌린다. */
  reset(): void;
  /**
   * 보관함 보유 수(표시 전용 · 동기).
   *
   * `gateway.listUnits()` 는 서버 계약이라 Promise 다 — 250ms 마다 통째로 다시 그리는 치트
   * 패널이 그걸 await 하면 표시가 한 프레임씩 밀리고 대기 중 상태가 겹친다. 그래서 숫자
   * 하나만 동기로 뽑는 창을 따로 둔다.
   */
  unitCount(): number;
}

// ---------------------------------------------------------------------------
// 내부 원장
// ---------------------------------------------------------------------------

/** 보관함 1행(행 uuid 자리에 결정론 문자열 id 를 쓴다 — 하네스라 uuid 형식이 필요 없다). */
interface MockRow {
  id: string;
  unit: DefenseUnitInstance;
}

function clampNonNegative(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  const i = Math.trunc(v);
  return i < 0 ? 0 : i;
}

/**
 * 강화 3축 모의 원장. `DefenseUnitsGateway` 전량 구현 + 하네스 제어 표면.
 *
 * 클래스 밖으로 새는 것은 {@link createDefenseMock} 이 만드는 제어 객체뿐이다.
 */
class HarnessDefenseUnitsGateway implements DefenseUnitsGateway {
  private readonly seed: number;
  private rng: SeededRng;
  private rows: MockRow[] = [];
  private idCounter = 0;
  private credits = MOCK_INITIAL_CREDITS;
  private minerals = MOCK_INITIAL_MINERALS;
  private blueprints = MOCK_INITIAL_BLUEPRINTS;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rng = new SeededRng(this.seed);
  }

  // --- 하네스 제어 표면 ------------------------------------------------------

  setCurrency(next: Partial<DefenseMockState>): void {
    this.credits = clampNonNegative(next.credits, this.credits);
    this.minerals = clampNonNegative(next.minerals, this.minerals);
    this.blueprints = clampNonNegative(next.blueprints, this.blueprints);
  }

  snapshot(): DefenseMockState {
    return { credits: this.credits, minerals: this.minerals, blueprints: this.blueprints };
  }

  /** 보관함 보유 수(동기 — 치트 패널 표시용. 서버 계약인 `listUnits` 는 Promise 다). */
  unitCount(): number {
    return this.rows.length;
  }

  /**
   * 결정론 보관함 채우기. 종류는 강화 대상 4종({@link DEFENSE_UNIT_KINDS} — 맵 템플릿 제외)에서,
   * catalogId 는 그 종류의 실제 등록 수에서 뽑으므로 카탈로그가 늘어도 미등록 인덱스가 나오지
   * 않는다. 등급·레벨·승급·어픽스 시드도 같은 스트림에서 뽑는다.
   */
  seedUnits(count: number): void {
    const n = Math.trunc(count);
    for (let i = 0; i < n; i++) {
      if (this.rows.length >= DEFENSE_UNIT_STORAGE_CAP) break;
      const kind = DEFENSE_UNIT_KINDS[this.rng.int(0, DEFENSE_UNIT_KINDS.length - 1)] ?? 0;
      const size = CATALOG_KIND_COUNTS[kind] ?? 1;
      const catalogId = size > 0 ? this.rng.int(0, size - 1) : 0;
      const rarity = rarityFromCode(this.rng.int(0, 3));
      const level = this.rng.int(1, 40);
      const ascension = this.rng.int(0, 2);
      const affixSeed = this.rng.nextU32();
      this.push(rollDefenseUnit({ kind, catalogId, rarity, affixSeed, level, ascension }));
    }
  }

  reset(): void {
    this.rows = [];
    this.idCounter = 0;
    this.rng = new SeededRng(this.seed);
    this.credits = MOCK_INITIAL_CREDITS;
    this.minerals = MOCK_INITIAL_MINERALS;
    this.blueprints = MOCK_INITIAL_BLUEPRINTS;
  }

  // --- DefenseUnitsGateway ---------------------------------------------------

  async getUserId(): Promise<string> {
    return 'harness-defense-uid';
  }

  async listUnits(): Promise<DefenseUnitOwned[]> {
    return this.rows.map((r) => ({
      id: r.id,
      kind: r.unit.kind,
      catalogId: r.unit.catalogId,
      unit: r.unit,
    }));
  }

  /**
   * 설계도 보유 조회. 단일 풀이라 **보유 방어체의 (kind, catalogId) 조합마다 같은 잔량**을
   * 보고한다(위 모듈 주석 §설계도 원장 참조). 풀이 0 이면 빈 목록 — 실 게이트웨이가 count<=0
   * 행을 감추는 것과 같은 표시 규율이다.
   */
  async listBlueprints(): Promise<BlueprintOwned[]> {
    if (this.blueprints <= 0) return [];
    const seen = new Set<string>();
    const out: BlueprintOwned[] = [];
    for (const r of this.rows) {
      const key = `${r.unit.kind}:${r.unit.catalogId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: r.unit.kind, catalogId: r.unit.catalogId, count: this.blueprints });
    }
    // 보관함이 비어 있으면(생성 직후·`reset()` 직후) 위 순회가 아무것도 내지 않는다. 그런데
    // 제작 UI 는 **이 목록에서만** 후보를 그리므로(defenseCommand.ts 의 listBlueprints 소비),
    // 설계도 200장을 들고도 제작 탭이 텅 비어 제작을 한 번도 눌러볼 수 없게 된다 — 이 모듈이
    // 내건 "제작 흐름을 그대로 밟을 수 있다"와 정면으로 어긋난다(리뷰 MEDIUM).
    // 그래서 종류별 catalogId 0 을 씨앗 행으로 낸다. `seedUnits` 를 대신 부르지 않는 이유는
    // 그쪽이 결정론 시드 스트림을 소비해 이후 리롤·제작 결과를 바꾸기 때문이다.
    if (out.length === 0) {
      for (const kind of DEFENSE_UNIT_KINDS) {
        out.push({ kind, catalogId: 0, count: this.blueprints });
      }
    }
    return out;
  }

  /** 레벨업 1단계. 비용은 `defenseUnitLevelUpCost`(서버 미러). */
  async levelUp(unitId: string): Promise<DefenseUnitUpgradeResult> {
    const row = this.find(unitId);
    if (row === null) return fail('not-owned');
    if (row.unit.level >= INVASION_LEVEL_MAX) return fail('max-level');
    const cost = defenseUnitLevelUpCost(row.unit.rarity, row.unit.level);
    if (cost === null) return fail('max-level');
    if (this.credits < cost.credits) return fail('insufficient-credits');
    if (this.minerals < cost.minerals) return fail('insufficient-minerals');
    this.credits -= cost.credits;
    this.minerals -= cost.minerals;
    return this.commit(row, { ...row.unit, level: row.unit.level + 1 });
  }

  /** 승급 1단계(설계도 + 크레딧). 크레딧 부족은 코드 반환(§서버와 다른 두 곳 ①). */
  async ascend(unitId: string): Promise<DefenseUnitUpgradeResult> {
    const row = this.find(unitId);
    if (row === null) return fail('not-owned');
    if (row.unit.ascension >= INVASION_ASCENSION_MAX) return fail('max-ascension');
    const cost = defenseUnitAscendCost(row.unit.ascension);
    if (cost === null) return fail('max-ascension');
    if (this.blueprints < cost.blueprints) return fail('insufficient-blueprints');
    if (this.credits < cost.credits) return fail('insufficient-credits');
    this.blueprints -= cost.blueprints;
    this.credits -= cost.credits;
    return this.commit(row, { ...row.unit, ascension: row.unit.ascension + 1 });
  }

  /**
   * 어픽스 리롤(광물). 새 시드는 `nextAffixSeed` 결정론 파생이라 서버가 새 시드를 주는 것과
   * 같은 효과를 재현한다(같은 시드로 두 번 리롤해도 결과가 굳지 않는다).
   */
  async rerollAffixes(unitId: string): Promise<DefenseUnitUpgradeResult> {
    const row = this.find(unitId);
    if (row === null) return fail('not-owned');
    // 서버 `defense_unit_affix_cap` 미러 — normal 은 어픽스 슬롯이 0 이라 리롤 대상이 아니다.
    if (DEFENSE_UNIT_AFFIX_RANGE[row.unit.rarity][1] <= 0) return fail('no-affix-slots');
    const cost = defenseUnitRerollCost(row.unit.rarity);
    if (this.minerals < cost.minerals) return fail('insufficient-minerals');
    this.minerals -= cost.minerals;
    return this.commit(row, rerollDefenseUnitAffixes(row.unit, nextAffixSeed(row.unit.affixSeed)));
  }

  /** 등급 승급(설계도). unique 는 상위가 없어 `max-rarity`. */
  async promoteRarity(unitId: string): Promise<DefenseUnitUpgradeResult> {
    const row = this.find(unitId);
    if (row === null) return fail('not-owned');
    const next: Rarity | undefined = nextRarityUp(row.unit.rarity);
    const cost = defenseUnitRarityUpCost(row.unit.rarity);
    if (next === undefined || cost === null) return fail('max-rarity');
    if (this.blueprints < cost.blueprints) return fail('insufficient-blueprints');
    this.blueprints -= cost.blueprints;
    return this.commit(
      row,
      promoteDefenseUnitRarity(row.unit, next, nextAffixSeed(row.unit.affixSeed)),
    );
  }

  /**
   * 설계도 1장 + 광물로 신규 방어체 제작. 검사 순서는 SQL `craft_defense_unit`(20260722020000
   * 재정의판)과 같다: 카탈로그 → 보관 상한 → 광물 → 설계도. **부분 차감이 남지 않도록**
   * 전부 통과한 뒤에 한 번에 적용한다.
   */
  async craftFromBlueprint(kind: number, catalogId: number): Promise<DefenseUnitUpgradeResult> {
    const size = CATALOG_KIND_COUNTS[kind] ?? 0;
    if (!DEFENSE_UNIT_KINDS.includes(kind) || catalogId < 0 || catalogId >= size) {
      return fail('bad-catalog');
    }
    if (this.rows.length >= DEFENSE_UNIT_STORAGE_CAP) return fail('storage-full');
    const mineralCost = craftMineralCost(kind);
    if (this.minerals < mineralCost) return fail('insufficient-funds');
    if (this.blueprints < CRAFT_BLUEPRINT_COST) return fail('insufficient-blueprints');
    this.minerals -= mineralCost;
    this.blueprints -= CRAFT_BLUEPRINT_COST;
    // 신규 인스턴스는 normal·레벨1·승급0 — 서버 craft 와 같다(강화는 이후 축이 담당).
    const unit = rollDefenseUnit({
      kind,
      catalogId,
      rarity: 'normal',
      affixSeed: this.rng.nextU32(),
    });
    const row = this.push(unit);
    // 재화 미동봉 — 이유는 {@link commit} 주석 참조(모의 잔액이 프로필 미러로 새는 것 차단).
    return { ok: true, unit: row.unit };
  }

  // --- 내부 ------------------------------------------------------------------

  private find(unitId: string): MockRow | null {
    return this.rows.find((r) => r.id === unitId) ?? null;
  }

  private push(unit: DefenseUnitInstance): MockRow {
    this.idCounter += 1;
    const row: MockRow = { id: `harness-du-${this.idCounter}`, unit };
    this.rows.push(row);
    return row;
  }

  /**
   * 갱신된 인스턴스를 보관함에 반영하고 성공 결과를 만든다.
   *
   * **잔여 재화(`credits`/`minerals`)는 일부러 동봉하지 않는다.** 서버 계약에는 있지만,
   * 사령부(`src/ui/pixi/defenseCommand.ts:806` `pullServerCurrency`)가 그 값을 **프로필에
   * 대입하고 저장**하기 때문이다. 모의 원장은 계정 재화와 완전히 다른 축인데 그걸 프로필
   * 미러에 써 넣으면 ① 화면의 보유 크레딧이 모의 숫자로 덮이고 ② 하네스 프로필 push 를 타고
   * 부풀린 잔액이 서버로 새는 경로가 생긴다(보안 리뷰 LOW-1). 필드를 빼면 `pullServerCurrency`
   * 의 `!== undefined` 가드가 걸려 프로필을 건드리지 않는다 — 모의 잔액은 치트 패널의
   * 재화 줄에서만 보인다.
   */
  private commit(row: MockRow, unit: DefenseUnitInstance): DefenseUnitUpgradeResult {
    row.unit = unit;
    return { ok: true, unit };
  }
}

/** 실패 결과 1건(서버 `jsonb_build_object('ok', false, 'code', …)` 미러). */
function fail(code: string): DefenseUnitUpgradeResult {
  return { ok: false, code };
}

/**
 * 방어체 강화 모의 게이트웨이 + 제어 표면 생성.
 * `seed` 가 같으면 `seedUnits`·리롤·제작이 전부 같은 결과를 낸다(결정론 재현).
 */
export function createDefenseMock(seed: number): DefenseMockControl {
  const gw = new HarnessDefenseUnitsGateway(seed);
  return {
    gateway: gw,
    setCurrency: (next) => gw.setCurrency(next),
    state: () => gw.snapshot(),
    seedUnits: (count) => gw.seedUnits(count),
    reset: () => gw.reset(),
    unitCount: () => gw.unitCount(),
  };
}
