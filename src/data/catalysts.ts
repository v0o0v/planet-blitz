/**
 * 촉매 카탈로그 & 계약 정본 — **유니크 양날 규칙 48종**(ADR-0052).
 *
 * 성계 지도 출격 전에 주입하는 런 1회 소모품. 공용 30종(id 0~29, 전 행성 드랍) +
 * 특산 18종(id 30~47, 6행성×3, 출신 행성 런 전용). 한 런에 **3장**(SLOT_CAP), 같은 촉매
 * **중복 금지**(유니크 주입), 특산은 **최대 2장**.
 *
 * ── ⚠️ 무엇이 바뀌었나 (ADR-0029 → ADR-0052) ──
 * 구 모델은 `reward: {axis, perStack}` + `penalty: {axis, perStack}` 두 칸짜리 태그였고
 * 계수가 상수 4개에서 나와 **촉매 간 수치 차이가 0**이었다. 서로 다른 것은 이름과 아이콘뿐이고
 * 스택 수학이 축별 선형 가산이라 촉매끼리 상호작용이 원리적으로 0이었다.
 * ADR-0052 는 48종 전부를 **한 개의 양날 규칙**으로 다시 쓴다 — 이득과 대가가 같은 원인에서
 * 나오는 한 문장이고, 조합의 재미는 규칙 간 창발 + 태그 공명에서 나온다.
 *
 * **폐기**: `RewardAxis`·`PenaltyAxis`·`PowerStat` 6+6+5 격자 · `perStack` 스칼라 4상수 ·
 * `catalystRewardMult`/`catalystPenaltyMult`/`catalystPowerMult`.
 * **신설**: `tags`(공명 재료) · `cap`(정산 유계) · `hook`(훅 예산 회계) · `voidOnModes`(픽커 경고).
 * **불변**: `id`·`slug`·`dropWeight`·아이콘 48장 — 서버 원장·상점 가격·i18n 앵커가 여기 매달려
 * 있다. `dropWeight` 를 건드리면 구매가·환급액이 조용히 갈린다.
 *
 * ── 규칙 본문은 여기 없다 ── 카드별 규칙문·신호·강/약 상황은 설계 정본이 갖는다:
 * `.omc/plans/catalyst-rebuild-2026-08-06/{charter,catalog-common,catalog-signature,audit}.md`.
 * 이 파일은 그중 **기계가 읽어야 하는 칸**(태그·상한·훅 등급)만 미러한다. 표시 문자열은 i18n.
 *
 * ── 결정론 ── 순수 함수 전용. `Math.random`·`Date.now` 없음. 해시에 들어가는 것은 정규화된
 * **정수 id 배열**이고(`replay.ts` 가 접는다), 배율(부동소수)은 해시에 직접 들어가지 않는다.
 *
 * ── 밸런스 ── `dropWeight` 는 보수적 placeholder 다(`// BALANCE`). **`cap.mult` 는 밸런스가
 * 아니라 계약이다** — 정산 캡의 미러이므로 서버 마이그레이션과 함께 움직인다.
 * `SLOT_CAP` 도 ADR-0052 가 확정한 설계 정본이라 튜닝 대상이 아니다.
 */

// ---------------------------------------------------------------------------
// 타입 (sim·서버·UI 공유 계약)
// ---------------------------------------------------------------------------

export type CatalystKind = 'common' | 'signature';

/**
 * 태그 6종 **고정**(ADR-0052 §태그 & 공명). 새로 만들지 않는다.
 * 촉매마다 1~2개를 달고, **같은 태그 2장 = 약공명 / 3장 = 강공명**이 발동한다.
 * 공명 해석은 {@link file://./catalystResonance.ts} 가 유일 정본이다.
 *
 * 한글 표시명: `ignite`=점화 · `density`=밀도 · `precision`=정밀 · `harvest`=수확 ·
 * `gamble`=도박 · `erosion`=침식. (표시 문자열은 i18n `catalyst.tag.*`.)
 */
export type CatalystTag = 'ignite' | 'density' | 'precision' | 'harvest' | 'gamble' | 'erosion';

/**
 * 공명 동급 충돌 시의 **태그 우선순위**(ADR-0052 §공명 — 한 런에 하나만 발동).
 * `점화 > 밀도 > 정밀 > 수확 > 도박 > 침식`. 배열 순서가 곧 우선순위다.
 */
export const CATALYST_TAG_PRIORITY: readonly CatalystTag[] = [
  'ignite',
  'density',
  'precision',
  'harvest',
  'gamble',
  'erosion',
];

/**
 * `상한:` 이 붙는 보상축 5종. 규칙 문장 안의 사건에 붙어 있어야 하고(§상한 근거 규율),
 * **축마다 따로 합성된다** — `축별 총상한 = 1 + Σ(그 축 개별상한 − 1) × 0.5`.
 *
 * 구 모델의 `power` 축은 없어졌다 — 전투 파워는 상한이 아니라 `파워:` 칸(클리어 시간 배수)으로
 * 유계하고 그것은 `bench/` 가 잰다(설계 정본 §파워).
 */
export type CatalystCapAxis = 'drop' | 'resource' | 'rarity' | 'xp' | 'catalystDrop';

/**
 * 훅 예산 등급(§훅 예산). **기계적 판정**: `WorldState` 나 엔티티에 **새 칸이 하나라도 생기면
 * `B`**, 기존 필드의 재해석은 `A`, 신규 시스템은 `C`.
 * 예산은 §A ≥30 · §B ≤14 · §C ≤4 이고 **공명도 이 예산에 든다**
 * ({@link file://./catalystResonance.ts} 의 `hook` 칸).
 */
export type CatalystHookGrade = 'A' | 'B' | 'C';

/** 상한 선언 — 축 + 배율. 개별 상한은 **×2.6 을 넘지 못한다**(§경제 결합 규율). */
export interface CatalystCap {
  readonly axis: CatalystCapAxis;
  /** 최상의 시나리오에서 이 규칙이 만들 수 있는 배율의 **이론적 최대치**. ≤2.6. */
  readonly mult: number;
}

