# PA 레인 계약 — 의뢰 런 구간 전환 코어

- 범위: 계획 `.omc/plans/commission-system-consensus.md` **§Phase 0 · §PB0 · §Phase A**
- 이 절들은 6라운드 검토에서 **매번 다시 맞았고 마지막 검토에서 새 결함 0건**이다. **그대로 구현한다.**
- 대상 워크트리: `cm-lane-pa` / 브랜치 `feat/commission-transition-core`
- 기준 커밋: `origin/main` = `6fe6756`

---

## 0. 착수 전 확인된 사실 (전수 대조 완료 — 2026-07-31)

계획이 인용한 좌표를 **전부 현재 코드와 대조**했다. 아래 6건만 어긋났고 나머지는 전부 일치한다.

| 계획 인용 | **실제** |
|---|---|
| `main.ts:1304-1320` (createWorld 인근) | `createWorld` 는 **1303**, aliasing 경고 주석은 **1304-1321**, `recorder =` 는 **1322** |
| `main.ts:1443-1470` | 블록 시작은 **1442** (`const creditsGained`) |
| `harness/core.ts:678-685` / `:707-712` | 본문은 맞으나 **메서드 선언은 677 / 706** |
| `runConfig.ts:191-195` planetMult 조건부 스탬프 | 조건부 스탬프 본체는 **190-192**. `195` 는 별개(`planetMultEpoch` 무조건 스탬프) |
| `world.ts:1089-1231` (createWorld 범위) | 함수는 **1000-1240**. state 리터럴 **1129-1205**, 진입 훅 **1208-1238**, `return state` **1239** |
| **"침공 골든 18건"** | **실측과 다르다 — §7 참조. AC 문구를 고쳐야 한다** |

### 0-1. 새로 확정된 수치

- **`WorldState` 는 61필드**(`src/sim/world.ts:746-985`, optional 7개). 계획은 개수를 세지 않았다.
  전수 대조 게이트는 이 61개를 전부 덮어야 한다.
- **플레이어 `Entity` 는 정확히 25필드**(`src/sim/entities.ts:126-175`). 계획의 25 **일치**.
- **`stepWorld` 소비처**: `src/` 20파일 56건 · `tests/` 89파일 532건 · **`scripts/` 5파일 13건** ·
  `data/` 1파일 1건 = **115파일 602건**(계획의 "113파일 595건"은 집계 기준 차이).
- **`tsconfig.json` 의 `include` 는 `["src","tests","data","vite.config.ts","eslint.config.js"]`** —
  `scripts` 가 없다. `stepWorld` 를 쓰는 `scripts/` 5파일:
  `scripts/deno-verify/{common,scenarios,verifyInvasion}.ts` · `scripts/record{Striker,Encounter}Baseline.ts`.

---

## 1. P0 — 상수 모듈 + 밸런스 큐

- **`.omc/plans/balance-queue.md` 는 이미 생성했다**(이 레인, 2026-07-31). 신규 밸런스 유예는 거기 등재.
- **상수 모듈**을 신설한다. 위치: `src/run/commissionConstants.ts` (또는 `data/commission.ts` — 데이터
  성격이면 후자). Phase D~F 가 이것을 읽는다. **하드코딩 금지.**
- 현재 값은 전부 **플레이스홀더**이며 그렇게 주석에 명시한다: 계급별 구간 수 2/3/4/5 · 구간당 틱 상한
  9,000. **진짜 값은 PC 실측 게이트가 정한다.**

## 2. PB0 — `CommissionPayload` 스키마

계획 §Phase B0 그대로. `equipRules` 는 **형태만** 정하고 개별 항목은 PD 가 채운다 —
`equipRules?: { bannedSlots?: SlotId[]; bannedUniqueIds?: number[]; maxRarity?: number }` 같은 **열린 레코드**.

## 3. A-1 — `runConfig` 단일 정본에 `commission?` 추가

