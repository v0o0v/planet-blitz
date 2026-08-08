/**
 * `autopilotInput` **거동 동결** 골든 (ADR-0049 §0-A 결정 B).
 *
 * ## 왜 이 파일이 있는가
 * 측정 전용 파일럿 프로파일을 신설하면서 두 파일럿이 조용히 갈리지 않도록 **입력 생성 로직을
 * 공유**하기로 했다(`prerequisites.md` §0-A). 공유는 곧 `autopilot.ts` 리팩터이고, 그 파일의
 * 출력 위에는 **벤치·회귀 골든 전부**가 산다 — `tests/fixtures/striker-prem8.json` ·
 * `encounter-baseline.json` · `scripts/deno-verify/fixtures.json` · `bench/**` 전부다.
 *
 * 그 골든들은 `pnpm test:sim` 으로만 돌고 7분 25초가 걸린다. 즉 **편집 중에는 아무도 갈림을
 * 알려 주지 않는다.** 이 파일이 그 자리를 메운다: 오토파일럿이 실제로 뱉는 **입력 프레임 열
 * 자체**를 비트 단위로 접어, 리팩터가 한 프레임이라도 바꾸면 기본 스위트에서 즉시 빨개진다.
 *
 * ## ⚠️ `tsc` 는 이 축을 못 잡는다
 * 이 저장소에는 **위치 인자를 지웠는데 타입이 우연히 맞아 `tsc` 를 통과한** 선례가 있다
 * (`skill-rebuild-commit2.md` 「구현하며 드러난 것」 1번 — `computeLoadoutStats` 의 가운데
 * 인자). "컴파일되니까 같다"는 근거가 아니다.
 *
 * ## ⚠️ 기대값을 다시 뜨지 마라
 * 아래 상수는 **리팩터 이전**(main `bed3cb8`)에서 뜬 값이다. 여기가 빨개졌다는 것은
 * "골든을 갱신할 때가 됐다"가 아니라 **오토파일럿 거동이 실제로 바뀌었다**는 뜻이고, 그것은
 * 결정 B 위반이다(기존 오토파일럿은 동결이 계약이다). 다시 뜬 골든으로 그 골든을 검사하면
 * 항진이다 — 같은 함정을 이 리포가 이미 두 번 적어 뒀다.
 *
 * ## 무엇을 접는가
 * 매 틱 `autopilotInput(state)` 가 낸 프레임의 5필드를 **float64 비트 그대로** 접는다
 * (`moveX`·`moveY`·`aim` 은 8바이트, `dash` 는 0/1, `special` 은 u32). 마지막에 **소요 틱 수**도
 * 접는다 — 런이 짧아지거나 길어지는 변화도 갈림으로 잡기 위해서다.
 *
 * `-0` 과 `0` 은 `setFloat64` 가 구분한다(의도적으로 더 엄격하다).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped, standardPerTree, standardStage, investVector } from '../src/bench/standardBuild.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const scratch = new DataView(new ArrayBuffer(8));

function foldF64(h: number, v: number): number {
  scratch.setFloat64(0, v);
  let out = h;
  for (let i = 0; i < 8; i++) out = Math.imul(out ^ scratch.getUint8(i), FNV_PRIME) >>> 0;
  return out;
}

function foldU32(h: number, v: number): number {
  let out = h;
  for (let i = 0; i < 4; i++) out = Math.imul(out ^ ((v >>> (i * 8)) & 0xff), FNV_PRIME) >>> 0;
  return out;
}

/** 행성 6종 전부(뱀서류·블록격파·레이싱·추격·수축·오염) — 모드 분기를 전수로 태운다. */
const PLANETS = [0, 1, 2, 3, 4, 5] as const;
/** 시드 3개. 장비 롤·웨이브 추첨이 갈리므로 서로 다른 분기 조합을 밟는다. */
const SEEDS = [1, 4242, 90210] as const;
/** 런당 최대 틱. 수천 틱이면 회피·전리품·카이팅·레벨업 프리즈가 전부 나온다. */
const MAX_TICKS = 3000;
const LEVEL = 40;

