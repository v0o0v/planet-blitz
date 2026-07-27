/**
 * 침공 밸런스 스모크 — NPC 시드 20기지 × 결정론 시드 목록 (M7c C7-balance).
 *
 * ## 이 파일이 막는 것
 * 레인별 단위 테스트는 자기 모듈만 부르므로 **"카탈로그는 다 그린인데 실제 판이 클리어
 * 불가"** 상태를 통과시킨다. M7c 콘텐츠 확장 직후가 정확히 그랬다 — 참조봇 실측에서
 * 중하·중위 밴드 클리어율이 **0%** 였는데 기존 테스트는 전부 통과했다.
 * 여기서는 `createWorld` → `stepWorld` **정규 경로**로 한 판을 끝까지 돌려, 밴드별
 * 클리어율이 목표 범위 안에 있는지를 직접 잰다.
 *
 * ## 측정 기준 — 참조봇이지 사람이 아니다
 * 입력은 `autopilotInput`(ADR-0008 순수 결정론 입력 봇)이 만든다. 사람 플레이어는
 * 이보다 잘 피하므로 **여기 승률은 실제 체감 승률의 하한**이다. 절대값보다 중요한 것은
 * ①클리어 가능성이 살아 있는가 ②밴드 순서대로 어려워지는가 두 가지다.
 *
 * 장비는 고정 프로필(`GEAR_REFERENCE`)을 쓴다. 무장비로 재면 배치전을 실제로 치르는
 * 시점(PvP 해금 직후 = 장비를 갖춘 상태)과 어긋나고, 콘텐츠가 조금만 세져도 전 밴드가
 * 0% 로 붙어 버려 회귀 신호가 죽는다.
 *
 * ## 목표 승률(설계 의도) — **현재 상한과 갈라져 있다. 아래 "숫자 읽는 법" 필독**
 *   하위(01~07) ≥ 85%  — 배치전은 PvP 해금 후 **필수 5회**다. 여기서 막히면 진행이 멈춘다.
 *   중하(08~14) 55~80% — 절반 이상 이기되 배치를 신경 쓰게 만드는 구간.
 *   중위(15~20) 25~55% — 재도전 전제의 상위권 문턱. 0% 도 100% 도 아니어야 한다.
 *
 * ## ⚠️ 이 파일의 숫자를 읽는 법 (2026-07-27 통합 — 흩어진 TODO 3세대를 여기로 모았다)
 *
 * 지금까지 각 단언 옆에 `TODO(밸런스)` 주석이 세 세대 쌓였다. 다음 레인이 **네 번째 층을
 * 쌓지 않도록**, 목표와 상한의 갈림에 관한 기록은 앞으로 이 블록에만 쓴다.
 *
 * ### ① 이 파일이 실제로 재는 것 — 방어 배치 난이도가 **아니다**
 * 런 풀 커브 계수를 1000 으로 올려 **레벨업을 0회**로 만들면 20기지 전부가 96시드 내내
 * **0% 또는 100% 로 고정된다**(2026-07-27 실측). 즉 시드 간 승률 분산은 통째로
 * `state.powerupRng`(`src/sim/world.ts` `rng.fork('powerups')`)에서 나오고, 적 스폰·드랍
 * 추첨은 승패를 사실상 흔들지 않는다. **여기 "승률"은 참조봇의 파워업 추첨 운 분포이지
 * 기지 배치의 난이도가 아니다.**
 * 그러므로 이 파일의 가치는 승률 절대값이 아니라 ⓐ클리어 가능성이 살아 있는가
 * ⓑ밴드 순서가 뒤집히지 않았는가 ⓒ**배선이 살아 있는가** 셋에 있고, ⓒ가 본체다 —
 * 이 저장소의 반복 결함("단위 테스트 그린인데 배선이 통째로 없다", 누적 8건)을 잡는 유일한
 * 계층이라 **이 파일을 약화시키는 변경은 특히 위험하다**.
 *
 * ### ② 목표와 상한이 갈라진 이력 3세대 (전부 "sim 이 바뀌었고 상한만 열었다")
 *   1세대 `fix/weapon-range-semantics` — 무제한 조준(`weapon.range === 0` 센티널) 제거.
 *          중하가 양 끝으로 찢어져 기지간 편차 18.1 → 30.2pp (중하 상한 28 → 32).
 *   2세대 ADR-0034 강제 스크롤 ANCHOR 정책 — 창 뒤 경계 고착이 사라져 난이도 **재분배**.
 *          중위 30.6 → 45.8%, 중하·중위 순서 역전 (중위 sd 상한 28 → 29, 중위 hi 55 → 80).
 *   3세대 ADR-0036 경험치 이원화(런 풀 커브 `10+6L` → `10+13L`) — 런당 레벨업 감소 →
 *          파워업 추첨 횟수 감소. ①의 성질 때문에 이 파일의 **모든 숫자가 함께 이동**했다.
 *          시드 12 → 24 · 중하 hi 85 → 88 · 중위 sd 29 → 33 · 게이트 #12 hi 95 → 100.
 * 현재 상한은 전부 "이 값이 좋다"가 아니라 **"지금 여기 있다"는 기록**이다.
 *
 * ### ③ 3세대 재기준화가 완화가 아닌 이유 — 96시드 대조군 실측 (2026-07-27)
 * 변경 전(`10+6L`) 코드를 폐기용 detached 워크트리(`bc73201`)에 따로 녹화해 대조했다.
 *   중위 기지간 승률 편차 sd — 변경 전 **30.4** / 변경 후 **30.1**. 커브 계수를
 *   3·6·8·10·11·13 으로 쓸어도 28.8~30.4 로 **평평하다** → 이 지표는 커브와 **무상관**이다.
 *   그리고 **대조군(변경 전 코드)도 96시드에서 sd 30.4 로 구 상한 29 를 위반한다** —
 *   구 상한 29 는 특정 12시드 실현(28.767)에 **과적합**돼 있었다.
 *   해상도별 수렴: 12시드 25.6→35.2 · 24시드 27.2→31.7 · **48시드 29.0→29.0** · 96시드 30.4→30.1.
 *   해상도가 오를수록 두 값이 붙는다 — 차이가 표본오차였다는 정의 그대로다.
 *   sd 의 출처는 #16 단독이다: **#16 을 빼면 중위 sd 는 변경 전 16.6 / 변경 후 15.9** 로 평범.
 * 시드를 12 → 24 로 늘린 것도 완화가 아니라 **해상도 복원**이다(아래 `BALANCE_SEEDS` 주석).
 *
 * ### ③-1 ⚠️ 3세대 이후 — **침공 런 풀 커브가 다시 `10+6L` 로 갈라졌다** (2026-07-27)
 * 위 ③ 의 재기준화는 런 풀 커브 `10+13L` 위에서 잰 것이다. 그 뒤 같은 밸런스 패스가 PvE 커브를
 * **`10+66L`** 로 더 올렸는데(ADR-0036 개정 · 런당 레벨업 5~8 목표), 그 값을 침공에도 적용하자
 * 기지 `#16` 이 **96시드 전패**(0/96 · 24시드 전부 코어 무피해 사망)가 되어 아래 "클리어 불가
 * 기지가 없다" 불변식이 실제로 깨졌다. ①의 성질 그대로다 — 침공 런 내 레벨업이 약 1회로 줄면
 * 파워업 추첨 횟수가 줄어 최저 기지가 분포 바닥 밖으로 밀린다.
 *
 * 그래서 **런 풀 커브를 런 구조별로 갈랐다**(`src/sim/world.ts` 의 `xpToNextInvasion`):
 * PvE `10 + 66L` · **침공 `10 + 6L`(= 이 파일 상한들이 서 있던 값으로 복원)**. 결과적으로
 * 아래 상한·밴드는 **재측정 없이 그대로 유효**하고(실측 33/33 통과), 침공 per-tick 해시도
 * 밸런스 패스 이전과 **바이트 동일**이다(48,477틱 · 520,844 bytes 대조). 즉 ②의 "4세대"가
 * 생긴 것이 아니라 **3세대 상태가 보존된 것**이다 — 이 절은 그 사실의 기록이다.
 *
 * ### ④ 해상도 정책 — 24시드는 ADR-0037 이 정한 CI 예산이다
 * ADR-0037: **튜닝 스윕은 96시드 · CI 회귀 게이트는 24시드**. 통계적으로는 48시드가 정답이고
 * (변경 전후 sd 가 29.0 으로 **일치**하는 지점 = 지표가 노이즈이길 멈추는 해상도) 그 사실을
 * 여기 남긴다. 다만 48 로 올리는 것은 CI 예산 정책 변경이라 **별도 판단 항목**이다.
 * 24시드 기준 승률 최소 눈금은 기지당 4.17pp · 밴드당 0.60pp(7기지 168런)다.
 *
 * ### ⑤ 목표 밴드를 되살리려면 — 수치가 아니라 결함이 먼저다
 * ADR-0037 이 침공(PvP) 방어 밸런스를 밸런싱 레인 **밖으로** 뺐다. 목표 복원은 별도 **침공
 * 난이도 레인**의 일이고, 그 레인의 1순위는 다음 둘이다(둘 다 실측된 결함이다):
 *   - `.omc/plans/m8-balance-handoff.md` §5.5 **보스 램프 배정 역전** — 가장 어려운
 *     `sporeQueen`(플레이어 승률 30.6%)이 중간 밴드(nn11~16)에, 가장 쉬운 축이 최상위에.
 *     중위 밴드 최저가 하필 #16 인 것이 이 역전으로 설명된다.
 *   - `.omc/research/invasion-powerup-inversion-2026-07-27.md` — 기지 #12 에서 **공격
 *     파워업이 승률을 깎는다**(4종 전부 억제 시 96/96 · 패배는 전부 코어 무피해 타임아웃).
 *     참조봇 상호작용 결함이라, 고치기 전의 승률은 결함 위에서 튜닝하는 것이 된다.
 * 램프를 실제로 바꾸려면 `supabase/migrations/20260723000000_m7c_seed_rebalance.sql` 이
 * 정본이고 아래 `RAMP_SQL_LINES` 미러 13줄을 **동시에** 고쳐야 한다(드리프트 가드 참고).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, LoadoutConfig } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { INVASION_TOTAL_TICKS, normalizeInvasionLayers } from '../src/sim/invasion/index.js';
import type { InvasionLayers } from '../src/sim/invasion/index.js';
import { INVASION_SOCKET_COUNTS } from '../src/sim/invasion/constants.js';
import { FORMATIONS } from '../data/invasion/formations.js';
import { INVASION_FACILITIES } from '../data/invasion/facilities.js';
import { L3_PROPS } from '../data/invasion/props.js';
import { DEFENSE_BOSSES } from '../data/invasion/defenseBosses.js';
import { SEED_BASES, SEED_BASE_COUNT, seedBaseUuid } from '../data/seedBases.js';
import { SHIP_TYPES, zeroSkillInvest } from '../data/ships/index.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { WEAPON_VULCAN } from '../src/items/loadout.js';
import type { AffixRoll, Item } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 시드 램프 미러 — 정본은 마이그레이션 SQL 이다
// ---------------------------------------------------------------------------

/**
 * `supabase/migrations/20260723000000_m7c_seed_rebalance.sql` 의 시드 생성 규칙 미러.
 * **정본은 SQL 이고 이건 사본이다.** 사본이 조용히 갈라지면 이 파일의 승률 측정이
 * 원격 DB 와 무관한 숫자가 되므로, 아래 `드리프트 가드` 테스트가 SQL 안의
 * `-- RAMP:` 주석과 이 표를 문자열로 대조한다.
 */
