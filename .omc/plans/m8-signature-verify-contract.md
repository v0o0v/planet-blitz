# M8 시그니처 배선 — 테스트/Deno 검증 계약 (실측 정찰본)

작성: 2026-07-21 · 정찰 전용(프로덕션·테스트 코드 무수정) · 대상: typeId 3(팬텀)·4(해츨링)·5(말로우)·6(버블) 의 `src/sim/world.ts` 배선 레인

이 문서는 "무엇을 어떻게 검증해야 배선이 실제로 있다고 말할 수 있는가"의 **계약**이다. 모든 주장은 `파일:줄` 또는 실측 실행 결과를 근거로 한다.

---

## 0. ⚠️ 최우선 경고 3건 (착수 전에 반드시 읽어라)

### 경고 ①  `scripts/deno-verify/fixtures.json` 은 **append-only 가 아니다. 매번 전량 덮어쓴다.**

`tests/denoFixture.test.ts:41` 이 `writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n', 'utf8')` 로 **파일 전체를 다시 쓴다.** 굳히는 대상은 `SCENARIOS` 전량(`tests/denoFixture.test.ts:31`)이므로, 스트라이커 시나리오 ①~⑥ 의 `finalHash`·`checkpoints` 도 매 `npx vitest run` 마다 **현재 코드 기준으로 재계산되어 덮어써진다.**

그리고 이 테스트의 단언은 `scenarios.length === 7`(`:44`)과 `finalHash` 가 유효 u32 라는 것뿐이다(`:45-49`). 즉 **당신의 world.ts 수정이 스트라이커 런에 샜더라도 이 테스트는 초록으로 통과하면서 골든 값을 조용히 새 값으로 갈아치운다.** 파일 자체가 회귀 탐지기가 아니다.

- 스트라이커 회귀를 실제로 잡는 것은 **`tests/shipHashBaseline.test.ts` 하나뿐**이다. 그쪽은 `tests/fixtures/striker-prem8.json` 을 **읽어서 비교만** 한다(`tests/shipHashBaseline.test.ts:5`, `:43-44`, `:117-119`). 이 성격 차이는 그 파일 헤더(`:6-7`)가 직접 명문화한다: "재생성형 픽스처인 scripts/deno-verify/fixtures.json 과 정반대 성격".
- 따라서 **작업 절차 계약**: 시나리오를 추가하는 커밋에서 `git diff -- scripts/deno-verify/fixtures.json` 을 반드시 육안 확인하고, **추가된 8번째 엔트리와 `"scenarioCount"` 한 줄 외에 기존 ①~⑦ 의 해시가 한 글자라도 바뀌면 즉시 중단**하라. 그것은 "스트라이커/기존 기체 런에 변경이 샜다"는 뜻이다. 선례가 있다: W0 커밋 `285b41d` 의 본문이 "fixtures.json 은 append 만 했다 — 삭제된 줄은 `"scenarioCount": 6` 한 줄뿐이고 기존 6종 해시는 불변" 이라고 기록한다.

### 경고 ②  "typeId 0 런과 결과가 다르다" 는 **이미 배선 없이도 참이다.** 그 단독으로는 아무것도 증명하지 못한다.

실측(정찰 프로브, `planet 0 / tier 0 / 중립 입력 / playerHp 1e8 / 3600틱`):

| seed | typeId | hpLost | kills@3600 | 최종 엔티티 수 |
|---|---|---|---|---|
| 3311 | 0 | 38 | 17 | 44 |
| 3311 | 3 | 74 | 28 | 88 |
| 3311 | 5 | 20 | 17 | 44 |
| 3311 | 6 | 52 | 17 | 44 |

**세 타입 모두 world.ts 분기가 한 줄도 없는 현재 상태에서 이미 typeId 0 과 관측이 갈린다.** 원인은 시그니처가 아니라 `baseBp`(`data/ships/mallow.ts:160` 등)가 `computeLoadoutStats` 를 통해 damage/maxHp/moveSpeed 를 바꾸고, `WorldConfig.shipType` 이 `hashWorld` 꼬리 폴드(`src/sim/replay.ts:444-450`)에 접히기 때문이다.

증거: `tests/shipIntegration.test.ts:112-136` 의 "신규 2종(typeId 5·6)도 자기 비트만 켜고 타입 0 과 관측 결과가 갈린다" 케이스는 **오늘 이미 통과한다**(vitest 전량 그린 실측). 배선은 0줄이다. 이것이 이 저장소 8번째 재발 결함의 교과서적 형태다 — 테스트 이름이 증명한다고 주장하는 것과 실제로 증명하는 것이 다르다.

→ **§1.3 의 "시그니처 억제 동형 대조군(suppressed control)" 을 반드시 함께 쓰라.** typeId 0 대조는 보조 지표로만 유지한다.

### 경고 ③  `hpLost` 는 정수가 아닐 수 있다 — aux 정수화 함정의 실측 증거

