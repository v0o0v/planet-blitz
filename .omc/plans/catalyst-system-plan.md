# 작업 계획: 촉매 시스템 (변칙 경보 대체) — rev3 (합의 완료)

- 상태: **pending approval** (consensus APPROVED — Architect·Critic 2인 승인, 실행 승인 대기)
- 근거 스펙: [.omc/specs/deep-interview-catalyst-system.md](../specs/deep-interview-catalyst-system.md)
- 근거 ADR: [ADR-0029](../../docs/adr/0029-catalyst-replaces-anomaly-alerts.md)
- 모드: consensus (deliberate). rev2 = Architect·Critic 1차 심사(C1 CRITICAL + M1~M5) 반영
- 밸런스 수치는 전부 **출시 전 일괄 튜닝**(defer-balance-tuning) — 본 계획은 구조·배선만 확정

---

## 요구 요약

성계 지도의 시드 랜덤 변칙 경보(`src/sim/anomaly.ts` + 변칙 패널)를 폐지하고, PvE 런 드랍으로 얻어 출격 전 주입하는 소모품 **촉매**로 대체한다. 촉매는 페널티+보상을 한 몸으로 갖고(무등급), 다중·중복 스택되며, 보유 정본은 서버 원장에 있고 **런 시작 시 소모**된다. 카탈로그는 공용 30종 + 특산 18종 = 48종 전량이 출시 요건. PvE 침략 전용.

## 🔴 핵심 아키텍처 이슈 2건 (rev2에서 근거 교정)

### 이슈 A — 결정론 해시: anomaly 폴드 제거는 침공 포함 전 런 1회 포맷 범프 (CRITICAL, C1)

`hashWorld`는 **PvE·침공 공유 단일 함수**다([replay.ts:268](../../src/sim/replay.ts)). anomaly 폴드([replay.ts:335-343](../../src/sim/replay.ts))는 shipType·planetMode·scroll·shrink·echo 같은 조건부 꼬리 폴드와 달리 **`if` 게이트 없는 무조건 중간 스트림**이며, `anomalyRng.getState()`는 시드 파생 가변값이다. `world.ts:854-855`에서 침공 런도 `rollAnomaly`로 이 스트림을 소비한다.

`verify-invasion` EF(배포본 v23)는 `verifyRun`→`runReplay`로 매 틱 `hashWorld`를 재계산해 `hashStream`을 전수 대조한다([verifyCore.ts:187·213-217](../../supabase/functions/verify-run/verifyCore.ts), [verifyInvasionCore.ts:53](../../supabase/functions/verify-invasion/verifyInvasionCore.ts)). 따라서 **anomaly.ts 폐기 = anomaly 폴드 제거 = 침공 포함 모든 런의 per-tick 해시 변동 = 배포된 verify-invasion 이 전 침공을 오거부**한다. 이는 메모리의 **v17 무효 사건**(문서만 "완료", 실제 배선은 구코드)과 동일 구조다.

→ **결론**: 이 변경은 회피 불가한 **1회 포맷 범프**다. "APPEND-ONLY로 침공 무영향"은 불가능(무조건 폴드라 침공도 접힘). 대응은 **전 골든 재생성 + verify-invasion EF lockstep 재배포**이며, 48h in-flight 리플레이 오탐 창을 명시 수용한다. (구 계획의 "EF verify-run 영향 없음"은 삭제 — verify-run 은 배포 대상도 아니고, 문제는 hashWorld 공유다.)

### 이슈 B — 촉매 자원 보상은 개연성 캡 포화 구간에서 절삭될 수 있다 (근거 교정, M2)

현행 정산: `settle_pve_run(summary)` → `grant_currency(..., 'pve_run', metrics)`가 자원 지급을 **개연성 캡** `PLAUSIBILITY × finalTick × (1+stage)`으로 클램프한다([pve_settlement.sql:160-161·206-207](../../supabase/migrations/20260726000200_pve_settlement.sql)). 이 캡은 **정산 공식이 아니라 여유 상한(ceiling)**이다 — 클라 주장액 위의 천장이지 지급액 산출식이 아니다.

