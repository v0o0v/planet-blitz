/**
 * 방어체 인벤토리·강화 게이트웨이의 실 Supabase 구현 (M7b 통합 게이트).
 *
 * `defenseUnits.ts` 의 {@link DefenseUnitsGateway} 를 `@supabase/supabase-js` 로 구현한다.
 * 이 파일만 SDK 를 정적 import 하며, 부트스트랩(`main.ts`)이 **설정이 있을 때만** 동적
 * import 해 팩토리를 등록한다 → 미설정 번들·테스트에 SDK 가 실리지 않는다
 * (`modulesGateway.ts`·구 `cardsGateway.ts` 와 동일 패턴). 익명 Auth 세션(ADR-0002) 공유.
 *
 * ## 서버가 권위다
 * 레벨업·승급·리롤·등급 승급·제작은 전부 security definer RPC 가 재화를 차감하고 결과를
 * 확정한다(`defense_units` 는 select 정책만 있어 클라 직접 쓰기가 불가능하다). 클라는 결과의
 * `credits`/`minerals` 를 프로필에 pull 할 뿐, 금액을 서버에 보내지 않는다.
 *
 * ## 강화 RPC 가 방어체 전체를 돌려주지 않는 이유
 * RPC 반환은 바뀐 축(`level`/`ascension`/`affixSeed`/`rarity`)과 잔여 재화뿐이다. 호출부는
 * 성공 후 {@link SupabaseDefenseUnitsGateway.listUnits} 로 보관함을 다시 읽어 화면을 맞추므로
 * (defenseCommand 의 `runUpgrade` → `reload`), 부분 응답으로 인스턴스를 재조립해 두 진실을
 * 만들지 않는다 — `unit` 필드는 채우지 않는다(선택 필드).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config.js';
import type {
  DefenseUnitsGateway,
  DefenseUnitOwned,
  DefenseUnitUpgradeResult,
  BlueprintOwned,
} from './defenseUnits.js';
import { defenseUnitFromRef } from '../items/rollDefenseUnit.js';
import { RARITY_CODE } from '../items/types.js';
import type { Rarity } from '../items/types.js';

/** RPC 응답 raw → Record 안전 변환. */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
/** 값이 정의된 경우만 { key: value }(exactOptionalPropertyTypes 대응 스프레드). */
function defined<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** RPC jsonb → 공통 강화 결과. `unit` 은 위 헤더 사유로 채우지 않는다. */
function toUpgradeResult(data: unknown): DefenseUnitUpgradeResult {
  const r = asRecord(data);
  return {
    ok: r.ok === true,
    ...defined('credits', asNum(r.credits)),
    ...defined('minerals', asNum(r.minerals)),
    ...defined('code', asStr(r.code)),
  };
}

/** DB 문자열 등급 → `Rarity`. 알 수 없는 값은 normal 로 접는다(표시 전용 폴백). */
function toRarity(v: unknown): Rarity {
  const s = asStr(v);
  return s !== undefined && s in RARITY_CODE ? (s as Rarity) : 'normal';
}

export class SupabaseDefenseUnitsGateway implements DefenseUnitsGateway {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  async getUserId(): Promise<string> {
    const { data: sessionData } = await this.client.auth.getSession();
    const existing = sessionData.session?.user?.id;
    if (existing !== undefined) return existing;
    const { data, error } = await this.client.auth.signInAnonymously();
    if (error !== null) throw error;
    const uid = data.user?.id;
    if (uid === undefined) throw new Error('익명 로그인 후에도 uid 를 얻지 못했습니다');
    return uid;
  }