`planet 2 / tier 2` 런에서 관측된 누적 피해가 `241.80000001192093` 이었다(정찰 프로브). 접촉 피해에 엘리트 배율이 섞여 f64 가 된다. `src/sim/world.ts:2256-2260` 주석이 이미 지적한 그 지점이며, aux 슬롯은 `src/sim/replay.ts:161-163` 에서 `e.aux0 >>> 0` 로 u32 해시된다. **말로우 지연 피해 풀을 aux 에 적립할 때 반드시 정수로 만들어라.** 테스트 단언도 `toBe(정수)` 대신 대조군과의 **차이 부호/크기**로 쓰는 편이 안전하다.

---

## 1. 정규 경로 통합 테스트 계약

### 1.1 `buildRunConfig` 실측 시그니처

`src/run/runConfig.ts:77`:

```ts
export function buildRunConfig(profile: Profile, opts: RunConfigOpts): WorldConfig
```

`RunConfigOpts`(`src/run/runConfig.ts:41-52`): `planet: number` · `tier: number` · `anomalyAccepted?: boolean` · `maxSegments?: number` · `invasion3?: Invasion3Config`.

반환 `WorldConfig` 는 `{ ...DEFAULT_CONFIG, planet, tier, anomalyAccepted, loadout, skillInvest, shipType, (maxSegments), (invasion3) }`(`:92-106`). 핵심 3축(`:70-75` 주석이 명문화):
1. `computeLoadoutStats(items, skillInvest, shipBonusBp, typeId)` → baseBp + 타입 트리 파생 + **시그니처 비트 OR-in**(`src/items/loadout.ts:292-293`, `if (sig >= 0) uniqueMask |= 1 << sig`)
2. `WorldConfig.shipType` → sim 게이트(`src/sim/world.ts:1085`)와 해시 꼬리 폴드(`src/sim/replay.ts:450`)
3. `skillInvest` 길이 → 해시에 그대로 접힘

`buildRunConfig` 는 순수 함수다(`:17-20` 주석). `skillInvest` 는 `.slice()` 복사본(`:83`).

### 1.2 기존 `tests/shipIntegration.test.ts` 가 typeId 1·2 를 검증하는 패턴 (전문 실측)

파일은 5개 블록(①~⑤)으로 구성되고, 공통 헬퍼가 세 개다(`:49-83`):

- `NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 }`(`:49`)
- `DURABLE_HP = 100_000_000`(`:51`) — "런이 조기 종료되지 않게 버티는 무대 상수(프로필 파생값이 아니다)"
- `runHashes(seed, cfg, ticks): number[]`(`:53-61`) — `createWorld(seed, {...cfg, playerHp: DURABLE_HP})` 후 매 틱 `stepWorld(state, NEUTRAL)` + `hashWorld(state)` 를 배열로 수집
- `profileWithType(typeId): Profile`(`:63-70`) — `defaultProfile()` → `activeShip(p).typeId = typeId` → `skillInvest = zeroSkillInvest(typeId)`
- `memStore(): KeyValueStore`(`:72-83`) — Map 기반 인메모리 저장소

typeId 1·2 검증 패턴은 **3층**이다:

| 층 | 위치 | 무엇을 본다 |
|---|---|---|
| (a) 마스크 점등 | `:90-96` | `hasCapstone(cfg.loadout?.uniqueMask ?? 0, SIG_BRUISER_ARMOR) === true` + `cfg.shipType === 1` |
| (b) 비트 누출 없음 | `:104-110`, `:128-131` | 자기 비트만 켜지고 `SIGNATURE_BITS` 의 나머지는 전부 false |
| (c) 관측 발산 | `:138-151` | `runHashes(9182, typeId1cfg, 180) !== runHashes(9182, typeId0cfg, 180)` + **양쪽 `new Set(...).size > 90`**(월드가 정지하면 아무것도 증명 못 한다는 가드) |

보조 계약: 결정론 왕복(`:153-158`, 전 `SHIP_TYPES` 순회로 같은 Profile 이 같은 해시 스트림) · 벡터 길이(`:160-165`) · 손상 세이브 폴백(`:167-175`) · 침공 경로 동형(`:177-190`).

`tests/shipHashBaseline.test.ts:198-261` 은 같은 사상의 **스트라이커 측 선례**다 — `assembleRunConfigLikeMain`(`:198-205`)이 `buildRunConfig` 를 그대로 부르고, 그 결과 config 가 골든 조립과 `toEqual` 인지(`:245`)까지 본다.

⚠️ **(c) 는 §0 경고 ② 대로 typeId 3~6 에서는 배선 없이도 통과한다.** 아래 1.3 이 그 구멍을 메운다.

### 1.3 시그니처 억제 동형 대조군 — 이 계약의 핵심

`signatureOn`(`src/sim/world.ts:1083-1086`)은 **2축 OR** 이다:

```ts
function signatureOn(state: WorldState, bit: number): boolean {
  if (hasSignature(state.config.loadout?.uniqueMask ?? 0, bit)) return true;
  return shipTypeDef(state.config.shipType ?? 0).signatureBit === bit;
}
```

따라서 시그니처만 끄려면 **두 축을 동시에** 눌러야 한다. 프로덕션 코드를 한 줄도 건드리지 않고 config 만으로 만들 수 있다:

```ts
// live = buildRunConfig(profileWithType(N), { planet, tier })
const bit = shipTypeDef(N).signatureBit;                 // data/ships/index.ts
const ctrl = {
  ...live,
  shipType: 0,                                            // 축 2 차단
  loadout: { ...live.loadout!, uniqueMask: live.loadout!.uniqueMask & ~(1 << bit) }, // 축 1 차단
};
```

