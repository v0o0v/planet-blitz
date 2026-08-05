/**
 * daily-reward Edge Function — 일일 보상 수령 진입점 (ADR-0048 · 계획 §C4, 슬라이스 1 = 재화 축).
 *
 * ## 이 파일이 하는 일과 하지 않는 일
 *
 * 하는 일: HTTP·Auth·DB I/O·**후보 조립**. 즉 "얼마나 좋은 것까지 줄 수 있는가"(예산)를 SQL 에서
 * 받아, 미러(`profiles.save`)와 서버 권위 테이블에서 진행 상태를 읽어 후보를 만들고, 순수 낙찰
 * 함수를 돌려 결과를 `claim_daily_reward_for` 에 넘긴다.
 *
 * 하지 않는 일: **상한 산식을 계산하지 않는다.** 정본은
 * `supabase/migrations/20260805000000_daily_reward.sql` 의 `daily_reward_preview_for` 이고 이
 * 파일은 그 반환값을 **소비만** 한다. 복제하면 `prove-*.ps1` 이 EF 의 TypeScript 를 영영 실증할
 * 수 없어 완료 관문 ②가 죽은 관문이 된다(계획 §C4 ④).
 *
 * ## 서버 권위 규율 (modules/index.ts:107 선례)
 *
 *  - `date_seed` 는 **서버 시각**에서 파생한다. 클라 입력을 신뢰하지 않는다. (SQL 쪽도 같은 식을
 *    자기 본문에서 다시 계산하므로 두 값이 갈릴 수 있는 유일한 순간은 UTC 자정 경계의 몇 ms 다 —
 *    그때는 SQL 이 이긴다. 여기 값은 낙찰 시드로만 쓰이고 원장 키는 SQL 이 정한다.)
 *  - 재화 잔액은 `profiles.credits`/`profiles.minerals` **컬럼**에서 읽는다. `save` jsonb 안의
 *    재화는 표시 미러라(ADR-0027) 그것으로 "얼마가 모자란가"를 재면 치트로 부풀린 미러가
 *    거리를 0 으로 만들어 후보를 통째로 지운다.
 *  - 방어체·설계도는 `defense_units`/`defense_blueprints` 서버 테이블에서 읽는다.
 *
 * ## ⚠️ `items` 테이블을 읽지 않는다
 *
 * 클라가 그 테이블에 한 줄도 쓰지 않으므로(`src/**` 에 `.from('items')` 0건) 비어 있다. 장비는
 * `profiles.save` 안에 있다. 슬라이스 1(재화 축)은 장비를 아예 보지 않는다.
 *
 * ## 계약
 *
 *   요청:  POST {}                (본문 없음. 수령 대상은 JWT 의 uid 로만 정해진다.)
 *   응답:  200 { ok:true, date_seed, already, streak?, budget?, clamped, result, next, item, grant? }
 *          4xx/5xx { ok:false, code, detail? }
 *
 * `result`/`next`/`item` 은 서버 원장(`daily_reward_claims`)에 적힌 그대로다 — EF 가 다시
 * 가공하지 않는다(화면과 원장이 갈리는 두 번째 진실을 만들지 않는다).
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { shopDateSeedFromMs, shopUserSeed, rollModuleShopRotation } from '../../../data/coreModules.ts';
import { valueBudgetForStreak, DAILY_STREAK_CYCLE } from '../../../data/dailyReward.ts';
import {
  produceDailyRewardCandidates,
  pickDailyReward,
  type DailyRewardAxis,
  type DailyRewardCandidate,
  type DailyRewardProgressInput,
  type DefenseUnitProgress,
} from '../../../data/dailyRewardSelection.ts';
import type { Rarity } from '../../../src/items/types.ts';
import { RARITY_BY_CODE } from '../../../src/items/types.ts';

/**
 * 창고 확장 상한 미러. 정본은 `src/save/profile.ts` 의 `MAX_STASH_EXPANSIONS` 다.
 *
 * ⚠️ **import 하지 않고 베낀다.** `CurrencyProgress.stashMaxExpansions` 가 상수가 아니라
 * **입력**인 이유가 그것이다(`data/dailyRewardSelection.ts` 헤더) — 그 상수가 사는 모듈이
 * 세이브 계층 전체(아이템 레지스트리·기체 트리·유니크)를 EF 번들로 끌고 들어온다. 값이 갈리면
 * 상한 도달 유저에게 존재하지 않는 확장 목표가 계속 뜬다. 계약 테스트가 대조할 자리다.
 */
