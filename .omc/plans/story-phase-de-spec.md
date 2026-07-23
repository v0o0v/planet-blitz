# 스토리 시스템 Phase D·E 구현 계약 (단일 정본)

> 이 문서는 team ultrawork 워커들이 공유하는 **구현 계약**이다. 정본은 여전히
> `docs/adr/0023-story-event-in-sim.md` + `CONTEXT.md` 서사 섹션 + `data/lore/*` 이고,
> 이 문서는 그 위에서 "누가 어느 파일을 어떤 필드 이름으로 고치는가"를 못박아 **워커 간
> 계약 불일치·파일 레이스**를 없앤다. 브랜치: `feat/story-phase-de`. pnpm 프로젝트
> (`corepack pnpm ...`). co-author: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## 0. 이 저장소의 반복 결함 (반드시 방어)
"단위 테스트 그린인데 배선이 통째로 없다"가 8번 재발했다. **정규 경로 통합 테스트**
(Profile → `buildRunConfig` → `createWorld` → `stepWorld` → 정산)로만 잡힌다. 모든 워커는
자기 변경이 **정규 경로에서 실제로 값을 만들고 소비되는지**를 통합 테스트로 증명해야 한다.

## 1. 결정론 규율 (Phase D — 절대 위반 금지)
`src/sim/replay.ts` `hashWorld` 는 리플레이 재검증의 계약이다(ADR-0005). 위반하면 클라(Node)와
서버(Deno EF) 재실행이 갈려 전 침공/PvE 가 오거부된다.

- **조건부 꼬리 폴드**: 에코 신호 상태는 `shrinkRuntime`/`scrollRuntime` 선례와 **정확히 같은**
  4단 배선으로 넣는다 — ① `WorldState.echoRuntime?` optional 필드 선언, ② `createWorld` 는
  **에코가 실제로 롤인된 런에서만** 세운다(그 외 undefined), ③ exactOptionalPropertyTypes
  조건부 스프레드(`...(x !== undefined ? { echoRuntime: x } : {})`), ④ `hashWorld` 는
  `state.echoRuntime !== undefined` 게이트로 **append-only 맨 꼬리**(shrinkRuntime 폴드 뒤)에만
  정수 필드를 접는다. → **에코 미발생 런(뱀서류·침공·블록격파·레이싱·추격·수축·오염 전부)의
  per-tick 해시가 바이트 단위로 불변**이어야 한다.
- **정수 전용**: echoRuntime 의 모든 해시 필드는 정수(`hashU32`, `>>> 0`). 반경·드웰·틱은 정수.
  실수 상태가 필요하면 엔티티 f64 필드(x/y/timer 아님— timer 는 u32)를 쓰되, 에코는 정수로 충분.
- **RNG 규율**: 에코 롤은 **기존 해시 스트림을 소비하지 않는다.** `state.worldRng.fork('echo')`
  를 쓴다 — `fork` 는 부모(worldRng)를 전진시키지 않으므로 worldRng 의 해시 상태가 불변이다.
  새 상시 RNG 스트림을 `createWorld`/`WorldState` 에 추가하지 마라(그러면 전 런 해시가 갈린다).
  `Math.random`/`Date.now`/전역/플랫폼 trig 금지. 결정론 trig 필요 시 `src/sim/math.ts`.
- **엔티티 kind**: 에코 오브젝트는 신규 kind 가 **필요하면** `KIND_CODE` 에 **29 부터 append**
  (`shelter`=28 다음). 재번호 절대 금지. 신규 kind 는 에코 런에만 등장 → 기존 fixtures 불변.
  가능하면 aux0/aux1·기존 필드 재활용으로 신규 해시 필드를 최소화(shrink 는 런타임 2필드만 추가).
- **바이트 불변 게이트**: `tests/determinism.test.ts`·`tests/shipHashBaseline.test.ts`·
  `tests/invasionHash.test.ts` 는 **REGEN 없이 통과**해야 한다. 만약 이들 골든 시드 중 하나가
  에코를 롤인해 해시가 바뀌면 **즉시 리드에게 보고**하라(silent regen 금지). 이상적으로는 골든
  시드가 전부 에코-negative 여야 한다(에코 확률 3% → 골든 시드 대부분 negative). deno
  픽스처(`scripts/deno-verify/fixtures.json`)는 시드가 에코-positive 인 경우에 한해
  `REGEN_DENO_FIXTURES=1` 로 재생성(의도한 해시 마이그레이션) — 재생성 시 diff 를 리드에 보고.