자원은 sim 내부에서 생성되고(`world.ts:3231` `state.resources++`), 촉매 "자원 +X%"는 이를 이미 배율로 만든다 — 드랍·경험치 축과 **동형**이다. 자원 축만 캡 경로를 타는 유일한 이유는 정산이 이를 `grant_currency` 캡으로 라우팅하기 때문. 따라서:
- base 자원 주장 **< 캡**이면 촉매 보너스는 그대로 통과 → 서버가 촉매를 몰라도 됨
- base 주장이 **캡을 포화**시키는 구간에서만 초과분이 절삭됨 (0이 되는 게 **아니라** 초과분만 절삭)
- 포화 여부는 개연성 계수·촉매 배율 등 **전부 밸런스 미정값**에 종속

→ **결론(심층 방어)**: "배율이 0이 된다"는 아니지만, 캡 계수를 타이트하게 튜닝하면 촉매 자원 보너스가 절삭될 수 있다. 밸런스가 확정되기 전에 이 절삭 위험을 구조적으로 제거하려면, 서버가 **소모 영수증**으로 그 런의 자원 배율을 알아 개연성 캡을 촉매 배율만큼 **조건부** 상향해야 한다. 이것이 Option A 채택 이유이며(아래 RALPLAN-DR), 자원 외 5축(드랍·희귀도·경험치·촉매·파워)은 sim 내부라 서버 정산 무관이다.

## 수용 기준

### sim (Lane 2)
- [ ] 같은 시드 + 같은 촉매 배열 → 동일 `hash`; 촉매 배열이 다르면(정규화 후) hash 분기
- [ ] `anomaly.ts`·변칙 UI·변칙 i18n 키 제거 후 전체 vitest 그린
- [ ] 촉매 무관 런끼리는 **촉매 폴드에서 0바이트(조건부 미폴드)로 서로 동형** (기존 조건부 꼬리 규율)
- [ ] 48종 각각 방향 검증 단위 테스트(부호)
- [ ] 같은 종류 N장 스택 = 선형 가산(N·X%) 검증, 슬롯 상한(`SLOT_CAP`) 초과 거부

### 결정론·EF (Lane 2·6) — 이슈 A 방어선
- [ ] **1회 포맷 범프 수용**: PvE 골든(`determinism.test.ts`)·침공 골든(`invasionHash.test.ts` 등) 전량 재생성, diff 리뷰로 의도된 변경 확인
- [ ] **verify-invasion EF 재배포**: 번들 소스 커밋 SHA 기록, 배포 직후 `origin/main` 최신 대조(v17 교훈). 재배포 전후 동일 시드 침공 리플레이가 신클라↔신EF 로 검증 통과
- [ ] 48h in-flight 리플레이 오탐 창을 릴리스 노트에 명시

### 서버 (Lane 3) — 이슈 B 방어선
- [ ] `consume_catalysts(catalyst_ids[], planet)`: 보유·특산-행성 정합 검증 → 차감 → **pending pve_run 행 생성(서버 run_id)** + 영수증(자원 배율) 서버측 영속. `for update` 직렬화
- [ ] `settle_pve_run`이 `p_summary.runId`로 pending 행을 `for update` 조회 → 영수증 자원 배율을 **그 런에 바인딩하는 캡 전체(개연성 `v_plaus` + per-call `v_call`)에 주입** → 정산 후 1회성 봉인(재사용 불가). 무촉매 런(runId 없음)은 기존 base 캡·INSERT 경로 유지(UPSERT-by-runId)
- [ ] **catalyst_defs SQL 미러**: 각 촉매의 자원 축 배율을 SQL 시드 테이블로 미러(TS `catalysts.ts`와 동기화 의무 문서화 — 기존 grant_currency "배너=정본·DECLARE 미러" 패턴의 확장)
- [ ] consume 후 크래시/미정산 pending 행 GC(orphan 정리 cron 또는 TTL)
- [ ] 촉매 분해 RPC: 원장 차감 + `grant_currency('salvage')`
- [ ] 드랍 지급 `grant_catalyst`: 엘리트·보스 촉매 드랍이 원장에 적립

