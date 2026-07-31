/**
 * Run settlement (M2 Phase C2 — plan §4, AC3/AC5/AC11).
 *
 * When a run ends the sim hands back a plain result: the collected loot records
 * (drop seed + rarity + provenance), the total XP earned, the raid resources, and
 * the loadout's meta mods. `settleRun` turns that into durable profile changes:
 *
 *   - each `LootRecord` is confirmed into an `Item` via the pure `rollItem`
 *     (same seed → same item, so a server re-run reproduces the reward);
 *   - items fill the inventory, then the stash, then overflow (surfaced so the UI
 *     can nudge the player to make room — plan D2);
 *   - run XP is banked onto the active ship, leveling it along the **메타 풀** curve
 *     `xpToNextMeta` (ADR-0036 — 런 내 성장 커브 `xpToNext` 와는 별개 축); each level
 *     grants one skill point (accrued only, spent in M3);
 *   - raid resources convert to credits.
 *
 * ADR-0003 / plan: collected loot is always preserved. On death the boss's
 * guaranteed drop was never collected (the boss is still alive, so the sim never
 * emitted it), so no stripping is needed here — the death path simply settles
 * whatever the pilot actually picked up.
 *
 * `salvageItems` implements bulk disenchant (plan D2): normal/magic → credits,
 * rare+ → minerals (scaled by the loadout's mineral-find mod).
 */

import { rollItem } from '../items/roll.js';
import { blueprintDropsFromLoot } from '../../data/planets/index.js';
import type { BlueprintGrant } from '../../data/planets/blueprints.js';
import { RARITY_BY_CODE } from '../items/types.js';
import type { Item } from '../items/types.js';
import type { LootRecord } from '../sim/world.js';
import { xpToNextMeta, lowStageXpDecayPercent } from './progressionPath.js';
import { LEVEL_CAP } from '../../data/waves.js';
import type { Profile, Ship } from './profile.js';
import { INVENTORY_CAP, activeShip, stashCapacity, recordPlanetClear } from './profile.js';
import { SHIP_STORIES, RECORD_SHARDS } from '../../data/lore/index.js';
import { storyProgressFromProfile, chapterUnlocked } from './storyProgress.js';
import { multFromCenti, NEUTRAL_MULT_CENTI } from '../economy/planetPopularity.js';

/**
 * ADR-0035 XP 안전망의 **하한 30%** 를 저단계 감쇠 × 행성 인기 배율의 **합성 결과**에 다시 건다.
 * 반환값은 `result.xpTotal`(이미 행성 배율이 곱해진 값)에 적용할 퍼센트다. 상세 근거는 호출부
 * 주석 참조.
 */
const XP_FLOOR_PERCENT = 30;

function xpAppliedPercent(decayPct: number, result: RunResult): number {
  const centi = result.planetMultCenti ?? NEUTRAL_MULT_CENTI;
  // 중립이면 구 경로와 **바이트 동일**하게 감쇠만 반환한다(부동소수 왕복조차 만들지 않는다).
  if (centi === NEUTRAL_MULT_CENTI) return decayPct;
  const m = multFromCenti(centi);
  const targetPct = Math.max(XP_FLOOR_PERCENT, (decayPct * centi) / 100);
  return targetPct / m;
}