## 2. 프로필 스키마 계약 (W1 소유 · 모든 워커가 이 이름을 쓴다)
`src/save/profile.ts`:
- **신규 필드 2개**를 `Profile` 인터페이스에 추가(append 위치는 guardians 뒤 권장):
  ```ts
  /** 수집한 기록 파편 id 집합(에코 신호 안정화로 추가). 도감(recordsArchive)이 읽는다. */
  collectedShards: string[];
  /** 사연 챕터3 마일스톤 카운터(metric id → 누적값). 정산 경로에서만 누적. storyUnlock 이 읽는다. */
  storyMetrics: Record<string, number>;
  ```
- `SAVE_VERSION` (`src/items/types.ts`) **5 → 6** 로 올린다.
- `migrate`: `if (version < 6) data = migrateV5toV6(data);` 추가. `migrateV5toV6` 는 스탬프만
  올리고(필드는 normalizeProfile 이 채운다) `saveVersion: 6`.
- `defaultProfile`: `collectedShards: []`, `storyMetrics: {}` 추가.
- `normalizeProfile`: 두 필드 안전 정규화(배열/객체 아니면 빈 값, 값은 유한 정수). 손상 세이브도
  유효 프로필. **정규화 함수 export** 하지 말 것(내부). `storyMetrics` 값은 `numOr(...,0)` 정수화.
- `collectedShards` 는 **중복 없는 집합 의미**지만 저장은 배열. 정규화에서 문자열만·중복 제거.
- ⚠️ `recordsArchive.ts` 의 기존 `collectedShardIds(profile)` 안전 접근은 그대로 동작하되, 이제
  필드가 정식 존재하므로 값이 실제로 채워진다. `storyProgressFromProfile`(storyUnlock)은 §3 참조.

### metric id 계약 (data/lore 정본 = 이 문자열, sim·정산·storyUnlock 이 공유)
`data/lore/index.ts` chapters[2].unlock.metric 값(불변):
| 기체 | metric | threshold(초기값) | 출처 |
|---|---|---|---|
| striker | `runsWon` | 12 | **메타**(승리 런 수) — 정산에서 victory 시 +1 |
| bruiser | `hitsTaken` | 1500 | sim: 플레이어 피격 횟수 |
| arccaster | `overchargeKills` | 400 | sim: 과충전 활성 중 처치 |
| phantom | `cloakBreaks` | 150 | sim: 은신 해제 첫 타 발동 |
| hatchling | `broodLaunches` | 250 | sim: 병아리 드론 출격 |
| mallow | `cushionHealed` | 40000 | sim: 완충 회복 HP 누적 |
| bubble | `filmPops` | 300 | sim: 방막 파열 |

`runsWon` 만 순수 메타(정산 victory 카운트). 나머지 6개는 **sim 이 관측 카운터로 세어**
RunResult 로 실어 정산에서 `profile.storyMetrics[metric] += delta` 로 누적한다.

## 3. storyUnlock 마일스톤 배선 (W1 소유)
`src/ui/pixi/storyUnlock.ts` `storyProgressFromProfile`:
- 현재 `milestoneReached: false` 스텁을 **실제 판정**으로 교체. 그 사연의 챕터3 unlock 이
  `kind:'milestone'` 이면 `profile.storyMetrics[unlock.metric] ?? 0 >= unlock.threshold`.
- `StoryProgress` 순수 판정은 그대로. `chapterUnlocked`·`unlockedChapterCount` 불변.
- 챕터3 unlock 이 milestone 이 아닌 경우 방어(현재 전 기체 milestone 이지만 미래 방어).
- 단위 테스트: metric 충족/미충족으로 챕터3 열림/잠김 판정.

## 4. sim 관측 카운터 (W2 소유 · 비-해시)
`src/sim/world.ts` `WorldState` 에 **비-해시 관측 카운터**를 추가한다(`tainted` 선례 — hashWorld
가 접지 않는 순수 메타데이터라 결정론 무영향). 필드 예:
```ts
/** 사연 마일스톤 관측 카운터(비-해시, tainted 선례). 정산이 RunResult 로 읽어 프로필에 누적. */
hitsTaken: number; overchargeKills: number; cloakBreaks: number;
broodLaunches: number; cushionHealed: number; filmPops: number;
```
- **반드시 hashWorld 에서 접지 않는다**(비-해시). createWorld 에서 0 초기화.
- 각 시그니처 훅 발동 지점(world.ts 기존 배선)에서 +1(또는 회복량 누적):
  - `hitsTaken`: 플레이어가 실제 피해를 입은 지점(iframes 부여 직전, 브루저 무관하게 전 기체 집계).
    ⚠️ **모든 기체**에 대해 세되, storyUnlock 은 bruiser 사연만 이 metric 을 본다.
  - `overchargeKills`: 과충전 bp>0 상태에서 낸 처치.
  - `cloakBreaks`: 은신 해제 첫 타(CLOAK_BREAK 적용) 발동 시.
  - `broodLaunches`: 병아리 드론 출격 시(spawnEventObject 병아리 경로).
  - `cushionHealed`: 완충 회복(`cushionRecovered`/`cushionSettled` 회복분) HP 누적.
  - `filmPops`: 방막 파열 발동 시.
