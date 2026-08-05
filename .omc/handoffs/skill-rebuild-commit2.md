# 인계 — ADR-0049 커밋 2 (`skillInvest` 와이어 재정의)

> 이 문서는 **설계가 아니라 인계**다. 설계 정본은 `docs/adr/0049-…` + `.omc/plans/skill-rebuild-2026-08-05/**`
> 이고 여기를 고쳐서 설계를 바꾸지 않는다. 여기 적는 것은 **구현 레인이 실측으로 알아낸 것**과
> **한 원자에 무엇이 들어가야 하는가**뿐이다.

## 레인 형태 — 한 PR 안에 커밋을 쌓는다

브랜치 `feat/skill-rebuild-adr-0049`. 커밋 2~8 은 **중간 상태가 깨져 있는 것이 정상**이라
(스킬이 스탯에서 메커닉으로 옮겨 가는 동안 파생 스탯이 0 인 창이 열린다) 레인당 1 PR 규약을
따른다(`affixes.md` ⑥-2 ⚠️). 선결 E2 만은 스킬과 무관한 현행 결함이라 **먼저 독립 PR 로
나갔다**(#316 봉합 · #317 회귀 가드, 둘 다 머지 완료).

## 실측으로 확인한 것 (설계 문서가 예상과 달랐던 지점)

1. **E2 는 `invasionHash` 골든을 갈지 않았다.** `prerequisites.md` §1 재생성 표는 갈릴 것으로
   적었으나 실측상 불변이다 — 원인은 "골든이 이미 맞아서"가 아니라 **커버리지가 0** 이기
   때문이다. 저장 골든 셋의 침공 시나리오는 전부 스트라이커·액티브 미장착·무입력 900틱이고
   (`scripts/recordEncounterBaseline.ts:171-187`), deno 시나리오 13건 중 `activeSlots` 를 실은
   것은 브루저 하나뿐이다. **픽스처 그린을 안전 신호로 읽지 마라.** #317 이 그 조합을 직접
   태우는 테스트를 신설했다.
2. **`GuardianBuild.skillInvest` 를 `prerequisites.md` 가 다루지 않는다.** 그 벡터는 서버에
   저장되고 클라가 읽을 때 `normalizeSkillInvest`(`src/save/profile.ts:838`)가 새 길이로
   자른다 → 구 63/78칸의 앞 30칸이 **새 레이아웃의 스킬 레벨로 재해석**된다. 노출 경로는
   예비역 소집(`callupPilot.ts:42` → `buildRunConfig`)이라 플레이어가 투자한 적 없는 스킬이
   공짜로 해금된다(ADR-0049 "해금은 포인트로만" 위반). 방어 스냅샷은 퇴역 시점에 이미 동결돼
   있어 영향 없다.
   - **결정(사용자 승인 2026-08-06): 길이로 구분해 0 처리.** 벡터 길이가 신규 노드 수와 다르면
     구 레이아웃으로 판정해 전부 0 으로 만든다. `retirementCombatScore` 는 퇴역 시점에 계산돼
     **서버에 저장**되므로(`p_combat_score`) legacy 수호기는 점수가 그대로다 — "점수는 높은데
     약한" 괴리가 legacy 에 한해 남는 것을 대가로 수용한다.
3. **골든 재생성 스크립트가 `package.json` 에 없다.** 전부 환경변수 + 직접 실행이다.

## E5(벽 접촉 플래그) 를 구현할 사람에게 — 프로브가 미리 밟은 지뢰

P3 재측정(`.omc/research/mallow-wall-streak-p3-rerun-2026-08-06.md`)이 계측 과정에서
**`slideCircleWalls` 의 경계 스냅 함정**을 찾았다. 겹침을 풀 때 좌표를 벽 경계값에 **정확히**
스냅하므로, 벽에 붙어 정지한 다음 틱에는 `dx < hw` 가 거짓이 되어 **실제로 붙어 있는데
`hit=false`** 가 나온다. 프로브는 재호출 반경에 `CONTACT_EPS = 0.1` 을 더해 복구했다.

E5 는 `SlideResult.hit` 을 **sim 안의 실제 슬라이드 호출에서** 읽으므로 재호출 함정 자체는
안 밟는다. 그러나 **의미 질문은 그대로 남는다**:

> `hit` 은 "벽에 닿아 있다"가 아니라 **"이번 틱에 벽에서 밀려났다"** 이다.

플레이어가 벽을 계속 **밀고 있으면** 매 틱 겹쳐서 `hit=true` 가 서지만, 경계에 **가만히
서 있으면** 겹침이 없어 `hit=false` 다. 설계서의 술어는 "접촉 중"(S4 피해 감소 · ME9 K=60
연속 접촉)이라 후자를 참으로 봐야 한다. 두 의미를 혼동하면 **S4·ME9 가 "벽을 계속 밀 때만"
작동**하고 붙어 서 있을 때는 조용히 꺼진다 — 화면상 아무 표시 없이.

E5 를 구현할 때 **어느 의미를 택했는지 주석에 명시**하고, "붙어서 정지" 상태를 태우는
테스트를 반드시 함께 써라. 프로브가 쓴 `CONTACT_EPS` 접근이 참고가 된다. 이 플래그는
스트라이커 M5·S4 · 브루저 MO8 · 버블 FI7 · 말로우 ME9 **다섯이 공유**하므로 여기서 틀리면
다섯이 함께 죽는다.

## 커밋 2 가 한 원자로 묶어야 하는 것

| # | 항목 | 자리 |
|---|---|---|
| 1 | flat 레이아웃 산술 재정의 (30칸 = 3축 × 10, 캡스톤 제거, `maxPoints` 20) | `data/ships/types.ts:114-149` (`shipNodeCount`·`shipTreeRange`·`shipCapstoneIndex`·`flattenShipNodes`) |
| 2 | `axisOfIndex(typeId, flatIndex)` **정본 헬퍼 신설** — sim·loadout·UI 세 곳 복제 금지 | `src/items/skills.ts` 단일 export (`affixes.md` ⑥-1 항목 4) |
| 3 | 기체 7종 노드 데이터 30개로 교체 | `data/ships/{striker,bruiser,arccaster,phantom,hatchling,mallow,bubble}.ts` |
| 4 | 캡스톤 게이트·사슬 선행(ADR-0047) 제거 | `src/items/skills.ts:139-253`, `src/items/loadout.ts:299-307`, `src/sim/capstones.ts` |
| 5 | 액티브 해금 게이트를 **축 누적 투자**로 재매핑 | `data/ships/actives/index.ts:83-129` |
| 6 | **E7** — `bumpActiveTree` 의 투자 벡터 오염 제거 → `activeTuneBonus` 신설 | `src/sim/powerups.ts:383-391`, `WorldConfig` append 위치 `src/sim/world.ts:709` 뒤 |
| 7 | 어픽스 **해시 영향분만**: `StatKey` 3종 · `skillAffixLv` 폴드 · `WorldConfig` 스탬프 | `src/items/types.ts`(유니온) · `src/items/skills.ts:34` `zeroStatSums` · **`src/items/loadout.ts:153` `zeroSums`**(1판 누락 자리) · `src/sim/replay.ts` |
| 8 | `SHIP_HASH_VERSION` bump | `src/sim/replay.ts:55` (유일 정의, EF 는 이 파일을 직접 import) |
| 9 | `migrateV10toV11`(투자 전액 환급) + `SAVE_VERSION = 11` + GuardianBuild 길이 기반 0 처리 | `src/save/profile.ts:608-624` 사다리 · 환급 선례는 `migrateV8toV9`(`:677-698`) 를 그대로 베낀다 |
| 10 | 골든 3종 재생성 | 아래 표 |
| 11 | 녹화기의 레거시 `data/skills.ts` API 의존 정리 | `scripts/recordStrikerBaseline.ts:48-56`, `scripts/deno-verify/scenarios.ts:40` |

### 골든 재생성 명령 (스크립트 없음 — 직접 실행)

| 골든 | 파일 | 명령 |
|---|---|---|
| W0 스트라이커 | `tests/fixtures/striker-prem8.json` | `RECORD_STRIKER_BASELINE=1 npx vite-node scripts/recordStrikerBaseline.ts` |
| 조우·침공 | `tests/fixtures/encounter-baseline.json` | `RECORD_ENCOUNTER_BASELINE=1 npx vite-node scripts/recordEncounterBaseline.ts` |
| deno 교차검증 | `scripts/deno-verify/fixtures.json` | `REGEN_DENO_FIXTURES=1 npx vitest run tests/denoFixture.test.ts` |

`tests/invasionHash.test.ts` 는 **파일 골든이 아니다**(인라인 레이아웃 계약). 값 재생성 대상이
아니고, 폴드 레이아웃을 바꿀 때만 기대값을 손댄다.

⚠️ 세 골든은 기본 `pnpm test` 에서 **제외**된다(`vite.config.ts:53-68` `SIM_LANE_FILES`).
`pnpm test` 그린은 골든 그린을 뜻하지 않는다 — `pnpm test:sim` 을 따로 돌려라.

⚠️ 재생성 회차마다 **증인 시드**가 함께 죽는다: `tests/fullRun.test.ts` ·
`tests/planetTierCompletion.test.ts` · `tests/autopilot.test.ts` · `tests/emergentRunLength.test.ts`
(`.omc/plans/balance-queue.md:2042-2052` 선례).

## 커밋 2 이후 (문서 순서 그대로)

3. E1·E3·E4·E5·E6 엔진 리팩터 — 각 독립 커밋, **이 시점엔 거동 불변**
4. 스트라이커 시그니처 신설(비트 24 — 실측 확인: 24~30 이 비어 있다) + 골든 재생성
5. 프로브 P1 (P2·P3 는 **선행 실시**, 결과는 `.omc/research/mallow-settle-probe-2026-08-06.md`)
6. 기체별 30스킬 배선 (7레인 병렬 — 단 E5 공유 벽 접촉 플래그 때문에 스트라이커 M5 가 먼저)
7. 어픽스 재편 **해시 무관분만**(슬롯별 풀·가중 draw·정련 `rerollable` 분모·CP).
   ⚠️ `affixes.md` ⑥-2 의 단계 3(암묵 고착)과 6(분모·완주)은 **반드시 한 커밋**
8. 밸런스 일괄은 **하지 않는다**(출시 직전 별도 레인)

## 배포 순서 (EF 마다 반대다 — `affixes.md` ⑥-3)

**①`verify-*` EF → ②클라 → ③`daily-reward` EF.** 한 배포로 묶지 마라 — 사이에 관측 창을
두어야 어느 쪽이 깨졌는지 가려진다.