/** What the sim reports at run end (all plain numbers/records — no sim types). */
export interface RunResult {
  victory: boolean;
  /** Collected loot (finalState.loot). */
  loot: readonly LootRecord[];
  /** Total XP earned this run (finalState.xpTotal). */
  xpTotal: number;
  /** Raid resources earned (finalState.resources) → credits. */
  resources: number;
  /** Planet index the run took place on (records a clear on victory, plan E2). */
  planet?: number;
  /**
   * 침략 단계 the run took place on (records a clear on victory, ADR-0022).
   * 저단계 XP 감쇠(ADR-0036)의 입력이기도 하다 — 미지정(침공·구 세이브)이면 무감쇠.
   */
  stage?: number;
  /**
   * 이번 런에 에코 신호를 안정화해 기록 파편을 획득했는가(스토리 Phase E — sim `echoStabilizedOf`
   * 파생). true 면 정산이 `RECORD_SHARDS` 순서로 첫 미수집 파편 1개를 `collectedShards` 에 담는다.
   * optional 이라 기존 호출부는 무영향(에코 미발생·침공 런은 undefined = false 취급).
   */
  echoStabilized?: boolean;
  /**
   * 이번 런의 사연 마일스톤 관측 델타(metric id → 이번 런 증가분, sim `runStoryMetrics` 파생).
   * 정산이 `profile.storyMetrics` 에 누적한다. optional — 없으면 누적 없음(기존 호출부 무영향).
   * ⚠️ `runsWon` 은 여기 담지 않는다 — sim 관측이 아니라 정산 메타(victory 카운트)라 정산이 센다.
   */
  storyMetricDeltas?: Readonly<Record<string, number>>;
  /**
   * 이 런에 적용된 행성 인기 보상 배율(**centi 정수**, 중립 100, ADR-0038). `WorldConfig
   * .planetMultCenti` 를 그대로 넘긴다. 미지정 = 중립(침공·오프라인·구 세이브).
   *
   * 정산이 이걸 받는 이유는 **두 가지**다:
   *  ① XP 30% 하한 재적용 — sim 이 메타 풀에 이미 배율을 곱해 뒀으므로, 저단계 감쇠와의 **합성**
   *     결과가 30% 아래로 내려가지 않도록 하려면 여기서 배율을 알아야 한다(아래 상세).
   *  ② 특산 설계도 역수 보정 — `blueprintDropsFromLoot` 이 엘리트 유래 동반 확률을 ×(1/m) 한다.
   */
  planetMultCenti?: number;
  /**
   * 이 런이 **의뢰 런**인가(의뢰서 시스템 · 계약 §10). `WorldConfig.commission !== undefined` 를
   * 그대로 넘긴다. 미지정 = 일반 런(기존 호출부·구 세이브 전부 무영향).
   *
   * 정산이 이걸 받는 이유는 하나다: **의뢰 클리어는 최고 클리어 단계를 갱신하지 않는다.**
   * 의뢰는 서버가 지정한 무대를 도는 별도 축이라, 그것으로 단계 개방이 진행되면 정규 진행
   * (ADR-0022)을 우회하는 경로가 열린다.
   */
  commission?: boolean;
}

/** Summary of what a run added to the profile (for the result overlay). */
export interface SettlementOutcome {
  itemsGained: Item[];
  levelsGained: number;
  skillPointsGained: number;
  creditsGained: number;
  /** Items that fit neither inventory nor stash (prompt the player to clear space). */
  overflow: number;
  /**
   * 이 런이 낸 방어체 설계도(M7b). **프로필에는 담지 않는다** — 설계도 보유량은 서버
   * (`defense_blueprints`)가 진실이라, 호출부가 이 목록을 `grantBlueprintDrops` 로 넘긴다.
   * 파생은 순수하고 RNG 를 소비하지 않는다(장비 확정과 **같은 드랍 시드**에서 되풀어 쓴다)
   * — 그래서 해시·fixture 가 그대로다(data/planets/blueprints.ts `rollBlueprintDrop` 계약).
   */
  blueprintsGained: BlueprintGrant[];
  /**
   * 이번 정산에서 새로 수집한 기록 파편 id(스토리 Phase E). 에코 안정화로 파편이 실제로
   * 담겼을 때만 존재한다(전부 수집됐거나 에코 미발생이면 undefined). 결과 오버레이 표시용.
   */
  shardGained?: string;
  /**
   * 이번 정산에서 새로 지급한 사연 챕터 보상 크레딧 합계(스토리 Phase E, claim 원장 1회성).
   * 이번 런으로 챕터가 처음 해금돼 보상이 지급됐을 때만 > 0. `creditsGained`(런 자원 환산)와는
   * 별도 축이라 결과 오버레이가 구분해 표시할 수 있다. 지급 없으면 undefined.
   */
  storyRewardCredits?: number;
  /**
   * 이 정산이 **의뢰 런**의 것인가(계약 §10 · A-8b). `RunResult.commission` 을 그대로 되비춘다.
   *
   * ⚠️ **optional 이 아니라 항상 실린다.** 호출부(`main.ts`)가 이 값으로 재화 지급 경로를
   * 가르는데(의뢰 런은 `settlePveRunCurrency` 를 타지 않는다), optional 이면 `?? false` 폴백이
   * 생기고 그 폴백은 "배선을 잊었다"와 "의뢰가 아니다"를 구분하지 못한다 — 이 저장소의 지배적
   * 실패 모드(조용한 배선 누락)가 정확히 그 틈으로 들어온다.
   */
  commission: boolean;
}