- 이 카운터들은 시그니처 비트가 켜진 런에서만 증가하는 게 자연스럽지만(예 broodLaunches 는
  해츨링만), **훅이 이미 게이트돼 있으므로** 카운트만 얹으면 된다. 미장착 기체는 그 훅에 도달
  안 해 0.

## 5. 에코 신호 sim (W2 소유 · 해시)
신규 모듈 `src/sim/echo.ts`(leaf: world 에서 `import type` 만, events.ts 선례):
- 플레이스홀더 상수(밸런스 = 출시 전 튜닝, 구조만 고정):
  - `ECHO_SPAWN_PROB`(≈0.03, 매우 드묾 — 사용자 의도적 희소), `ECHO_MIN_SPAWN_TICK`(런 초반 배제),
    `ECHO_STABILIZE_RADIUS`(안정화 판정 반경), `ECHO_DWELL_TICKS`(반경 내 누적 체류 목표),
    `ECHO_TRIGGER_RADIUS`(오브젝트 접촉/근접 반경), `ECHO_REWARD_CREDITS`(크레딧 묶음).
- `EchoRuntime`(정수 필드만): 예 `{ state: number; dwell: number }`
  (state: 0 대기/미스폰 전, 1 출현·안정화 진행, 2 안정화 완료·보상 지급됨). 필요 시 `entityId`.
- 롤: `createWorld` 에서 `worldRng.fork('echo')` 로 ① 이 런에 에코가 나오는가(chance ~3%),
  ② 나온다면 스폰 틱(ECHO_MIN_SPAWN_TICK 이후 범위). **positive 일 때만** echoRuntime 을 세운다.
  스폰 틱은 echoRuntime 에 담거나(해시됨) 비-해시 스크래치로 두되, **positive 런만 echoRuntime
  present** 라 조건부 폴드가 성립. (스폰 틱 자체를 접을지는 W2 재량 — 접으면 "언제 나왔나"까지 봉인.)
- 스폰: step 루프에서 `maybeSpawnEcho`(maybeSpawnSupply 선례) — 스폰 틱 도달 시 에코 오브젝트
  1개 스폰(플레이어 주변 오프셋). 런당 1회(echoRuntime.state 게이트).
- 안정화: 플레이어가 `ECHO_STABILIZE_RADIUS` 안에 있으면 `dwell`++(상한 ECHO_DWELL_TICKS),
  밖이면 감소/리셋(설계 재량 — "버티기"). `dwell >= ECHO_DWELL_TICKS` 도달 시 **안정화 성공**:
  - `state.resources += ECHO_REWARD_CREDITS`(**해시된 경제** — 서버가 리플레이로 재검증. ADR-0023
    핵심: 보상이 런 경제에 영향 → sim 안, 해시됨).
  - echoRuntime.state = 2, 에코 오브젝트 dead 처리(또는 안정화 표식).
  - **로어 한 줄 표시**: sim 은 결과 플래그만 낸다(echoRuntime.state===2). UI(main.ts)가 그 전이를
    관측해 로어 토스트 1줄 표시(§7).
- 전투력 불개입: 보상은 크레딧 + 기록 파편(메타)뿐. 적 피해/버프 없음.

## 6. RunResult · 정산 배선 (W2 소유)
`src/save/settlement.ts` `RunResult` 에 **optional** 필드 추가(기존 호출부 무영향):
```ts
/** 에코 안정화로 이번 런에 파편을 획득했는가(sim echoRuntime.state===2 파생). */
echoStabilized?: boolean;
/** 이번 런 사연 마일스톤 관측 델타(metric id → 이번 런 증가분). 정산이 프로필에 누적. */
storyMetricDeltas?: Readonly<Record<string, number>>;
```
`settleRun`:
- **마일스톤 누적**: `storyMetricDeltas` 각 항목을 `profile.storyMetrics[k] = (profile.storyMetrics[k] ?? 0) + v`.
  추가로 **runsWon 은 정산에서**: `if (result.victory) profile.storyMetrics.runsWon = (…)+1`.
  ⚠️ 오염 런(tainted)은 정산 자체가 스킵되므로(main.ts) 위조 카운트 방지는 기존 격리로 커버.
