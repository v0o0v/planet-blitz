/**
 * 하네스 촉매 모의 게이트웨이 (개발 도구, DEV 전용 — ADR-0008·ADR-0029).
 *
 * 실 Supabase 없이 도는 하네스에서 촉매 정규경로("보유 시드→픽커 주입→출격→정산")를 끝까지
 * 관측하기 위한 **인메모리 원장 모의**다. `net/index.ts` 의 촉매 4함수(consume/salvage/grant/
 * fetch)는 실 서버가 없으면 이 게이트웨이로 폴백한다(`setHarnessCatalystGateway`). 그러면:
 *  - `fetchCatalystInventory` — 시드된 원장을 성계 지도 픽커·촉매 보관함이 그대로 읽고,
 *  - `consumeCatalysts` — 슬롯 상한·특산 정합·보유량을 서버와 **같은 계약**으로 2차 검증한 뒤
 *    실제로 원장을 차감하고 가짜 runId 를 발급한다(무촉매 폴백이 아니라 실제 주입 출격),
 *  - `grantCatalyst` — 정산이 파생한 드랍을 원장에 적립하고(드랍→다음 주입 루프 실증),
 *  - `salvageCatalyst` — 원장을 차감하고 **촉매 잔재**를 지급하며(ADR-0042), `buyCatalyst` 는
 *    그 잔재로 공용 촉매를 되사 원장에 얹는다(촉매 상점 분해↔구매 왕복 실증).
 *
 * `consumeFail` 토글로 소모 거부를 강제해 출격 폴백 모달([재시도]/[촉매 빼고 출격])도 재현한다.
 *
 * ## 무엇을 모의하지 않는가
 * 재화·프로필 경로(`settlePveRun`·`grantCurrency`·`spendCurrency`·`upsertProfile`)는 **일부러
 * 비워** 둔다 — 이 게이트웨이는 촉매 4함수 전용 폴백이고, 재화/프로필은 하네스가 기존대로
 * 로컬(프로필 직접 편집 + 미설정 폴백)로 처리해야 하기 때문이다. 필수 3메서드는 스텁이다.
 *
 * 프로덕션 미포함: 하네스 배선(main.ts DEV 블록)에서만 동적 import 되므로 트리셰이킹으로
 * 프로덕션 번들에서 완전히 제거된다.
 */

import type { ServerProfile } from '../net/profileSync.js';
import type {
  ServerGateway,
  CatalystConsumeResult,
  CatalystSalvageResult,
  CatalystBuyResult,
  CatalystGrantResult,
  CatalystInventoryRow,
} from '../net/gateway.js';
import {
  CATALYSTS,
  catalystById,
  normalizeCatalystArray,
  isWithinSlotCap,
  isWithinSignatureCap,
  catalystBuyPrice,
  catalystSalvageValue,
  catalystIsPurchasable,
} from '../data/catalysts.js';
// ⚠️ **공명 포함본**을 쓴다. `catalysts.ts` 의 `resourceCapMult` 는 촉매 3장분만 세므로
// 공명이 자원축인 조합에서 서버 영수증(`consume_catalysts`)과 값이 갈린다 — 하네스 모의는
// 서버 미러라 그 갈림이 곧 거짓 그린이 된다.
import { resourceCapMultWithResonance } from '../data/catalystResonance.js';

/**
 * 하네스 모의가 참조하던 재화 리더. ADR-0042 로 분해 보상이 크레딧 → **촉매 잔재**로 바뀌어
 * 더 이상 읽지 않지만, 배선(main.ts DEV 블록) 호환을 위해 타입과 생성자 인자는 남긴다.
 */
export interface MockCurrencyReader {
  credits(): number;
  minerals(): number;
}

/**
 * 인메모리 촉매 원장 모의. `ServerGateway` 의 촉매 4메서드를 실제 원장 상태로 구현하고,
 * 나머지 필수/재화 메서드는 스텁으로 둔다.
 */
export class HarnessCatalystGateway implements ServerGateway {
  /** catalyst_id → 보유 수량(>0 만 유지). */
  private readonly ledger = new Map<number, number>();
  /** consume 강제 실패 토글(출격 폴백 모달 실증용). */
  private consumeFail = false;
  /** 발급 runId 카운터(가짜 uuid 대용). */
  private runCounter = 0;
  /** 촉매 잔재 잔액 모의(ADR-0042) — 분해로 늘고 구매로 준다. */
  private residue = 0;

  constructor(_currency?: MockCurrencyReader) {
    /* 재화는 더 이상 참조하지 않는다(ADR-0042: 분해 보상 = 촉매 잔재). */
  }