### UI (Lane 4)
- [ ] 성계 지도 주입 패널(변칙 패널 자리) → 픽커 팝업(48종·수량·주입/해제)
- [ ] 관리 화면 + 분해 실행
- [ ] 특산은 비출신 행성에서 비활성+사유 렌더
- [ ] 소모 RPC 실패 시 [재시도]/[촉매 빼고 출격] 폴백, 실패 경로 아이템 미소모 확인
- [ ] 하네스 브라우저로 주입→출격, 픽커, 분해 실증

### 카탈로그·해금 (Lane 1·5)
- [ ] 48종 데이터 정의(페널티·보상축·드랍 가중치·특산 소속) + 아이콘 + ko/en i18n
- [ ] 특산 3슬롯 템플릿(모드/자원/보스 격화) 6행성 적용
- [ ] 신규 프로필 1단계 런에서 촉매 드랍 → 즉시 주입(해금 게이트 부재 실증)

## 구현 레인 (의존 순)

### Lane 0 — 데이터 계약 & 폐지 (선행, 전제)
- `src/data/catalysts.ts` 신설: 48종 정의 `{ id, kind:'common'|'signature', planet?, penalty, rewardAxis, rewardPerStack, dropWeight }`. 보상축 enum 6종. 밸런스값은 placeholder + `// BALANCE` 표식.
- `SLOT_CAP` 상수 1곳(sim·서버·UI 공유). placeholder.
- `normalizeCatalystArray(ids): sorted counts` — 해시·서버 검증 공유(순서 무관 보장).
- **자원 축 배율은 TS·SQL 양쪽 정의**가 필요(이슈 B) — TS 정본 + SQL `catalyst_defs` 시드 미러. 동기화 의무를 Lane 0·3에 못박음.

### Lane 1 — 카탈로그 콘텐츠 (Lane 0 후; 순수 데이터/배율 촉매만 병렬)
- 공용 30 + 특산 18 채움. **단, 신규 sim 훅이 필요한 특산(모드 격화형 중 shrinkRuntime·chase 등을 실제로 비트는 것)은 Lane 2로 재분류**(M-arch3) — Lane 1은 배율·기존 필드 조합 촉매만.
- 아이콘: 장비 아이콘체, pixellab-forge 캐시 우선.
- i18n: `catalyst.<id>.name/desc` ko/en, 변칙 키 제거.

### Lane 2 — sim 통합 & 결정론 (Lane 0 후)
- 폐지: `src/sim/anomaly.ts` 전체. `AnomalyState` 인자를 받는 함수 시그니처 정리 — `drops.ts`의 `rollEliteDrop`([drops.ts:143-149](../../src/sim/drops.ts))·`rollBossDrop`([drops.ts:164-169](../../src/sim/drops.ts))에서 `anomaly: AnomalyState` **인자 제거**(라인 번호는 근사).
- 교체: `src/run/runConfig.ts` `anomalyAccepted`([runConfig.ts:49·131](../../src/run/runConfig.ts)) → `catalysts: number[]`(+ 서버 `runId` 필드).
- 효과 적용: 순수 함수 `catalystMult(catalysts, axis)`. `world.ts` 참조점(L2515·L3223·L3254)·`drops.ts`를 촉매 집계 배율로 대체.
- 파워 축: 런 내 스탯 배율 — 파워업 적용 지점과 동형(임시·런 한정). `state.weapon`/플레이어 스탯 변형이라 hashWorld가 이미 접음(결정론 안전). loadout 파생과 **중복 적용 안 되도록** 적용 지점 1곳 확정.
- **해시 폴드(이슈 A 단일 전략)**: anomaly 폴드([replay.ts:335-343](../../src/sim/replay.ts)) **제거** → 촉매 폴드를 **echo 폴드 뒤 조건부 꼬리**([replay.ts:505](../../src/sim/replay.ts) 아래)에 신설(`if catalysts.length > 0`만 폴드, 정규화 배열). anomaly 제거는 1회 포맷 범프이므로 전 골든 재생성으로 흡수(위 결정론 수용 기준).