/**
 * Apply a finished run to the profile in place, returning a summary. Pure w.r.t.
 * RNG — item confirmation is fully determined by the drop seeds.
 */
export function settleRun(profile: Profile, result: RunResult): SettlementOutcome {
  // 1. Confirm every collected drop into a concrete item.
  const itemsGained: Item[] = [];
  for (const rec of result.loot) {
    const rarity = RARITY_BY_CODE[rec.rarity] ?? 'normal';
    itemsGained.push(rollItem(rec.seed, rarity, { planet: rec.planet, stage: rec.stage }));
  }

  // 2. Place items: inventory first, then stash, then overflow.
  const stashCap = stashCapacity(profile.stashExpansions);
  let overflow = 0;
  for (const it of itemsGained) {
    if (profile.inventory.length < INVENTORY_CAP) profile.inventory.push(it);
    else if (profile.stash.length < stashCap) profile.stash.push(it);
    else overflow++;
  }

  // 3. Bank XP onto the active ship, leveling along the xpToNextMeta curve (메타 풀 — ADR-0036).
  //    저단계 감쇠는 **여기서만** 걸린다: 표준 진행 경로(ADR-0035)보다 한참 아래 단계를 반복해
  //    파밍하는 경로의 효율을 깎되 진행을 멈추지는 않는다(하한 30%).
  //    ⚠️ 감쇠는 **적립 전 레벨** 기준으로 한 번만 곱한다 — 이 정산에서 레벨업이 여러 번
  //    일어나도 배율이 도중에 변하지 않아야 결정론·설명가능성이 선다("이 런은 ×0.7"이 한 문장).
  //
  //    ## 행성 인기 배율과의 합성 + 30% 하한 재적용 (ADR-0038)
  //    `result.xpTotal` 은 sim 이 **이미 행성 배율 m 을 곱해 둔** 값이다. 그대로 감쇠까지 곱하면
  //    최종 배율이 `decay × m` 이 되는데, m 이 1 미만(예: 0.85)이면 `0.30 × 0.85 = 0.255` 처럼
  //    ADR-0035 의 30% 안전망 **아래로 뚫린다**. 하한은 "이 런의 XP 효율이 어떤 조합에서도
  //    30% 밑으로는 안 간다"는 약속이라, 축 하나가 아니라 **합성 결과**에 걸려야 한다.
  //
  //    그래서 여기서 적용할 퍼센트를 되푼다:
  //      목표 최종 배율  target = max(0.30, decay × m)
  //      이미 곱해진 m 을 감안한 적용 퍼센트 appliedPct = 100 × target / m
  //      ⇒ 실제 최종 = m × appliedPct/100 = target  ✓
  //    m === 1(중립)이면 `target = max(0.30, decay)` 이고 `decay` 는 이미 30 이상이므로
  //    `appliedPct === decayPct` — 산술이 구 경로와 **정확히 동일**하다(early-return 으로 명시).
  const ship = activeShip(profile);
  const decayPct = lowStageXpDecayPercent(ship.level, result.stage);
  const rawXp = Math.max(0, Math.floor(result.xpTotal));
  const levelsGained = grantXp(ship, Math.floor((rawXp * xpAppliedPercent(decayPct, result)) / 100));
  const skillPointsGained = levelsGained;
  profile.skillPoints += skillPointsGained;

  // 4. Resources → credits. 재화 서버 권위(ADR-0027): 순수 정산은 델타를 **계산·반환만** 하고
  //    프로필 미러에 가산하지 않는다 — 재화 지급은 호출부가 온라인=서버 RPC(settle_pve_run) /
  //    미설정=로컬 미러 가산으로 가른다(위조 불가: 클라가 정산으로 재화를 창조 못 함).
  const creditsGained = Math.max(0, Math.floor(result.resources));

  // 5. On victory, record the planet clear (drives 정제소 unlock + 단계 개방 상한, ADR-0022).
  //    승리한 단계가 실제로 기록돼야 개방이 진행된다(핵심 배선 — 누락 시 개방 영영 안 됨).
  //    ⚠️ **의뢰 런은 제외한다**(계약 §10 A-8). 의뢰는 서버가 지정한 무대를 도는 별도 축이라,
  //    의뢰 클리어로 단계가 개방되면 정규 진행(ADR-0022)을 우회하는 경로가 열린다.
  //    ⚠️⚠️ **일반 PvE 는 반드시 계속 갱신돼야 한다** — 이 게이트를 넓게 잡으면 위 주석이 경고한
  //    "누락 시 개방 영영 안 됨" 이 그대로 재현된다(정반대 방향의 회귀).
  if (
    result.victory &&
    result.commission !== true &&
    result.planet !== undefined &&
    result.stage !== undefined
  ) {
    recordPlanetClear(profile, result.planet, result.stage);
  }

  // 6. 설계도 파생(M7b) — 장비 확정과 같은 드랍 시드에서 되풀어 쓰는 순수 함수라 RNG 커서를
  //    건드리지 않는다. 지급(서버 RPC)은 호출부 몫이다(위 SettlementOutcome 주석 참조).
  //    행성 인기 수량 배율(ADR-0038)이 엘리트 드랍 **건수**를 바꿨으므로, 특산 설계도 기대
  //    획득률이 불변이도록 동반 확률을 역수 보정한다(보스 확정 드랍은 제외 — LootRecord.elite).
  const blueprintsGained = blueprintDropsFromLoot(result.loot, multFromCenti(result.planetMultCenti));

  // 7. 스토리 시스템(Phase E, ADR-0023) — 마일스톤 누적 · 파편 수집 · 챕터 보상 claim.
  //    전부 비-sim 메타 경로라 해시·리플레이 무관이다. 오염 런·하네스 침공 런은 호출부(main.ts)가
  //    정산 자체를 스킵하므로 위조 카운트는 기존 격리(ADR-0008)로 막힌다 — 여기선 방어 불필요.
  const story = applyStoryProgress(profile, result);

  return {
    itemsGained,
    levelsGained,
    skillPointsGained,
    creditsGained,
    overflow,
    blueprintsGained,
    commission: result.commission === true,
    ...(story.shardGained !== undefined ? { shardGained: story.shardGained } : {}),
    ...(story.rewardCredits > 0 ? { storyRewardCredits: story.rewardCredits } : {}),
  };
}