- **파편 수집**: `echoStabilized` 이면 **다음 미수집 파편 1개**를 `profile.collectedShards` 에 append
  (`RECORD_SHARDS` 순서로 첫 미수집 id). 전부 수집됐으면 no-op. 파편 **어느 것**인가는 클라 수집
  결정(경제 아님·서버 재검증 대상 아님) — sim 은 boolean 만 낸다. 중복 append 방지.
- SettlementOutcome 에 표시용 필드(`shardGained?: string`, `milestonesReached?: string[]` 등) 추가는
  재량(결과 오버레이 표시용). 없어도 됨.
`src/main.ts` 정산 호출부(3곳: PvE ~1035, 그 외):
- RunResult 조립에 `echoStabilized: echoStabilizedOf(w)`, `storyMetricDeltas: storyMetricsOf(w)` 추가.
  헬퍼는 world 에서 카운터/echoRuntime 읽는 순수 함수(sim 모듈 또는 settlement 근처).
- **오염 런/하네스 침공 런은 기존대로 정산 스킵**(변경 없음).

## 7. 코스메틱 보상 + 로어 토스트 (W1 데이터/키 · W2 토스트 표시)
- **스티커 확장 금지**: `data/stickers.ts` 는 12-슬롯 고정 서버 계약. 절대 손대지 마라.
- **클라 전용 도감 코스메틱**: 신규 `data/cosmetics.ts`(순수 데이터 + 조회 헬퍼, 서버 무관).
  사연 챕터 해금 시 부여되는 **배지/칭호**를 선언(기체 slug·챕터 index → 코스메틱 id). i18n 키
  `cosmetic.<id>.name` 파생. 이건 **클라 전용**이라 서버 저장 계약 없음 — 보유는 프로필 파생
  (해금된 챕터에서 유도)이거나 별도 클라 필드. **가장 단순**: 코스메틱 보유 = 해금된 챕터에서
  순수 파생(별도 저장 불필요) → recordsArchive/도감에 표시. 저장이 꼭 필요하면 그때 논의.
  ⚠️ 크레딧(ChapterReward.credits)은 이미 lore 데이터에 있음 — 챕터 해금 순간 1회 지급 로직이
  필요하면 W1 이 "해금 이벤트→보상" 훅을 설계(중복 지급 방지: 지급 완료 표식). **단, 서버 권위
  자원 위조 이슈는 별개 과제** — 지금은 기존 클라 profile.credits 경로 그대로.
- **i18n 키(W1 소유, catalog.ts EN/KO 둘 다)**: 에코 안정화 로어 토스트(`echo.stabilized.toast` 등),
  파편 획득 알림(`shard.gained` 등), 코스메틱 이름. 키 없으면 `tests/i18n.test.ts` 빨간불.
- **로어 토스트 표시(W2)**: main.ts 렌더 루프가 echoRuntime 안정화 전이를 관측해 기존 토스트/HUD
  인프라로 1줄 표시. 없으면 최소 구현(과잉 UI 금지).

## 8. EF 재배포 (리드 소유, 구현 후)
`verify-pve-sample` + `verify-invasion` 두 함수 소스에 에코 로직 반영 후 재배포(spb 래퍼,
detached 클린 워크트리 번들, **번들 소스 커밋 기록 + 배포 직후 origin/main 최신 대조** — 1회차
v17 무효 재발 방지). sim 코드가 공유되면(두 함수가 src/sim 을 번들) 별도 수정 없이 재번들만 필요할
수 있음 — W2/W3 가 함수 소스 구조를 확인해 리드에 보고.

## 9. 검증 게이트 (각 PR 전 · 리드 최종)
- `corepack pnpm -s exec tsc --noEmit` + `corepack pnpm lint` + `corepack pnpm test` **그린**.
- 정규 경로 통합 테스트 포함(§0). 결정론 바이트 불변 게이트(§1) 통과.
- 브라우저 하네스 실경로(`?harness=1` → `window.__pb`) — 스크린샷 불가 시 씬그래프/상태로.