**이 대조군이 왜 공정한가(= 시그니처 외에 아무것도 안 바뀌는가):** `config.shipType` 을 읽는 곳은 저장소 전체에 세 군데뿐이다(실측 grep).
1. `src/sim/replay.ts:450` — 해시 꼬리 폴드. **해시가 아닌 관측량**(hp·kills·엔티티 수)만 비교하면 무관.
2. `src/sim/powerups.ts:313` `investedInAffinity` — 그러나 `:311-320` 은 투자 합을 세고, `profileWithType(N)` 은 `zeroSkillInvest` 라 **전 성분 0** → `powerupWeight`(`:325-336`)가 `WEIGHT_TREE_BASE + floor(0/4)` 로 타입 무관 동일. `powerupRng` 소비 순서 불변.
3. `src/sim/world.ts:1085` — 바로 우리가 끄려는 축.

**실측 검증(대조군 자체의 음성 대조):** 위 대조군을 현재 코드에 그대로 적용해 `live` 와 `ctrl` 의 비해시 관측량을 비교한 결과 —

| stage | seed | type 1 | type 2 | type 3 | type 4 | type 5 | type 6 |
|---|---|---|---|---|---|---|---|
| p0/t0 | 3311 | **다름** | **다름** | 동일 | 동일 | 동일 | 동일 |
| p0/t0 | 555 | 동일※ | **다름** | 동일 | 동일 | 동일 | 동일 |
| p2/t2 | 3311 | **다름** | **다름** | 동일 | 동일 | 동일 | 동일 |
| p2/t2 | 555 | **다름** | **다름** | 동일 | 동일 | 동일 | 동일 |

※ p0/t0·seed 555 는 브루저 장갑이 1스택까지만 쌓여 피해 차가 0 이었다 — **무대 선정이 계약의 일부**라는 증거(§1.5).

즉 **이미 배선된 1·2 는 잡히고, 배선이 없는 3~6 은 완전히 동일하다.** 이 대조가 곧 "배선이 있는가"의 직접 측정이다. 배선 후 3~6 이 `identical=false` 로 바뀌지 않으면 그 레인은 실패다.

보조 관측 하나 더: `player.aux0`/`aux1` 은 시그니처 미보유 런에서 **항상 0** 이어야 한다(`src/sim/replay.ts:161` 의 조건부 폴드 규약, 임무 규율 5). 실측에서 type 3~6 은 `maxAux0 = maxAux1 = 0`, type 1 은 `aux0` 최대 8(= `ARMOR_MAX_STACKS`), type 2 는 `aux0` 최대 600(= `OVERCHARGE_TICK_CAP`, `src/sim/world.ts:1081`)이었다. → 테스트는 **"live 런에서 aux 가 0 이 아니게 된다 + ctrl 런에서 끝까지 0 + typeId 0 런에서 끝까지 0"** 을 함께 단언하라.

### 1.4 타입별 관측량·필요 틱 수 (순수 함수 상수에서 유도)

공통: 입력은 `NEUTRAL`(정지), `playerHp = DURABLE_HP`, `createWorld` → `stepWorld` 정규 경로. 관측 3종 = `hpLost`(= `DURABLE_HP - player.hp`) · `state.kills` · `state.entities.length`. 여기에 `player.aux0/aux1` 궤적.

#### typeId 3 — 팬텀 / `SIG_PHANTOM_CLOAK`(비트 20)

- **상수**: `CLOAK_UNHIT_TICKS = 240`(`src/sim/shipSignature.ts:131`) · `CLOAK_BREAK_BP = 25000`(`:133`).
- **발현 조건**: 연속 무피격 240틱. 실측 무피격 스트릭(p0/t0, typeId 4, 5400틱): seed 3311 = 4543 · seed 555 = 3323 · seed 9182 = 4627 → **정지 입력 런은 초반 피격 이후 매우 긴 무피격 구간이 생겨 은신이 반드시 진입한다.**
- **최소 틱**: 첫 피격 tick 이 seed 3311 = 182 · seed 9182 = 204 · seed 555 = 738. 은신은 (첫 피격 + 240) 이후 성립 → **≥ 900틱 권장, 안전하게 1200틱.** seed 555 는 시작부터 738틱 무피격이라 **틱 240 부터 은신** → 초반 구간 단독 관측도 가능(600틱이면 충분).
- **관측량**: `hpLost`(은신 중 적이 조준을 잃으면 피해 감소) · `firstHitTick` 이동 · `kills`(은신 해제 첫 타 2.5배로 처치 가속). **ctrl 대비 `hpLost` 가 유의미하게 작아야 한다.**
- **주의**: 적 AI 는 `updateEnemy(state, e, def, player)`(`src/sim/world.ts:1137` → `src/sim/patterns/index.ts:31`)가 `player` 엔티티를 직접 받는다. 은신을 여기서 처리하면 **PvE·침공 전 경로에 파급**된다. `isPlayerTargetable`(`src/sim/world.ts:1638`)은 **플레이어가 무엇을 조준하는가**의 술어라 은신과 무관하다 — 혼동하지 마라. 그 함수 헤더 주석(`:1626-1637`)이 명시하는 "세 목록은 항상 같이 바뀐다"는 방어체 조준 계약이지 은신 계약이 아니다.