/**
 * 한 (행성, 시드) 런의 **입력 프레임 열 해시**. 결정론이므로 같은 입력이면 항상 같은 값이다.
 *
 * 기체는 행성·시드로 파생해 7종이 고루 섞이게 한다 — 무기 사거리가 갈리면 카이팅 분기의
 * 밟는 지점도 갈린다.
 */
function frameStreamHash(planet: number, seed: number, shipTypeId: number): number {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = shipTypeId;
  ship.level = LEVEL;
  ship.skillInvest = investVector(shipTypeId, standardPerTree(LEVEL));
  ship.equipped = standardEquipped(LEVEL, seed, planet);
  const config = buildRunConfig(profile, { planet, stage: standardStage(LEVEL) });

  const state = createWorld(seed, config);
  let h = FNV_OFFSET;
  let ticks = 0;
  for (let i = 0; i < MAX_TICKS; i++) {
    const f = autopilotInput(state);
    h = foldF64(h, f.moveX);
    h = foldF64(h, f.moveY);
    h = foldF64(h, f.aim);
    h = foldU32(h, f.dash ? 1 : 0);
    h = foldU32(h, f.special >>> 0);
    stepWorld(state, f);
    ticks++;
    if (state.victory || state.gameOver) break;
  }
  // 런 길이도 접는다 — 프레임이 같아도 런이 일찍 끝나면 그것도 갈림이다.
  return foldU32(h, ticks);
}

function keyOf(planet: number, seed: number): string {
  return `p${planet}s${seed}`;
}

/**
 * **리팩터 이전(main `bed3cb8`)에 실측한 값**. 위 ⚠️ 절을 읽지 않고 갱신하지 마라.
 */
/**
 * ## 재동결 이력 — **2026-08-07 (배치7, 210스킬 배선 완주 시점)**
 *
 * 이 표가 갈린 원인은 **두 가지이고 서로 다르다.** 재동결할 때 둘을 섞지 마라.
 *
 * ### ① 8건 — `d7445a4`(PR#329, 2026-08-06 사용자 승인 C-3)
 * 피격 피해 배율 변경이 오토파일럿의 회피 판단을 바꿨다. `git bisect` 로 확정됐고 **최소 네
 * 세션이 각자 다시 조사했다** — 다시 조사하지 마라(프로젝트 메모리 `sim-golden-pre-red`).
 * 그 8건은 배치7 **이전에 이미** 갈려 있었고, 배치7 이 그 값을 한 개도 안 건드렸다(실측:
 * 6ac0f78 과 배치7 tip 에서 각각 뜬 수신값 8건이 **전부 동일**).
 *
 * ### ② 1건(`p1s4242`) — 배치7 의 **브루저 BL1「응전 사출」**
 * 키의 기체는 `shipTypeId = (planet + seed % 7) % 7` 로 정해진다 — `p1s4242` 는
 * `(1 + 0) % 7 = 1` 이라 **브루저**다. 그리고 아래 `frameStreamHash` 는 `investVector` 로
 * **스킬을 실제로 투자**하므로 BL1 이 붙는다. BL1 은 *피격 틱에 반격 볼리를 자동 발사*하는
 * 스킬이라 오토파일럿이 보는 세계가 달라지고, 그래서 입력 열이 갈린다.
 *
 * ⭐ **배치7 의 발산이 BL1 하나로 일관된다** — deno 픽스처 13 시나리오 중에서도 갈린 것은
 * 브루저 2개뿐이었고(나머지 11개 바이트 동일, 무투자 런 포함), 여기서도 브루저 1건뿐이다.
 * 다른 6기체의 신규 배선 14종은 이 골든들이 투자하는 슬롯에 안 걸린다.
 *
 * ⚠️ **이 표를 "빨개졌으니 갱신" 으로 다시 뜨지 마라.** 이 파일 헤더가 적은 대로, 여기가
 * 빨간 것은 *"골든을 갱신할 때가 됐다"* 가 아니라 **오토파일럿 거동이 실제로 바뀌었다**는
 * 뜻이다. 갱신은 **그 변화의 원인을 이름으로 지목할 수 있을 때만** 한다 — 위 ①② 처럼.
 *
 * ## 재동결 이력 — **2026-08-07 (어픽스 재편, ADR-0049 · affixes.md ②)**
 *
 * ### 18건 **전부** — 슬롯별 어픽스 풀 도입
 * 이 골든은 sim 골든인데 아이템은 sim 밖이다. 그런데도 갈린 경로는 하나다:
 * `frameStreamHash` → `standardEquipped`(`src/bench/standardBuild.ts`) → **`rollItem`**.
 * 어픽스 풀이 전역 24종 균등에서 슬롯별 가중으로 바뀌자 표준 빌드의 장비 스탯이 바뀌었고,
 * 로드아웃이 바뀌니 오토파일럿이 보는 세계가 바뀌었다.
 *
 * ⭐ **건수가 그 진단의 증거다.** 배치7 의 BL1 은 브루저 한 기체 얘기라 **1건**만 갈렸다.
 * 여기는 **18/18 전량**인데, 그것이 곧 "한 기체의 거동 변화"가 아니라 **입력층 전면 변경**의
 * 서명이다. 한 기체만 갈렸다면 오히려 진단이 틀린 것이다.
 *
 * ⭐⭐ **교환 대조로 확정했다(재생성 *전에*).** `affixPoolFor` 를 옛 전역 24종 균등으로만
 * 되돌려 돌리자 **18건이 전부 정확히 옛 값으로 복원**됐다(동일 18 / 발산 0). 즉 발산의 원인은
 * 슬롯 풀 **하나뿐**이고 그 안에 숨은 별도 회귀는 없다. 다음 재동결도 이렇게 해라 —
 * **vitest 실패 덤프를 파싱하지 마라**(값이 잘려 원인을 잘못 짚는다, 배치7 이 두 번 밟았다).
 */