export interface CatalystDef {
  /** 안정 numeric id, **append-only**. runConfig/hash/서버가 이 값으로 참조. */
  readonly id: number;
  /** 안정 문자열 키. i18n `catalyst.<slug>.*`, 아이콘 참조. **불변**. */
  readonly slug: string;
  readonly kind: CatalystKind;
  /** signature 만: 출신 행성 인덱스(0..5). common 은 undefined. */
  readonly planet?: number;
  /** 태그 1~2개. 공명의 재료다(§태그↔공명 정합 규율 — 자기 태그의 공명 조건을 파괴하면 못 단다). */
  readonly tags: readonly CatalystTag[];
  /** 정산 유계. `catalyst_defs` 에 미러돼 `settle_pve_run` 의 캡이 된다. */
  readonly cap: CatalystCap;
  /** 훅 예산 회계용 등급. 배선 레인이 실측으로 재등급하면 여기와 설계 문서를 함께 고친다. */
  readonly hook: CatalystHookGrade;
  /** 상대 드랍 가중치(무등급 — 희소성은 이 가중치로만 표현). **구매가·환급액이 여기서 파생한다.** // BALANCE */
  readonly dropWeight: number;
  /**
   * 특산 18종의 **모드 훅 식별자**. ADR-0029 가 선언만 하고 배선하지 않아 `src/` 어디에서도
   * 읽히지 않던 칸이다 — ADR-0052 가 18종 전부에 배선한다(구 6종 → 18종).
   * 공용 30종은 undefined.
   */
  readonly modeHook?: string;
  /**
   * **이 행성 모드에서 구조적으로 무효**인 경우의 모드 인덱스 목록. 픽커가 **회색 경고**를 띄운다
   * (촉매 간 충돌로 인한 축소 작동은 **노랑**이고 그것은 런타임 판정이라 여기 안 적는다).
   *
   * ⚠️ §축소 작동 규율: 무효화는 **픽커의 사전 경고로만** 존재하고, 런 안에서는 반드시 축소된
   * 형태로라도 작동해야 한다. 이 칸이 있다고 sim 이 그 카드를 꺼도 된다는 뜻이 아니다.
   */
  readonly voidOnModes?: readonly number[];
}

// ---------------------------------------------------------------------------
// 드랍 가중치 (// BALANCE — 단 값은 **동결**이다)
// ---------------------------------------------------------------------------
//
// ⚠️ 아래 다섯 상수의 **값**은 ADR-0052 재작성에서 한 자리도 바꾸지 않았다. 구매가
// (`catalystBuyPrice`)·환급액(`catalystSalvageValue`)·SQL 가격 시드가 전부 여기서 파생하고,
// `tests/catalystShopContract.test.ts` 가 마이그레이션 본문의 리터럴과 전수 대조한다.
// 이름만 구 보상축 어휘(`W_POWER`)에서 희소도 어휘로 옮겼다.

/** 공용 일반 촉매. // BALANCE */
const W_COMMON = 10;
/** 공용 희소(구 `W_POWER`) — 프리미엄은 등급이 아니라 희소 드랍으로. // BALANCE */
const W_RARE = 2;
/** 공용 최희소(구 `W_POWER_SKILLALL`). // BALANCE */
const W_RAREST = 1;
/** 특산 일반. // BALANCE */
const W_SIGNATURE = 8;
/** 특산 보스 격화형 — 낮게(천장 보상). // BALANCE */
const W_SIGNATURE_BOSS = 4;

/**
 * 총 주입 수 하드 캡. sim·서버·UI 공유 단일 정본.
 *
 * ADR-0052 §결정 "슬롯 상한 8 → 3": 규칙 여덟이 동시에 돌면 무엇이 무엇 때문인지 읽히지 않아
 * 학습이 일어나지 않는다. 3장은 48C3 = 17,296 조합으로 충분히 넓으면서 인과가 읽히고,
 * 정산 캡 합성이 현행 서버 구조 안에 들어온다.
 *
 * ⚠️ 서버 미러는 `supabase/migrations/20260807000000_catalyst_slot_cap.sql` 이다
 * (`consume_catalysts` 가 강제). 여기를 고치면 그 마이그레이션도 함께 고쳐야 한다.
 */
export const SLOT_CAP = 3;

/**
 * 한 런에 넣을 수 있는 **특산 최대 장수**(§구조 계약). 3장 전부를 특산으로 채우면 특산 하나가
 * 나머지를 고정해 선택이 사라진다. 서버 짝은 `consume_catalysts` 의 게이트 (f) 다.
 */
export const SIGNATURE_CAP = 2;

/**
 * 개별 상한의 하드 천장(§경제 결합 규율). 초판은 ×3.0 카드가 7종이었고 그 조합이 합성
 * 기준선을 넘겨 **캡이 설계를 사후에 잘라내는** 상태였다. `tests/catalysts.test.ts` 가 강제한다.
 */
export const MAX_CATALYST_CAP_MULT = 2.6;

/**
 * 축별 상한 합성 계수(§경제 결합 규율, 확정식).
 * `축별 총상한 = 1 + Σ(그 축 개별상한 − 1) × COMPOSE_FACTOR`.
 * **곱 합성은 채택 불가** — 슬롯 3에서도 ×27 이고 캡 상향이 곧 부정 탐지 상향이라 방어가
 * 무력화된다.
 */
export const CAP_COMPOSE_FACTOR = 0.5;

/** 전축 상한 = `max(축별 총상한) × ALL_AXIS_FACTOR` — 정산 총액의 단일 유계. */
export const CAP_ALL_AXIS_FACTOR = 1.2;

// ---------------------------------------------------------------------------
// 모드 훅 식별자 — 특산 18종 (구 6종에서 확장)
// ---------------------------------------------------------------------------