#### typeId 4 — 해츨링 / `SIG_HATCHLING_BROOD`(비트 21)

- **상수**: `HATCH_BASE_KILLS = 12`(`shipSignature.ts:149`) · `HATCH_STEP_KILLS = 4`(`:151`) · `HATCH_SCALE_KILLS = 60`(`:153`) · `HATCH_MAX_KILLS = 40`(`:155`). `hatchThreshold(kills)`(`:164-170`)는 누적 60 처치까지 12 고정.
- **발현 시점 실측**(p0/t0, typeId 4, 정지 입력, 5400틱): 누적 처치 12 도달 tick = seed 3311 **587** · seed 555 **469** · seed 9182 **667**. 24 도달 = seed 555 **949** · seed 9182 **1177**. 36 도달 = seed 555 **1582**.
- **무대 선정 필수**: `planet 1 / tier 1` 은 5400틱에 총 7~8킬뿐이라 **임계에 영원히 못 닿는다**(실측). `planet 2 / tier 2` 도 3600틱에 4~6킬. → **반드시 `planet 0 / tier 0`.**
- **권장**: `seed 555, planet 0, tier 0, 1800틱` → 임계 3회 통과(469·949·1582) → 병아리 3기.
- **관측량**: `state.entities.length` 증가(대조군 대비) + `state.kills` 증가 + `player.aux0`(처치 카운터) 궤적.
- **규율 6 재확인**: 적 스폰은 반드시 `summonEnemy`(`src/sim/waves.ts:246`, `e.cooldown = def.fireCooldown` 고정·RNG 미소비) 경유. `spawnEnemy`(`src/sim/waves.ts:220`)는 `state.waveRng.int(0, 30)`(`:229`)을 소비해 결정론을 깬다. 다만 병아리는 **아군** 이므로 두 함수 모두 부적합할 수 있다 — 규율 7에 따라 **신규 EntityKind 를 만들기 전에 기존 아군 유닛 kind 재사용을 우선 검토하라**: `'turretPickup'`(`src/sim/entities.ts:28`, "접촉 시 일정 시간 자동 사격하는 아군 포탑")이 이미 아군 자동 사격 유닛이고, `spawnEventObject(state, 'turretPickup', ...)` 호출 선례가 `src/sim/world.ts:1505`·`:1600` 두 곳에 있다.

#### typeId 5 — 말로우 / `SIG_MALLOW_CUSHION`(비트 22)

- **상수**: `CUSHION_DEFER_BP = 3500`(`shipSignature.ts:174`) · `CUSHION_RECOVER_TICKS = 180`(`:176`) · `CUSHION_RECOVER_BP = 6000`(`:178`).
- **발현 조건**: **맞아야** 적립되고, 그 후 **연속 무피격 180틱** 이 지나야 회복이 시작된다. 순 이득 = 피해의 35% × 60% = **21% 경감**(반올림 전).
- **최소 틱**: 첫 피격 tick + 180. seed 3311/p0t0 = 182 + 180 = **362틱**. 안전하게 **≥ 900틱**.
- **무대 선정**: p0/t0 는 3600틱 누적 피해가 20(seed 3311)~46(seed 555)뿐이라 21% 경감이 정수 반올림에 먹혀 4~10 차이로 얇다. **`planet 2 / tier 2` 권장** — 같은 조건에서 누적 피해 1364(seed 3311) / 372.8(seed 555)로 신호가 크다.
- **관측량**: `hpLost` 가 대조군보다 **작다**(`ctrl.hpLost > live.hpLost`). 부등호로 단언하라 — 절대값은 §0 경고 ③ 때문에 취약하다.

#### typeId 6 — 버블 / `SIG_BUBBLE_FILM`(비트 23)

- **상수**: `FILM_PERIOD_TICKS = 420`(`shipSignature.ts:213`) · `FILM_ABSORB_FLAT = 60`(`:215`) · `FILM_BURST_RADIUS = 220`(`:217`) · `FILM_BURST_PUSH = 260`(`:219`).
- **발현 조건**: 시간축만 — `filmReady(ticksSinceBurst)`(`:222-224`)가 420틱에서 true. 피격 여부와 무관하게 **421틱째부터 첫 막**.
- **최소 틱**: 막 1장 = 421틱. 흡수가 관측되려면 막이 선 뒤 피격이 있어야 하므로 **≥ 900틱**, 파열 밀어내기까지 보려면 **≥ 1800틱**(막 4장 이상).
- **무대 선정**: p2/t2 권장(3600틱 누적 피해 858 @seed 3311) — 막 8장 × 60 = 최대 480 흡수라 신호가 절반 이상.
- **관측량**: `hpLost` 가 대조군보다 작다 + 밀어내기 때문에 적 위치/`entities.length` 가 갈린다.

### 1.5 최소 Profile/설정 조립 — 기존 헬퍼 그대로 쓴다