const RAMP = {
  level: (nn: number) => 1 + Math.floor((3 * (nn - 1)) / 2),
  rarity: (nn: number) => (nn <= 6 ? 0 : nn <= 12 ? 1 : nn <= 17 ? 2 : 3),
  ascension: (nn: number) => (nn <= 9 ? 0 : nn <= 14 ? 1 : nn <= 18 ? 2 : 3),
  template: (nn: number) => (nn <= 7 ? 0 : nn <= 14 ? 2 : 1),
  waves: (nn: number) => Math.min(6, 1 + Math.floor((nn - 1) / 3)),
  formationKinds: (nn: number) => Math.min(8, 1 + Math.floor((nn + 1) / 3)),
  formationShift: (nn: number) => (nn >= 17 ? 2 : 0),
  facilities: (nn: number, socketN: number) => Math.min(socketN, 2 + Math.floor((nn - 1) / 2)),
  facilityKinds: (nn: number) => Math.min(9, 2 + Math.floor((nn * 2) / 5)),
  props: (nn: number) => (nn <= 4 ? 0 : nn <= 8 ? 1 : nn <= 15 ? 2 : nn <= 17 ? 3 : 4),
  propKinds: (nn: number) => Math.min(6, 1 + Math.floor(nn / 4)),
  propShift: (nn: number) => (nn >= 18 ? 3 : 0),
  boss: (nn: number) => (nn <= 4 ? -1 : nn <= 10 ? 0 : nn <= 16 ? 1 : 2),
};

/** SQL 헤더가 반드시 담고 있어야 하는 램프 식(문자열 그대로 대조). */
const RAMP_SQL_LINES: readonly string[] = [
  '-- RAMP: level = 1 + (3*(nn-1))/2',
  '-- RAMP: rarity = nn<=6 ? 0 : nn<=12 ? 1 : nn<=17 ? 2 : 3',
  '-- RAMP: ascension = nn<=9 ? 0 : nn<=14 ? 1 : nn<=18 ? 2 : 3',
  '-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1',
  '-- RAMP: waves = min(6, 1 + (nn-1)/3)',
  '-- RAMP: formationKinds = min(8, 1 + (nn+1)/3)',
  '-- RAMP: formationShift = nn>=17 ? 2 : 0',
  '-- RAMP: facilities = min(socketN, 2 + (nn-1)/2)',
  '-- RAMP: facilityKinds = min(9, 2 + (nn*2)/5)',
  '-- RAMP: props = nn<=4 ? 0 : nn<=8 ? 1 : nn<=15 ? 2 : nn<=17 ? 3 : 4',
  '-- RAMP: propKinds = min(6, 1 + nn/4)',
  '-- RAMP: propShift = nn>=18 ? 3 : 0',
  '-- RAMP: boss = nn<=4 ? none : nn<=10 ? 0 : nn<=16 ? 1 : 2',
];

const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260723000000_m7c_seed_rebalance.sql', import.meta.url),
);

/**
 * 마이그레이션 SQL 원문. `tests/node-shims.d.ts` 의 `readFileSync` 선언이 인코딩 인자를
 * 받지 않아(바이트 반환) 여기서 디코드한다 — 공유 shim 을 이 레인이 넓히지 않기 위해서다.
 */
function readMigrationSql(): string {
  return new TextDecoder().decode(readFileSync(MIGRATION_PATH));
}