/**
 * ## 재동결 이력 — **2026-08-08 (출시 전 밸런스 · 플랫 시그니처 비율화)**
 *
 * ### 3건(`p3s1` · `p3s90210` · `p4s4242`) — 해츨링 병아리 탄 피해 비율화
 * `shipTypeId = (planet + seed % 7) % 7` 로 셋 다 **4 = 해츨링**이다. 병아리 탄 피해가
 * `TURRET_BULLET_DAMAGE`(10) 고정에서 **플레이어 발당 피해의 20%**(`BROOD_DAMAGE_BP`)로
 * 바뀌면서 병아리 화력이 달라졌고, 처치·적 배치가 달라져 오토파일럿이 보는 세계가 갈렸다.
 *
 * ⭐ **건수가 진단의 증거다.** 해츨링 키는 이 표에 정확히 3개이고 **그 3개만** 갈렸다.
 * 같은 커밋의 버블 개정(막 내구 → 최대 HP 비율)은 **한 건도 안 갈렸다** — 버블 키(`p5s1`)가
 * 그대로다. 즉 발산이 한 기체로 일관된다.
 *
 * ⭐⭐ **교환 대조로 확정했다(재생성 *전에*).** `world.ts` `fireTurretShot` 의 병아리 분기만
 * 옛 상수로 되돌려 돌리자 **18건 전부 옛 값으로 복원**됐다(동일 18 / 발산 0). 원인은 그 한
 * 줄뿐이고 그 안에 숨은 별도 회귀는 없다.
 */