### Lane 3 — 서버 경제 (Lane 0 후, 마이그레이션 **새 파일**)
- 새 마이그레이션 `20260727000000_catalyst_ledger.sql`:
  - `catalyst_inventory`(profile_id, catalyst_id, qty) — 원장, 본인 select만, RPC만 write.
  - `catalyst_defs`(catalyst_id, resource_mult, ...) — TS `catalysts.ts` 자원 배율 SQL 미러(시드).
  - `grant_catalyst(catalyst_id, qty)` — 드랍 지급.
  - `consume_catalysts(catalyst_ids[], planet)` — 보유·특산-행성 정합 검증 → 차감 → **pending pve_run 행 + 영수증(catalyst_defs 로 산출한 자원 배율) 영속** → `run_id` 반환. `for update`.
  - `salvage_catalyst(catalyst_id, qty)` — 차감 + `grant_currency('salvage')`.
- **정산 배선(이슈 B)**: `settle_pve_run`을 개정 — `p_summary.runId`로 pending 행 조회(`for update`), 영수증 자원 배율을 **그 런의 바인딩 캡 전체에 주입**: grant_currency metrics 에 `resourceMult` 필드 추가 → `v_plaus *= m` **및** `v_call_credits *= m`(둘 다), 단 `SLOT_CAP × maxResourcePerStack` 유계 클램프. per-call 만 상향하고 개연성을 빠뜨리거나 그 역이면 `least(claim, v_plaus, v_call, v_rem)` 최소값 구조상 절삭이 잔존하므로 **바인딩 가능한 두 캡을 함께** 곱한다. 1회성 봉인. `pve_runs`는 **UPSERT-by-runId**(runId 있으면 pending UPDATE, 없으면 기존 INSERT). pending 행 부재/GC 시 settle 은 무배율 base 캡으로 진행(촉매 소실 = ADR 수용), **GC TTL > 최대 정당 정산 지연** 보장.
- placeholder 캡 상수 + 배너 문서화. 상한 인플레는 `SLOT_CAP × maxResourcePerStack` 유계임을 배너에 명시.

### Lane 4 — UI/UX (Lane 0·2 후)
- 폐지: `src/ui/pixi/planetSelect.ts` 변칙 패널(`makeAnomalyPanel`·`setAnomaly`·라벨), DOM 판 `src/ui/planetSelect.ts`.
- 주입 패널·픽커·관리 화면·분해: 카드 팝업 문법 재사용, `panelContent()` 여백, `stripEmoji`.
- 출격 흐름: `consume_catalysts` → 성공 시 run config에 `runId`·촉매 배열 → 실패 시 [재시도]/[촉매 빼고 출격].

### Lane 5 — 온보딩·문서·하네스 (막바지)
- 해금 게이트 없음: 드랍 경로만 열면 자동. 첫 획득 연출 + 주입 패널 뱃지.
- 하네스: `src/harness/core.ts`·`cheatPanel.ts` `anomaly` 파라미터 → 촉매 주입 제어.
- 문서: CONTEXT.md **분해** 정의 확장(촉매 포함), GDD AC10·beginner-guide·player-power-reference 갱신.

## 위험과 완화