/**
 * 특산이 그 행성 모드를 비트는 훅의 식별자. **`src/sim/catalystHooks.ts` 가 이것으로 분기한다.**
 *
 * ⚠️ 간선 방향에 주의하라(ADR-0052 §ADR-0021 개정): `src/sim/modes/*` 는 드랍·촉매를
 * **import 하지 않는** 순수 환경 함수로 남고, `catalystHooks.ts` 가 **모드 상태를 읽어** 보정을
 * 얹는다. 그래야 `modes/AGENTS.md` 의 내부 의존성 목록이 문자 그대로 유지된다.
 */
export const MODE_HOOK = {
  // 카르곤(0) vampire
  kargonSwarmcall: 'kargon-swarmcall',
  kargonMagmaVein: 'kargon-magma-vein',
  kargonLavaWarden: 'kargon-lava-warden',
  // 베르단(1) shrink
  berdanCollapse: 'berdan-collapse',
  berdanRoyalJelly: 'berdan-royal-jelly',
  berdanHiveQueen: 'berdan-hive-queen',
  // 니플헤임(2) chase
  niflheimPursuit: 'niflheim-pursuit',
  niflheimRimeCrystal: 'niflheim-rime-crystal',
  niflheimFlagship: 'niflheim-flagship',
  // 아르케(3) racing
  arkeOverclock: 'arke-overclock',
  arkeAncientCore: 'arke-ancient-core',
  arkeObelisk: 'arke-obelisk',
  // 톡사르(4) contamination
  toxarOutbreak: 'toxar-outbreak',
  toxarBlightspore: 'toxar-blightspore',
  toxarBlightMother: 'toxar-blight-mother',
  // 크라스(5) blockBreak
  krasBreach: 'kras-breach',
  krasBreachsteel: 'kras-breachsteel',
  krasColossus: 'kras-colossus',
} as const;

/** 강제 스크롤 모드 인덱스 — `voidOnModes` 가 반복해서 쓴다(아르케 racing · 크라스 blockBreak). */
const MODE_ARKE = 3;
const MODE_KRAS = 5;

// ---------------------------------------------------------------------------
// 48종 카탈로그 (id 순 = 배열 인덱스. 접근은 catalystById 로.)
// ---------------------------------------------------------------------------

/**
 * 각 줄의 주석은 규칙 한 줄 요약이다 — **정본이 아니다**. 정본은
 * `.omc/plans/catalyst-rebuild-2026-08-06/catalog-{common,signature}.md` 의 명세 블록이고,
 * 규칙을 바꾸려면 거기부터 고친 뒤 `audit.md` 전수 대조표를 다시 돌려야 한다.
 */