/**
 * ## 재동결 이력 — **2026-08-08 (출시 전 밸런스 확정 · 18/18 전량)**
 *
 * ### 원인 — 플레이어·적 기본 스탯 일괄 개정
 * 사용자 플레이테스트 루프가 확정한 값들이다: 플레이어 공격력 8 → 18.24 · HP 100 → 151 ·
 * 적 밀도 +30%(`src/sim/enemyScale.ts`) · 단계 HP 앵커 4/22 → 16/88 · 보스 HP ×2 ·
 * 바닥 해저드 절반 · 브루저·아크캐스터 `baseBp` HP 축. 이 골든은 표준 장비 빌드로 오토파일럿을
 * 돌리므로 그 전부를 통과한다.
 *
 * ⭐ **건수가 진단의 증거다.** 한 기체 얘기였다면 1~3건만 갈렸어야 한다(배치7 BL1 이 1건,
 * 2026-08-08 해츨링 개정이 3건이었다). **18/18 전량**은 "입력층 전면 변경" 의 서명이고,
 * 실제로 이번에 바뀐 것이 플레이어 기본 스탯과 적 축 전체다.
 *
 * ⭐⭐ **교환 대조로 확정했다(재생성 *전에*).** 레인이 바꾼 밸런스 상수 **14개를 전부 원래
 * 값으로 되돌려** 돌리자 `enemyStasis`·`volleyExtraction`·`catalystResource` 해시 골든이
 * **48/48 그린으로 복원**됐다. 즉 발산의 원인은 그 상수들뿐이고 그 안에 숨은 회귀는 없다.
 */
/**
 * ## 재동결 이력 — **2026-08-08 (같은 레인 마감 · `summonEnemy` 의 짝 없는 `ENEMY_HP_MULT` 제거)**
 *
 * ### 6건(`p0s1` · `p0s4242` · `p0s90210` · `p1s4242` · `p2s4242` · `p4s4242`)
 *
 * ### 원인 — 밀도 패스가 **소환 경로까지 샜던 것**을 되돌렸다
 * 밀도 패스의 계약은 «적 수 ×1.3 ↔ 적 HP ×1/1.3» **한 쌍**인데, 수 배수는 웨이브 경로
 * (`spawnEnemy`)에만 걸리고 HP 배수는 `summonEnemy` 에도 걸려 있었다. 그래서 소환 경로의 적
 * (침공 드론·침공 편대·보스 무리·**중반 격전**·촉매 소환·조우 수호)이 늘어난 것 없이 HP 만
 * 23% 깎인 **보상 없는 약화** 상태였다. `tests/invasionFacility.test.ts` 가 드론 내구도
 * 75 → 57 로 잡아 드러났다(사유 전문은 `waves.ts` `summonEnemy` 본문 주석).
 *
 * ⭐ **건수가 진단의 증거다.** 바로 위 절의 밸런스 일괄 개정은 **18/18 전량**이었다 —
 * 그것이 "입력층 전면 변경" 의 서명이다. 이번은 **6/18 부분**이고, 그것이 곧 *"3,000틱 안에
 * 소환 경로(주로 중반 격전 구간)를 실제로 밟은 런에만 걸린다"* 는 국소 변경의 서명이다.
 * 만약 여기서도 18/18 이 갈렸다면 진단이 틀린 것이다.
 *
 * ⭐⭐ **교환 대조로 확정했다(재생성 *전에*).** `summonEnemy` 의 그 한 줄만 되돌려 돌리자
 * **18/18 이 전부 옛 값 그대로 그린**이었다(발산 0). 즉 발산의 원인은 그 줄 하나뿐이고 숨은
 * 회귀는 없다. 이 절차를 다음 재동결도 그대로 따라라 — **vitest 실패 덤프를 파싱하지 마라.**
 */