새 헬퍼를 만들지 마라. `tests/shipIntegration.test.ts` 의 `profileWithType`(`:63-70`)·`runHashes`(`:53-61`)·`NEUTRAL`(`:49`)·`DURABLE_HP`(`:51`) 를 그대로 확장한다. 필요한 추가는 **"해시가 아닌 관측량을 뽑는 러너"** 하나뿐이며 형태는 다음과 같다(스케치 — 구현 레인이 작성):

```
runObserved(seed, cfg, ticks) -> { hpLost, kills, entityCount, maxAux0, maxAux1 }
  state = createWorld(seed, { ...cfg, playerHp: DURABLE_HP })
  for t in 1..ticks: stepWorld(state, NEUTRAL); (aux 최대치 추적)
```

`buildRunConfig` 를 반드시 경유하고(`import { buildRunConfig } from '../src/run/runConfig.js'`, 기존 `:20`), sim/데이터를 테스트가 직접 조립하지 마라. **공허 런 가드**(`new Set(hashes).size > 90` — `:117`, `:134`, `:149-150`)를 새 케이스에도 반드시 붙여라. 정지한 월드는 아무것도 증명하지 않는다.

### 1.6 음성 대조(negative control) 절차 — 타입별 1건씩

**선례 인용.** W0 커밋 `285b41d`(`feat(ship): M8 기체 챔피언화 …`)의 본문:

> 음성 대조로 골든이 실제로 잡는지 확인했다 — `WEIGHT_TREE_BASE` 를 4→5 로 한 글자 바꾸자 12런 전부가 정확한 발산 틱과 함께 실패했다(예: 틱 125 에서 0x1af387c9 ≠ 0x23b3fa6c).

대상 상수는 `src/sim/powerups.ts:294`(`const WEIGHT_TREE_BASE = 4;`), 잡은 테스트는 `tests/shipHashBaseline.test.ts` 33건이다. **같은 방식으로, 각 타입의 배선 한 줄을 무력화했을 때 새 테스트가 반드시 빨개지는지 확인하고 결과를 커밋 본문에 적어라. 확인 후 되돌린다(작업트리에 남기지 마라).**

| 타입 | 무력화 지점(1줄) | 무력화 방법 | 반드시 실패해야 하는 케이스 |
|---|---|---|---|
| 공통 | `src/sim/world.ts:1085` `signatureOn` 2축 중 마스크 축 | `if (hasSignature(...)) return true;` 를 `return false` 로 | 전 타입 통합 케이스 — 이 한 줄이 4건 전부를 죽여야 정상 |
| 3 팬텀 | 은신 게이트 호출부(신설 위치) | 은신 판정을 `cloakActive(...)` → `false` 고정 | `p0t0/seed 555` 팬텀 케이스의 `hpLost`·`firstHitTick` 이 대조군과 같아짐 |
| 4 해츨링 | 출격 호출 1줄(`summonEnemy`/`spawnEventObject`) | 호출을 `if (false)` 로 감쌈 | `p0t0/seed 555/1800틱` 의 `entities.length` 가 대조군과 같아짐 |
| 5 말로우 | 지연 전환 1줄 | `cushionDeferredDamage(d)` → `0` | `p2t2` 케이스의 `ctrl.hpLost > live.hpLost` 부등호가 깨짐(등호) |
| 6 버블 | 막 재생성 1줄 | `filmReady(...)` → `false` 고정 | `p2t2/1800틱` 의 `hpLost` 가 대조군과 같아짐 + `aux` 가 0 유지 |

추가 필수 음성 대조 1건 — **역방향**: 위 어떤 변경을 해도 `tests/shipHashBaseline.test.ts` 33건은 **계속 통과해야 한다**(스트라이커 무관). 하나라도 빨개지면 배선이 typeId 0 경로에 샌 것이다.

---

## 2. Deno 시나리오 계약

### 2.1 시나리오 ⑦(해츨링) 실측 해부 — `scripts/deno-verify/scenarios.ts:250-283`, `:374-384`

구성 요소를 전량 인용한다.

**(a) 타입 상수** — `:260`
```ts
const HATCHLING_TYPE_ID = 4;
```

**(b) 투자 벡터 생성기** — `:262-271`
```ts
function hatchlingSkillInvest(): number[] {
  const def = shipTypeDef(HATCHLING_TYPE_ID);
  const v = zeroSkillInvest(HATCHLING_TYPE_ID);
  // 세 계열 tier0 을 각각 다르게 찍어 affinity 슬라이스가 실제로 갈리게 한다.
  for (let ti = 0; ti < def.trees.length; ti++) {
    const { start } = shipTreeRange(def, ti);
    v[start] = ti + 2;
  }
  return v;
}
const HATCHLING_INVEST = hatchlingSkillInvest();
```
`shipTreeRange(def, ti)`(`data/ships/types.ts:120-123`)는 `{ start: ti * def.nodesPerTree, end: start + nodesPerTree }`. 즉 각 트리의 **첫 base 노드**에 2·3·4 를 찍는다 → `investedInAffinity`(`src/sim/powerups.ts:311`)가 타입별로 갈린 가중을 만든다.

**(c) config 주입** — `:275-283`
```ts
const HATCHLING_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  tier: 1,
  playerHp: DURABLE,                                  // = 100_000_000 (:127)
  loadout: computeLoadoutStats([], HATCHLING_INVEST, undefined, HATCHLING_TYPE_ID).loadout,
  skillInvest: HATCHLING_INVEST,
  shipType: HATCHLING_TYPE_ID,
};
```
로드아웃은 **리터럴이 아니라 실제 파생 함수**를 태운다(`:259` 주석: "클라가 쓰는 경로와 같은 값이 되게 한다").