| 위험 | 완화 |
|---|---|
| **anomaly 폴드 제거 → verify-invasion 전 침공 오거부**(이슈 A, v17 재현) | 1회 포맷 범프 명시 수용 · 전 골든 재생성 · **클라+EF 원자 배포**(hashWorld 스트림 버전 게이트가 없어 신EF가 구포맷 리플레이를 검증 못 함) · 컷오버 중 침공 리플레이 제출 드레인/일시중지 · 번들 SHA 기록·origin/main 대조 · 재배포 전후 동일 시드 침공 검증(신규 정합만 증명, in-flight 구리플레이는 드레인으로 커버) |
| **정산 배율 배선 누락**(이 프로젝트 8회 재발) | Lane 3 **실 plpgsql/실 Supabase 관통 테스트**(아래 M4 방어선) · 영수증 run_id 연결을 수용 기준으로 강제 |
| 영수증 위조(클라가 배율 되들고 옴) | 영수증은 **서버측 pending 행에 영속**, settle이 uid+run_id로 서버 조회(클라 배율 무시) · 1회성 봉인 |
| 결정론 골든 순서 오류 | 촉매 폴드를 echo 뒤 **조건부 꼬리**에 신설(재배치 금지 규율 준수), 빈 배열 무폴드로 촉매 무관 런 상호 동형 |
| 특산-행성 정합을 클라만 검사 | 서버 `consume_catalysts` 2차 검증(거부 테스트) |
| consume 후 크래시로 pending 행 orphan | pending 행 GC(TTL/cron), 원장 차감은 확정이므로 아이템 소실 = ADR 수용 |
| 시작 시 소모 온라인 의존 | 무촉매 출격 폴백 |
| 비-재화 축(drop·rarity·xp)은 ADR-0026상 클라 신뢰 | 기존 자세 유지 — 촉매가 위조 인센티브를 키우나 3중 캡·정산 요약 개연성이 유계. 릴리스 전 재점검 항목으로 기록 |
| 48종 대량 콘텐츠 | Lane 1 병렬(모드 격화 sim 훅만 Lane 2), 아이콘 캐시, i18n 일괄 |

## 검증 단계

1. `pnpm test` 전체 그린(폐지 무회귀 + 신규 방향/스택 단위 + 결정론 골든 재생성 diff 리뷰)
2. `pnpm lint`
3. **결정론·EF**: PvE·침공 골든 재생성 확인 → verify-invasion EF 재배포(spb 래퍼, 번들 SHA 기록) → 동일 시드 침공 리플레이 신클라↔신EF 검증 통과
4. **서버 정산 배선(M4)**: 실 Supabase(로컬 또는 원격) 대상 — 촉매 자원 런 → `consume_catalysts` → 런 → `settle_pve_run` → **실지급액이 영수증 배율 반영**을 검증(pgTAP 또는 하네스 e2e가 실 정산 관통). **반드시 per-call 바인딩 시나리오**(개연성 여유는 크고 per-call `v_call`이 낮게 튜닝된 상태)에서 배율이 관통하는지 고정 검증 — 개연성 바인딩만 보면 캡 미스매치 결함이 그린으로 샌다. vitest 목 테스트는 클라 호출 형태만 보증한다고 격하 표기
5. 하네스(`?harness=1`): 신규 프로필 1단계 드랍→주입→출격→정산, 픽커 48종, 관리 화면 분해, RPC 실패 폴백
6. 결정론: 같은 시드+촉매 2회 → 동일 hash

---

## RALPLAN-DR 요약

### 원칙 (Principles)
1. **서버가 재화 진실의 원천** — 촉매 자원 보상도 서버 캡을 통과해야 실재(ADR-0027)
2. **구조와 밸런스 분리** — 수식 꼴·배선은 지금, 계수는 출시 전
3. **결정론은 1회 포맷 범프로 전환** — anomaly 무조건 폴드 제거는 침공 포함 전 런 해시를 바꾸므로 골든·EF 동반 재생성(ADR-0005 규율: 촉매 신규 폴드는 조건부 꼬리 append)
4. **배선을 실 서버 관통 테스트로 증명** — vitest 목은 배선 존재를 증명하지 않는다(8회 교훈 + M4)
5. **코어 루프 우선** — 서버 장애가 무촉매 플레이를 막지 않는다

### 결정 동인 (Decision Drivers)
1. 촉매 자원 보상이 개연성 캡 포화 구간에서 절삭되지 않아야 함 → 영수증 기반 조건부 캡 상향
2. 48종 전량 출시 요건 → 데이터 계약(Lane 0)을 콘텐츠와 분리, 단 모드 격화 sim 훅은 Lane 2
3. 결정론 골든·침공 EF 보호 → 포맷 범프를 명시 수용하고 lockstep 재배포