/**
 * ## 재동결 이력 — **2026-08-08 (같은 날 3차 · 보스 HP 단계 곡선 신설)**
 *
 * ### 2건(`p2s4242` · `p2s90210`)
 *
 * ### 원인 — 보스만 단계 배율 밖에 있던 것을 고쳤다
 * 잡몹 HP 에는 `stageParams(stage).hpMult` 가 걸리는데 **보스에는 안 걸려 있었다** — 그래서
 * 보스 HP 가 단계 1 이든 20 이든 7,200 고정이었고, 사용자 신고(*"10·20단계에서 거의 3초 만에
 * 죽는다"*)의 원인이 그것이다. `bossStageHpMult`(`src/sim/enemyScale.ts`)를 신설해 두 스폰
 * 지점(`world.ts` · `modes/chase.ts`)에 함께 걸었다.
 *
 * ⭐ **건수가 진단의 증거다.** 이 골든은 `LEVEL = 40` → `standardStage(40) = 8` 이라 **단계 8**
 * 을 돌고, 곡선은 단계 8 에서 ×7.3 이다. 그런데 갈린 것은 **2건뿐**이다 — 나머지 16 은
 * `MAX_TICKS`(3,000) 안에 **보스에 아예 닿지 못하는** 런이라 보스 HP 가 무엇이든 입력 열이
 * 같다. 즉 «보스전에 들어간 런만 갈렸다» 가 이 변경의 정확한 서명이다. 여기서 18/18 이
 * 갈렸다면 오히려 진단이 틀린 것이다(그 서명은 입력층 전면 변경의 것이다 — 위 절들 참조).
 *
 * ⭐⭐ **교환 대조로 확정했다(재생성 *전에*).** `bossStageHpMult` 를 `return 1` 로 눌러
 * 돌리자 **18/18 이 전부 옛 값 그대로 그린**이었다(발산 0). 원인은 이 곡선 하나뿐이고 숨은
 * 회귀는 없다.
 *
 * ⚠️ **단계 1 은 곡선이 정확히 ×1 이라 단계1 무대의 골든은 원리적으로 안 갈린다**
 * (`tests/bossStageHp.test.ts` 가 그 절대값을 따로 잠근다).
 */
/**
 * ## 재동결 이력 — **2026-08-08 (같은 날 4차 · 보스 곡선을 구간선형 → 지수로)**
 *
 * ### 같은 2건(`p2s4242` · `p2s90210`)
 *
 * ### 원인 — 곡선의 **형식**이 바뀌었다(값 조정이 아니다)
 * 사용자 2차 지시: *"보스 hp 증가 그래프를 지금 20단계 보스가 현재보다 두배 올라가는 수준으로
 * 바꿔줘"* → *"단계1은 현재 값으로 고정하고 그 뒤로 어느정도 지수적으로 올라가서 20단계가
 * 두배가 되도록"*. `bossStageHpMult` 가 구간선형(앵커 1/10/11)에서 **등비수열**(공비 1.1761)로
 * 바뀌었다. 단계 20 이 ×10.9 → ×21.8 이다.
 *
 * ⭐ **갈린 키가 3차 재동결과 정확히 같은 2개다.** 이 골든은 단계 8 을 돌고 나머지 16 은
 * `MAX_TICKS`(3,000) 안에 **보스에 닿지 못한다** — 보스 HP 를 어떻게 바꾸든 갈리는 집합은
 * 「보스전에 들어간 런」으로 고정이다. 그 집합이 달라졌다면 오히려 진단이 틀린 것이다.
 *
 * ⭐⭐ **교환 대조로 확정했다(재생성 *전에*).** `bossStageHpMult` 를 옛 구간선형 식으로만
 * 되돌려 돌리자 **18/18 이 전부 3차 값 그대로 그린**이었다(발산 0). 원인은 곡선 형식 하나뿐이다.
 *
 * ⚠️ 단계 1 은 이번에도 정확히 ×1 이라(사용자가 *"단계1은 현재 값으로 고정"* 으로 재확인)
 * 단계1 무대 골든은 원리적으로 안 갈린다.
 */