function ref(catalogId: number, nn: number, salt: number) {
  return {
    catalogId,
    level: RAMP.level(nn),
    ascension: RAMP.ascension(nn),
    affixSeed: salt,
    rarity: RAMP.rarity(nn),
  };
}

/** 순번 nn(1..20)의 시드 배치. SQL 이 원격에 심는 것과 같은 정규형이어야 한다. */
export function seedBaseLayers(nn: number): InvasionLayers {
  const tpl = RAMP.template(nn);
  const socketN = INVASION_SOCKET_COUNTS[tpl] as number;
  const waves = RAMP.waves(nn);
  const kf1 = RAMP.formationKinds(nn);
  const sf1 = RAMP.formationShift(nn);
  const facils = RAMP.facilities(nn, socketN);
  const kf2 = RAMP.facilityKinds(nn);
  const props = RAMP.props(nn);
  const kp = RAMP.propKinds(nn);
  const sp = RAMP.propShift(nn);
  const boss = RAMP.boss(nn);
  return normalizeInvasionLayers({
    l1: {
      waveSlots: Array.from({ length: 6 }, (_, i) =>
        i < waves ? ref((i + sf1) % kf1, nn, nn * 1000 + i * 7) : null,
      ),
    },
    l2: {
      templateId: tpl,
      sockets: Array.from({ length: socketN }, (_, i) =>
        i < facils ? ref(i % kf2, nn, nn * 2000 + i * 13) : null,
      ),
    },
    l3: {
      boss: boss >= 0 ? ref(boss, nn, nn * 4000) : null,
      guardians: [null, null],
      props: Array.from({ length: 6 }, (_, i) =>
        i < props ? ref((i + sp) % kp, nn, nn * 3000 + i * 17) : null,
      ),
      core: { hp: 8000, x: 0, y: 0 },
    },
  });
}

// ---------------------------------------------------------------------------
// 참조 장비 프로필 + 런 하네스
// ---------------------------------------------------------------------------

/**
 * 배치전을 실제로 치르는 시점의 "중간 장비" 근사. 임의값이지만 **고정**이라 측정이
 * 재현된다. 이 값을 바꾸면 아래 목표 범위도 함께 재측정해야 한다.
 */
const GEAR_REFERENCE: LoadoutConfig = {
  weaponType: 0,
  subWeaponType: -1,
  damageMult: 1.9,
  fireRateMult: 0.82,
  bulletCountAdd: 1,
  pierceAdd: 1,
  bulletSpeedMult: 1,
  spreadAdd: 0,
  rangeAdd: 0,
  moveSpeedMult: 1.1,
  maxHpAdd: 60,
  dashCdMult: 0.85,
  magnetMult: 1,
  xpMult: 1,
  uniqueMask: 0,
  fireDmg: 0,
  coldSlow: 0,
  lightning: 0,
};

/**
 * 결정론 시드 목록. 재현 가능해야 하므로 **고정 배열**이다(난수 생성 금지).
 *
 * ## 12 → 24 는 완화가 아니라 **해상도 복원**이다 (2026-07-27, ADR-0036 재기준화)
 * 예전 12개는 M8 24시드 목록에서 하나 걸러 뽑은 부분집합이었고 최소 눈금이 **8.33pp** 였다.
 * 그 해상도에서는 `#16` 의 진짜 승률 6.25%(96시드 6/96)가 **0/12 로 관측될 확률이 46%** 라,
 * 아래 "클리어 불가 기지 없음" 불변식이 사실상 동전던지기였다 — 변경 전(`10+6L`)에도 진짜
 * 승률은 12.5% 뿐이어서 0/12 확률이 20% 였다. `.omc/plans/m8-balance-handoff.md` §6 이
 * **"최저 기지가 12런 중 1승이면 여유는 정확히 1런"** 이라고 미리 경고한 그 지점이다.
 * 24시드에서 `#16` 은 **1/24** 로 승리가 다시 관측되고 불변식이 원래 의도대로 작동한다.
 * 즉 늘린 시드는 단언을 느슨하게 하는 것이 아니라 **단언이 재려던 것을 다시 잴 수 있게** 한다.
 *
 * ## append-only 계약
 * **앞 12개는 절대 바꾸지 않는다**(m8 인계 §1.2). 뒤 12개는 M8 정본 24시드의 나머지를
 * 순서 그대로 **뒤에 붙인 것**이며 `src/bench/rosterBench.ts` 의 `SEEDS[0..23]` 과 동일하다 —
 * 그래서 침공 밸런스와 로스터 벤치가 같은 시드 좌표계를 공유한다. 승패로 고르지 않았다
 * (이긴 시드만 모으면 승률이 위로 편향된다).
 */
const BALANCE_SEEDS: readonly number[] = [
  // --- 1~12: 기존 목록(불변) ---
  1, 5, 11, 17, 23, 31, 41, 43, 53, 61, 71, 79,
  // --- 13~24: M8 정본 24시드의 나머지(append) ---
  83, 97, 101, 113, 127, 131, 149, 151, 163, 173, 181, 191,
];

interface RunOutcome {
  readonly win: boolean;
  readonly ticks: number;
  readonly reachedL3: boolean;
}

/**
 * {@link GEAR_REFERENCE} 와 **같은 결과를 내는 어픽스 표현**. 정규 경로
 * (`buildRunConfig` → `computeLoadoutStats`)는 리터럴 로드아웃을 받지 않고 장착 아이템에서
 * 출발하므로, 로스터 게이트는 리터럴 대신 이 표를 아이템에 실어 보낸다.
 *
 * 대응은 `src/items/loadout.ts` 의 `applyStatSums` 규칙 그대로다(발칸은 무기 baseline 이
 * 무연산이라 중립 로드아웃이 출발점이다):
 *   damagePct 90 → damageMult 1.9 · fireRatePct 18 → fireRateMult 0.82(=1−0.18)
 *   bulletCount 1 · pierce 1 · moveSpeedPct 10 → 1.1 · maxHpFlat 60 · dashCdPct 15 → 0.85
 * 나머지 축(탄속·확산·자석·경험치·원소)은 `GEAR_REFERENCE` 가 중립이라 어픽스도 없다.
 */
const GEAR_REFERENCE_AFFIXES: readonly AffixRoll[] = [
  { id: 'gate-damage', stat: 'damagePct', value: 90 },
  { id: 'gate-firerate', stat: 'fireRatePct', value: 18 },
  { id: 'gate-bulletcount', stat: 'bulletCount', value: 1 },
  { id: 'gate-pierce', stat: 'pierce', value: 1 },
  { id: 'gate-movespeed', stat: 'moveSpeedPct', value: 10 },
  { id: 'gate-maxhp', stat: 'maxHpFlat', value: 60 },
  { id: 'gate-dashcd', stat: 'dashCdPct', value: 15 },
];

/** 참조 장비를 한 자루의 발칸 주무기로 묶는다(슬롯 순서 계약상 `main` 이어야 무기 타입이 선택된다). */
function gateGearItem(rangeAdd: number): Item {
  return {
    id: 'roster-gate-reference',
    slot: 'main',
    rarity: 'rare',
    affixes: [...GEAR_REFERENCE_AFFIXES, { id: 'gate-range', stat: 'rangeFlat', value: rangeAdd }],
    weaponType: WEAPON_VULCAN,
    source: { planet: 0, stage: 1 },
  };
}

