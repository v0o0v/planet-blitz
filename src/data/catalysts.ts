/**
 * 촉매 카탈로그 & 배율 함수 — 데이터 계약 (Lane 0, ADR-0029, 스펙 di-catalyst-2026-07-24).
 *
 * 성계 지도 출격 전에 주입하는 런 1회 소모품. 모든 촉매는 **페널티+보상을 한 몸**으로 가진다
 * (순수 버프 없음·무등급). 공용 30종(id 0~29, 전 행성 드랍) + 특산 18종(id 30~47, 6행성×3슬롯,
 * 출신 행성 런 전용). 이 파일은 하위 레인의 계약 정본이다 — Lane 2(sim·해시 폴드)·Lane 3(서버
 * 원장·SQL 미러)·Lane 4(픽커/관리 UI) 가 아래 공개 API 에 의존하므로 이름/시그니처를 임의로
 * 바꾸지 않는다.
 *
 * ── 스택 수학(스펙 R9) ── **선형 가산**. 효과는 "장당 +perStack"으로 정의하고, N장 = N·perStack.
 * 보상 배율 = 1 + Σ(같은 보상축 촉매들의 perStack). 페널티도 동일 규칙(Lane 2 가 sim 노브에 곱).
 *
 * ── 결정론 ── 순수 함수 전용. `Math.random`·`Date.now` 없음. 같은 입력 → 같은 출력. 해시에 들어가는
 * 것은 정규화된 **정수 id 배열**이고(Lane 2 가 접는다), 배율(부동소수)은 해시에 직접 들어가지 않는다.
 *
 * ── 밸런스 ── 모든 수치(perStack·dropWeight·SLOT_CAP)는 보수적 placeholder 다(`// BALANCE`).
 * 구조·부호(방향)만 정본이고 계수는 출시 전 일괄 튜닝한다(defer-balance-tuning). 지금 밸런싱 금지.
 */

// ---------------------------------------------------------------------------
// 타입 (Lane 2·3·4 공유 계약)
// ---------------------------------------------------------------------------

export type CatalystKind = 'common' | 'signature';

/** 보상이 지목하는 공통축 6종(스펙 R7). 촉매는 정확히 하나를 지목해 +perStack. */
export type RewardAxis = 'drop' | 'rarity' | 'xp' | 'resource' | 'catalystDrop' | 'power';

/**
 * 페널티가 비트는 sim 노브(Lane 2 가 실제 적용). 아래 6종으로 한정 — Lane 2 배선 계약이 고정이라
 * 6종 밖 신설 금지. 전부 "배율이 클수록 난이도 상승" 방향으로 통일한다:
 *  - enemyHp/enemySpeed/enemyDamage/enemyCount/enemyBulletSpeed: 값이 클수록 적이 강/빠름/많음
 *  - playerHpDown: 값이 클수록 기체 HP 페널티가 큼(Lane 2 가 최대 체력 하향 강도로 소비)
 */
export type PenaltyAxis =
  | 'enemyHp'
  | 'enemySpeed'
  | 'enemyDamage'
  | 'enemyCount'
  | 'enemyBulletSpeed'
  | 'playerHpDown';

/** 파워 보상축 세부 타깃(스펙 R8 — 기존 스탯 어휘 재사용, 런 한정·파워업과 같은 지위). */
export type PowerStat = 'damage' | 'fireRate' | 'moveSpeed' | 'maxHp' | 'skillAll';

export interface CatalystDef {
  /** 안정 numeric id, **append-only**. runConfig/hash/서버가 이 값으로 참조. */
  readonly id: number;
  /** 안정 문자열 키. i18n `catalyst.<slug>.name/desc`, 아이콘 참조에 쓴다. */
  readonly slug: string;
  readonly kind: CatalystKind;
  /** signature 만: 출신 행성 인덱스(0..5). common 은 undefined. */
  readonly planet?: number;
  /**
   * 보상: 공통축 하나에 +perStack(분수, 0.15 = +15%). axis==='power' 면 powerStat 필수.
   * perStack·powerStat 조합만 정본이고 계수는 밸런스.
   */
  readonly reward: { readonly axis: RewardAxis; readonly perStack: number; readonly powerStat?: PowerStat };
  /** 장당 페널티 크기(분수). 전 촉매 동봉(순수 버프 없음). // BALANCE */
  readonly penalty: { readonly axis: PenaltyAxis; readonly perStack: number };
  /** 상대 드랍 가중치(무등급 — 희소성은 이 가중치로만 표현). // BALANCE */
  readonly dropWeight: number;
  /**
   * 특산 '모드 격화형' 전용: Lane 2 가 배선할 bespoke sim 훅 식별자(예 'contamination-intensify').
   * 없으면 표준 보상/페널티 축만으로 동작한다.
   */
  readonly modeHook?: string;
}