**(d) 시나리오 엔트리** — `:374-384`
```ts
{
  name: '⑦ 해츨링(비스트라이커 기체) 런 — shipType 폴드 + 시그니처 + 78길이 벡터',
  seed: 0xb10f,
  config: HATCHLING_RUN,
  checkpointInterval: 600,
  buildInputs: () => driveDurable(0xb10f, HATCHLING_RUN, MAX_RUN_TICKS),
  rolls: [
    { dropSeed: 0xb10f_71, rarity: 'rare', source: { planet: 2, tier: 1 } },
    { dropSeed: 0xb10f_72, rarity: 'unique', source: { planet: 2, tier: 1 } },
  ],
}
```
- `MAX_RUN_TICKS = 60 * 240 = 14400`(`:128`).
- `driveDurable`(`:66-100`) = 레벨업 대기 시 `packPowerupPick(0)`, 보스가 있으면 추적, 승리 후 남은 loot 로 이동, 그 외 **`emptyInput()`(정지)**. `state.gameOver` 면 break, 승리+loot 없음이 20틱 지속되면 break.
- `checkpointInterval: 600` → `common.ts:147-149` 가 600틱마다 해시 기록.
- 실측(`deno task verify`): ⑦ 은 `ticks=14400 finalHash=3171968474 ckpt=24 loot=29 victory=true`.

**(e) fixture 축 게이트** — `tests/denoFixture.test.ts:77-93` 이 ⑦ 의 `shipType === 4`(`:82`), `skillInvest.length === shipSkillNodeCount(4)` 이며 `!== shipSkillNodeCount(0)`(`:84-85`), `hasCapstone(loadout.uniqueMask, SIG_HATCHLING_BROOD)`(`:87`), 그리고 **①~⑥ 은 `config.shipType` 이 `undefined`**(`:89-92`)임을 못 박는다.

### 2.2 typeId 5(mallow)·6(bubble) 시나리오 추가 — 단계별 복제·변경 목록

1. **상수 2개 추가**(`scenarios.ts`, ⑦ 블록 바로 아래):
   `const MALLOW_TYPE_ID = 5;` · `const BUBBLE_TYPE_ID = 6;`
2. **투자 벡터 생성기**: `hatchlingSkillInvest()`(`:262-271`)를 **타입 인자를 받는 일반형으로 재사용**하라(복붙 3벌 금지). `function shipSampleInvest(typeId: number): number[]` 로 바꾸고 `hatchlingSkillInvest()` 호출을 `shipSampleInvest(HATCHLING_TYPE_ID)` 로 치환하면 ⑦ 의 벡터는 **바이트 동일**하다(같은 `shipTypeDef`/`shipTreeRange`/`zeroSkillInvest` 호출, 같은 `ti + 2`). → ⑦ 해시 불변이 보장된다. 치환 후 `deno task verify` 로 ⑦ `finalHash=3171968474` 가 유지되는지 **즉시 확인**하라.
3. **config 2개**: `HATCHLING_RUN`(`:275-283`) 형태를 복제하되 —
   - `shipType` / `computeLoadoutStats(..., typeId)` / `skillInvest` 를 해당 타입으로
   - **`planet`·`tier` 는 §1.4 의 무대 선정을 따른다**: 말로우·버블 모두 피해량이 커야 신호가 서므로 `planet: 2, tier: 2`(⑤ 니플헤임 섬멸과 같은 무대) 권장. ⑦ 의 `planet 2 / tier 1` 을 그대로 쓰면 신호가 얇다.
   - `playerHp: DURABLE` 유지(런이 14400틱 버텨야 한다)
4. **시나리오 엔트리 2개 append**(`SCENARIOS` 배열 **맨 뒤**, `:384` 뒤). 이름은 `⑧`·`⑨` 로. `seed` 는 기존과 겹치지 않는 새 값, `checkpointInterval: 600`, `buildInputs: () => driveDurable(seed, CFG, MAX_RUN_TICKS)`, `rolls` 2건(⑦ 형식 그대로, `source` 를 해당 planet/tier 로).
   **배열 순서 변경·중간 삽입 금지** — `fixtures.json` 의 `scenarios` 는 배열이라 인덱스가 밀리면 비교가 통째로 어긋난다.
5. **`tests/denoFixture.test.ts` 갱신 2곳**: `expect(scenarios.length).toBe(7)`(`:44`) → 9, 그리고 `:89-92` 의 "①~⑥ 은 shipType 미지정" 루프가 `s.name.startsWith('⑦')` 만 건너뛰므로 **⑧·⑨ 도 건너뛰도록 확장**해야 한다(안 하면 그 루프가 새 시나리오에서 실패한다). ⑦ 과 같은 형태의 비스트라이커 게이트 케이스를 ⑧·⑨ 에도 추가하라(`shipType === 5/6`, `hasCapstone(mask, SIG_MALLOW_CUSHION / SIG_BUBBLE_FILM)`).
6. ⚠️ **길이 축 주의**: `data/ships/mallow.ts:157`·`data/ships/bubble.ts:156` 은 둘 다 `nodesPerTree: NODES_PER_TREE` 라 노드 수가 **스트라이커와 같은 63**이다(`shipNodeCount = trees.length * (nodesPerTree + 1)`, `data/ships/types.ts:116`). 즉 ⑧·⑨ 는 **"길이가 다른 벡터" 축을 자극하지 않는다** — 그 축은 해츨링(78, `data/ships/hatchling.ts:189`) 전담이다. 문서·주석에 이 사실을 적어 다음 레인이 오해하지 않게 하라.