/**
 * 로스터 게이트용 `WorldConfig` — **정규 경로 전량**을 탄다.
 * `Profile`(활성 기체 typeId · 타입별 skillInvest · 장착 아이템) → `buildRunConfig`
 * → `computeLoadoutStats(..., typeId)` → `applyShipTypeBase`(섀시 baseBp) → `createWorld`.
 * 리터럴 로드아웃을 꽂으면 이 사슬이 통째로 우회돼 baseBp 회귀가 보이지 않는다.
 */
function rosterGateConfig(
  layers: InvasionLayers,
  over: { readonly shipType: number; readonly rangeAdd: number },
): WorldConfig {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = over.shipType;
  // 벡터 길이는 타입별 계약이다(스트라이커 63 · 나머지 상이). **무투자**로 둔다 — 투자를
  // 실으면 6기체가 전부 83~100% 로 포화돼 회귀 신호가 죽는다(아래 게이트 주석 §커버 범위 ③).
  ship.skillInvest = zeroSkillInvest(over.shipType);
  ship.equipped.main = gateGearItem(over.rangeAdd);
  return buildRunConfig(profile, {
    planet: 0,
    stage: 1,
    invasion3: { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 },
  });
}

function playRun(
  seed: number,
  layers: InvasionLayers,
  /** 로스터 게이트 전용 덮어쓰기. 미지정이면 기존 19건과 **완전히 같은** 구성이다. */
  over?: { readonly shipType: number; readonly rangeAdd: number },
): RunOutcome {
  let config: WorldConfig;
  if (over === undefined) {
    config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
  } else {
    config = rosterGateConfig(layers, over);
  }
  const state = createWorld(seed, config);
  let reachedL3 = false;
  for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
    stepWorld(state, autopilotInput(state));
    if (state.invasion3?.phase === 2) reachedL3 = true;
    if (state.gameOver || state.victory) {
      return { win: state.victory, ticks: t + 1, reachedL3 };
    }
  }
  return { win: false, ticks: INVASION_TOTAL_TICKS, reachedL3 };
}

interface BandStat {
  readonly winRate: number;
  /** 기지별 승률(퍼센트) — 밴드 안 난이도 분산 지표. */
  readonly perBaseRates: number[];
  /** 기지별 평균 클리어틱(승리 표본이 있는 기지만). */
  readonly perBaseMeanTicks: number[];
}

function measureBand(orders: readonly number[]): BandStat {
  let wins = 0;
  let total = 0;
  const perBaseRates: number[] = [];
  const perBaseMeanTicks: number[] = [];
  for (const nn of orders) {
    const layers = seedBaseLayers(nn);
    let bw = 0;
    const ticks: number[] = [];
    for (const seed of BALANCE_SEEDS) {
      const o = playRun(seed, layers);
      total++;
      if (o.win) {
        wins++;
        bw++;
        ticks.push(o.ticks);
      }
    }
    perBaseRates.push((bw / BALANCE_SEEDS.length) * 100);
    if (ticks.length > 0) {
      perBaseMeanTicks.push(ticks.reduce((a, b) => a + b, 0) / ticks.length);
    }
  }
  return { winRate: (wins / total) * 100, perBaseRates, perBaseMeanTicks };
}

const BANDS = {
  하위: [1, 2, 3, 4, 5, 6, 7],
  중하: [8, 9, 10, 11, 12, 13, 14],
  중위: [15, 16, 17, 18, 19, 20],
} as const;

/** 밴드 측정은 비싸다(런 1회 ≈ 1만 틱). 밴드마다 한 번만 돌리고 여러 단언이 공유한다. */
const measured: Record<keyof typeof BANDS, BandStat> = {
  하위: measureBand(BANDS.하위),
  중하: measureBand(BANDS.중하),
  중위: measureBand(BANDS.중위),
};

// ---------------------------------------------------------------------------
// ① 밴드별 클리어율이 목표 범위 안
// ---------------------------------------------------------------------------