// ---------------------------------------------------------------------------
// 밸런스 placeholder 상수 (전부 // BALANCE — 출시 전 일괄 튜닝)
// ---------------------------------------------------------------------------

/** 일반 보상축(drop·rarity·xp·resource·catalystDrop) 장당 배율. // BALANCE */
const REWARD_PER_STACK = 0.15;
/** 자원 보상축 장당 배율(서버 개연성 캡 미러 대상). // BALANCE */
const RESOURCE_PER_STACK = 0.15;
/** 파워 보상축 장당 배율(런 한정 스탯 강화). // BALANCE */
const POWER_PER_STACK = 0.1;
/** 장당 페널티 배율(위험-보상 커플링 — 보상보다 크게 잡아 스택 몰빵을 자기 밸런싱). // BALANCE */
const PENALTY_PER_STACK = 0.2;

/** 공용 일반 촉매 드랍 가중치. // BALANCE */
const W_COMMON = 10;
/** 파워축 촉매 드랍 가중치 — 극저(프리미엄은 등급 아니라 희소 드랍으로). // BALANCE */
const W_POWER = 2;
/** skillAll 파워 촉매 — 파워축 중에서도 최희소. // BALANCE */
const W_POWER_SKILLALL = 1;
/** 특산 모드/자원형 드랍 가중치. // BALANCE */
const W_SIGNATURE = 8;
/** 특산 보스 격화형 드랍 가중치 — 낮게(천장 보상). // BALANCE */
const W_SIGNATURE_BOSS = 4;

/**
 * 총 주입 수 하드 캡(스펙 R9 — 무상한이면 개연성 캡·UI·해시 입력이 비유계).
 * sim·서버·UI 공유 단일 정본. placeholder. // BALANCE
 */
export const SLOT_CAP = 8;

// ---------------------------------------------------------------------------
// 48종 카탈로그 (id 순 = 배열 인덱스. 접근은 catalystById 로.)
// ---------------------------------------------------------------------------

/** 모드 격화형 sim 훅 식별자(Lane 2 가 배선). 행성 모드↔훅 1:1. */
export const MODE_HOOK = {
  /** 카르곤(0) vampire — 적 밀도·근접 압박 격화. */
  vampire: 'vampire-intensify',
  /** 베르단(1) shrink — 안전지대 수축 가속. */
  shrink: 'shrink-intensify',
  /** 니플헤임(2) chase — 추격 압박 격화. */
  chase: 'chase-intensify',
  /** 아르케(3) racing — 레이싱 페이스 격화. */
  racing: 'racing-intensify',
  /** 톡사르(4) contamination — 오염 확산 가속. */
  contamination: 'contamination-intensify',
  /** 크라스(5) blockBreak — 블록 방벽 강화. */
  blockBreak: 'blockbreak-intensify',
} as const;

/**
 * 촉매 48종 정의. 각 줄 주석은 [페널티축 → 보상축] 방향 요약이다.
 * 공용 30종은 보상 6축 × 5종으로 고르게 분포한다.
 */