### 2.3 fixtures 재생성 절차 — 실측

- **ground truth 를 굳히는 곳**: `tests/denoFixture.test.ts:30-50`(파일명은 `denoFixture.test.ts` 다 — 헤더 주석 `:5` 가 "tests/deno-fixture.test.ts" 로 쓰는 것은 오기).
- **재생성 명령**: `npx vitest run`(또는 `npx vitest run tests/denoFixture.test.ts`). 별도 스크립트 없음 — 테스트가 곧 생성기다(`:12` "재생성은 `npm test`로 충분하다").
- **비교 실행**: `cd scripts/deno-verify && deno task verify` → `verify.ts` 가 `fixtures.json` 을 읽어 bit-identical 비교.
- **append-only 인가? → 아니다.** §0 경고 ① 참조. `writeFileSync` 가 전량 덮어쓴다. 기존 엔트리 보존은 **"코드가 안 바뀌면 값도 같다"는 결정론에만 의존**하며, 구조적 보장이 아니다.
- **스트라이커 골든은 이 경로와 무관하다**: `tests/fixtures/striker-prem8.json`(393,890 bytes, 실측)은 `tests/shipHashBaseline.test.ts:43` 이 **읽기만** 하고, `:117-119` 가 `serializeBaseline(ACTUAL) === GOLDEN_TEXT` 로 바이트 동일까지 본다. 시나리오 추가는 이 파일을 건드리지 않는다.

### 2.4 `deno task check` / `deno task bundle` 실제 정의 (실측 인용)

| 경로 | task | 정의 |
|---|---|---|
| `scripts/deno-verify/deno.json` | `verify` | `deno run --allow-read verify.ts` |
| 〃 | `verify-run` / `verify-invasion` / `verify-pve` | `deno run --allow-read verifyRun.ts` / `verifyInvasion.ts` / `verifyPveSample.ts` |
| `supabase/functions/verify-invasion/deno.json` | `check` | `deno check verifyInvasionCore.ts index.ts` |
| 〃 | `bundle` | `deno bundle index.ts -o dist.index.js --config deno.json --platform browser --minify --external jsr:@supabase/supabase-js@2 --external jsr:@supabase/functions-js/edge-runtime.d.ts` + 생성 헤더 주입 `deno eval` |
| `supabase/functions/modules/deno.json` | `check` | `deno check modulesCore.ts index.ts` |
| 〃 | `bundle` | verify-invasion 과 동형(라벨만 `modules`) |
| `supabase/functions/verify-run/deno.json` | `check` / `serve` | `deno check verifyCore.ts index.ts` / `deno run --allow-read --allow-net index.ts` |
| `supabase/functions/verify-pve-sample/deno.json` | `check` / `bundle` | `deno check verifyPveCore.ts index.ts` / verify-invasion 과 동형 |

네 곳 모두 `"unstable": ["sloppy-imports"]`, `"lock": false`. 임무 지시의 "verify-invasion 과 modules 두 곳"은 위 표의 2·3행이다. 로컬 실측 Deno 는 `deno 2.8.0 / v8 14.9.207.2-rusty / typescript 6.0.3`.

### 2.5 시나리오가 "효과가 실제로 발현될 만큼" 긴가 — 판단 기준

`driveDurable` 은 **대부분의 틱이 `emptyInput()`(정지·무발사 입력)** 이다(`scenarios.ts:88`). 이 성질이 타입별로 다르게 작용한다:

| 타입 | driveDurable 적합성 | 근거 |
|---|---|---|
| 2 아크캐스터 | ◎ 정지가 기본이라 과충전이 거의 상시 | `OVERCHARGE_STILL_TICKS = 90` |
| 5 말로우 | ○ **맞아야** 발현 — 정지 파일럿은 접촉 피해를 계속 받으므로 적립은 확실. 다만 **회복은 무피격 180틱**이 필요해 교전 밀도가 너무 높으면 회복 구간이 안 온다 | `CUSHION_RECOVER_TICKS = 180`. p2/t2·3600틱 실측 누적 피해 1364(seed 3311) |
| 6 버블 | ◎ 시간축만 필요 — 14400틱이면 막 34장 | `FILM_PERIOD_TICKS = 420`, 14400/420 ≈ 34 |
| 4 해츨링 | △ **무대 의존** — 킬 수가 무대에 좌우된다 | p0/t0 는 587틱에 12킬, p1/t1 은 5400틱에 8킬(실측) |
| 3 팬텀 | △ 무피격 240틱 필요 — 정지 파일럿은 초반 피격 후 긴 무피격 구간이 생겨 성립하나 시드 의존 | 첫 피격 tick 182/204/738(실측) |