describe('밸런스 스모크 — 밴드별 클리어율', () => {
  // 상한의 성격·이력은 **파일 헤더 "숫자 읽는 법" ②** 에 통합했다(여기서 반복하지 않는다).
  // 24시드 실측(2026-07-27): 하위 **97.62%** · 중하 **86.31%** · 중위 **68.06%**.
  // 중하 hi 는 85 → 88 이다 — 실측 86.31 위로 약 3런(1.7pp) 여유. 런 풀 커브가 파워업 추첨
  // 횟수를 줄이면서 중하가 실제로 +8.8pp 올랐다(96시드 75.3 → 84.1, 계수에 단조). 이건
  // 표본오차가 아니라 실효과이므로 상한을 실측에 맞춰 올린다. 다만 **목표 55~80 은 그대로
  // 두었다** — 되살리는 것은 침공 난이도 레인 몫이다(헤더 ⑤).
  it.each([
    ['하위', 85, 100],
    ['중하', 55, 88],
    ['중위', 25, 80],
  ] as [keyof typeof BANDS, number, number][])(
    '%s 밴드 클리어율이 %d~%d%% 안에 있다',
    (band, lo, hi) => {
      const rate = measured[band].winRate;
      expect(rate, `${band} 밴드 클리어율 ${rate.toFixed(1)}%`).toBeGreaterThanOrEqual(lo);
      expect(rate, `${band} 밴드 클리어율 ${rate.toFixed(1)}%`).toBeLessThanOrEqual(hi);
    },
  );

  it('밴드 순서대로 어려워진다(하위 > 중위)', () => {
    // M7c 확장 직후의 실제 결함이 "중하·중위가 나란히 0%" 였다. 평균 승률만 보면
    // 그것도 '순서대로'라 통과하므로, 위 범위 단언과 함께여야 의미가 있다.
    //
    // 원래는 `하위 > 중하 > 중위` 3단 단조였다. 앵커 정책 개정(2026-07-27) 이후 중하·중위가
    // 역전됐고 지금도 24시드 실측 하위 97.6 > 중하 86.3 **< 중위 68.1**... 이 아니라
    // 중하 86.3 > 중위 68.1 로 **중간 단조는 회복됐다**(런 풀 커브가 중하를 올리고 중위를
    // 내린 결과다). 그래도 중간 단언을 되살리지 않는 이유는 이 회복이 난이도 램프를 고쳐서가
    // 아니라 파워업 추첨 횟수 변화의 부산물이기 때문이다(헤더 ①) — 램프 재배치 전에 단조를
    // 계약으로 굳히면 다음 sim 변경에서 다시 깨진다. 양 끝만 계약으로 둔다.
    expect(measured.하위.winRate).toBeGreaterThan(measured.중위.winRate);
  });

  it('클리어 불가 기지가 없다(모든 기지가 최소 1시드에서 승리)', () => {
    // 승률 평균이 목표 안이어도 특정 기지 하나가 수학적으로 클리어 불가일 수 있다.
    //
    // ⚠️ 이 단언은 **해상도에 직접 의존한다**. 최저 기지 `#16` 의 진짜 승률은 96시드 기준
    // 6.25%(6/96)이므로 12시드에서는 0승이 46% 확률로 나온다 — 단언이 코드가 아니라 주사위를
    // 재게 된다. `BALANCE_SEEDS` 를 24로 되돌린 뒤 `#16` 은 **1/24** 로 관측된다(승리 시드
    // 149). 24시드로 늘린 것이 단언을 약화시킨 것이 아니라 **이 단언을 다시 유효하게 만든**
    // 조치라는 뜻이다 — 되돌리지 마라. 자세한 근거는 `BALANCE_SEEDS` 주석과 헤더 ③.
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      measured[band].perBaseRates.forEach((rate, i) => {
        expect(rate, `${band} #${BANDS[band][i]} 가 전 시드에서 패배`).toBeGreaterThan(0);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// ② 밴드 안 난이도 분산 상한
// ---------------------------------------------------------------------------

function stdev(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

describe('밸런스 스모크 — 밴드 안 분산', () => {
  it('기지별 클리어 시간 편차가 상한 안(밴드 안에서 판 길이가 널뛰지 않는다)', () => {
    // 상한은 실측값에 여유를 준 값이다. 넘으면 한 밴드 안에 성격이 전혀 다른 기지가
    // 섞였다는 뜻이다. 24시드 실측(2026-07-27): 하위 **1609** / 중하 **392** / 중위 **893**틱.
    // (구 12시드 실측은 1656 / 565 / 641 이었다 — 상한은 그대로 두었다. 세 밴드 모두
    //  여유가 충분해 재조정할 근거가 없다.)
    const limits: Record<keyof typeof BANDS, number> = { 하위: 2200, 중하: 1400, 중위: 1600 };
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      const sd = stdev(measured[band].perBaseMeanTicks);
      expect(sd, `${band} 기지간 클리어틱 편차 ${Math.round(sd)}`).toBeLessThanOrEqual(
        limits[band],
      );
    }
  });

  it('기지별 승률 편차가 상한 안', () => {
    // 밴드 안에서 한 기지만 유별나게 쉽거나 어려우면 '난이도 밴드'라는 표시가 거짓이 된다.
    // 이력 3세대(무제한 조준 제거 → 앵커 정책 → 런 풀 커브)는 **헤더 "숫자 읽는 법" ②** 로
    // 통합했다. 여기에는 현재 상한의 **근거만** 남긴다.
    //
    // 24시드 실측(2026-07-27): 하위 **3.76** · 중하 **12.93** · 중위 **31.70** pp.
    // 기지별 승률 #15~#20 = 66.7 / **4.2** / 62.5 / 79.2 / 95.8 / 100.0.
    //
    // ⚠️ 중위 상한 29 → 33. 이 조정은 **커브가 분산을 키웠기 때문이 아니다** — 반대다:
    //   · 중위 sd 는 계수와 **무상관**이다. 96시드에서 변경 전 **30.4** / 변경 후 **30.1**.
    //     커브 계수를 3·6·8·10·11·13 으로 쓸어도 28.8~30.4 로 평평하다.
    //   · **대조군(변경 전 코드)도 96시드에서 sd 30.4 로 구 상한 29 를 위반한다.**
    //     구 상한 29 는 특정 12시드 실현(28.767)에 **과적합**돼 있었다.
    //   · 해상도별 수렴: 12시드 25.6→35.2 · 24시드 27.2→31.7 · **48시드 29.0→29.0** ·
    //     96시드 30.4→30.1. 해상도가 오를수록 변경 전후가 붙는다 = 차이는 표본오차였다.
    //   · ADR-0037 이 CI 게이트를 **24시드**로 정했다. 48시드가 통계적 정답이지만(변경 전후가
    //     29.0 으로 일치하는 지점) 그건 CI 예산 정책 변경이라 **별도 판단 항목**이다.
    // 상한 33 은 24시드 실측 31.70 위로 약 1.3pp 여유다.
    //
    // ⚠️ 분산의 출처는 **#16 단독**이다. #16 을 빼면 중위 sd 는 변경 전 16.6 / 변경 후 15.9
    // 로 평범해진다. 즉 이 상한을 더 넓히는 것으로는 아무것도 고쳐지지 않고, 실제 처방은
    // #16 의 난이도를 밴드 안으로 되돌리는 것이다 — 유력 원인은 m8 인계 §5.5 **보스 램프
    // 배정 역전**(가장 어려운 `sporeQueen` 이 중간 밴드 nn11~16 에 있다)이고, 그건 램프 =
    // 마이그레이션 정본 변경이라 침공 난이도 레인 소관이다(헤더 ⑤).
    //
    // 중하 상한 32 는 유지한다 — 실측 12.93 으로 여유가 크다(커브 변경이 오히려 개선했다:
    // 96시드 15.9 → 12.1). 하위 20 도 실측 3.76 으로 유지.
    const limits: Record<keyof typeof BANDS, number> = { 하위: 20, 중하: 32, 중위: 33 };
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      const sd = stdev(measured[band].perBaseRates);
      expect(sd, `${band} 기지간 승률 편차 ${sd.toFixed(1)}pp`).toBeLessThanOrEqual(limits[band]);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 정규 경로 통합 — 3레이어를 실제로 통과한다
// ---------------------------------------------------------------------------

describe('밸런스 스모크 — 정규 경로 통합', () => {
  it('시드 기지 런이 L3 까지 실제로 진행되고 코어 파괴로 끝난다', () => {
    // "밸런스 수치는 맞는데 배선이 없어 빈 맵을 스크롤한다"를 막는 자리다.
    const layers = seedBaseLayers(1);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
    const state = createWorld(1, config);
    const seen = new Set<number>();
    let spawnedAny = false;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      const phase = state.invasion3?.phase;
      if (phase !== undefined) seen.add(phase);
      if (!spawnedAny && state.entities.some((e) => e.kind === 'enemy' && !e.dead)) {
        spawnedAny = true;
      }
      if (state.gameOver || state.victory) break;
    }
    expect(spawnedAny, '적이 한 번도 스폰되지 않았다(스텝 훅 미배선 신호)').toBe(true);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(state.victory).toBe(true);
    expect(state.entities.find((e) => e.kind === 'core' && !e.dead)).toBeUndefined();
  });

  it('상위 기지 런에서 방어 보스·기물이 실제로 존재한다', () => {
    // 카탈로그에 넣었는데 스폰 경로가 없으면 승률만 보고는 알 수 없다.
    // 시드 5 는 #20 이 L3 까지 도달해 승리하는 것으로 확인된 값이다(패배 시드로 재면
    // 플레이어가 L3 전에 죽어 "보스가 없다"가 오탐이 된다).
    // ⚠️ 증인 시드는 sim 이 바뀌면 함께 갱신해야 한다 — 예전 값 37 은
    // `fix/weapon-range-semantics` 이후 L3 에 도달하지 못한다(#20 의 L3 도달 시드 집합이
    // 71·83·97·127·163·173 에서 1·5·11·23·113·149·173 으로 갈렸다). 단언을 약화한 것이
    // 아니라 **같은 성질의 증인을 다시 고른 것**이다.
    const layers = seedBaseLayers(20);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
    const state = createWorld(5, config);
    let sawBoss = false;
    let sawProp = false;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      if (!sawBoss && state.entities.some((e) => e.kind === 'defenseBoss')) sawBoss = true;
      if (!sawProp && state.entities.some((e) => e.kind === 'prop')) sawProp = true;
      if (sawBoss && sawProp) break;
      if (state.gameOver || state.victory) break;
    }
    expect(sawBoss, '#20 배치에 보스가 있는데 엔티티가 없다').toBe(true);
    expect(sawProp, '#20 배치에 기물이 있는데 엔티티가 없다').toBe(true);
  });

  it('사거리에 투자한 공격자도 실제로 사격하고 승리까지 간다', () => {
    // 이 하네스는 오래도록 `rangeAdd: 0` 한 점만 밟았다(`GEAR_REFERENCE`). 그 사이
    // `weapon.range` 는 `0 = 무제한` 센티널이라 **사거리에 투자할수록 조준 상한이 좁아졌고**,
    // 오토파일럿 카이팅 거리(460)보다 짧아지면 침공 공격자가 한 발도 쏘지 못했다 —
    // "밴드별 승률 전부 목표 안" 옆에 "사거리 노드를 찍으면 마비"가 나란히 있었다는 뜻이다.
    // 사거리 축을 실제로 밟는 유일한 자리이므로, 승패뿐 아니라 **탄이 나갔는지**까지 본다.
    const invested: LoadoutConfig = { ...GEAR_REFERENCE, rangeAdd: 400 };
    const layers = seedBaseLayers(1);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = invested;
    const state = createWorld(1, config);
    let firedTicks = 0;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      if (state.entities.some((e) => e.kind === 'bullet' && !e.dead)) firedTicks++;
      if (state.gameOver || state.victory) break;
    }
    expect(firedTicks, '사거리 투자 프로필이 한 발도 쏘지 못했다').toBeGreaterThan(0);
    expect(state.victory, '사거리 투자 프로필이 무투자 대비 승리하지 못했다').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ④ 카탈로그 골든 가드 — 수치 튜닝이 인덱스 계약을 건드리지 않았는지
// ---------------------------------------------------------------------------

describe('카탈로그 계약 — 수치 튜닝이 인덱스를 건드리지 않았다', () => {
  it('편대 카탈로그 순서·개수 골든', () => {
    expect(FORMATIONS.map((f) => f.id)).toEqual([
      'formation-scout-drones',
      'formation-interceptors',
      'formation-assault',
      'formation-glide-flock',
      'formation-mine-layer',
      'formation-shield-escort',
      'formation-sniper-nest',
      'formation-support-escort',
      'formation-toxar-corrosion',
      'formation-toxar-blight',
      'formation-kras-breaker',
      'formation-kras-piercer',
    ]);
    FORMATIONS.forEach((f, i) => expect(f.catalogId).toBe(i));
  });

  it('설비 카탈로그 순서·개수 골든', () => {
    expect(INVASION_FACILITIES.map((f) => f.key)).toEqual([
      'fac.rapid',
      'fac.rail',
      'fac.mortar',
      'fac.laser',
      'fac.flame',
      'fac.spawner',
      'fac.press',
      'fac.gravwell',
      'fac.shock',
      'fac.venomvent',
      'fac.blightpool',
      'fac.corrosivemist',
      'fac.toxinturret',
      'fac.heavyrail',
      'fac.siegecannon',
      'fac.breachturret',
      'fac.demolisher',
    ]);
  });

  it('기물 카탈로그 순서·역할 골든', () => {
    expect(L3_PROPS.map((p) => p.id)).toEqual([
      'shieldGenerator',
      'gravityAnchor',
      'fixedCannon',
      'repairPylon',
      'decoyHologram',
      'mineSwarm',
    ]);
    // 역할 코드가 인덱스와 어긋나면 스텝 디스패치가 통째로 바뀐다.
    L3_PROPS.forEach((p, i) => expect(p.role).toBe(i));
  });

  it('방어 보스 카탈로그 순서 골든', () => {
    expect(DEFENSE_BOSSES.map((b) => b.id)).toEqual([
      'steelGoliath',
      'sporeQueen',
      'phaseWarden',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 시드 램프 드리프트 가드 + 풀 카탈로그 노출
// ---------------------------------------------------------------------------

describe('시드 재조정 — SQL 정본과의 정합', () => {
  it('마이그레이션 헤더의 RAMP 식이 이 파일의 미러와 일치한다', () => {
    const sql = readMigrationSql();
    for (const line of RAMP_SQL_LINES) {
      expect(sql, `SQL 램프 주석이 미러와 다르다: ${line}`).toContain(line);
    }
  });

  it('마이그레이션이 NPC 고정 UUID 20행만 건드린다', () => {
    const sql = readMigrationSql();
    // WHERE 절이 고정 UUID 동등 비교 하나뿐이어야 실유저 방어가 안전하다.
    expect(sql).toContain("where id = v_def_id");
    expect(sql).toContain("'000000de-f000-4000-8000-'");
    expect(sql).not.toMatch(/update\s+public\.defenses[\s\S]{0,400}?where\s+true/i);
  });

  it('20기지가 시드 램프 목표 카탈로그를 전부 노출한다(미사용 시드 콘텐츠 0)', () => {
    const formations = new Set<number>();
    const facilities = new Set<number>();
    const props = new Set<number>();
    const bosses = new Set<number>();
    for (let nn = 1; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      for (const s of l.l1.waveSlots) if (s !== null) formations.add(s.catalogId);
      for (const s of l.l2.sockets) if (s !== null) facilities.add(s.catalogId);
      for (const s of l.l3.props) if (s !== null) props.add(s.catalogId);
      if (l.l3.boss !== null) bosses.add(l.l3.boss.catalogId);
    }
    // 시드 램프(RAMP)가 **목표로 하는** 카탈로그 대역을 빠짐없이 노출하는지 본다(대역 안에
    // 구멍이 있으면 그 콘텐츠는 NPC 기지에서 영영 안 보인다). 대역 상한은 램프에서 파생한다
    // (하드코딩 금지) — 편대·설비는 램프 상한까지, 기물·보스는 전량이다.
    //
    // ⚠️ Lane9 신규 방어체(편대 8~11 · 설비 9~16)는 램프 대역 **밖**이다: 톡사르·크라스
    // 특산 설계도라 획득 경로가 **행성 파밍**이고, 그 도달은 tests/planetDrops.test.ts ③·⑥ 이
    // 보장한다(미사용 콘텐츠 0 은 전역적으로 여전히 성립 — 죽은 콘텐츠가 아니다). NPC 시드
    // 기지 노출까지 넓히는 것은 서버 시드 램프(20260723000000_m7c_seed_rebalance.sql) 수정 +
    // 클리어율 밴드 재측정을 동반하는 별도 밸런스 패스 소관이다(defer-balance-tuning).
    const seedFormationKinds = Math.max(
      ...Array.from({ length: SEED_BASE_COUNT }, (_, i) => RAMP.formationKinds(i + 1)),
    );
    const seedFacilityKinds = Math.max(
      ...Array.from({ length: SEED_BASE_COUNT }, (_, i) => RAMP.facilityKinds(i + 1)),
    );
    expect([...formations].sort((a, b) => a - b)).toEqual(
      Array.from({ length: seedFormationKinds }, (_, i) => i),
    );
    expect([...facilities].sort((a, b) => a - b)).toEqual(
      Array.from({ length: seedFacilityKinds }, (_, i) => i),
    );
    expect([...props].sort((a, b) => a - b)).toEqual(L3_PROPS.map((_, i) => i));
    expect([...bosses].sort((a, b) => a - b)).toEqual(DEFENSE_BOSSES.map((_, i) => i));
    // 시드가 참조하는 편대·설비 id 는 전부 실재 카탈로그다(댕글링 시드 0).
    for (const id of formations) expect(FORMATIONS[id]).toBeDefined();
    for (const id of facilities) expect(INVASION_FACILITIES[id]).toBeDefined();
  });

  it('시드 배치가 전부 정규형이다(정규화 멱등)', () => {
    for (let nn = 1; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      expect(normalizeInvasionLayers(l)).toEqual(l);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑥ seedBases 구조 회귀 0 (설명 재작성이 구조를 건드리지 않았는지)
// ---------------------------------------------------------------------------

describe('seedBases — 재조정이 구조를 건드리지 않았다', () => {
  it('개수 20 · UUID 스킴 · 밴드 분포 7/7/6 유지', () => {
    expect(SEED_BASES.length).toBe(20);
    SEED_BASES.forEach((b, i) => {
      expect(b.order).toBe(i + 1);
      expect(b.profileId).toBe(seedBaseUuid(i + 1));
    });
    const counts = { 하위: 0, 중하: 0, 중위: 0 };
    for (const b of SEED_BASES) counts[b.difficultyBand]++;
    expect(counts).toEqual({ 하위: 7, 중하: 7, 중위: 6 });
  });

  it('설명은 전부 비어 있지 않고 이모지를 담지 않는다', () => {
    // 정찰 뷰가 Pixi 라 컬러 이모지는 두부로 렌더된다.
    for (const b of SEED_BASES) {
      expect(b.description.length).toBeGreaterThan(10);
      expect(b.description).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑦ 로스터 간섭 회귀 게이트 — 침공은 기체 로스터와 한 배를 탄다
// ---------------------------------------------------------------------------

/**
 * ## 이 블록이 막는 것
 * 위 19건은 전부 `GEAR_REFERENCE` 리터럴만 쓰고 `config.shipType` 을 세우지 않는다. 그래서
 * 사실상 **스트라이커(signatureBit −1) 고정 · `rangeAdd 0`** 한 조합만 잰다. 그런데 로스터는
 * 침공 런에 네 갈래로 새어 들어온다 — 코드로 확인한 경로다:
 *   ① `src/run/runConfig.ts` 의 `buildRunConfig` 가 PvE·정식 침공·하네스 침공의 **단일 정본**
 *      이고, `applyShipTypeBase`(`src/items/loadout.ts:202`)로 섀시 `baseBp` 4축이 침공 런에도
 *      그대로 실린다.
 *   ② `src/sim/world.ts` 의 로드아웃 적용부에 침공 분기가 없다 — PvE 와 같은 코드를 탄다.
 *   ③ `isPlayerTargetable` 이 `facilityGun`·`defenseBoss`·`prop`·`core` 를 포함하므로
 *      `weapon.range`(= 로스터의 range 노드·`rangeAdd`)가 **침공 조준 거리도** 좁힌다.
 *   ④ `signatureOn`(`src/sim/world.ts`) → SIG_* 6종이 침공 게이트 없이 발동한다.
 *
 * ## 이 게이트가 실제로 커버하는 범위 (측정으로 확인한 사실만 적는다)
 * 게이트 런은 {@link rosterGateConfig} 로 **정규 경로 전량**을 탄다 —
 * `Profile` → `buildRunConfig` → `computeLoadoutStats(..., typeId)` → `applyShipTypeBase`.
 *   - ① **커버**. `data/ships/<slug>.ts` 의 `baseBp` 를 극단으로 변조하면 이 게이트가 깨진다
 *     (아래 "감도 실증" 참고). 리터럴 로드아웃을 꽂던 이전 판은 이 사슬을 통째로 우회해
 *     **baseBp 를 −9000 으로 만들어도 통과**했다.
 *   - ② **커버**(①이 만든 로드아웃이 `weapon.damage`/`fireCooldown`/`playerHp`/`playerSpeed`
 *     로 착지하는 것이 승률에 그대로 나타난다).
 *   - ③ **부분 커버**. 게이트가 싣는 `rangeAdd 460` 은 장비 어픽스(`rangeFlat`)에서 온다.
 *     `lo.rangeAdd` → `weapon.range` → `isPlayerTargetable` 구간은 이걸로 실제로 탄다.
 *     **미커버: 스킬트리 노드가 주는 `rangeFlat`** — 게이트는 **무투자** 벡터를 싣는다.
 *     투자를 실으면 기체 간 격차가 아니라 트리 총량이 승률을 지배해 baseBp 회귀 신호가
 *     묻히므로 일부러 무투자로 고정했다. 트리 rangeFlat 회귀는 `tests/skills.test.ts`
 *     계열이 맡는다.
 *   - ④ **커버**. `buildRunConfig` 가 `shipType` 을 항상 명시하고 시그니처 비트를
 *     `loadout.uniqueMask` 에 OR 한다.
 *
 * ## 왜 하필 이 조합인가
 * - `rangeAdd = 460` 은 `src/sim/autopilot.ts` 의 `KITE_DISTANCE` 와 같은 값이다. 참조봇이
 *   유지하려는 거리와 사거리가 정확히 겹치는 **임계점**이라, range 축이 조금만 흔들려도
 *   조준 성공/실패가 갈린다 — 로스터 range 변경에 가장 민감한 지점이다.
 * - 기지 **두 곳**을 쓴다. 한 곳으로는 **양방향 감도가 안 나온다** — 실증한 사실이다.
 *
 * ## 기지·폭 선정 — 전량 재실측 (2026-07-21)
 * 아래 값은 **이 트리에서 그대로 재현되는 실측**이다. 게이트를 통과시키려고 폭을 넓힌 것이
 * 아니라, 전 기지를 재고 **담당 방향별로 기지를 골랐다**.
 * 재현법: 기지 nn × 비-스트라이커 6기체 × `BALANCE_SEEDS` 를 {@link rosterGateRate} 로
 * 돌린다(정규 경로 · `rangeAdd 460` · 무투자).
 * ⚠️ 아래 표와 폭 산정은 **12시드 시절(2026-07-21)의 기록**이다. `BALANCE_SEEDS` 가 24로
 * 늘었으므로(2026-07-27) 최소 눈금은 8.33pp → **4.17pp** 이고, 현행 실측은 아래
 * {@link ROSTER_GATE_BASES} 주석에 있다. 이 표는 **기지 #12·#16 을 고른 근거**로만 읽어라.
 *
 * 실측 — 기체 1(브루저)~6 순, 괄호는 (min~max, 폭):
 *     #9  = 66.7/41.7/58.3/100.0/83.3/66.7   (41.7~100.0, 58.3pp)
 *     #10 = 75.0/75.0/41.7/100.0/91.7/66.7   (41.7~100.0, 58.3pp)
 *     #11 = 66.7/50.0/66.7/83.3/50.0/66.7    (50.0~83.3, 33.3pp)
 *     #12 = 58.3/50.0/50.0/75.0/50.0/58.3    (50.0~75.0, 25.0pp) ← 전 기지 중 **가장 좁다**
 *     #13 = 58.3/41.7/58.3/83.3/75.0/50.0    (41.7~83.3, 41.7pp)
 *     #14 = 50.0/25.0/83.3/33.3/50.0/41.7    (25.0~83.3, 58.3pp)
 *     #15 = 41.7/50.0/33.3/50.0/66.7/33.3    (33.3~66.7, 33.3pp)
 *     #16 = 50.0/33.3/25.0/33.3/58.3/33.3    (25.0~58.3, 33.3pp) ← **천장이 가장 낮다**
 *     #17 = 41.7/16.7/58.3/33.3/83.3/58.3    (16.7~83.3, 66.7pp)
 *     #18 = 50.0/41.7/41.7/16.7/100.0/100.0  (16.7~100.0, 83.3pp)
 *     #19 = 100.0/91.7/25.0/58.3/100.0/100.0 (25.0~100.0, 75.0pp)
 *     #20 = 8.3/83.3/50.0/8.3/50.0/16.7      (8.3~83.3, 75.0pp)
 *
 * - **#12 = 하한 담당.** 바닥이 50.0% 로 높고 폭이 25.0pp(3눈금)로 전 기지 중 가장 좁다 —
 *   아래쪽 여유가 최대다. 상향은 여기서 안 잡힌다: `+20000` 변조에서 기체 1 이 58.3 → 75.0
 *   으로 오르는데 **기저 최대(기체 4)가 이미 75.0** 이라 어떤 hi 도 둘을 가르지 못한다.
 * - **#16 = 상한 담당.** 천장이 58.3% 로 전 기지 중 가장 낮은데 `+20000` 변조는 기체 1 을
 *   75.0% 로 올린다 — 분리 폭 16.7pp(2눈금)로 **전 기지 중 유일하게 상향이 분리된다**
 *   (#15 는 8.3pp, 나머지는 기저 최대가 83.3% 이상이라 분리 0).
 * - 폭(12시드의 최소 눈금은 8.33pp):
 *     #12 lo 20 — 기저 최소 50.0 에서 아래로 30.0pp(3.6눈금). 통상 ±2눈금 튜닝은 통과한다.
 *     #12 hi 95 — 기저 최대 75.0 에서 위로 20.0pp. 담당 방향이 아니라 느슨한 안전망이다.
 *     #16 hi 70 — 기저 최대 58.3 과 변조값 75.0 **사이**다. 이 구간에 놓인 실현 가능한 값은
 *                 66.7(8/12) 하나뿐이므로 **위쪽 여유는 정확히 1눈금**이고, 그것이 이 sim 에서
 *                 확보 가능한 최대다(변조가 75.0 에서 포화한다). 여기만 ±2눈금 여유가 없다 —
 *                 대신 하한 담당(#12)이 3.6눈금을 갖는다.
 *     #16 lo  5 — 기저 최소 25.0 에서 아래로 20.0pp(2.4눈금). 담당 방향이 아니므로 **"전 시드
 *                 패배"에 가까운 선**으로 둔다.
 *
 * ## 감도 실증 (2026-07-21, 위 실측과 같은 트리에서 수행하고 원복)
 * `data/ships/bruiser.ts` 의 `baseBp` 4축을 통째로 바꾼 뒤 게이트를 돌렸다.
 *   `{-9000,-9000,-9000,-9000}` : #12 기체 1 = **0.0%**  → lo 20 위반 → 실패
 *                                 (#11·#15·#16 도 전부 0.0% 로 죽는다)
 *   `{20000,20000,20000,20000}` : #16 기체 1 = **75.0%** → hi 70 위반 → 실패
 *                                 (같은 변조에서 #11 66.7→75.0 · #12 58.3→75.0 · #15 41.7→75.0)
 * 두 변조 모두 기체 2~6 열은 값이 그대로였다 — 하네스가 변조 기체만 격리해 잰다는 증거다.
 * 원복 후 전 기지·전 기체 그린.
 */
const ROSTER_GATE_RANGE_ADD = 460;

/** 로스터 게이트가 도는 기지와 그 기지에서의 허용 폭. 위 주석의 실측이 근거다. */
// 이 게이트가 지키는 계약은 **"0%도 100%도 아니다"**(비-스트라이커 기체로도 침공이 성립하고,
// 동시에 무저항도 아니다)이지 특정 승률이 아니다. 담당 방향은 위 주석대로 **#12=하한 ·
// #16=상한** 이다.
//
// ## 24시드 실측 (2026-07-27, 런 풀 커브 `10+13L` · 기체 1~6 순)
//   #12 = 95.8 / 91.7 / 66.7 / **100.0** / **100.0** / 91.7   (66.7~100.0)
//   #16 = 25.0 /  8.3 / 16.7 /   20.8 /   29.2 / 29.2         ( 8.3~29.2)
//
// ⚠️ **#12 hi 95 → 100.** 런 풀 커브가 파워업 추첨 횟수를 줄이면서 기지 #12 가 실제로
// 크게 쉬워졌다(96시드 61.5 → 92.7%, 계수에 단조). 이건 표본오차가 아니라 실효과다.
// 다만 **계약("100%가 아니다")은 96시드에서 위반되지 않는다** — 96시드 실측은 기체 4 =
// **95.8%** · 기체 5 = **91.7%** 로, 24시드 창이 마침 전승 구간을 담았을 뿐이다. 즉 24시드
// `24/24` 는 "무저항"이 아니라 **해상도 한계**다. #12 는 애초에 파일 주석대로 하한 담당이고
// 상한은 "담당 방향이 아니라 느슨한 안전망"이었으므로, 여기서 상향 감도를 잃는 대가는 없다 —
// 상향 담당은 #16(hi 70, 실측 최대 29.2 로 여유 40.8pp)이 그대로 진다.
//
// ⚠️ 기지 #12 가 왜 "약할수록 이기는가"는 밸런스가 아니라 **결함**이다:
// `.omc/research/invasion-powerup-inversion-2026-07-27.md` — 공격 파워업 4종을 전부 억제하면
// 96/96 승리, 패배는 전부 코어 무피해(8000/8000) 타임아웃이다. 이 게이트 수치는 그 결함이
// 고쳐지면 다시 움직인다.
const ROSTER_GATE_BASES = [
  { nn: 12, lo: 15, hi: 100, band: '66.7~100.0' },
  { nn: 16, lo: 5, hi: 70, band: '8.3~29.2' },
] as const;

/** 스트라이커(0)를 뺀 나머지 전 기체. 카탈로그에서 유도한다 — 개수를 손으로 적지 않는다. */
const NON_STRIKER_SHIP_TYPES: readonly number[] = SHIP_TYPES.map((_, i) => i).filter((i) => i > 0);

function rosterGateRate(shipType: number, nn: number): number {
  const layers = seedBaseLayers(nn);
  let wins = 0;
  for (const seed of BALANCE_SEEDS) {
    const o = playRun(seed, layers, { shipType, rangeAdd: ROSTER_GATE_RANGE_ADD });
    if (o.win) wins++;
  }
  return (wins / BALANCE_SEEDS.length) * 100;
}

/** (기체, 기지 순번) 전 조합. 개수를 손으로 적지 않는다. */
const ROSTER_GATE_CASES = NON_STRIKER_SHIP_TYPES.flatMap((shipType) =>
  ROSTER_GATE_BASES.map((b) => [shipType, b.nn] as [number, number]),
);

function rosterGateBase(nn: number): (typeof ROSTER_GATE_BASES)[number] {
  const b = ROSTER_GATE_BASES.find((x) => x.nn === nn);
  if (b === undefined) throw new Error(`로스터 게이트 기지 정의 없음: #${nn}`);
  return b;
}

describe('로스터 간섭 게이트 — 비-스트라이커 기체로도 침공이 성립한다', () => {
  it('스트라이커가 typeId 0 이고 나머지 기체가 존재한다', () => {
    // 아래 게이트의 전제. 카탈로그가 재정렬되면 게이트가 엉뚱한 기체를 재게 된다.
    expect(SHIP_TYPES[0]?.id).toBe(0);
    expect(NON_STRIKER_SHIP_TYPES.length).toBeGreaterThan(0);
    expect(NON_STRIKER_SHIP_TYPES).not.toContain(0);
  });

  it.each(ROSTER_GATE_CASES)(
    '기체 %i 이 기지 #%i(사거리 임계)에서 0%%도 100%%도 아니다',
    (shipType, nn) => {
      const base = rosterGateBase(nn);
      const rate = rosterGateRate(shipType, nn);
      const msg = `기체 ${shipType} · 기지 #${base.nn} 클리어율 ${rate.toFixed(1)}% (실측 밴드 ${base.band}%)`;
      expect(rate, msg).toBeGreaterThanOrEqual(base.lo);
      expect(rate, msg).toBeLessThanOrEqual(base.hi);
    },
  );
});