  // --- 하네스 제어 표면(치트 패널이 호출) -----------------------------------

  /** 원장에 촉매를 더한다(id → +qty 합산). qty<=0 은 무시. */
  seed(entries: readonly { id: number; qty: number }[]): void {
    for (const { id, qty } of entries) {
      if (catalystById(id) === undefined || qty <= 0) continue;
      this.ledger.set(id, (this.ledger.get(id) ?? 0) + Math.floor(qty));
    }
  }

  /** 48종 전부를 각 qty 개씩 시드한다(각 id → +qty). */
  seedAll(qty: number): void {
    if (qty <= 0) return;
    for (const def of CATALYSTS) this.ledger.set(def.id, (this.ledger.get(def.id) ?? 0) + Math.floor(qty));
  }

  /** 원장을 통째로 비운다(잔재도 0으로). */
  clear(): void {
    this.ledger.clear();
    this.residue = 0;
  }

  /** 촉매 잔재를 직접 세팅한다(치트 패널 — 구매 실증용). */
  setResidue(v: number): void {
    this.residue = Math.max(0, Math.floor(v));
  }

  /** 현재 촉매 잔재 잔액. */
  getResidue(): number {
    return this.residue;
  }

  /** consume 강제 실패 토글 설정. */
  setConsumeFail(fail: boolean): void {
    this.consumeFail = fail;
  }

  /** 현재 consume 강제 실패 여부. */
  isConsumeFail(): boolean {
    return this.consumeFail;
  }

  /** 현재 원장 스냅샷(id→qty, 복사본). 픽커 즉시 표시용으로 성계 지도에 넘긴다. */
  snapshot(): Map<number, number> {
    return new Map(this.ledger);
  }

  // --- ServerGateway: 필수 스텁 ---------------------------------------------

  async getUserId(): Promise<string> {
    return 'harness-uid';
  }
  /**
   * 프로필 pull — 촉매 잔재(ADR-0042)만 실어 낸다. 잔재 조회가 이 경로를 타므로(전용 RPC 없음)
   * 하네스에서도 상점이 잔고를 읽을 수 있어야 한다. `save` 는 하네스가 로컬로 처리하므로 비운다.
   */
  async fetchProfile(): Promise<ServerProfile | null> {
    return { save: null, saveVersion: 0, catalystResidue: this.residue };
  }
  async upsertProfile(): Promise<void> {
    /* 재화/프로필은 하네스가 로컬로 처리 — 모의 안 함(no-op). */
  }

  // --- ServerGateway: 촉매 4메서드(실제 원장 상태) --------------------------

  /**
   * 출격 직전 소모. 서버 `consume_catalysts` 와 **같은 계약**으로 검증한다: 슬롯 상한 초과·미지
   * id·특산-행성 불일치·**중복**·**특산 초과**·보유량 부족이면 **throw**(서버 트랜잭션 롤백 =
   * 아이템 미차감). 통과하면 원장을 차감하고 가짜 runId + 자원 배율을 낸다.
   * `consumeFail` 이 켜져 있으면 무조건 throw.
   *
   * ## ⚠️ 중복은 **접지 말고 거부해야 한다** (ADR-0052 유니크 주입)
   * `normalizeCatalystArray` 가 이제 중복을 **제거**하므로, 그 결과만 보면 `[15, 15]` 가
   * 조용히 `[15]` 로 통과한다. 그런데 서버 게이트 (e)는 그것을 **거부**한다 — 즉 하네스가
   * 서버보다 관대해져, 서버가 출격 시점에 튕길 로드아웃을 하네스에서는 성공으로 재게 된다.
   * 이 저장소는 *"하네스 모의가 서버보다 관대해 거짓 그린을 만드는"* 형태를 이미 겪었다.
   * 그래서 **정규화 전 원본 배열**로 중복을 판정한다.
   */
  async consumeCatalysts(catalystIds: number[], planet: number): Promise<CatalystConsumeResult> {
    if (this.consumeFail) throw new Error('harness: consume 강제 실패');
    // ⚠️ 정규화 **전**에 중복을 본다(위 주석). 정규화는 중복을 지우므로 순서가 계약이다.
    const seen = new Set<number>();
    for (const id of catalystIds) {
      if (seen.has(id)) throw new Error(`harness: 촉매 ${id} 중복 주입(유니크 주입 위반)`);
      seen.add(id);
    }
    const ids = normalizeCatalystArray(catalystIds);
    if (ids.length === 0) throw new Error('harness: 유효 촉매 없음');
    if (!isWithinSlotCap(ids)) throw new Error('harness: 슬롯 상한 초과');
    if (!isWithinSignatureCap(ids)) throw new Error('harness: 특산 최대 2장 초과');
    // 특산-행성 정합 검증(서버 2차 검증 미러). 유니크 주입이라 수량은 언제나 1이다.
    for (const id of ids) {
      const def = catalystById(id);
      if (def === undefined) throw new Error(`harness: 미지 촉매 ${id}`);
      if (def.kind === 'signature' && def.planet !== planet) {
        throw new Error(`harness: 특산 촉매 ${id} 는 행성 ${def.planet} 전용`);
      }
      if ((this.ledger.get(id) ?? 0) < 1) throw new Error(`harness: 촉매 ${id} 보유 부족`);
    }
    // 통과 — 원장 차감(서버 성공 트랜잭션 미러). 장당 1개다.
    for (const id of ids) this.decrement(id, 1);
    this.runCounter += 1;
    return {
      run_id: `harness-run-${this.runCounter}`,
      resource_mult: resourceCapMultWithResonance(ids),
    };
  }