**판단 기준 3항:**
1. **길이**: 필요한 최소 틱(`§1.4`)의 **최소 3배**를 돌려 효과가 반복 발현되게 하라. 14400틱은 5·6 에 충분하다.
2. **입력 성격**: 말로우·버블은 `driveDurable`(정지+피격) 로 충분. 팬텀은 **무피격 구간**이 필요하므로 `driveRoam`(`scenarios.ts:103-116`, 대각 드리프트) 쪽이 오히려 회피가 되어 유리할 수 있다 — 시나리오 추가 시 두 입력 생성기를 모두 시도해 신호가 큰 쪽을 고른다.
3. **공허 런 가드**: `tests/denoFixture.test.ts:65-75` 형식 — `checkpoints.length > 0`, 필요하면 `summary.kills > 0` / `loot.length > 0` 을 새 시나리오에도 단언하라. ⑦ 실측 `loot=29 victory=true` 가 그 기준선이다.

---

## 3. 전체 게이트 명령 목록 — 현재 기준선(전부 직접 실행해 실측)

| # | 명령 (cwd) | 현재 결과 |
|---|---|---|
| 1 | `npx tsc --noEmit` (repo root) | **exit 0, 에러 0** |
| 2 | `npx eslint . --max-warnings 0` (repo root) | **exit 0, 경고 0** |
| 3 | `npx vitest run` (repo root) | **97 파일 / 2070 테스트 통과** — 아래 주석 참조 |
| 4 | `npx vite build` (repo root) | 미실행(읽기 전용 정찰 범위 밖 — 산출물을 만든다). `npm run build` = `tsc --noEmit && vite build` |
| 5 | `deno task verify` (`scripts/deno-verify/`) | **전체 통과: Node ↔ Deno bit-identical.** mathProbe `793092539`, 시나리오 ①~⑦ 전부 PASS |
| 6 | `deno task check` (`supabase/functions/verify-invasion/`) | **통과**(`deno check verifyInvasionCore.ts index.ts`) |
| 7 | `deno task check` (`supabase/functions/modules/`) | **통과**(`deno check modulesCore.ts index.ts`) |
| 8 | `deno task bundle` (위 두 곳) | 미실행 — `dist.index.js` 를 덮어쓰는 산출 명령이라 정찰 범위 밖. 배포 레인에서 실행 |

### ⑤ `deno task verify` 실측 전문(기준선 값 — 시나리오 추가 후 ①~⑦ 이 이 값과 달라지면 회귀다)

```
PASS 수학 표면 프로브  hash=793092539
PASS ① 카르곤 정찰 기본(로밍)                   ticks=4029  finalHash=940615867  ckpt=6  loot=1  victory=true
PASS ② 베르단 교전 + 로드아웃 + 엘리트 어픽스      ticks=14400 finalHash=3645815251 ckpt=24 loot=8  victory=true
PASS ③ 변칙(이상현상) 수락 런                    ticks=2400  finalHash=215462699  ckpt=4  loot=0  victory=false
PASS ④ 유니크 장착 런(과열 드럼 / 관통 자이로)     ticks=14400 finalHash=3646846755 ckpt=24 loot=1  victory=true
PASS ⑤ 니플헤임 섬멸 + 미사일 + 원소 + 스킬투자    ticks=14400 finalHash=1627907535 ckpt=24 loot=23 victory=true
PASS ⑥ 아르케 교전 + 빔 + M3 유니크              ticks=14400 finalHash=3361513563 ckpt=24 loot=14 victory=true
PASS ⑦ 해츨링(비스트라이커 기체) 런               ticks=14400 finalHash=3171968474 ckpt=24 loot=29 victory=true
```

### ③ vitest 기준선에 대한 실측 주석 — 반드시 읽어라

본 정찰이 실행한 `npx vitest run` 의 원출력은 **`Test Files 98 passed (98)` / `Tests 2090 passed (2090)`** 였고, 목록에 `tests/__tmpRecon.test.ts (20 tests)` 가 포함돼 있었다. 그 파일은 실행 직후 `ls`·`git status --porcelain` 어디에도 없다(git status 는 `M supabase/migrations/20260723000000_m7c_seed_rebalance.sql` 한 줄뿐, 이것도 본 정찰이 만든 것이 아니다).

`98 - 1 = 97`, `2090 - 20 = 2070` 으로 **임무가 명시한 기준선 97파일/2070건과 정확히 일치**한다. 결론: 임시 정찰 파일을 만들었다 지운 **동시 세션이 같은 워크트리에서 돌고 있(었)다.** 착수 전에 `git status` · `git log -3 --oneline` · `git worktree list` 로 외부 흔적을 확인하고, 위 migration 파일의 수정분이 본인 것이 아님을 인지한 상태로 시작하라.

### 커밋 전 필수 확인 3줄

1. `git diff -- data/skills.ts` → **반드시 공백**(임무 규율 1). 현재 공백 확인됨.
2. `git diff -- tests/fixtures/striker-prem8.json` → **반드시 공백**(골든 재생성 금지).
3. `git diff -- scripts/deno-verify/fixtures.json` → **추가 엔트리 + `scenarioCount` 외에 기존 해시 변경 0줄**(§0 경고 ①).