/**
 * 스토리 진행 적용(Phase E) — 정산에서만 프로필의 사연 상태를 전진시킨다. 순서가 계약이다:
 *  (a) sim 관측 마일스톤 델타를 `storyMetrics` 에 누적 → (b) victory 면 `runsWon` +1 →
 *  (c) 에코 안정화면 다음 미수집 파편 1개 수집 → (d) **위 누적을 반영한 최신 진행으로** 해금된
 *  챕터의 보상 크레딧을 claim(원장으로 1회만).
 *
 * (d)를 (a)(b) **뒤**에 두는 것이 핵심이다 — 이번 런이 임계값을 넘겨(예: 12번째 승리, 인연 행성
 * 첫 클리어) 챕터가 **바로 이 정산에서** 해금되면 같은 정산에서 보상을 지급해야 한다. recordPlanetClear
 * (settleRun 5단)도 이 함수 앞에 돌아 `planetProgress` 가 최신이므로 챕터 2 해금도 즉시 반영된다.
 */
function applyStoryProgress(
  profile: Profile,
  result: RunResult,
): { shardGained?: string; rewardCredits: number } {
  // (a) sim 관측 마일스톤 델타 누적. 양의 정수 델타만 더한다(음수·비유한은 무시 —
  //     프로필 정규화가 0 하한이지만 오염 델타가 누적을 되감지 못하도록 여기서도 막는다).
  const deltas = result.storyMetricDeltas;
  if (deltas !== undefined) {
    for (const [metric, delta] of Object.entries(deltas)) {
      // runsWon 은 순수 정산 메타(아래 (b)에서 victory 마다 +1)라 sim 관측 델타 축과 겹치면
      // 안 된다. 현재 runStoryMetrics(echo.ts)는 runsWon 을 넣지 않지만, storyMetricDeltas 는
      // 외부 계약이므로 여기서 축을 강제 분리해 향후 호출부 실수로 인한 이중 카운트를 막는다.
      if (metric === 'runsWon') continue;
      if (typeof delta === 'number' && Number.isFinite(delta) && delta > 0) {
        profile.storyMetrics[metric] = (profile.storyMetrics[metric] ?? 0) + Math.floor(delta);
      }
    }
  }

  // (b) runsWon 은 순수 정산 메타(sim 관측 아님) — victory 정산마다 +1.
  if (result.victory) {
    profile.storyMetrics.runsWon = (profile.storyMetrics.runsWon ?? 0) + 1;
  }

  // (c) 파편 수집 — 에코 안정화 시 RECORD_SHARDS 순서로 첫 미수집 id 1개를 append(중복 방지).
  //     전부 수집됐거나 에코 미발생이면 no-op. "어느 파편"인가는 클라 수집 결정(경제 아님).
  let shardGained: string | undefined;
  if (result.echoStabilized === true) {
    for (const shard of RECORD_SHARDS) {
      if (!profile.collectedShards.includes(shard.id)) {
        profile.collectedShards.push(shard.id);
        shardGained = shard.id;
        break;
      }
    }
  }

  // (d) 사연 챕터 보상 claim — 해금된 챕터의 크레딧을 원장으로 1회만 지급. 해금 판정은 (a)(b)(5단)
  //     이후의 최신 프로필로 한다. claimId = `${slug}-ch${index+1}`.
  let rewardCredits = 0;
  for (const shipStory of SHIP_STORIES) {
    const progress = storyProgressFromProfile(profile, shipStory);
    for (const chapter of shipStory.chapters) {
      if (chapter.reward === undefined) continue;
      if (!chapterUnlocked(chapter, progress)) continue;
      const claimId = `${shipStory.slug}-ch${chapter.index + 1}`;
      if (profile.storyRewardsClaimed.includes(claimId)) continue;
      // claim 원장(storyRewardsClaimed)은 여기서 1회성으로 기록하되(재청구 방지), 크레딧 **지급**은
      // 호출부로 위임한다(ADR-0027): 미러에 직접 가산하지 않고 rewardCredits 로 반환만 한다 —
      // 온라인은 grant_currency(source='story'), 미설정은 로컬 미러 가산.
      profile.storyRewardsClaimed.push(claimId);
      rewardCredits += chapter.reward.credits;
    }
  }

  return { ...(shardGained !== undefined ? { shardGained } : {}), rewardCredits };
}