- `RunConfigOpts`(`src/run/runConfig.ts:46-89`)에 `commission?: CommissionRunConfig` 추가.
- **조건부 스탬프** — 미지정이면 필드 자체를 안 싣는다. 선례가 둘 있고 둘 다 이 파일에 있다:
  `planetMultCenti`(`:190-192`) · `activeSlotsWire`(빈 배열이면 미탑재, `:152-159`).
  `tests/activeSkillRunConfig.test.ts:41` 이 "조건부 스탬프 = 골든 JSON 바이트 불변" 축의 직접 선례다.
- `SegmentSpec` 에 **`mode` 필드를 두지 않는다** — `planetMode` 는 `planetContent(planet).mode` 파생이
  단일 정본이다(`runConfig.ts:186`).
- **성장축 제약은 config 에 실린다** — `constraints.bannedPowerupLines`. 서버가 대조해야 하기 때문이다.
- ⚠️ 파일 머리말(`:1-27`)이 "신규 런 입력은 반드시 여기에만 추가"를 못 박고
  `tests/shipIntegration.test.ts` 의 grep 게이트가 `main.ts` 재중복을 막는다. **그 게이트를 통과해야 한다.**

## 4. A-2 — 구간 config 계승 기본 + 무대 차집합

- `nextCfg = { ...prev.config, ...stageOverride(seg) }`.
  `stageOverride` 는 **좁은 리터럴**: `planet` · `stage` · `planetMode` · `arenaWidth/Height` ·
  `maxSegments` · `commission`(segmentIndex 갱신분).
- `createWorld(seed, cfg, { preDerived: true })` 가 **`world.ts:1018-1061` 굽기를 건너뛴다.**
  - 범위 확인 완료: `catalystMods`(`:1009`)·`planetMult`(`:1013`)는 그 블록 **밖**이라 승계 config
    로부터 정상 재도출된다. `weapon`·`magnetRadius` 는 승계가 덮는다.
- ⚠️ `createWorld` 는 `cfg = { ...config }` **얕은 사본**(`:1001`)을 만든 뒤 그 사본을 **변형**한다.
  `preDerived` 분기가 그 변형을 건너뛰어야 하며, **승계 config 를 그 사본이 오염시키지 않아야 한다.**

## 5. A-3 — 구간 종료 감지 3분기

편집 지점은 `compact()` 보스 사망 분기 **한 곳**(`world.ts:3784-3798`). 유일성 확인 완료 —
PvE 에서 `victory=true` 를 세우는 곳은 `:3782`(코어, 침공 전용)와 `:3788`(보스) 둘뿐이고
레이싱·블록격파·추격도 결국 `'boss'` kind 사망을 통과한다.

| 분기 | 조건 | 결과 |
|---|---|---|
| ① 중간 구간 종료 | 보스 처치 **또는** 표적 도주, `segmentIndex < length-1` | `segmentDone = 1` |
| ② 마지막 구간 완수 | 보스 처치(또는 표적 **처치**), `segmentIndex === length-1` | `victory = true` |
| ③ **마지막 구간 실패** | **표적 도주**, `segmentIndex === length-1` | **`gameOver = true`** |

⚠️ **③ 을 ② 로 떨어뜨리면 의뢰 실패가 성공으로 판정된다.** 스펙 AC `:75` 의 정반대이고, ADR-0044 가
위조 가치 최고로 지목한 확정 유니크 지급 경로에서 벌어지는 오판이다. **전용 테스트 3건 필수.**

`bossKilled`·`rollBossDrop` → `state.loot` push(`:3793-3797`), 엘리트 loot push(`:3802-3808`)는 **그대로 둔다.**

**A-3b 종료 플래그 우선순위 계약**: `gameOver`/`victory` 가 `segmentDone` 을 **무조건 이긴다.**
`advanceCommissionSegment` 첫 줄이 `if (prev.gameOver || prev.victory) return prev`.
근거 — 보스를 죽인 그 틱에 잔존 적·탄이 플레이어를 죽이면 `checkGameOver`(`world.ts:3853-3854`)가
같은 틱에 `gameOver` 를 세운다. 루프 층이 `segmentDone` 만 보면 **죽은 런이 다음 구간을 연다.**