const MAX_STASH_EXPANSIONS = 4;

/**
 * CORS — 브라우저 클라(기지 화면의 일일 보상 모달)가 직접 호출하는 EF 라 반드시 필요하다.
 * 없으면 프리플라이트가 막혀 supabase-js 가 "Failed to fetch" 로 즉시 실패한다(modules EF 와 동형).
 */
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// 안전 파싱 — `profiles.save` 는 클라가 올린 jsonb 라 어떤 모양이든 올 수 있다
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
/** 등급 코드/문자열 → `Rarity`. 손상값은 normal 로 접는다(가치가 NaN 이 되지 않게). */
function toRarity(v: unknown): Rarity {
  if (typeof v === 'string' && (v === 'normal' || v === 'magic' || v === 'rare' || v === 'unique')) {
    return v;
  }
  const code = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return RARITY_BY_CODE[code] ?? 'normal';
}

// ---------------------------------------------------------------------------
// 예고(announcement) — "적힌 것은 바뀌지 않는다"
// ---------------------------------------------------------------------------

/**
 * 예고 페이로드 — **종류·등급·계급까지만.** 랜덤 값은 담지 않는다(AC-21).
 *
 * 재화 축은 등급도 계급도 없으므로 슬라이스 1 에서 실제로 실리는 것은 `axis` 하나다. 그럼에도
 * 필드를 미리 열어 두는 이유는 슬라이스 2 가 축을 붙일 때 **페이로드 형태가 바뀌면 어제 쓴
 * 예고를 오늘 못 읽기** 때문이다 — 배포 경계를 사이에 둔 하루가 통째로 예고 없는 날이 된다.
 */
interface DailyAnnouncement {
  readonly axis: DailyRewardAxis;
  readonly rarity?: Rarity;
  readonly grade?: number;
}

/** 어제 행의 `payload` → 예고. 모양이 아니면 `null`(= 약속된 것이 없다). */
function parseAnnouncement(raw: unknown): DailyAnnouncement | null {
  const r = asRecord(raw);
  const axis = r.axis;
  if (typeof axis !== 'string') return null;
  const known: readonly string[] = ['currency', 'catalyst', 'blueprint', 'coreModule', 'gear', 'commission'];
  if (!known.includes(axis)) return null;
  const rarity = typeof r.rarity === 'string' ? toRarity(r.rarity) : undefined;
  const grade = typeof r.grade === 'number' && Number.isFinite(r.grade) ? Math.trunc(r.grade) : undefined;
  return {
    axis: axis as DailyRewardAxis,
    ...(rarity !== undefined ? { rarity } : {}),
    ...(grade !== undefined ? { grade } : {}),
  };
}

/** 후보 → 예고. **값 필드를 절대 담지 않는다**(AC-21 — 담으면 내일 굴림이 오늘 새어 나간다). */
function announcementOf(c: DailyRewardCandidate): DailyAnnouncement {
  const s = c.detail.subject;
  const rarity = s.axis === 'coreModule' || s.axis === 'gear' ? s.rarity : undefined;
  const grade = s.axis === 'commission' ? s.grade : undefined;
  return {
    axis: c.axis,
    ...(rarity !== undefined ? { rarity } : {}),
    ...(grade !== undefined ? { grade } : {}),
  };
}

/**
 * 후보가 예고를 지키는가 — **종류·등급·계급만** 본다. 값은 오늘 시드로 굴린다.
 *
 * 재화 축은 등급·계급이 없어 실질적으로 `axis` 비교 하나다. 그럼에도 일반형으로 쓴 이유는
 * 슬라이스 2 가 이 함수를 고치지 않고 축만 등록하면 되게 하기 위해서다.
 */