export const CATALYSTS: readonly CatalystDef[] = [
  // ── 공용: 드랍량(drop) 5종 (id 0~4) ────────────────────────────────────────
  { id: 0, slug: 'abundance', kind: 'common', reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 1, slug: 'plunder', kind: 'common', reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 2, slug: 'harvest', kind: 'common', reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 3, slug: 'bounty', kind: 'common', reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemySpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 4, slug: 'cornucopia', kind: 'common', reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyBulletSpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },

  // ── 공용: 희귀도(rarity) 5종 (id 5~9) ──────────────────────────────────────
  { id: 5, slug: 'refinement', kind: 'common', reward: { axis: 'rarity', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 6, slug: 'gilding', kind: 'common', reward: { axis: 'rarity', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 7, slug: 'prospect', kind: 'common', reward: { axis: 'rarity', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 8, slug: 'alchemy', kind: 'common', reward: { axis: 'rarity', perStack: REWARD_PER_STACK }, penalty: { axis: 'playerHpDown', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 9, slug: 'epiphany', kind: 'common', reward: { axis: 'rarity', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyBulletSpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },

  // ── 공용: 경험치(xp) 5종 (id 10~14) ────────────────────────────────────────
  { id: 10, slug: 'insight', kind: 'common', reward: { axis: 'xp', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemySpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 11, slug: 'tutelage', kind: 'common', reward: { axis: 'xp', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 12, slug: 'ascension', kind: 'common', reward: { axis: 'xp', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 13, slug: 'enlightenment', kind: 'common', reward: { axis: 'xp', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 14, slug: 'mastery', kind: 'common', reward: { axis: 'xp', perStack: REWARD_PER_STACK }, penalty: { axis: 'playerHpDown', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },

  // ── 공용: 자원(resource) 5종 (id 15~19) ────────────────────────────────────
  { id: 15, slug: 'extraction', kind: 'common', reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 16, slug: 'foundry', kind: 'common', reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 17, slug: 'greed', kind: 'common', reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 18, slug: 'mercantile', kind: 'common', reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemySpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 19, slug: 'motherlode', kind: 'common', reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'playerHpDown', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },

  // ── 공용: 촉매 드랍률(catalystDrop) 5종 (id 20~24) ─────────────────────────
  { id: 20, slug: 'resonance', kind: 'common', reward: { axis: 'catalystDrop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 21, slug: 'catalysis', kind: 'common', reward: { axis: 'catalystDrop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyBulletSpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 22, slug: 'cascade', kind: 'common', reward: { axis: 'catalystDrop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 23, slug: 'seeding', kind: 'common', reward: { axis: 'catalystDrop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },
  { id: 24, slug: 'chainreaction', kind: 'common', reward: { axis: 'catalystDrop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemySpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_COMMON },

  // ── 공용: 파워(power) 5종 (id 25~29) — 드랍 가중치 극저(무등급 원칙: 프리미엄은 희소 드랍) ──
  { id: 25, slug: 'overdrive', kind: 'common', reward: { axis: 'power', perStack: POWER_PER_STACK, powerStat: 'damage' }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_POWER },
  { id: 26, slug: 'rapidcore', kind: 'common', reward: { axis: 'power', perStack: POWER_PER_STACK, powerStat: 'fireRate' }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_POWER },
  { id: 27, slug: 'afterburner', kind: 'common', reward: { axis: 'power', perStack: POWER_PER_STACK, powerStat: 'moveSpeed' }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_POWER },
  { id: 28, slug: 'bulwark', kind: 'common', reward: { axis: 'power', perStack: POWER_PER_STACK, powerStat: 'maxHp' }, penalty: { axis: 'enemySpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_POWER },
  { id: 29, slug: 'ascendant', kind: 'common', reward: { axis: 'power', perStack: POWER_PER_STACK, powerStat: 'skillAll' }, penalty: { axis: 'playerHpDown', perStack: PENALTY_PER_STACK }, dropWeight: W_POWER_SKILLALL },

  // ── 특산: 카르곤(planet 0, vampire) id 30~32 ───────────────────────────────
  // ① 모드 격화형 · ② 테마 자원형 · ③ 보스 격화형
  { id: 30, slug: 'kargon-swarmcall', kind: 'signature', planet: 0, reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.vampire },
  { id: 31, slug: 'kargon-magma-vein', kind: 'signature', planet: 0, reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE },
  { id: 32, slug: 'kargon-lava-warden', kind: 'signature', planet: 0, reward: { axis: 'rarity', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE_BOSS },

  // ── 특산: 베르단(planet 1, shrink) id 33~35 ────────────────────────────────
  { id: 33, slug: 'berdan-collapse', kind: 'signature', planet: 1, reward: { axis: 'xp', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemySpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.shrink },
  { id: 34, slug: 'berdan-royal-jelly', kind: 'signature', planet: 1, reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE },
  { id: 35, slug: 'berdan-hive-queen', kind: 'signature', planet: 1, reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE_BOSS },

  // ── 특산: 니플헤임(planet 2, chase) id 36~38 ───────────────────────────────
  { id: 36, slug: 'niflheim-pursuit', kind: 'signature', planet: 2, reward: { axis: 'catalystDrop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemySpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.chase },
  { id: 37, slug: 'niflheim-rime-crystal', kind: 'signature', planet: 2, reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyBulletSpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE },
  { id: 38, slug: 'niflheim-flagship', kind: 'signature', planet: 2, reward: { axis: 'rarity', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE_BOSS },

  // ── 특산: 아르케(planet 3, racing) id 39~41 ────────────────────────────────
  { id: 39, slug: 'arke-overclock', kind: 'signature', planet: 3, reward: { axis: 'xp', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemySpeed', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.racing },
  { id: 40, slug: 'arke-ancient-core', kind: 'signature', planet: 3, reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE },
  { id: 41, slug: 'arke-obelisk', kind: 'signature', planet: 3, reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE_BOSS },

  // ── 특산: 톡사르(planet 4, contamination) id 42~44 ─────────────────────────
  { id: 42, slug: 'toxar-outbreak', kind: 'signature', planet: 4, reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'playerHpDown', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.contamination },
  { id: 43, slug: 'toxar-blightspore', kind: 'signature', planet: 4, reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE },
  { id: 44, slug: 'toxar-blight-mother', kind: 'signature', planet: 4, reward: { axis: 'rarity', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE_BOSS },

  // ── 특산: 크라스(planet 5, blockBreak) id 45~47 ────────────────────────────
  { id: 45, slug: 'kras-breach', kind: 'signature', planet: 5, reward: { axis: 'catalystDrop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyHp', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE, modeHook: MODE_HOOK.blockBreak },
  { id: 46, slug: 'kras-breachsteel', kind: 'signature', planet: 5, reward: { axis: 'resource', perStack: RESOURCE_PER_STACK }, penalty: { axis: 'enemyCount', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE },
  { id: 47, slug: 'kras-colossus', kind: 'signature', planet: 5, reward: { axis: 'drop', perStack: REWARD_PER_STACK }, penalty: { axis: 'enemyDamage', perStack: PENALTY_PER_STACK }, dropWeight: W_SIGNATURE_BOSS },
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
 * 순서 무관 정규화: 오름차순 정렬 + 중복(스택) 보존 + 미지 id 제거.
 * 해시(Lane 2)·서버 검증(Lane 3)이 공유한다 — 같은 집합이면 입력 순서와 무관하게 동일 배열.
 */
export function normalizeCatalystArray(ids: readonly number[]): number[] {
  return ids.filter((id) => BY_ID.has(id)).sort((a, b) => a - b);
}

/**
 * 정규화 후 총 주입 수가 SLOT_CAP 이내인지 검증(초과 거부).
 * 초과 거부 로직의 단일 위치 — Lane 2(sim)·Lane 3(서버)·Lane 4(UI)가 이 함수로 캡을 강제한다.
 */
export function isWithinSlotCap(ids: readonly number[]): boolean {
  return normalizeCatalystArray(ids).length <= SLOT_CAP;
}

// ---------------------------------------------------------------------------
// 배율 함수 (선형 가산, 순수)
// ---------------------------------------------------------------------------

/**
 * 보상축 배율 = 1 + Σ(해당 reward.axis 인 촉매들의 perStack). 미지 id 는 무시.
 * axis==='power' 는 세부 스탯 구분이 없으므로 파워 전체 합이다 — 스탯별 배율은 catalystPowerMult 를 쓴다.
 */
export function catalystRewardMult(ids: readonly number[], axis: RewardAxis): number {
  let sum = 0;
  for (const id of ids) {
    const def = BY_ID.get(id);
    if (def !== undefined && def.reward.axis === axis) sum += def.reward.perStack;
  }
  return 1 + sum;
}

/**
 * 페널티축 배율 = 1 + Σ(해당 penalty.axis 촉매들의 perStack). 미지 id 는 무시.
 * Lane 2 가 해당 sim 노브에 곱한다(배율이 클수록 난이도 상승).
 */
export function catalystPenaltyMult(ids: readonly number[], axis: PenaltyAxis): number {
  let sum = 0;
  for (const id of ids) {
    const def = BY_ID.get(id);
    if (def !== undefined && def.penalty.axis === axis) sum += def.penalty.perStack;
  }
  return 1 + sum;
}

/** 편의: 자원축 보상 배율. 서버 영수증(개연성 캡 미러)이 참조하는 값이다. */
export function resourceMultOf(ids: readonly number[]): number {
  return catalystRewardMult(ids, 'resource');
}

/**
 * 특정 파워 스탯 배율 = 1 + Σ(axis==='power' && powerStat===stat 인 촉매들의 perStack).
 * 런 한정 스탯 강화(파워업과 같은 지위). Lane 2 가 스탯 적용 지점 1곳에서만 곱해 중복 적용을 막는다.
 */
export function catalystPowerMult(ids: readonly number[], stat: PowerStat): number {
  let sum = 0;
  for (const id of ids) {
    const def = BY_ID.get(id);
    if (def !== undefined && def.reward.axis === 'power' && def.reward.powerStat === stat) {
      sum += def.reward.perStack;
    }
  }
  return 1 + sum;
}

// ---------------------------------------------------------------------------
// SQL 미러 시드 (Lane 3)
// ---------------------------------------------------------------------------

/**
 * 각 촉매의 자원축 장당 배율(자원축이 아니면 0). Lane 3 가 `catalyst_defs` 시드로 SQL 에 미러한다
 * (TS 정본 + SQL 미러 동기화 의무 — 기존 grant_currency "배너=정본·DECLARE 미러" 패턴의 확장).
 * settle_pve_run 이 이 값으로 그 런의 개연성/per-call 캡을 조건부 상향한다.
 */
export const CATALYST_RESOURCE_MIRROR: readonly { readonly id: number; readonly resourcePerStack: number }[] =
  CATALYSTS.map((c) => ({
    id: c.id,
    resourcePerStack: c.reward.axis === 'resource' ? c.reward.perStack : 0,
  }));

// ---------------------------------------------------------------------------
// 아이콘 참조 (slug 기반, 축별 placeholder)
// ---------------------------------------------------------------------------

/**
 * 촉매 → **개별 아트** 아이콘 키(`assets/catalyst_<slug>.png`). slug 의 `-` 는 파일명 규약상
 * `_` 로 바꾼다(`kargon-swarmcall` → `catalyst_kargon_swarmcall`) — 기존 유니크 장비 아트
 * (`equip_unique_*`)가 쓰는 것과 같은 규칙이다.
 *
 * 2026-07-28 아트 패스에서 48종 전부 개별 아이콘이 생겼다(사용자 요청). 그 전에는 보상축별
 * 공용 placeholder 뿐이었고, 같은 축 촉매 5종이 한 그림을 공유해 화면에서 구별되지 않았다.
 */
export function catalystIconKey(def: CatalystDef): string {
  return `catalyst_${def.slug.replace(/-/g, '_')}`;
}

/**
 * 개별 아트가 없을 때의 **보상축별 공용 폴백** 키. 아트가 코드보다 늦게 오는 경우를 위해
 * 남겨 둔다 — 소비 측은 {@link catalystIconKey} → 이 키 → 텍스트 글리프 순으로 내려간다
 * (`uiTextures.ts` 의 "없으면 null 폴백" 규약과 같은 정신).
 */
export function catalystIconFallbackKey(def: CatalystDef): string {
  if (def.reward.axis === 'power') {
    return `catalyst_axis_power_${def.reward.powerStat ?? 'damage'}`;
  }
  return `catalyst_axis_${def.reward.axis}`;
}

/**
 * 로더가 잡아야 할 촉매 아이콘 basename 전체(개별 48 + 축 폴백 10). **레지스트리 파생**이라
 * 촉매가 추가되면 자동으로 목록에 든다 — 하드코딩하면 새 촉매 한 장이 조용히 null 폴백된다
 * (`SHIP_SHOWCASE_NAMES` 가 같은 이유로 파생이다).
 */
export const CATALYST_ICON_NAMES: readonly string[] = [
  ...new Set([
    ...CATALYSTS.map((d) => `${catalystIconKey(d)}.png`),
    ...CATALYSTS.map((d) => `${catalystIconFallbackKey(d)}.png`),
  ]),
];