/**
 * ## 재동결 이력 — **2026-08-08 (같은 날 5차 · §R51 조종사 레벨 성장 신설 · 18/18 전량)**
 *
 * ### 원인 — 장비 축 포화를 레벨 배율로 메웠다
 * 조사 실측이 «Lv5 → Lv100 실효 전투력 ×1.00» 이었다(「Lv100 이 Lv50 보다 약할 확률」 52.8%).
 * `src/items/loadout.ts` 에 **전 기체 공통 레벨 배율**(`PILOT_LEVEL_GROWTH_PER_LEVEL` 1.0164,
 * 레벨당 등비)을 신설해 `damageMult` 와 `maxHpAdd` 두 축에 걸었다. 이 골든은 `LEVEL = 40` 을
 * 쓰므로 배율이 ×1.876 로 걸린다.
 *
 * ⭐ **건수가 진단의 증거다.** 이 배율은 **모든 기체·모든 행성·모든 시드**의 피해와 HP 를
 * 동시에 바꾸므로 「입력층 전면 변경」의 서명, 곧 **18/18 전량**이어야 한다. 부분만 갈렸다면
 * 배선이 어딘가에서 새고 있다는 뜻이라 진단이 틀린 것이다(앞선 재동결 중 6/18·2/18 은 각각
 * «소환 경로를 밟은 런만» ·«보스전에 들어간 런만» 이라는 국소 서명이었다 — 성격이 다르다).
 *
 * ⭐⭐ **교환 대조로 확정했다(재생성 *전에*).** `PILOT_LEVEL_GROWTH_PER_LEVEL` 만 `1.0` 으로
 * 되돌려 돌리자 **18/18 이 전부 4차 값 그대로 그린**이었다(발산 0). 즉 발산의 원인은 그 상수
 * 하나뿐이고 그 안에 숨은 회귀는 없다. **vitest 실패 덤프는 파싱하지 않았다** — 값을 따로 뜨는
 * 스크립트로 전량을 다시 냈다.
 *
 * ⚠️ **레벨 1 무대의 골든은 원리적으로 안 갈린다** — `pilotLevelMult(1)` 이 early-return 으로
 * 정확히 1 이라 무연산이다. 그래서 `defaultProfile()`(레벨 1)을 쓰는 다른 골든 전부가 그대로다.
 * ⚠️ **침공 골든도 안 갈린다** — `buildRunConfig` 가 침공·예비역 소집에 레벨 1 을 넘긴다
 * (의도적 제외, 그 자리 주석이 정본).
 */
/**
 * ## 재동결 이력 — **2026-08-08 (같은 날 6차 · §R50 경제 지표 복구 · 원인 둘 · 9/18)**
 *
 * ⚠️ **원인이 둘이고 서로 다르다. 섞지 마라.** 각각을 따로 교환 대조했다(재생성 *전에*).
 *
 * ### ① 9건 — `pilotSteer` 에 **④ 사선 확보** 신설 (`src/sim/autopilot.ts`)
 * 봇에는 벽이라는 개념이 없었다 — 그 파일에 `wall` 이라는 단어가 없었다. 2026-08-04 벽
 * 프리팹 이후 봇은 *"쏘면 벽에 맞는 자리"* 에 붙박여 카이팅만 하다 죽었고, §R50 이 이월한
 * 경제 지표 2건이 그 그림자였다. **밸런스 조정이 아니라 계측기 수리다**(③ 전리품 수거와
 * 같은 형태 · 같은 사유).
 *
 * ⭐ **건수가 진단의 증거다.** 갈린 것은 행성 0(2건) · 1(1건) · 3(3건) · 5(3건)이고
 * **행성 2·4 는 3/3 전부 동일**하다. 새 분기는 «최근접 표적과의 선분을 벽이 실제로 막았을
 * 때»만 발화하므로, 3,000틱 안에 그 상황을 한 번도 안 밟은 런은 프레임이 바이트 동일하다 —
 * 그것이 이 변경의 정확한 서명이다. 여기서 18/18 이 갈렸다면 게이트가 새는 것이므로 오히려
 * 진단이 틀린 것이다(18/18 은 입력층 전면 변경의 서명이다 — 위 절들 참조).
 *
 * ### ② 4건(`p0s1` · `p1s1` · `p3s1` · `p5s1`) — `EXPECTED_CARDS_PER_RUN` 42 → 32
 * 그 상수는 `eliteDropChance` 의 분모라 **엘리트 드랍 게이트 확률**이 바뀐다. 게이트가
 * `dropRng` 를 굴리는 자리는 그대로지만 통과/실패가 뒤집히면 드랍 레코드가 달라지고, 봇이
 * 보는 세계(바닥 전리품 = ③ 수거 분기의 입력)가 갈린다.
 *
 * ⭐ **건수가 진단의 증거다.** 갈린 4건이 **전부 seed 1** 이다 — 3,000틱 안에 엘리트를 실제로
 * 잡고 그 게이트 결과가 뒤집힌 런에만 걸린다는 뜻이고, 국소 변경의 서명이다.
 *
 * ⭐⭐ **교환 대조.** `openFireLane` 첫 줄을 `return undefined` 로 눌러 돌리자 ②만 남아
 * **4건**으로 줄었고, ②까지 함께 되돌리자 **18/18 전부 5차 값 그대로 그린**이었다(발산 0).
 * **vitest 실패 덤프는 파싱하지 않았다** — 값을 따로 뜨는 스크립트로 전량을 다시 냈다.
 */