### 가능 옵션 (Viable Options)
- **옵션 A — 영수증 기반 조건부 캡 상향 (채택)**: consume RPC가 서버측 영수증 발급, settle이 run_id로 조회해 개연성 캡을 그 런에 한해 촉매 배율만큼 상향.
  - 장점: flat per-call 치팅 상한을 **전역 손상 없이** 조건부 상향(실제 소모 런만); 위조 불가(서버 영속·1회성 봉인); 상한 인플레가 `SLOT_CAP×maxPerStack` 유계.
  - 단점: consume RPC·영수증·SQL 미러·pending 행·정산 조회 신설; 촉매 런 온라인 의존; 자원 청구는 ADR-0026상 여전히 클라 주장이라 그 런의 상한이 배율만큼 함께 오름.
- **옵션 D — 정적 헤드룸 (검토·기각)**: 영수증 없이 개연성 캡 계수를 `SLOT_CAP×maxResourcePerStack`만큼 **전역 정적 상향**. 촉매 배열이 이미 sim 내부 `state.resources`를 올리므로 캡 여유만 있으면 무배선 통과.
  - 장점: 서버 배선 0개(consume/영수증/미러 불필요); 구현 최소.
  - 단점: flat per-call 상한을 **전 유저·무촉매 런까지** 유계 배율만큼 느슨하게 함 → free-tier 치팅 방어를 비조건부로 전역 약화. free-tier에서 per-call 캡이 유일한 실질 방어선이라 손실이 큼.
  - **기각 근거**: A와 D는 동일 노브(촉매 런 상한 상향)를 조건부 vs 무조건으로 여닫는 관계. D의 위조 창 확대(전원 대상)가 A의 배선 비용보다 크다 — 특히 비-재화 축이 이미 클라 신뢰라 재화 축 방어선을 약화하면 안 됨.
- **옵션 B — 자원 축 제외**: 스펙 R7(자원 축 채택) 위반. 기각.
- **옵션 C — 클라 직접 청구(캡 우회)**: ADR-0027 정면 위반. 기각.

## Pre-mortem (3 실패 시나리오)

1. **verify-invasion 전 침공 라이브 아웃티지**: anomaly 폴드 제거 후 EF 재배포를 빠뜨리거나 클라만 먼저 나가 신클라 침공 해시가 구EF와 갈려 전 침공 오거부. v17처럼 문서만 "완료"라 무증상 통과. → **방어**: 클라+EF 원자 배포 + 컷오버 중 침공 리플레이 드레인, 검증 3단이 EF 재배포+동일 시드 침공 검증을 게이트, 번들 SHA 기록·origin/main 대조.
2. **자원 배율이 조용히 절삭**: 영수증 배선을 빠뜨리거나 run_id 연결이 끊겨, 캡 계수를 타이트하게 튜닝했을 때 촉매 자원 보너스가 포화 구간에서 절삭. vitest 목은 서버를 안 짚어 그린. → **방어**: 검증 4단이 실 Supabase 관통 테스트로 실지급액의 배율 반영을 확인. (주의: "빈 촉매 hash 불변" 같은 잘못된 방어 아님 — 포맷 범프는 수용됨.)
3. **특산 우회 주입**: 클라 UI만 비활성이고 서버가 특산-행성 미검증 → 특산을 아무 행성에 발라 이득. → **방어**: `consume_catalysts`가 특산-행성 정합 2차 검증(거부 테스트).

## 확장 테스트 계획

| 층위 | 대상 |
|---|---|
| **Unit** | 48종 방향 검증(부호), 선형 가산 N·X%, `SLOT_CAP` 초과 거부, `normalizeCatalystArray` 순서 무관, `catalystMult` 축별, 파워 축 중복 적용 없음 |
| **Integration (sim)** | 폐지 무회귀 전체 vitest, 촉매 배열별 hash 분기, 촉매 무관 런 hash 상호 동형(조건부 무폴드) |
| **Integration (서버·M4 방어선)** | 실 Supabase: consume→pending 행→settle 조회→실지급액 배율 반영, 분해→원장 차감→salvage 지급, 특산-행성 거부, 영수증 1회성 봉인(재사용 거부), orphan pending GC |
| **e2e (하네스)** | 신규 프로필 1단계 드랍→주입→출격→정산 배율, 픽커 48종·수량, 관리 화면 분해, RPC 실패 폴백 |
| **결정론·EF** | PvE·침공 골든 재생성 diff, verify-invasion 재배포 전후 동일 시드 침공 검증 통과 |
| **Observability** | consume/salvage 감사 로그(currency_grants·촉매 원장), `flagged` 오탐 없음, pending 행 GC 관측 |