/**
 * Add XP to a ship and resolve level-ups along the **메타 풀** curve. Returns the number
 * of levels gained.
 *
 * `LEVEL_CAP` 하드 강제(ADR-0036): 만렙에서 `xpToNextMeta` 가 0 을 내므로 루프가 멈추고,
 * 아래에서 남은 `ship.xp` 를 **0 으로 버린다**. 초과 XP 를 남겨두지 않는 이유는 그게 곧
 * "만렙 기체에 저금해 두면 다음 세대가 빨리 큰다"는 우회로가 되기 때문이다 — 만렙의 유일한
 * 출구는 퇴역이고(ADR-0007·0024 세대 순환), 그 문 앞에 저금통을 두면 순환 의도가 무너진다.
 */
export function grantXp(ship: Ship, xp: number): number {
  ship.xp += xp;
  let levels = 0;
  // Consume banked XP up the curve. Terminates: xpToNextMeta grows with level and xp
  // is finite, so the loop bound is xp / xpToNextMeta(1); 만렙에서는 need === 0 으로 즉시 종료.
  for (;;) {
    if (ship.level >= LEVEL_CAP) break;
    const need = xpToNextMeta(ship.level);
    if (need <= 0 || ship.xp < need) break;
    ship.xp -= need;
    ship.level++;
    levels++;
  }
  if (ship.level >= LEVEL_CAP) {
    ship.level = LEVEL_CAP;
    ship.xp = 0; // 초과 XP 는 버린다(위 주석).
  }
  return levels;
}