export const CATALYSTS: readonly CatalystDef[] = [
  // ── 공용: 드랍 결 (id 0~4) ────────────────────────────────────────────────
  // 전리품 2배 — 바닥에 다섯 이상 쌓이면 적이 그만큼 빨라진다.
  { id: 0, slug: 'abundance', kind: 'common', tags: ['harvest', 'density'], cap: { axis: 'drop', mult: 2.0 }, hook: 'A', dropWeight: W_COMMON },
  // 엘리트·보스는 처치해도 안 뱉는다 — 몸으로 부딪혀 강탈하고, 그것은 접촉 피해다.
  { id: 1, slug: 'plunder', kind: 'common', tags: ['gamble', 'ignite'], cap: { axis: 'drop', mult: 1.8 }, hook: 'A', dropWeight: W_COMMON },
  // 적이 죽은 자리에 수확 지대 — 그 위에서 탄이 관통하지만 밟으면 느려진다.
  { id: 2, slug: 'harvest', kind: 'common', tags: ['harvest', 'precision'], cap: { axis: 'xp', mult: 2.2 }, hook: 'A', dropWeight: W_COMMON, voidOnModes: [MODE_ARKE, MODE_KRAS] },
  // 피격 자리에 현상금 표식 — 주우면 자원, 적이 먼저 밟으면 그 적이 먹고 강화된다.
  { id: 3, slug: 'bounty', kind: 'common', tags: ['harvest', 'gamble'], cap: { axis: 'resource', mult: 2.0 }, hook: 'A', dropWeight: W_COMMON },
  // 레벨업 시 바닥 전리품이 전부 폭발해 적을 태운다 — 터진 것은 등급이 한 단계 내려간다.
  { id: 4, slug: 'cornucopia', kind: 'common', tags: ['harvest', 'ignite'], cap: { axis: 'drop', mult: 1.6 }, hook: 'A', dropWeight: W_COMMON },

  // ── 공용: 정련 결 (id 5~9) ────────────────────────────────────────────────
  // 3택에 정련 선택지 — 같은 등급 셋을 한 단계 위 하나로. 지면 정련로째 잃는다.
  { id: 5, slug: 'refinement', kind: 'common', tags: ['gamble'], cap: { axis: 'rarity', mult: 2.0 }, hook: 'B', dropWeight: W_COMMON },
  // 적이 산 시간만큼 도금된다 — 처치하면 도금이 벗겨져 가장 가까운 적에게 옮겨 붙는다.
  { id: 6, slug: 'gilding', kind: 'common', tags: ['gamble', 'density'], cap: { axis: 'rarity', mult: 2.2 }, hook: 'A', dropWeight: W_COMMON },
  // 매 웨이브 광맥 보유자 하나 — 다른 적에게 둘러싸인 동안 무적이다.
  { id: 7, slug: 'prospect', kind: 'common', tags: ['precision', 'ignite'], cap: { axis: 'rarity', mult: 2.0 }, hook: 'A', dropWeight: W_COMMON },
  // 노말 전리품 셋이 가까우면 매직 하나로 융합 — 그 자리는 유독 장판이 된다.
  { id: 8, slug: 'alchemy', kind: 'common', tags: ['ignite', 'erosion'], cap: { axis: 'rarity', mult: 1.8 }, hook: 'A', dropWeight: W_COMMON },
  // 3택이 1택 2중첩이 된다 — 대신 거부할 수 없다.
  { id: 9, slug: 'epiphany', kind: 'common', tags: ['gamble'], cap: { axis: 'xp', mult: 1.8 }, hook: 'A', dropWeight: W_COMMON },

  // ── 공용: 성장 결 (id 10~14) ──────────────────────────────────────────────
  // 적탄 궤적이 예고선으로 보인다 — 그 선 위에 서 있는 동안만 경험치 세 배.
  { id: 10, slug: 'insight', kind: 'common', tags: ['precision', 'gamble'], cap: { axis: 'xp', mult: 2.6 }, hook: 'B', dropWeight: W_COMMON },
  // 레벨 5로 시작 — 대신 이 런의 레벨업은 3택 없이 자동으로 결정된다.
  { id: 11, slug: 'tutelage', kind: 'common', tags: ['gamble'], cap: { axis: 'xp', mult: 1.8 }, hook: 'A', dropWeight: W_COMMON },
  // 웨이브마다 최대 HP −10% / 공격력 +10% — 대시로 적을 관통할 때마다 1 돌아온다.
  { id: 12, slug: 'ascension', kind: 'common', tags: ['gamble', 'erosion'], cap: { axis: 'rarity', mult: 2.0 }, hook: 'A', dropWeight: W_COMMON },
  // 화면의 적이 적을수록 탄이 커진다(최대 3배) — 대신 급행 소환이 두 배.
  { id: 13, slug: 'enlightenment', kind: 'common', tags: ['precision'], cap: { axis: 'xp', mult: 2.6 }, hook: 'A', dropWeight: W_COMMON },
  // 3택에 같은 파워업이 셋 — 3중첩으로 들어오지만 다른 선택지는 없다.
  { id: 14, slug: 'mastery', kind: 'common', tags: ['precision'], cap: { axis: 'drop', mult: 1.6 }, hook: 'A', dropWeight: W_COMMON },

  // ── 공용: 자원 결 (id 15~19) ──────────────────────────────────────────────
  // 보급 습격 자원이 적들에게 실린다 — 죽이면 전리품으로 굳고, 화면을 벗어나면 사라진다.
  { id: 15, slug: 'extraction', kind: 'common', tags: ['harvest', 'gamble'], cap: { axis: 'drop', mult: 2.4 }, hook: 'A', dropWeight: W_COMMON },
  // 적 셋마다 포탑이 선다(20초) — 대신 포탑 수만큼 네 공격력이 나뉜다.
  { id: 16, slug: 'foundry', kind: 'common', tags: ['density', 'erosion'], cap: { axis: 'resource', mult: 1.8 }, hook: 'B', dropWeight: W_COMMON },
  // 자원이 그 값어치만큼 적이 되어 나타난다 — 죽이면 세 배, 못 죽이면 증발한다.
  { id: 17, slug: 'greed', kind: 'common', tags: ['density', 'gamble'], cap: { axis: 'resource', mult: 2.6 }, hook: 'A', dropWeight: W_COMMON },
  // 3택 한 칸이 빚 카드 — 2중첩으로 받고 런 종료 시 자원으로 갚는다(런 안에서 닫힌다).
  { id: 18, slug: 'mercantile', kind: 'common', tags: ['gamble'], cap: { axis: 'resource', mult: 1.8 }, hook: 'A', dropWeight: W_COMMON },
  // 적이 광맥이 된다 — 처치하면 광석 덩어리가 남고 부숴야 자원이 된다(조준이 묶인다).
  { id: 19, slug: 'motherlode', kind: 'common', tags: ['harvest', 'ignite'], cap: { axis: 'resource', mult: 2.4 }, hook: 'A', dropWeight: W_COMMON },

  // ── 공용: 연쇄 결 (id 20~24) ──────────────────────────────────────────────
  // 같은 종류 셋이 모이면 동조해 강해진다 — 하나를 죽이면 나머지가 즉사하며 셋 몫을 뱉는다.
  { id: 20, slug: 'resonance', kind: 'common', tags: ['ignite', 'density'], cap: { axis: 'drop', mult: 2.0 }, hook: 'A', dropWeight: W_COMMON },
  // 촉매가 보유함으로 안 가고 그 자리에 미정착 결정으로 박힌다 — 적이 밟으면 부서진다.
  { id: 21, slug: 'catalysis', kind: 'common', tags: ['gamble', 'harvest'], cap: { axis: 'catalystDrop', mult: 1.5 }, hook: 'A', dropWeight: W_COMMON },
  // 적이 죽을 때 폭발한다 — 그 폭발은 너도 태운다(피해 절반).
  { id: 22, slug: 'cascade', kind: 'common', tags: ['ignite', 'density'], cap: { axis: 'drop', mult: 2.0 }, hook: 'A', dropWeight: W_COMMON },
  // 처치 자리에 씨앗 — 15초 뒤 전리품 나무가 되지만 그 전에 적이 밟으면 적이 먹는다.
  { id: 23, slug: 'seeding', kind: 'common', tags: ['harvest', 'erosion'], cap: { axis: 'drop', mult: 1.8 }, hook: 'A', dropWeight: W_COMMON },
  // 받은 피해가 가장 가까운 적에게 전이된다 — 그만큼 최대 HP 상한이 그 웨이브 동안 내려간다.
  { id: 24, slug: 'chainreaction', kind: 'common', tags: ['ignite', 'gamble'], cap: { axis: 'xp', mult: 2.5 }, hook: 'A', dropWeight: W_COMMON },

  // ── 공용: 파워 결 (id 25~29) ──────────────────────────────────────────────
  // 쏠수록 총열이 달아오르고 뜨거울수록 피해가 오른다 — 임계를 넘기면 3초 침묵.
  { id: 25, slug: 'overdrive', kind: 'common', tags: ['precision', 'erosion'], cap: { axis: 'resource', mult: 1.8 }, hook: 'B', dropWeight: W_RARE },
  // 같은 방향으로 계속 이동할수록 공격력이 오른다(최대 2배) — 피격당하면 초기화.
  { id: 26, slug: 'rapidcore', kind: 'common', tags: ['precision'], cap: { axis: 'xp', mult: 2.0 }, hook: 'B', dropWeight: W_RARE },
  // 대시 쿨다운이 사라진다 — 대시마다 최대 HP −3, 대시로 관통해 죽이면 3이 돌아온다.
  { id: 27, slug: 'afterburner', kind: 'common', tags: ['precision', 'erosion'], cap: { axis: 'drop', mult: 1.8 }, hook: 'A', dropWeight: W_RARE },
  // 피격 직후 3초간 맞은 방향 120°의 적탄이 소멸한다 — 그 방향으로 네 탄도 안 나간다.
  { id: 28, slug: 'bulwark', kind: 'common', tags: ['precision', 'harvest'], cap: { axis: 'resource', mult: 1.8 }, hook: 'B', dropWeight: W_RARE },
  // 최대 HP 절반 — 대신 대시 무적이 두 배이고 대시로 통과한 적은 2초간 이동 불능.
  // ⚠️ 훅 §B → §A 재등급(2026-08-08). 4판이 §B 로 올린 사유는 *"이동 불능을 표현할 수단이 없다
  // (`applySlow` 는 지속만 받고 강도는 `COLD_SLOW_MULT` 고정 상수)"* 였는데, 그 사이 `status.ts`
  // 에 **정지 축**이 생겼다 — `applyStasis(e, ticks)` 는 기존 `life` 칸에 쓰고(적 `enemy` 는
  // `life` 를 읽거나 쓰는 코드가 0건이며 `hashWorld` 가 이미 무조건 접는 칸이라 해시 레이아웃도
  // 불변), `enemyStatusStopMult` 가 배율 0 을 준다. **신규 칸 0 · 임의 배율 0** 이므로 §A 다.
  { id: 29, slug: 'ascendant', kind: 'common', tags: ['precision', 'gamble'], cap: { axis: 'drop', mult: 1.8 }, hook: 'A', dropWeight: W_RAREST },

  // ── 특산: 카르곤 (planet 0, vampire) id 30~32 ─────────────────────────────
  // 처치 할당 절반 — 대신 넘긴 웨이브 수만큼 다음 세그먼트의 적 상한이 누진한다.
  { id: 30, slug: 'kargon-swarmcall', kind: 'signature', planet: 0, tags: ['density', 'erosion'], cap: { axis: 'drop', mult: 2.0 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.kargonSwarmcall },
  // 네가 쏜 탄이 지나간 자리에 용암이 솟는다 — 적도 너도 태운다.
  { id: 31, slug: 'kargon-magma-vein', kind: 'signature', planet: 0, tags: ['ignite', 'erosion'], cap: { axis: 'drop', mult: 2.0 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.kargonMagmaVein },
  // 보스가 용암 갑주 — 가까이 붙을수록 물러지고 멀어지면 굳는다(그 반경은 접촉 피해권).
  { id: 32, slug: 'kargon-lava-warden', kind: 'signature', planet: 0, tags: ['precision'], cap: { axis: 'rarity', mult: 2.2 }, hook: 'A', dropWeight: W_SIGNATURE_BOSS, modeHook: MODE_HOOK.kargonLavaWarden },

  // ── 특산: 베르단 (planet 1, shrink) id 33~35 ──────────────────────────────
  // 안전 원이 따라오지 않고 15초마다 점프한다 — 점프 직후 5초간 새 원 안의 적이 즉사한다.
  { id: 33, slug: 'berdan-collapse', kind: 'signature', planet: 1, tags: ['precision', 'harvest'], cap: { axis: 'catalystDrop', mult: 1.5 }, hook: 'B', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.berdanCollapse },
  // 수축에 밀려난 자리에 젤리가 남는다 — 먹은 적은 느려지고 못 먹은 적은 빨라진다.
  { id: 34, slug: 'berdan-royal-jelly', kind: 'signature', planet: 1, tags: ['harvest'], cap: { axis: 'resource', mult: 2.4 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.berdanRoyalJelly },
  // 보스가 피해를 입으면 그만큼 일벌을 토한다 — 일벌을 죽이면 보스가 그만큼 약해진다.
  { id: 35, slug: 'berdan-hive-queen', kind: 'signature', planet: 1, tags: ['density', 'harvest'], cap: { axis: 'drop', mult: 2.2 }, hook: 'A', dropWeight: W_SIGNATURE_BOSS, modeHook: MODE_HOOK.berdanHiveQueen },

  // ── 특산: 니플헤임 (planet 2, chase) id 36~38 ─────────────────────────────
  // 포식자가 네 그림자를 남긴다 — 네 경로를 그대로 따라오며 닿으면 즉사. 대신 확보 속도 2배.
  { id: 36, slug: 'niflheim-pursuit', kind: 'signature', planet: 2, tags: ['precision', 'gamble'], cap: { axis: 'resource', mult: 2.2 }, hook: 'B', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.niflheimPursuit },
  // 네가 지나간 자리가 언다 — 적은 느려지지만 포식자는 오히려 가속한다.
  { id: 37, slug: 'niflheim-rime-crystal', kind: 'signature', planet: 2, tags: ['harvest', 'precision'], cap: { axis: 'rarity', mult: 2.0 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.niflheimRimeCrystal },
  // 포식자 위로 기함이 뜬다 — 대피소를 부수지만 부서진 대피소는 스스로 복구된다.
  { id: 38, slug: 'niflheim-flagship', kind: 'signature', planet: 2, tags: ['gamble', 'erosion'], cap: { axis: 'catalystDrop', mult: 1.5 }, hook: 'B', dropWeight: W_SIGNATURE_BOSS, modeHook: MODE_HOOK.niflheimFlagship },

  // ── 특산: 아르케 (planet 3, racing) id 39~41 ──────────────────────────────
  // 스크롤 2배 — 벽에 부딪히면 벽이 부서지며 자원이 나오지만 최대 속도가 한 단계 내려간다.
  { id: 39, slug: 'arke-overclock', kind: 'signature', planet: 3, tags: ['gamble'], cap: { axis: 'resource', mult: 2.2 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.arkeOverclock },
  // 코스 위 고대 코어 — 흡수하면 대량 자원이지만 3초간 선회 반경이 두 배가 된다.
  { id: 40, slug: 'arke-ancient-core', kind: 'signature', planet: 3, tags: ['harvest', 'gamble'], cap: { axis: 'resource', mult: 2.4 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.arkeAncientCore },
  // 보스 앞에 오벨리스크 관문 셋 — 통과한 수만큼 보스가 약해지고 못 한 관문은 보스를 키운다.
  { id: 41, slug: 'arke-obelisk', kind: 'signature', planet: 3, tags: ['precision', 'gamble'], cap: { axis: 'rarity', mult: 2.4 }, hook: 'B', dropWeight: W_SIGNATURE_BOSS, modeHook: MODE_HOOK.arkeObelisk },

  // ── 특산: 톡사르 (planet 4, contamination) id 42~44 ───────────────────────
  // 정화가 절반만 일어난다 — 대신 오염 위에서는 네 탄이 오염을 먹고 커진다.
  { id: 42, slug: 'toxar-outbreak', kind: 'signature', planet: 4, tags: ['erosion', 'harvest'], cap: { axis: 'drop', mult: 2.4 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.toxarOutbreak },
  // 처치한 적이 포자 구름을 남긴다 — 구름 안의 적은 두 배 빨라지지만 거기서 죽으면 두 배 뱉는다.
  { id: 43, slug: 'toxar-blightspore', kind: 'signature', planet: 4, tags: ['ignite', 'density'], cap: { axis: 'drop', mult: 2.0 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.toxarBlightspore },
  // 보스가 쓰러지면 즉시 두 번째 형태로 일어선다 — 잡으면 세 배, 못 잡으면 첫 형태분도 사라진다.
  { id: 44, slug: 'toxar-blight-mother', kind: 'signature', planet: 4, tags: ['gamble'], cap: { axis: 'rarity', mult: 2.6 }, hook: 'A', dropWeight: W_SIGNATURE_BOSS, modeHook: MODE_HOOK.toxarBlightMother },

  // ── 특산: 크라스 (planet 5, blockBreak) id 45~47 ──────────────────────────
  // 블록이 세 배 단단해지고 층이 겹친다 — 대신 부순 층이 그 자리에 엄폐물로 남는다.
  { id: 45, slug: 'kras-breach', kind: 'signature', planet: 5, tags: ['harvest', 'density'], cap: { axis: 'catalystDrop', mult: 1.5 }, hook: 'A', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.krasBreach },
  // 부순 블록 조각이 네 뒤를 따라다니며 방패가 된다(최대 5) — 대신 그만큼 느려진다.
  { id: 46, slug: 'kras-breachsteel', kind: 'signature', planet: 5, tags: ['precision', 'erosion'], cap: { axis: 'xp', mult: 2.0 }, hook: 'B', dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.krasBreachsteel },
  // 남은 블록이 곧 보스의 방어력 — 부술수록 약해지지만 그 자리로 스크롤이 더 빨리 밀려온다.
  { id: 47, slug: 'kras-colossus', kind: 'signature', planet: 5, tags: ['ignite', 'erosion'], cap: { axis: 'rarity', mult: 2.4 }, hook: 'A', dropWeight: W_SIGNATURE_BOSS, modeHook: MODE_HOOK.krasColossus },
] as const;

// ---------------------------------------------------------------------------
// 조회 & 정규화
// ---------------------------------------------------------------------------

/** id → CatalystDef. O(1) 조회. */
const BY_ID: ReadonlyMap<number, CatalystDef> = new Map(CATALYSTS.map((c) => [c.id, c]));

/** id 로 촉매를 얻는다(미지 id 면 undefined). */
export function catalystById(id: number): CatalystDef | undefined {
  return BY_ID.get(id);
}

/**
 * 순서 무관 정규화: 오름차순 정렬 + **중복 제거**(유니크 주입) + 미지 id 제거.
 * 해시(`replay.ts`)·서버 검증(`consume_catalysts`)이 공유한다 — 같은 집합이면 입력 순서와
 * 무관하게 동일 배열이다.
 *
 * ⚠️ **ADR-0029 대비 거동이 바뀌었다.** 구 모델은 중복을 **스택으로 보존**했다(2장 = 2배).
 * ADR-0052 §결정 "유니크 주입": 규칙은 "2장이면 2배"가 성립하지 않으므로 중복은 여기서 접힌다.
 * 중복 보유분은 기존 분해 경로(ADR-0042)로 잔재가 된다 — 자동 환급 마이그레이션은 하지 않는다.
 */
export function normalizeCatalystArray(ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort((a, b) => a - b);
}

/**
 * 정규화 후 총 주입 수가 SLOT_CAP 이내인지 검증(초과 거부).
 * 초과 거부 로직의 단일 위치 — sim·서버·UI 가 이 함수로 캡을 강제한다.
 */
export function isWithinSlotCap(ids: readonly number[]): boolean {
  return normalizeCatalystArray(ids).length <= SLOT_CAP;
}

/**
 * 정규화 후 특산 장수가 {@link SIGNATURE_CAP} 이내인지 검증.
 * 서버 짝은 `consume_catalysts` 게이트 (f) 다 — 두 곳이 갈리면 클라가 통과시킨 조합을
 * 서버가 출격 시점에 거부해 런이 통째로 날아간다.
 */
export function isWithinSignatureCap(ids: readonly number[]): boolean {
  let n = 0;
  for (const id of normalizeCatalystArray(ids)) {
    if (BY_ID.get(id)?.kind === 'signature') n++;
  }
  return n <= SIGNATURE_CAP;
}

/** 이 조합에 그 촉매가 들어 있는가. **소지 술어의 단일 정본** — 레인마다 만들면 갈린다. */
export function hasCatalyst(ids: readonly number[], id: number): boolean {
  return ids.includes(id);
}

/**
 * 이 행성 모드에서 그 촉매가 **구조적으로 무효**인가(픽커 회색 경고).
 * ⚠️ §축소 작동 규율 — 무효는 경고일 뿐이고 런 안에서는 축소된 형태로라도 작동해야 한다.
 */
export function catalystVoidOnMode(def: CatalystDef, mode: number): boolean {
  return def.voidOnModes?.includes(mode) ?? false;
}

// ---------------------------------------------------------------------------
// 상한 합성 (§경제 결합 규율 — 확정식)
// ---------------------------------------------------------------------------

/**
 * 축별 총상한 = `1 + Σ(그 축 개별상한 − 1) × CAP_COMPOSE_FACTOR`.
 * **공명 상한도 자기 축의 합에 든다** — 호출부가 {@link file://./catalystResonance.ts} 의
 * `resolveResonance` 결과를 함께 넘겨야 한다. 이 함수만으로는 촉매분만 센다.
 *
 * ⚠️ 최악 조합 탐색을 손으로 하지 마라 — `scripts/catalystCapSweep.ts` 가 48C3 = 17,296 건 ×
 * 공명 발동 판정을 전수로 돌린다(§경제 결합 규율이 명시한 계약. 손 계산이 2·3판 연속 틀렸다).
 */
export function axisCapMult(ids: readonly number[], axis: CatalystCapAxis): number {
  let sum = 0;
  for (const id of normalizeCatalystArray(ids)) {
    const def = BY_ID.get(id);
    if (def !== undefined && def.cap.axis === axis) sum += def.cap.mult - 1;
  }
  return 1 + sum * CAP_COMPOSE_FACTOR;
}

/**
 * 편의: 자원축 총상한 — **촉매 3장분만 센다.**
 *
 * ⚠️ **정산·표시에 이것을 쓰지 마라.** 헌장이 *"강공명·약공명도 자기 축의 합에 든다"* 고
 * 못 박았고 서버 영수증(`consume_catalysts`)이 그렇게 계산하므로, 공명이 자원축인 조합에서
 * 이 값은 **과소평가**가 되어 클라 표시와 서버 영수증이 갈린다.
 * 정본은 {@link file://./catalystResonance.ts} 의 `resourceCapMultWithResonance` 다.
 * (여기서 공명을 못 세는 것은 모듈 방향 때문이다 — 그 파일이 이 파일을 import 한다.)
 */
export function resourceCapMult(ids: readonly number[]): number {
  return axisCapMult(ids, 'resource');
}

/** 상한을 갖는 축 전체(고정 순서 — UI 표시·전수 검사가 이 순서를 쓴다). */
export const CATALYST_CAP_AXES: readonly CatalystCapAxis[] = [
  'drop',
  'resource',
  'rarity',
  'xp',
  'catalystDrop',
];

/** 전축 상한 = `max(축별 총상한) × CAP_ALL_AXIS_FACTOR` — 정산 총액의 단일 유계. */
export function allAxisCapMult(ids: readonly number[]): number {
  let max = 1;
  for (const axis of CATALYST_CAP_AXES) {
    const m = axisCapMult(ids, axis);
    if (m > max) max = m;
  }
  return max * CAP_ALL_AXIS_FACTOR;
}

// ---------------------------------------------------------------------------
// SQL 미러 시드
// ---------------------------------------------------------------------------

/**
 * 각 촉매의 **상한 축 + 배율**. `catalyst_defs` 의 축별 미러 시드다(구 `resource_mult` 1칸에서
 * 확장 — 규칙형은 조건부 보상이라 서버가 실제 액수를 예측할 수 없고, 각 규칙의 이론적 최대치만
 * 강제한다). `settle_pve_run` 이 이 값으로 축별 합성식을 돌린다.
 *
 * ⚠️ TS 정본 + SQL 미러 **동기화 의무** — `tests/catalystShopContract.test.ts` 계열이
 * 마이그레이션 본문과 전수 대조하므로 한쪽만 고치면 CI 가 먼저 깨진다.
 */
export const CATALYST_CAP_MIRROR: readonly {
  readonly id: number;
  readonly capAxis: CatalystCapAxis;
  readonly capMult: number;
}[] = CATALYSTS.map((c) => ({ id: c.id, capAxis: c.cap.axis, capMult: c.cap.mult }));

/**
 * 구 `catalyst_defs.resource_mult` 칸의 후속. **의미가 바뀌었다** — 구 값은 "장당 자원 배율
 * 가산분"(0.15)이었고 지금은 **자원축 개별 상한**(예 2.6)이다. 자원축이 아니면 1 이다
 * (0 이 아니다 — 합성식이 `Σ(cap − 1)` 이라 중립원이 1 이다).
 */
export const CATALYST_RESOURCE_MIRROR: readonly {
  readonly id: number;
  readonly resourceCap: number;
}[] = CATALYSTS.map((c) => ({
  id: c.id,
  resourceCap: c.cap.axis === 'resource' ? c.cap.mult : 1,
}));

// ---------------------------------------------------------------------------
// 촉매 상점 가격 (ADR-0042 — 촉매 잔재로 닫은 자기 완결 경제)
// ---------------------------------------------------------------------------
//
// ⚠️ 이 절은 ADR-0052 재작성에서 **한 줄도 바뀌지 않았다.** 가격은 `dropWeight` 한 축에서만
// 파생하고 그 값들이 동결이므로, 48종의 구매가·환급액이 재작성 전후로 동일하다.

/** 흔한 촉매(`dropWeight === W_COMMON`) 1장의 구매가. 다른 모든 가격이 여기서 파생한다. // BALANCE */
export const CATALYST_BASE_PRICE = 10;

/**
 * 분해 환급 비율(퍼센트). 구매가의 이 비율만큼 촉매 잔재로 돌려준다. // BALANCE
 *
 * ⚠️ 이 값은 `salvage_catalyst` SQL 본문의 `SALVAGE_RATIO_PCT` 와 **수동 미러**다.
 * `tests/catalystShopContract.test.ts` 가 마이그레이션 본문에서 리터럴을 추출해 대조하므로
 * 한쪽만 고치면 CI 가 먼저 깨진다.
 */
export const SALVAGE_RATIO_PCT = 50;

/**
 * 촉매 구매가 — 희소도(`dropWeight`) 한 축에서만 파생한다(ADR-0042 §계약 세부).
 *
 * `W_SIGNATURE = 8` 이라 특산 일반 12종이 `10 × 10 / 8 = 12.5` 로 비정수가 된다. **`Math.floor`
 * 로 절하한다** — 서버는 `floor(buy_price × pct / 100)` 로 환급하므로 양수 구간에서 JS 와
 * PostgreSQL 의 `floor` 가 동일해 표시가와 청구액이 갈릴 여지가 없다.
 *
 * 미지 id 는 0 을 반환한다. 서버 `buy_catalyst` 의 `price-unset` 게이트와 같은 방향이다.
 */
export function catalystBuyPrice(id: number): number {
  const def = BY_ID.get(id);
  if (def === undefined) return 0;
  return Math.floor((CATALYST_BASE_PRICE * W_COMMON) / def.dropWeight);
}

/**
 * 촉매 1장 분해 시 얻는 촉매 잔재.
 *
 * ⚠️ **결합 순서가 계약이다** — n 장 분해는 `catalystSalvageValue(id) * n` 이지
 * `floor(price × pct × n / 100)` 이 아니다. `buy_price = 25 · n = 3` 에서 36 vs 37 로 갈린다.
 * SQL 도 같은 순서(`floor(...) * v_qty`)여야 하고 계약 테스트가 그 괄호 위치를 잠근다.
 */
export function catalystSalvageValue(id: number): number {
  return Math.floor((catalystBuyPrice(id) * SALVAGE_RATIO_PCT) / 100);
}

/**
 * 촉매 상점 진열 여부. 공용 30종만 판다 — 특산은 분해만 되고 되살 수 없다(ADR-0042 §결정 4).
 * 특산을 팔면 그 행성에 한 번도 안 가고 그 행성 특산을 쥐게 되어 ADR-0022 의 종류 축 차별화가
 * 무너진다.
 */
export function catalystIsPurchasable(id: number): boolean {
  return BY_ID.get(id)?.kind === 'common';
}

/**
 * `catalyst_defs.buy_price` 시드의 TS 정본. 마이그레이션의 `CATALYST_PRICE_SEED_BEGIN`/`_END`
 * 센티넬 사이 블록과 계약 테스트가 전수 대조한다 — 시드 갱신을 잊으면 CI 가 깨진다.
 */
export const CATALYST_PRICE_MIRROR: readonly {
  readonly catalystId: number;
  readonly buyPrice: number;
  readonly purchasable: boolean;
}[] = CATALYSTS.map((c) => ({
  catalystId: c.id,
  buyPrice: catalystBuyPrice(c.id),
  purchasable: catalystIsPurchasable(c.id),
}));

// ---------------------------------------------------------------------------
// 아이콘 참조 (slug 기반)
// ---------------------------------------------------------------------------

/**
 * 촉매 → **개별 아트** 아이콘 키(`assets/catalyst_<slug>.png`). slug 의 `-` 는 파일명 규약상
 * `_` 로 바꾼다(`kargon-swarmcall` → `catalyst_kargon_swarmcall`).
 *
 * 48종 전부 개별 아이콘이 있고 **재작성이 slug 를 안 바꿨으므로 아트는 한 장도 안 버려진다.**
 */
export function catalystIconKey(def: CatalystDef): string {
  return `catalyst_${def.slug.replace(/-/g, '_')}`;
}

/**
 * 개별 아트가 없을 때의 **상한축별 공용 폴백** 키. 소비 측은 {@link catalystIconKey} → 이 키 →
 * 텍스트 글리프 순으로 내려간다(`uiTextures.ts` 의 "없으면 null 폴백" 규약).
 *
 * ⚠️ 구 모델의 `power` 축이 사라져 `catalyst_axis_power_*` 5장이 **등재에서 빠졌다.**
 * 지울 파일은 없다 — 그 5장은 원래도 실물이 없던 부채였다(`tests/uiAssetPresence.test.ts` 의
 * `KNOWN_MISSING` 에 올라 있었고, 등재가 사라지면서 그 목록에서도 빠졌다).
 * 폴백 키는 이제 상한축 5종뿐이고 {@link CATALYST_ICON_NAMES} 가 레지스트리 파생이라
 * 로더 목록도 자동으로 따라간다.
 */
export function catalystIconFallbackKey(def: CatalystDef): string {
  return `catalyst_axis_${def.cap.axis}`;
}

/**
 * 로더가 잡아야 할 촉매 아이콘 basename 전체(개별 48 + 축 폴백 5). **레지스트리 파생**이라
 * 촉매가 추가되면 자동으로 목록에 든다 — 하드코딩하면 새 촉매 한 장이 조용히 null 폴백된다.
 */
export const CATALYST_ICON_NAMES: readonly string[] = [
  ...new Set([
    ...CATALYSTS.map((d) => `${catalystIconKey(d)}.png`),
    ...CATALYSTS.map((d) => `${catalystIconFallbackKey(d)}.png`),
  ]),
];