  async listUnits(): Promise<DefenseUnitOwned[]> {
    // RLS defense_units_select_own 이 본인 행만 반환. 최신순.
    const { data, error } = await this.client
      .from('defense_units')
      .select('id, kind, catalog_id, level, ascension, affix_seed, rarity')
      .order('created_at', { ascending: false });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: DefenseUnitOwned[] = [];
    for (const raw of rows) {
      const r = asRecord(raw);
      const id = asStr(r.id);
      const kind = asNum(r.kind);
      const catalogId = asNum(r.catalog_id);
      if (id === undefined || kind === undefined || catalogId === undefined) continue;
      const rarity = toRarity(r.rarity);
      // 어픽스는 저장하지 않는다 — (catalogId, rarity, affixSeed, level, ascension) 에서
      // 순수 재구성한다("시드만 저장한다" 설계의 회수 지점, rollDefenseUnit.ts 참조).
      const unit = defenseUnitFromRef(kind, {
        catalogId,
        level: asNum(r.level) ?? 1,
        ascension: asNum(r.ascension) ?? 0,
        // affix_seed 는 bigint 라 supabase-js 가 number 또는 string 으로 준다(둘 다 수용).
        affixSeed: (asNum(r.affix_seed) ?? Number(asStr(r.affix_seed) ?? '0')) >>> 0,
        rarity: RARITY_CODE[rarity],
      });
      out.push({ id, kind, catalogId, unit });
    }
    return out;
  }

  async listBlueprints(): Promise<BlueprintOwned[]> {
    const { data, error } = await this.client
      .from('defense_blueprints')
      .select('kind, catalog_id, count')
      .order('kind', { ascending: true });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: BlueprintOwned[] = [];
    for (const raw of rows) {
      const r = asRecord(raw);
      const kind = asNum(r.kind);
      const catalogId = asNum(r.catalog_id);
      const count = asNum(r.count);
      if (kind === undefined || catalogId === undefined || count === undefined) continue;
      // count=0 행은 재료를 다 쓴 흔적이라 목록에서 감춘다(제작 버튼이 항상 비활성인 행).
      if (count <= 0) continue;
      out.push({ kind, catalogId, count });
    }
    return out;
  }

  async levelUp(unitId: string): Promise<DefenseUnitUpgradeResult> {
    const { data, error } = await this.client.rpc('level_up_defense_unit', { p_unit_id: unitId });
    if (error !== null) throw error;
    return toUpgradeResult(data);
  }

  async ascend(unitId: string): Promise<DefenseUnitUpgradeResult> {
    const { data, error } = await this.client.rpc('ascend_defense_unit', { p_unit_id: unitId });
    if (error !== null) throw error;
    return toUpgradeResult(data);
  }

  async rerollAffixes(unitId: string): Promise<DefenseUnitUpgradeResult> {
    const { data, error } = await this.client.rpc('reroll_defense_unit_affixes', {
      p_unit_id: unitId,
    });
    if (error !== null) throw error;
    return toUpgradeResult(data);
  }

  async promoteRarity(unitId: string): Promise<DefenseUnitUpgradeResult> {
    const { data, error } = await this.client.rpc('promote_defense_unit_rarity', {
      p_unit_id: unitId,
    });
    if (error !== null) throw error;
    return toUpgradeResult(data);
  }

  async craftFromBlueprint(kind: number, catalogId: number): Promise<DefenseUnitUpgradeResult> {
    // 20260722020000 재정의판: 설계도 1장 + 희귀 광물(보스 40 / 그 외 12). 광물 부족은
    // insufficient-funds, 설계도 부족은 트랜잭션째 raise → supabase-js error → 여기서 throw
    // (공개 API `call` 래퍼가 null 로 흡수해 UI 는 '서버가 거부했다'로 표시한다).
    const { data, error } = await this.client.rpc('craft_defense_unit', {
      p_kind: kind,
      p_catalog: catalogId,
    });
    if (error !== null) throw error;
    return toUpgradeResult(data);
  }
}

/**
 * 설계도 지급 RPC(`grant_blueprints`). 방어체 게이트웨이와 같은 SDK 사본을 쓰려고 여기에 둔다
 * — `blueprints.ts` 가 설정이 있을 때만 이 모듈을 동적 import 한다.
 *
 * 트러스트 모델은 장비 드랍(items 클라 직접 쓰기 + pve_runs 사후 샘플링)과 동급이다. 서버가
 * 행 8·장수 4 상한을 강제한다.
 */
export async function grantBlueprintsViaRpc(
  config: SupabaseConfig,
  grants: readonly { kind: number; catalogId: number; count: number }[],
): Promise<number> {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const { data, error } = await client.rpc('grant_blueprints', {
    p_grants: grants.map((g) => ({ kind: g.kind, catalogId: g.catalogId, count: g.count })),
  });
  if (error !== null) throw error;
  const r = asRecord(data);
  return r.ok === true ? (asNum(r.granted) ?? 0) : 0;
}