function matchesAnnouncement(c: DailyRewardCandidate, ann: DailyAnnouncement): boolean {
  if (c.axis !== ann.axis) return false;
  const s = c.detail.subject;
  if (ann.rarity !== undefined) {
    if (s.axis !== 'coreModule' && s.axis !== 'gear') return false;
    if (s.rarity !== ann.rarity) return false;
  }
  if (ann.grade !== undefined) {
    if (s.axis !== 'commission') return false;
    if (s.grade !== ann.grade) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 진행 견인 입력 조립
// ---------------------------------------------------------------------------

/**
 * 활성 기체의 레벨과 "스킬 포인트를 실제로 썼는가"를 뽑는다.
 *
 * `wantsRespec` 를 투자 벡터 합 > 0 으로 정하는 이유: 아무것도 찍지 않은 조종사에게 "리스펙
 * 비용까지 3,000 크레딧"을 들이미는 것은 견인이 아니라 소음이다(`CurrencyProgress.wantsRespec`
 * 주석의 요구). 저장된 `skillPoints`(미사용 잔량)로는 이것을 판정할 수 없다 — 잔량이 0 인 것은
 * 다 썼다는 뜻일 수도, 애초에 받은 적이 없다는 뜻일 수도 있다.
 */
function readActiveShip(save: Record<string, unknown>): { level: number; wantsRespec: boolean } {
  const ships = asArray(save.ships);
  const idx = Math.trunc(asNum(save.activeShipIndex, 0));
  const ship = asRecord(ships[idx >= 0 && idx < ships.length ? idx : 0]);
  const invest = asArray(ship.skillInvest);
  let spent = 0;
  for (const v of invest) spent += Math.max(0, asNum(v, 0));
  return { level: Math.max(1, Math.trunc(asNum(ship.level, 1))), wantsRespec: spent > 0 };
}

/**
 * 방어체 + 중복 설계도 → `DefenseUnitProgress[]`.
 *
 * `dupBlueprints` 는 **같은 (kind, catalogId) 설계도 보유 수**다 — 승급이 요구하는 것이 바로 그
 * 중복분이라(`defenseUnitAscendCost().blueprints`) 총 설계도 수로 세면 다른 방어체의 설계도가
 * 승급 후보를 열어 버린다.
 */
function readDefenseUnits(unitRows: unknown[], blueprintRows: unknown[]): DefenseUnitProgress[] {
  const dup = new Map<string, number>();
  for (const raw of blueprintRows) {
    const r = asRecord(raw);
    dup.set(`${Math.trunc(asNum(r.kind))}:${Math.trunc(asNum(r.catalog_id))}`, Math.trunc(asNum(r.count)));
  }
  const out: DefenseUnitProgress[] = [];
  for (const raw of unitRows) {
    const r = asRecord(raw);
    const id = typeof r.id === 'string' ? r.id : '';
    if (id === '') continue;
    const key = `${Math.trunc(asNum(r.kind))}:${Math.trunc(asNum(r.catalog_id))}`;
    out.push({
      key: id,
      rarity: toRarity(r.rarity),
      level: Math.max(1, Math.trunc(asNum(r.level, 1))),
      ascension: Math.max(0, Math.trunc(asNum(r.ascension, 0))),
      dupBlueprints: Math.max(0, dup.get(key) ?? 0),
    });
  }
  return out;
}

/**
 * 진행 견인 입력 전체.
 *
 * ⚠️ **`refining` 은 넣지 않는다.** 정제소에 올려 둔 장비는 `Profile` 에 저장되지 않는다 —
 * 화면 세션 상태다(`src/ui/pixi/refinery.ts`). 없는 것을 추측으로 만들면 정제소를 쓰지 않는
 * 플레이어에게 "정련 굴림까지 12 광물" 목표가 매일 뜬다. 그 축은 정련 상태가 세이브로
 * 승격되는 날 함께 붙는다.
 */
function buildProgressInput(
  save: Record<string, unknown>,
  credits: number,
  minerals: number,
  moduleOffers: readonly Rarity[],
  defenseUnits: readonly DefenseUnitProgress[],
): DailyRewardProgressInput {
  const ship = readActiveShip(save);
  return {
    currency: {
      credits,
      minerals,
      stashExpansions: Math.max(0, Math.trunc(asNum(save.stashExpansions, 0))),
      stashMaxExpansions: MAX_STASH_EXPANSIONS,
      shipLevel: ship.level,
      wantsRespec: ship.wantsRespec,
      defenseUnits,
      moduleOffers,
    },
  };
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method-not-allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (authHeader === null) {
    return json({ ok: false, code: 'missing-authorization' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url === undefined || anonKey === undefined || serviceKey === undefined) {
    return json({ ok: false, code: 'server-misconfigured' }, 500);
  }

  // (1) 호출자 식별. **본문에서 uid 를 받지 않는다** — 받는 순간 남의 보상을 대신 수령하는
  //     경로가 열린다(RPC 는 service_role 전용이라 EF 가 유일한 문지기다).
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr !== null || userData.user === null) {
    return json({ ok: false, code: 'unauthenticated' }, 401);
  }
  const callerId = userData.user.id;

  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  // (2) 예산·연속일·예고·기수령 여부. **상한 산식의 정본은 이 RPC 다**(§C4 ④).
  const { data: previewRaw, error: previewErr } = await service.rpc('daily_reward_preview_for', {
    p_recipient: callerId,
  });
  if (previewErr !== null) {
    return json({ ok: false, code: 'preview-failed', detail: previewErr.message }, 500);
  }
  const preview = asRecord(previewRaw);
  if (preview.ok !== true) {
    // 'no-profile' 등 — 프로필이 없으면 견인할 진행도 자체가 없다.
    return json({ ok: false, code: typeof preview.code === 'string' ? preview.code : 'preview-rejected' }, 409);
  }

  const dateSeed = shopDateSeedFromMs(Date.now());
  const userSeed = shopUserSeed(callerId);

  // (3) 멱등 — 오늘 이미 받았으면 **아무것도 굴리지 않고** 저장된 것을 그대로 돌려준다(AC-5).
  //     여기서 다시 굴리면 네트워크 재시도가 매번 다른 물건을 만든다.
  if (preview.already === true) {
    const todaySeed = asNum(preview.date_seed, dateSeed);
    // ⚠️ `item` 을 **null 로 뭉개지 않는다.** `daily_reward_preview_for` 는 `item_payload` 를
    //    돌려주지 않으므로 여기서 원장을 직접 읽는다. 뭉개면 아직 세이브에 반영되지 않은 배송물이
    //    있는데도 응답이 "배송할 것 없음"이 되고, 그 응답을 믿는 클라가 행을 닫아 물건이 영구
    //    유실된다(장비 축이 붙는 슬라이스 2 의 실제 유실 경로다).
    const { data: rowRaw } = await service
      .from('daily_reward_claims')
      .select('item_payload, applied_at')
      .eq('profile_id', callerId)
      .eq('date_seed', todaySeed)
      .maybeSingle();
    const row = asRecord(rowRaw);
    return json(
      {
        ok: true,
        already: true,
        date_seed: todaySeed,
        streak: asNum(preview.streak, 1),
        budget: asNum(preview.budget, 0),
        clamped: preview.clamped === true,
        result: preview.result_payload ?? null,
        next: preview.next_payload ?? null,
        // 이미 반영된 행은 배송할 것이 없다 — 다시 실어 주면 클라가 헛되이 한 바퀴 더 돈다.
        item: row.applied_at === null || row.applied_at === undefined ? (row.item_payload ?? null) : null,
      },
      200,
    );
  }

  const budget = asNum(preview.budget, 0);
  const ceiling = asNum(preview.ceiling, 0);
  const streak = Math.max(1, Math.trunc(asNum(preview.streak, 1)));

  // (4) 진행 상태 로드 — 미러(save) + 서버 권위 컬럼/테이블.
  const { data: profRaw, error: profErr } = await service
    .from('profiles')
    .select('save, credits, minerals')
    .eq('id', callerId)
    .maybeSingle();
  if (profErr !== null) {
    return json({ ok: false, code: 'profile-load-failed', detail: profErr.message }, 500);
  }
  const profRow = asRecord(profRaw);
  const save = asRecord(profRow.save);

  // 방어체·설계도 로드 실패는 **치명이 아니다** — 그 축의 후보만 사라지고 나머지(창고·리스펙·
  // 모듈)는 그대로 선다. 여기서 500 을 내면 부수 테이블 장애가 그날 보상 전체를 막는다.
  const { data: unitRows } = await service
    .from('defense_units')
    .select('id, kind, catalog_id, level, ascension, rarity')
    .eq('profile_id', callerId);
  const { data: blueprintRows } = await service
    .from('defense_blueprints')
    .select('kind, catalog_id, count')
    .eq('profile_id', callerId);

  const moduleOffers = rollModuleShopRotation(dateSeed, userSeed).map((m) => m.rarity);
  const input = buildProgressInput(
    save,
    asNum(profRow.credits, 0),
    asNum(profRow.minerals, 0),
    moduleOffers,
    readDefenseUnits(asArray(unitRows), asArray(blueprintRows)),
  );
  const candidates = produceDailyRewardCandidates(input);

  // (5) 예고 소비 — **적힌 것은 바뀌지 않는다.**
  //
  // 어제 행이 있으면 그 종류·등급·계급으로 후보를 좁히고 값만 오늘 시드로 정한다. 어제 행이
  // 없으면(= 하루 놓쳐 그 행이 소멸했으면) **지금 파생한다** — 이 분기가 없으면 하루 건너뛴
  // 유저는 약속된 것이 없다는 이유로 영영 못 받는다.
  //
  // ⚠️ 좁힌 결과가 비면 **좁히지 않은 집합으로 되돌린다.** 예고를 지키는 것보다 못 받는 것이
  //    나쁘기 때문이다(그 목표는 어제 이후 이미 달성됐을 수 있다 — 거리가 0 이 되면 후보에서
  //    스스로 빠진다). 되돌린 사실은 `announcement_missed` 로 원장에 남겨 관측 가능하게 둔다 —
  //    이 값이 자주 참이면 예고가 약속으로 기능하지 못하고 있다는 신호다.
  const announced = parseAnnouncement(preview.announcement);
  const honored = announced === null ? candidates : candidates.filter((c) => matchesAnnouncement(c, announced));
  const announcementMissed = announced !== null && honored.length === 0 && candidates.length > 0;
  const pool = announcementMissed ? candidates : honored;

  const pick = pickDailyReward(pool, budget, dateSeed, userSeed);
  const subject = pick.candidate.detail.subject;

  // 슬라이스 1 은 재화 축만 낙찰된다(레지스트리에 그것만 등록돼 있고, 폴백도 재화다). 다른 축이
  // 나왔다면 슬라이스 2 배선이 절반만 들어온 상태이므로 **조용히 크레딧으로 바꾸지 않고 막는다** —
  // 바꾸면 그 축의 지급이 유실된 채로 원장에는 수령으로 적혀 하루가 소멸한다.
  if (subject.axis !== 'currency') {
    return json({ ok: false, code: 'axis-not-implemented', detail: subject.axis }, 501);
  }

  // ⚠️ **여기서 예산으로 미리 깎지 않는다. 원값을 그대로 넘긴다.**
  //
  // 초안은 이 자리에서 `budget / value` 비율로 접었다. SQL 의 절삭이 `value` 필드만 고치고
  // `credits`/`minerals` 는 EF 가 보낸 값을 그대로 `grant_currency_for` 에 넘기던 시절의
  // 임시 방어였다. 그 구멍은 마이그레이션 7절이 `v_scale` 로 축 성분까지 깎도록 고쳐 닫혔다.
  //
  // 이제 EF 가 미리 깎으면 **해롭다**: 서버가 받는 `p_value` 가 이미 예산과 같아져
  // `v_value < v_claim` 이 거짓이 되고, 그러면 `clamped` 플래그가 **false** 로 기록된다.
  // 절삭이 실제로 일어났는데 원장의 `clamped` 컬럼과 `[OK] CAP_CLAMPED` 가 그것을 못 본다 —
  // 관측 지표 ③(상한 절삭 발생률)이 조용히 0 을 읽는 죽은 계측기가 되는 자리다.
  //
  // 정상 경로에서는 애초에 초과가 없다(`pickDailyReward` 가 `value <= budget` 로 걸렀고
  // 폴백은 `floor(budget)` 이다). 초과가 생긴다면 그것은 TOCTOU — 그 사이 앵커가 움직였다는
  // 뜻이고, **그 사실이 기록되어야** 한다. 권위는 SQL 하나다.
  const grantCredits = Math.max(0, Math.floor(subject.credits));
  const grantMinerals = Math.max(0, Math.floor(subject.minerals));

  // (6) 내일 예고 확정 — **내일 예산(연속일 + 1)** 으로 다시 고른다.
  //
  // 천장(`ceiling`)은 오늘 것을 그대로 쓴다. 내일의 `lifetime_granted` 를 알 수 없기 때문이고,
  // 앵커는 단조 증가라 오늘 천장은 내일 천장의 **하한**이다 — 예고가 실제보다 낮게 잡힐 수는
  // 있어도 지킬 수 없는 약속이 되지는 않는다(방향이 안전한 쪽이다).
  //
  // 시드는 `dateSeed + 1` 이다. 같은 시드를 쓰면 동점 tie-break 가 오늘과 같아져 예고가 오늘
  // 낙찰을 그대로 복사한다.
  const nextStreakValue = streak >= DAILY_STREAK_CYCLE ? 1 : streak + 1;
  const nextBudget = Math.min(valueBudgetForStreak(nextStreakValue), ceiling);
  const nextPick = pickDailyReward(candidates, nextBudget, dateSeed + 1, userSeed);
  const nextPayload = announcementOf(nextPick.candidate);

  // (7) 수령 확정. `date_seed` 를 넘기지 않는다 — SQL 이 서버 시각으로 계산한다(그 파라미터가
  //     있으면 복합 PK 가 서로 다른 seed 를 안 막아 하루 여러 번 수령이 열린다).
  //
  //     `p_item_payload` 는 슬라이스 1 에서 **항상 null** 이다(장비 축은 슬라이스 2). 그래도
  //     넘기는 이유는 배선을 미리 세워 두기 위해서다 — 축이 붙는 날 EF·SQL·클라 셋 중 하나만
  //     고치면 되게.
  const { data: claimedRaw, error: claimErr } = await service.rpc('claim_daily_reward_for', {
    p_recipient: callerId,
    p_axis: 'currency',
    p_value: pick.candidate.value,
    p_result: {
      credits: grantCredits,
      minerals: grantMinerals,
      goal_id: pick.candidate.detail.goalId,
      distance: pick.candidate.distance,
      fallback: pick.fallback,
      announcement_missed: announcementMissed,
      ...(pick.candidate.step !== undefined
        ? { step: { index: pick.candidate.step.index, total: pick.candidate.step.total } }
        : {}),
    },
    p_next_payload: nextPayload,
    p_item_payload: null,
  });
  if (claimErr !== null) {
    return json({ ok: false, code: 'claim-failed', detail: claimErr.message }, 500);
  }
  const claimed = asRecord(claimedRaw);
  if (claimed.ok !== true) {
    return json({ ok: false, code: typeof claimed.code === 'string' ? claimed.code : 'claim-rejected' }, 409);
  }

  return json(
    {
      ok: true,
      already: claimed.already === true,
      date_seed: asNum(claimed.date_seed, dateSeed),
      streak: asNum(claimed.streak, streak),
      budget: asNum(claimed.budget, budget),
      clamped: claimed.clamped === true,
      // 원장에 적힌 그대로. EF 가 다시 가공하지 않는다(화면과 원장이 갈리지 않게).
      result: claimed.result_payload ?? null,
      next: claimed.next_payload ?? null,
      item: claimed.item_payload ?? null,
      grant: claimed.grant ?? null,
    },
    200,
  );
});