// ---------------------------------------------------------------------------
// Salvage / bulk disenchant (plan D2)
// ---------------------------------------------------------------------------

/** Credits/minerals yielded by salvaging item(s). */
export interface SalvageYield {
  credits: number;
  minerals: number;
}

/** Base salvage value per rarity (M2 first-pass tuning, spec §5). */
const SALVAGE_CREDITS: Record<string, number> = { normal: 2, magic: 5 };
const SALVAGE_MINERALS: Record<string, number> = { rare: 3, unique: 8 };

/**
 * Salvage value of a single item (pure). Normal/magic convert to credits; rare+
 * convert to minerals scaled by the loadout mineral-find mod (worldMods).
 */
export function salvageValue(item: Item, mineralFindMult = 1): SalvageYield {
  if (item.rarity === 'normal' || item.rarity === 'magic') {
    return { credits: SALVAGE_CREDITS[item.rarity] ?? 0, minerals: 0 };
  }
  const base = SALVAGE_MINERALS[item.rarity] ?? 0;
  return { credits: 0, minerals: Math.round(base * mineralFindMult) };
}

/**
 * Bulk-disenchant the given items: sum their yield and remove them from inventory +
 * stash. Items not present in either list are still counted toward the yield (caller
 * is trusted to pass owned items).
 *
 * 재화 서버 권위(ADR-0027): 아이템 제거(로컬 인벤토리 상태 — 서버가 봉인하지 않음)는 여기서
 * 하되, 획득 credits/minerals 는 **반환만** 하고 프로필 미러에 가산하지 않는다. 재화 지급은
 * 호출부가 온라인=grant_currency(source='salvage') / 미설정=로컬 미러 가산으로 가른다.
 */
export function salvageItems(
  profile: Profile,
  items: readonly Item[],
  mineralFindMult = 1,
): SalvageYield {
  let credits = 0;
  let minerals = 0;
  // 참조 동일성이 아니라 item.id로 매칭한다: 정산에서 롤한 Item과 인벤토리에 보관된
  // Item이 서로 다른 객체 인스턴스여도(직렬화·복원 등) 동일 아이템으로 제거되도록.
  const removeIds = new Set(items.map((it) => it.id));
  for (const it of items) {
    const y = salvageValue(it, mineralFindMult);
    credits += y.credits;
    minerals += y.minerals;
  }
  profile.inventory = profile.inventory.filter((it) => !removeIds.has(it.id));
  profile.stash = profile.stash.filter((it) => !removeIds.has(it.id));
  return { credits, minerals };
}