  /** 드랍 적립 — 원장에 upsert 가산하고 갱신 수량을 낸다. */
  async grantCatalyst(catalystId: number, qty: number): Promise<CatalystGrantResult> {
    if (catalystById(catalystId) === undefined) throw new Error(`harness: 미지 촉매 ${catalystId}`);
    const after = (this.ledger.get(catalystId) ?? 0) + Math.max(0, Math.floor(qty));
    this.ledger.set(catalystId, after);
    return { catalyst_id: catalystId, qty_after: after };
  }

  /**
   * 분해(ADR-0042) — 보유가 충분하면 차감하고 **촉매 잔재**를 지급한다. 결합 순서는 서버 계약
   * 그대로 `catalystSalvageValue(id) * qty` 다(`floor(price*pct*qty/100)` 로 쓰면 값이 갈린다).
   * 보유 부족이면 `ok=false`(미차감).
   */
  async salvageCatalyst(catalystId: number, qty: number): Promise<CatalystSalvageResult> {
    const owned = this.ledger.get(catalystId) ?? 0;
    const want = Math.max(0, Math.floor(qty));
    if (want <= 0 || owned < want) {
      return { ok: false, salvaged: 0, residue: this.residue, gained: 0, note: 'not-owned' };
    }
    this.decrement(catalystId, want);
    const gained = catalystSalvageValue(catalystId) * want;
    this.residue += gained;
    return { ok: true, salvaged: want, residue: this.residue, gained };
  }

  /**
   * 구매(ADR-0042) — 서버 `buy_catalyst` 와 **같은 게이트 순서**로 거부한다: 미지 id →
   * 특산 → 가격 미설정 → 잔재 부족. 통과하면 잔재를 차감하고 원장에 가산한다(미통과는 미차감).
   */
  async buyCatalyst(catalystId: number, qty: number): Promise<CatalystBuyResult> {
    const want = Math.max(0, Math.floor(qty));
    const reject = (note: string): CatalystBuyResult => ({
      ok: false,
      catalyst_id: catalystId,
      bought: 0,
      spent: 0,
      residue: this.residue,
      note,
    });
    if (want <= 0) return reject('nothing-to-buy');
    if (catalystById(catalystId) === undefined) return reject('unknown-catalyst');
    if (!catalystIsPurchasable(catalystId)) return reject('signature-not-sold');
    const price = catalystBuyPrice(catalystId);
    if (price <= 0) return reject('price-unset');
    const cost = price * want;
    if (this.residue < cost) return reject('insufficient-residue');
    this.residue -= cost;
    this.ledger.set(catalystId, (this.ledger.get(catalystId) ?? 0) + want);
    return { ok: true, catalyst_id: catalystId, bought: want, spent: cost, residue: this.residue };
  }

  /** 보유 원장 조회 — >0 인 행만 낸다. */
  async fetchCatalystInventory(): Promise<CatalystInventoryRow[]> {
    const rows: CatalystInventoryRow[] = [];
    for (const [catalyst_id, qty] of this.ledger) {
      if (qty > 0) rows.push({ catalyst_id, qty });
    }
    return rows;
  }

  // --- 내부 -----------------------------------------------------------------

  private decrement(id: number, n: number): void {
    const left = (this.ledger.get(id) ?? 0) - n;
    if (left > 0) this.ledger.set(id, left);
    else this.ledger.delete(id);
  }
}