## ADR (촉매 정산 배선 + 결정론 포맷 범프)

- **Decision**: (1) 촉매 소모 RPC가 서버측에 **영수증(자원 배율) + pending pve_run 행**을 영속하고, `settle_pve_run`이 `runId`로 이를 조회해 개연성 캡을 그 런에 한해 촉매 배율만큼 상향한 뒤 1회성 봉인한다. 자원 외 5축은 sim 내부라 서버 무관. (2) anomaly 무조건 폴드 제거는 침공 포함 전 런 1회 포맷 범프로 수용하고, 촉매 폴드는 echo 뒤 조건부 꼬리로 신설하며, 전 골든·verify-invasion EF를 lockstep 재생성/재배포한다.
- **Drivers**: 서버 재화 권위(ADR-0027) · 자원 축 촉매 실재(스펙 R7) · free-tier per-call 캡 방어선 보존 · 결정론 검증(ADR-0005) · 침공 EF 정합.
- **Alternatives considered**: 정적 헤드룸(D — 전역 캡 약화로 기각) · 자원 축 제외(B — R7 위반) · 클라 직접 청구(C — ADR-0027 위반) · APPEND-ONLY 무영향(불가능 — anomaly 폴드가 무조건이라 침공도 접힘).
- **Why chosen**: 영수증은 서버 영속·1회성이라 위조 불가하고, **바인딩 캡 전체(개연성+per-call)를 실제 소모 런만 조건부 상향**해(둘 중 하나만 올리면 `least` 최소값 구조상 절삭 잔존) 전역 방어선을 손상하지 않으며, 상한 인플레가 `SLOT_CAP×maxPerStack` 유계다. 결정론은 포맷 범프가 회피 불가하므로 정직하게 클라+EF 원자 재배포로 흡수한다.
- **Consequences**: 촉매 런은 시작 시 온라인 필요(무촉매 런은 오프라인 유지). 서버에 consume/영수증/pending/미러 계약 추가. verify-invasion EF 재배포 필수 + 48h in-flight 오탐 창. 자원 청구가 리플레이 없이 클라 주장(ADR-0026)이라 그 런의 상한이 배율만큼 함께 오름(유계). catalyst 자원 배율이 TS·SQL 이중 정의라 동기화 의무 발생.
- **Follow-ups**: 밸런스 수치(계수·배율·상한·드랍률·분해 환산) 출시 전 일괄. CONTEXT.md 분해 정의 확장. 비-재화 축 클라 신뢰 위조 인센티브 릴리스 전 재점검. 침공 확장은 명시적 non-goal.

---

## Changelog (rev2 — 1차 합의 심사 반영)

- **C1**: 결정론 서사 전면 재작성 — anomaly 폴드가 무조건·침공 공유임을 코드로 확인, 제거 = 1회 포맷 범프 = verify-invasion 재배포 필수로 정정. "EF verify-run 영향 없음" 삭제. 위험표·검증 3단·Pre-mortem #1에 EF 재배포 게이트 추가.
- **M1**: 결정론 전략 단일화 — "APPEND-ONLY 준수/빈 촉매 hash 불변/포맷 범프 수용" 3중 모순 제거. 촉매 폴드는 echo 뒤 조건부 꼬리, anomaly 제거는 포맷 범프로 명시 수용. Pre-mortem #2 재작성.
- **M2**: "보상 배율 0" → "포화 구간 절삭 가능(무효 아님), 밸런스 종속"으로 근거 교정. 심층 방어 정당성은 유지.
- **M3**: Option D(정적 헤드룸)를 RALPLAN-DR에 추가·정직 비교·기각 근거 명시.
- **M4**: 정산 배율 방어선을 vitest 목 → **실 plpgsql/실 Supabase 관통 테스트**로 재지정. 확장 테스트 Integration 층 분리.
- **M5**: 영수증→정산 연결 명세 — consume이 pending pve_run 행(서버 run_id) + 영수증 영속, settle이 runId 조회·1회성 봉인. `pve_runs` INSERT→UPDATE 전환. catalyst_defs SQL 미러 추가.
- **Minor**: drops.ts 시그니처 인자 제거 명시, pending 행 orphan GC, 파워 축 중복 적용 방지, 비-재화 축 클라 신뢰 위험 기록.