## 6. A-4 — `stepRun` + 새 월드 반환

```ts
export function stepRun(state: WorldState, input: InputFrame): WorldState
//   stepWorld → segmentDone && !gameOver && !victory && !프리즈 이면
//   advanceCommissionSegment → 새 월드 반환. 아니면 항등(prev) 반환.
```

**호출 순서 계약은 하나다: advance 는 `stepWorld` 직후·다음 `stepWorld` 이전.**
(rev2 의 "hashWorld 기록 사이"는 틀렸다 — **클라 루프에 `hashWorld` 가 없다.** `stepOnce`
(`main.ts:1363-1371`)는 `record → stepWorld → snapshot → observe` 뿐이고, 클라 해시는 정산 시점에
`runReplay` 재실행으로 얻는다.)

⚠️ **이 계약 위반의 증상**: 클라·서버 **둘 다 `runReplay`** 를 쓰므로 해시는 절대 안 갈리고,
대신 **실제 플레이한 런과 정산되는 런이 갈린다**(PR#191 계열 결함).

**마지막 틱 전환 금지**: 중간 구간의 마지막 입력 프레임 뒤에 전환이 일어나면 `runReplay` 의
`finalState` 가 한 틱도 안 돈 새 월드가 되고, `verify-run/verifyCore.ts:190-191` 이 읽는
`victory`/`gameOver` 가 둘 다 `false` 라 `outcome-mismatch` 가 난다.

### 6-1. ⚠️ `runReplay` 가 반드시 바뀐다

`src/sim/replay.ts:653-662` 의 `runReplay` 는 **월드를 한 번만 만들고**
`for (const input of replay.inputs) { stepWorld; hashes.push(hashWorld) }` 를 돈다.
구간마다 새 월드를 만드는 설계이므로 **여기가 `stepRun` 기반으로 바뀌어야 한다.**
계획이 "`runReplay` 는 `stepRun` 호출로 3줄만 바뀐다"고 한 것이 이 자리다.
**`verify-run/verifyCore.ts` 는 diff 0 이어야 한다**(머지 하드 게이트).

### 6-2. A-4b — 월드 참조를 스텝 루프 밖으로 캐시하지 않는다

수정 대상(전부 실측 확인됨):

| 위치 | 현상 | 조치 |
|---|---|---|
| `src/main.ts:1594` | 티커 프레임 최상단 `const w = world;` + `:1626` 캐치업 `while` | **캐치업 루프 이후 재조회** |
| `src/harness/core.ts:678-685`(`ff`) | 루프 밖 `host.getWorld()`, 안에서 `stepOnce` 반복 + `autopilotInput(world)` | **루프 안에서 재조회** |
| `src/harness/core.ts:707-712`(`step`) | 동일 | **루프 안에서 재조회** |

- ⚠️ **정산은 티커 루프 본문에 없다.** 종료 판정 단일면은 `settleIfRunOver()`
  (`main.ts:1568-1573`)이고 `endRun` 은 `main.ts:1374`. 하네스 `ff` 도 같은 함수를 부른다.
  **`endRun(w)` 에 넘기는 `w` 가 캐치업 이후 재조회된 것이어야 한다.**
- `stepThrough`(`replay.ts:668-675`)는 **세 번째 스텝 루프**다(프로덕션 호출부 0건, 테스트 전용).
  `stepRun` 기반으로 고치거나 의뢰 config 를 타입으로 막는다.
- `main.ts:2138` 에도 `stepWorld` 직접 호출이 있다(하네스 경로). `main.ts:313` 주석이
  "`stepWorld` 직접 호출 금지"를 못 박고 있으므로 **함께 본다.**
- **게이트**: 루프 앞 월드 바인딩(`= host.getWorld()` / `= world;`)을 탐지하는 **grep 게이트**를
  추가한다. 타입으로 표현할 방법을 못 찾았다 — 자인하고 grep 으로 간다.

### 6-3. 전환 시 렌더 리셋

- `entityRenderer.reset()` 필요 — 새 월드가 `nextEntityId` 를 1 로 되돌리므로 안 부르면 2구간 적이
  1구간 스프라이트를 물려받는다(`src/render/entityRenderer.ts:679` 가 엔티티 id 키 캐시,
  `reset()` 은 현재 `startRun` 에서만 — `main.ts:1302`).
- `prevSnap`/`currSnap` 보간(`main.ts:1323-1324`)도 리셋.
- ⚠️ **`next !== prev` 일 때만 부른다.** 무조건 부르면 프리즈된 틱마다 스프라이트 캐시가 날아간다.

### 6-4. `stepWorld` 봉인 — 린트·grep 방어임을 자인한다

**구조적 봉인이 아니다.** 소비처 115파일 602건 중 `tests/` 89파일 이관 비용 대비 이득이 낮다고
판단해 받아들인 트레이드오프다. 따라서 **방어를 실행에 배정한다**:

1. **eslint `no-restricted-imports`** — ⚠️ **기존 블록을 재사용할 수 없다.**
   현재 `simCoreRestrictions`(`eslint.config.js:31-70`)의 적용 대상은 `files: ['src/sim/**/*.ts','data/**/*.ts']`
   이고 그 규칙은 **sim 이 pixi·render·ui·input 을 못 당기게** 하는 것이다. 방향이 반대다.
   → **새 블록**을 추가한다: `src/**` 중 `src/sim/**` 을 제외한 대상에서 `stepWorld` 직접 import 금지.
2. **`tsconfig.scripts.json` 신설** + `pnpm exec tsc -p tsconfig.scripts.json --noEmit` 를 검증에 배정.
   없으면 `stepWorld` 관련 변경이 **tsc·vitest 그린인 채 Deno 검증 하네스만 런타임에 깨진다.**
   - `scripts/deno-verify/*.ts` 는 Deno 대상이라 Node 타입과 충돌할 수 있다. `include` 를 `scripts/**`
     로 잡되 필요한 `lib`/`types` 를 별도로 준다. **`tests/denoFixture.test.ts:31` 이
     `scripts/deno-verify/scenarios.js` 를 import 하므로 그 경로만 이미 간접 타입체크된다** —
     나머지 4파일이 진짜 사각지대다.
3. **grep 게이트**: 의뢰 config 를 쓰는 테스트는 `stepRun` 강제.

## 7. A-5 — 승계 계약 (범위: `WorldState` 61필드 + 플레이어 `Entity` 25필드)

**분류 원칙**: **안전망·부활류는 런 단위**(곱해지면 난이도 붕괴), **페이싱·주기류는 무대 단위**.

`tick` 은 **구간별 0 리셋**. 누적은 `commissionRuntime.totalTicks`.
- 근거: 승계하면 절대-틱 임계 로직 전 계열이 잠재 결함이 된다. 실증 —
  `SUPPLY_SPAWN_TICKS = [1800, 6000]`(`world.ts:359`) + `maybeSpawnSupply`(`:3071-3082`)는
  `state.tick < nextTick` 으로만 판정하는데 새 월드는 `supplyNextIndex: 0`(`:1165`)이라,
  `tick` 이 9,000대면 **2구간 첫 두 틱에 보급선 2기가 몰리고 그 뒤 영원히 0기**다.
  결정론적이라 해시가 안 갈리고 밸런스 이상으로만 보인다.
- **구간 곱셈을 인지·수용한다** — 전부 페이싱·주기류라 무대 단위가 옳다.
  `.omc/plans/balance-queue.md` §A 에 R13-a~d 로 등재 완료.

### 플레이어 `Entity` 25필드 분류

| 분류 | 필드 | 근거 |
|---|---|---|
| **승계 — 런 단위 안전망** | `targetX` | `CAP_SURVIVAL_CRIT` **런당 1회** 치명 무효 소진 표식(`world.ts:3573-3577`). 리셋하면 **N구간 = N회 부활** |
| | `hp` / `maxHp` | 런 승계의 핵심 |
| | `aux0` / `aux1` | 기체 시그니처 런타임 |
| **승계 — 쿨다운** | `targetY` | 위상 전환막 내부 쿨다운(`world.ts:1731-1733`) |
| | `ownerId` | `UQ_DRONE_BAY` 소환 간격(`world.ts:2716-2729`) |
| | `cooldown` / `dashCooldown` | 무기·대시 쿨다운 |
| **RESET_ZERO** | `iframes` | 피격 무적 — 문맥이 무대와 함께 사라진다 |
| | `phase` | `UQ_OVERHEAT_DRUM` 연속 명중 스택. **`combo` 와 같은 결** |
| | `timer` | 일반 타이머 |
| **FRESH** | `x` `y` `vx` `vy` `angle` `radius` `life` `damage` `pierce` `enemyType` `id` `kind` `dead` | 무대 진입 시 재설정 |

**기체별 `aux0`/`aux1` 승계 영향**(정본 `world.ts:1811-1816`) — 6기체 중 **말로우만 불리**
(적립 지연 피해가 무대를 넘어 터진다). **해츨링은 `aux0`(kills 스냅샷)이 `state.kills` 와 결합**돼
있어 둘 다 승계해야 정합. 비대칭은 밸런스 큐 R10·R10b 에 등재 완료.

### `WorldState` 승계

**CARRY**: `xp`/`xpTotal`/`level` · `weapon` · `magnetRadius`/`magnetBuffTicks` · `loot` ·
`resources`/`catalystResourceMilli` · `kills`/`gems` · `maxCombo` · **`tainted`(OR 누적)** ·
액티브 4정수(`activeCd0`·`activeCd1`·`activeBuff0`·`activeBuff1`) · 사연 카운터 6개
(`hitsTaken`·`overchargeKills`·`cloakBreaks`·`broodLaunches`·`cushionHealed`·`filmPops`) ·
`commissionRuntime`

⚠️ **`tainted` 리셋 시 1구간의 치트·하네스 개입이 전환 한 번으로 세탁**되고 정산 제외의 유일한
게이트(`main.ts:1410`, ADR-0008)가 무력화된다.
`maxCombo` 는 해시 대상(`replay.ts:314`)이자 런 지표라 승계.
**`sigBit` 는 승계하지 않는다** — `createWorld` 가 승계 config 로부터 재계산한다(`world.ts:1150`).

**미승계(FRESH)**: `tick` · `entities`(플레이어 제외) · `wave` · 모드 런타임 전부
(`scrollRuntime`·`shrinkRuntime`·`echoRuntime`·`encounterRuntime`·`moduleRuntime`·`invasion3`) ·
`supplyNextIndex` · `grid`/`generatedChunks`/`activeWalls`/`wallIndex` · `combo`/`comboTimer` ·
`playerSlowTicks` · `powerupChoices`/`pendingLevelUp` · `bossSpawned`/`victory`/`gameOver` · `sigBit` ·
7개 RNG(`rng`·`waveRng`·`powerupRng`·`supplyRng`·`worldRng`·`dropRng`·`eliteRng`) ·
`config` · `nextEntityId` · `playerId` · `bulletCap` · `enemyBulletCount` · `invasion3Bombs` ·
`catalystMods` · `planetMult`

> **61개가 CARRY ∪ RESET_ZERO ∪ FRESH 로 빠짐없이 분류돼야 한다.** 위 목록은 초안이며,
> 구현 시 **컴파일러가 누락을 잡게** 만드는 것이 본질이다(아래 §7-1).

### 7-1. 검증 — 뮤테이션 + 전수 대조 **병용**

**둘 다 필요하다. 어느 하나로는 못 잡는다.**

- **전수 대조**: `CARRY`/`RESET_ZERO`/`FRESH` 합집합이 `keyof WorldState`(61) 및 플레이어
  `keyof Entity`(25)와 **정확히 일치**함을 exhaustive 매핑으로 단언.
  형태: `const CARRY = [...] as const` + `type _Miss = Exclude<keyof WorldState, ...>` **양방향**,
  또는 `Record<keyof WorldState, 'carry'|'reset'|'fresh'>` 를 `satisfies` 로.
  - ⚠️ `noUnusedLocals: true` 라 검사용 alias 는 export 하거나 소비해야 tsc 를 통과한다.
  - ⚠️ **`keyof` 는 선언된 키만 본다** — 중첩 런타임 객체 내부는 못 본다. 현재는 전부 미승계라
    성립하지만 **한계를 주석으로 못 박는다.**
  - ⚠️ `exactOptionalPropertyTypes: true` 이고 optional 키 7개(`moduleRuntime`·`invasion3`·
    `scrollRuntime`·`shrinkRuntime`·`echoRuntime`·`encounterRuntime` + ...)가 있다. `keyof` 는
    optional 을 포함하므로 유니온 도출을 방해하지 않는다.
- **뮤테이션**: `carryAcrossSegment` 에서 임의 한 필드를 제거하면 승계 불변식 테스트가 **실패**해야 한다.

> **왜 병용인가**: 뮤테이션은 목록에 *있는* 필드의 진단력만 증명한다. 목록에 **없는** 필드는 제거할
> 것이 없어 **원리적으로 못 잡고**, Architect 가 잡은 결함 2건(플레이어 `Entity` 누락 ·
> `tick`/`supplyNextIndex`)이 **정확히 그 사각지대**에서 나왔다.

## 8. A-6 — `hashWorld` 의뢰 꼬리 폴드

- **위치: `activeSlots` 폴드(`replay.ts:600-604`) 바로 뒤.** 그것이 **현재 맨 마지막 폴드**임을 확인했다.
  append-only.
- 조건: `config.commission !== undefined`. 이 조건은 **런 내내 불변**이라 조건 자체가 토글되는
  액티브 쿨다운 꼬리(`:585-594`)보다 한 등급 안전하다. all-or-nothing 고정 폭 유지.
- 접는 값: `segments.length` · `segmentIndex` · `segmentDone` · `order` · `grade`.
- **접지 않는 것**: `planet`·`stage`(본문에서 이미 접힌다 — `:342`, `:345`) ·
  `totalTicks`(스트림 인덱스 i 에서 `totalTicks === i+1` 이라 정보량 0. 파생 폴드 금지 규율 `:559-561`).
- ⚠️ **이 폴드는 장식이 아니라 스트림 무결성의 하중 부재다.** `tick` 이 구간마다 0 으로 돌아가므로
  같은 행성·같은 단계가 반복되는 조합에서는 **`segmentIndex` 가 유일한 판별자**다.
- **의뢰 술어 단일화**: `config.commission` 이 정본, 런타임은 파생.

## 9. A-7 — 조우·에코·중반 격전 억제

- `createWorld` 는 비-침공 런에서 `rollEcho`(`world.ts:1109`)·`rollEncounter`(`:1126`)를 무조건 굴린다.
  의뢰 런에서 억제한다.
- **근거 정정**: "굴리고 버리면 RNG 가 전진한다"는 **틀렸다** — 둘 다 `worldRng.fork(...)` 만 쓰고
  부모를 소비하지 않는다(`rng.ts:98-102` 로 확증). 진짜 근거는 **런타임 객체가 존재하면 조건부 꼬리
  폴드가 켜지고**(`replay.ts:501-507`, `:538-549`) **`stepEcho`/`stepEncounter` 가 상태를 갖는다**는 것.
- 중반 격전은 `waves.ts:164` 의 `seg.clash` 분기를 억제(`SEGMENTS[3].clash === true`,
  정의는 `data/waves.ts:283`).
- A-4 의 **detour 가드는 제거**한다 — `encounterRuntime` 이 아예 없으므로 도달 불가 사문 코드다.
  프리즈 가드만 남긴다.

## 10. A-8 / A-8b — 최고 클리어 미갱신 + 정산 경로

- **A-8**: `src/save/settlement.ts:177-178` 이 `recordPlanetClear` 를 무조건 실행한다
  (가드는 `:177` `if (result.victory && result.planet !== undefined && result.stage !== undefined)`).
  `RunResult`(`:57-94`) / `SettlementOutcome`(`:97-122`) 에 `commission: boolean` 을 배선하고
  호출을 게이트한다. **`endRun` → `settleRun` 경로 전체가 대상이라 비자명하다.**
  - ⚠️ 그 줄의 주석(`:175-176`)이 "누락 시 개방 영영 안 됨 — 핵심 배선"이라고 못 박고 있다.
    **일반 PvE 는 반드시 계속 갱신돼야 한다.** 게이트를 잘못 걸면 정반대 회귀가 난다.
- **A-8b**(D5·D10~D12): 의뢰 런은 클라 `settlePveRunCurrency` 경로를 **타지 않는다.**
  단 **사연 보상만 `grantCurrency(…, 'story')` 별도 호출**한다(D11) — 안 하면 claim 은 소모되고
  크레딧이 증발한다.
  - ⚠️ **이 축의 서버 쪽 계약은 서버 레인(`cm-lane-srv`)이 확정한다.** PA 레인은 **클라 분기와
    `RunResult`/`SettlementOutcome` 배선까지만** 하고, 실제 RPC 호출 형태는 서버 레인 계약을 기다린다.
  - `main.ts:1442-1470` 의 `isNetConfigured()` 분기가 대상.
  - `main.ts:1510` `timeSec: w.tick / 60` 은 **`finalTick` 과 무관한 별도 표시 경로**이고,
    다구간에서는 마지막 구간 시간만 보이므로 **누적 틱 기준으로 고쳐야 한다**(표시 결함).
  - `finalTick` 은 프로덕션에서 `w.tick` 을 싣는 곳이 **`main.ts:1450` 한 곳뿐**이고 그것은
    `settlePveRunCurrency` 인자 안이다. 나머지 `finalTick`(`invasion.ts:221,224,657` ·
    미호출 `pveRun.ts:30,33,46`)은 전부 **`replay.inputs.length` 에서 온다** — 다구간에서도 자동으로
    누적 길이가 된다.

---

## 11. 머지 하드 게이트

### 회귀 (⚠️ **이 4건은 무의뢰 런만 밟아 신규 코드에 대해 항진이다**)

- [ ] 무의뢰 PvE 런 per-tick 해시 스트림이 변경 전 커밋과 **바이트 동일**
      (detached 워크트리 기준선 대조)
- [ ] **침공 해시 골든 통과** ← **AC 문구 정정 필요, §12**
- [ ] `INVASION_HASH_VERSION` **3** 그대로 (`src/sim/invasion/constants.ts:170`)
- [ ] `verify-run/verifyCore.ts` **diff 0 줄**
- [ ] `verify-invasion` EF 재배포 없이 기존 침공 리플레이 계속 accept

### 진단력 (**실제로 실패하는지 확인 후 되돌린다**)

- [ ] **전수 대조**: `WorldState` 또는 `Entity` 에 필드를 추가하면 **컴파일 또는 테스트가 깨진다**
- [ ] **뮤테이션**: `carryAcrossSegment` 에서 한 필드 제거 시 승계 불변식 테스트가 **실패**
- [ ] `preDerived` 분기 무력화 시 "파워업 0회 스탯 동일" 테스트가 **실패**
- [ ] 의뢰 꼬리 폴드 제거 시 전환 골든이 **실패**
- [ ] 조우 억제(A-7) 무력화 시 "의뢰 런에 조우 미등장" 테스트가 **실패**
- [ ] `main.ts` 캐치업 루프의 월드 재조회를 되돌리면 **참조 캐싱 테스트가 실패**

### 검증 실행 (이 리포에 **CI 가 없다** — `.github/` 부재. 전부 머지 전 수동)

1. `pnpm test` — **`| tail` 로 파이프하지 마라**(exit code 가 tail 것이 되어 거짓 그린)
2. `pnpm build` (= `tsc --noEmit && vite build`) — **테스트 추가 후 반드시 재실행**(node-shims 전례)
3. `pnpm lint` (= `eslint . --max-warnings 0`) — `no-restricted-imports` 새 블록이 실제로 도는지 확인
4. **`pnpm exec tsc -p tsconfig.scripts.json --noEmit`** (신설)
5. `scripts/deno-verify` 실행 — Deno 가 `src/sim` 을 소스 그대로 import 하므로
   **tsc·vitest 그린과 무관하게 여기서만 드러나는 결함이 있다**

---

## 12. ⚠️ AC 정정 — "침공 골든 18건"은 실측과 다르다

계획 AC 는 "침공 골든 18건 전량 통과"라고 쓰지만, **실측 결과 해시 골든 배열은 그 숫자가 아니다**:

| 자산 | 실제 내용 |
|---|---|
| `tests/fixtures/encounter-baseline.json` | `invasion[]` = **3런 × 900틱** per-tick 해시 (+`pve[]` = 12런 × 1800틱) |
| `tests/fixtures/striker-prem8.json` | 12런 × 6000틱 per-tick 해시 (무의뢰 PvE 기준선) |
| `scripts/deno-verify/fixtures.json` | `meta.scenarioCount` = **13** (Deno/Node 크로스 대조) |

`invasion*.test.ts` 파일은 **19개**(렌더/에셋 2개 포함)이고 대부분 **골든 배열이 아니라 어써션 기반**
이다. "18건"은 아마 그 파일 수를 가리킨 것으로 보인다.

→ **AC 를 다음으로 교체한다** (숫자를 세지 말고 명령으로 적는다):
- [ ] **`tests/` 의 `invasion*` 테스트 전량 통과**
- [ ] **`encounter-baseline.json` 의 `invasion` 3런 per-tick 해시 바이트 불변**
- [ ] **`striker-prem8.json` 12런 per-tick 해시 바이트 불변**
- [ ] **`scripts/deno-verify/fixtures.json` 13 시나리오 전량 통과**

> 계획의 "18건"을 그대로 AC 에 쓰면 **무엇을 통과시켜야 하는지가 흐려진다.** 이 리포는
> "AC 목록의 길이를 방어의 완결성으로 읽지 말 것"을 이미 규율로 적었다(계획 §서버·검증 말미).

---

## 13. 서버 레인과의 경계

| 축 | PA 레인 | 서버 레인(`cm-lane-srv`) |
|---|---|---|
| `CommissionPayload` **스키마 타입** | **PA 가 정의**(PB0) — sim·config 가 읽는다 | 그 타입을 읽어 `payload jsonb` 계약으로 쓴다 |
| `commission?` config 스탬프 | **PA** | — |
| 승계·전환·해시 폴드 | **PA** | — |
| `RunResult.commission` 배선 | **PA** | — |
| `settlePveRunCurrency` 미탑승 분기 | **PA**(클라 분기까지) | RPC 형태 확정 |
| `grantCurrency(…,'story')` 별도 호출 | **PA**(호출 배선) | `source='story'` 캡 확인 |
| 원장 테이블·RPC·cron·EF | — | **서버** |
| 상수 모듈 실값 | PA 가 **골격**(플레이스홀더) | PC 실측 게이트가 **실값** |

**공유 편집 지점은 `CommissionPayload` 타입 하나뿐**이다. PA 가 먼저 커밋하고 서버 레인이 그것을 읽는다.