const EXPECTED: Readonly<Record<string, number>> = {
  p0s1: 3883225162,
  p0s4242: 1710554414,
  p0s90210: 322457692,
  p1s1: 1824830719,
  p1s4242: 475494526,
  p1s90210: 2544742006,
  p2s1: 2697845404,
  p2s4242: 3255025042,
  p2s90210: 3868266812,
  p3s1: 3174297668,
  p3s4242: 850058131,
  p3s90210: 2002896390,
  p4s1: 654501837,
  p4s4242: 177366342,
  p4s90210: 481925563,
  p5s1: 376544585,
  p5s4242: 2495465801,
  p5s90210: 2845773895,
};

describe('autopilotInput 거동 동결 — 입력 프레임 열 골든', () => {
  it('행성 6종 × 시드 3개의 프레임 열이 동결값과 바이트 단위로 같다', () => {
    const actual: Record<string, number> = {};
    for (const planet of PLANETS) {
      for (const seed of SEEDS) {
        const shipTypeId = (planet + (seed % 7)) % 7;
        actual[keyOf(planet, seed)] = frameStreamHash(planet, seed, shipTypeId);
      }
    }
    expect(actual).toEqual(EXPECTED);
  });

  it('같은 입력을 두 번 접으면 같다 (계측기가 상태를 흘리지 않는다)', () => {
    expect(frameStreamHash(0, 1, 0)).toBe(frameStreamHash(0, 1, 0));
  });

  it('⚠️ 공허 방어 — 실제로 수백 틱 이상 굴렸고 프레임이 한 종류가 아니다', () => {
    const profile = defaultProfile();
    const ship = activeShip(profile);
    ship.typeId = 0;
    ship.level = LEVEL;
    ship.skillInvest = investVector(0, standardPerTree(LEVEL));
    ship.equipped = standardEquipped(LEVEL, 1, 0);
    const state = createWorld(1, buildRunConfig(profile, { planet: 0, stage: standardStage(LEVEL) }));
    const seen = new Set<string>();
    let ticks = 0;
    for (let i = 0; i < MAX_TICKS; i++) {
      const f = autopilotInput(state);
      seen.add(`${f.moveX},${f.moveY},${f.aim},${f.dash},${f.special}`);
      stepWorld(state, f);
      ticks++;
      if (state.victory || state.gameOver) break;
    }
    // 런이 조기에 끝나면 골든이 "아무것도 안 잰 0" 이 된다 — 그 상태를 명시적으로 막는다.
    expect(ticks).toBeGreaterThan(300);
    expect(seen.size).toBeGreaterThan(50);
  });

  it('오토파일럿은 대시도 액티브도 누르지 않는다 (결정 B 의 "동결" 대상 그 자체)', () => {
    const profile = defaultProfile();
    const ship = activeShip(profile);
    ship.typeId = 0;
    ship.level = LEVEL;
    ship.skillInvest = investVector(0, standardPerTree(LEVEL));
    ship.equipped = standardEquipped(LEVEL, 7, 0);
    const state = createWorld(7, buildRunConfig(profile, { planet: 0, stage: standardStage(LEVEL) }));
    let dashes = 0;
    let actives = 0;
    for (let i = 0; i < 1200; i++) {
      const f = autopilotInput(state);
      if (f.dash) dashes++;
      // 비트 9·10 = 액티브 슬롯 1·2(`data/inputBits.ts`).
      if ((f.special & ((1 << 9) | (1 << 10))) !== 0) actives++;
      stepWorld(state, f);
      if (state.victory || state.gameOver) break;
    }
    expect(dashes).toBe(0);
    expect(actives).toBe(0);
  });
});