## Changelog (rev3 — 2차 합의 심사 반영, Architect 조건부 승인)

- **[차단 해소] 영수증 주입 대상 캡 미스매치**: 영수증 자원 배율을 개연성 캡(`v_plaus`)뿐 아니라 **per-call 캡(`v_call_credits`)에도 함께 주입**(둘 다 곱, `SLOT_CAP×maxResourcePerStack` 유계 클램프). `least(claim, v_plaus, v_call, v_rem)` 최소값 구조상 바인딩 캡을 하나라도 빠뜨리면 절삭 잔존 → 계획 자신의 "per-call이 유일 방어선" 논리와 정합하도록 교정. 수용 기준·Lane 3·ADR·검증 4단(per-call 바인딩 시나리오 고정) 반영.
- **[경미] 무촉매 런 경로 보존**: `pve_runs` INSERT→UPDATE를 **UPSERT-by-runId**로 명시(runId 없으면 기존 INSERT). pending 부재/GC 시 무배율 base 캡 진행 + GC TTL > 최대 정당 정산 지연 보장.
- **[경미] 48h 창 → 배포 절차 격상**: 릴리스 노트 명시에서 **클라+EF 원자 배포 + 컷오버 중 침공 리플레이 드레인/일시중지**로 승격(hashWorld 스트림 버전 게이트 부재라 신EF가 구포맷 리플레이 검증 불가). 위험표·Pre-mortem #1 반영.
- (선택) 촉매 폴드 첫 바이트에 `CATALYST_HASH_VERSION` 상수 폴드 — invasion3·shipType 선례. 향후 촉매 폴드 포맷 변경 구분용, 필수 아님.

## Lane 3 구현 가드레일 (Critic 승인 시 첨부 — 오구현 방지)

1. **배율 `m`은 최종 grant(`least`)가 아니라 캡 변수 정의 지점(`v_plaus`·`v_call_credits`)에 곱하라.** 극단초과 flag 기준 `v_ref := least(v_plaus, v_call)`([pve_settlement.sql:214](../../supabase/migrations/20260726000200_pve_settlement.sql))가 캡 변수를 상속하므로, 캡 지점에 곱하면 `v_ref`도 자동 스케일돼 정직한 고배율 촉매 런의 `claim = C×m`이 `FLAG_MULTIPLE(=10)` 오탐을 맞지 않는다. grant 에만 곱하면 `v_ref` 미스케일로 오탐 위험.
2. **`resourceMult`는 `pve_run` 경로에만 전달.** `grant_currency`의 `p_metrics`에 얹어(시그니처 무변경) `settle_pve_run`만 전달하고 `salvage_catalyst`·story 는 미전달 — salvage/story 캡이 느슨해지지 않음을 단언 테스트 1개로 못박을 것.
3. **pending 행은 `pve_runs.id`를 run_id로, `verified_status='pending'`으로 생성**(기존 `pve_runs_pending_idx` 부분 인덱스와 정합). settle 시 'verified'로 flip. teardown 마이그레이션(`20260726000300`)이 `replay`·`client_result` NOT NULL 컬럼과 샘플러(`sample_pve_runs`·`apply_pve_verification`)를 **이미 제거**했으므로 pending 접근 지뢰 없음 — 실행 시 post-teardown `pve_runs` 형상만 재확인.

## 밸런스 패스 재점검 항목 (출시 전)

- `SLOT_CAP × maxResourcePerStack` 유계값이 `FLAG_MULTIPLE(=10)`을 넘도록 튜닝되면, 가드레일 #1(캡 지점 스케일)이 오탐 방지의 유일 방어선이 된다. 최대 `m` 확정 시 이 상호작용 재점검.
- 촉매 계수·드랍률·상한값·분해 환산율 일괄 튜닝.
