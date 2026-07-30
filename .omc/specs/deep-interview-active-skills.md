# Deep Interview Spec: 기체 타입별 액티브 스킬

## Metadata
- Interview ID: di-active-skills-2026-07-31
- Rounds: 6 (+ Round 0 토폴로지 게이트)
- Final Ambiguity Score: 13%
- Type: brownfield
- Generated: 2026-07-31
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no (선행 grill 세션 13갈래 결정을 사전 컨텍스트로 사용)
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.92 | 0.25 | 0.230 |
| Success Criteria | 0.82 | 0.25 | 0.205 |
| Context Clarity | 0.80 | 0.15 | 0.120 |
| **Total Clarity** | | | **0.870** |
| **Ambiguity** | | | **0.130** |

## Topology

| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| sim-core | active | 발동 처리·쿨다운 2개·3결 효과·해시 조건부 폴드 | AC-1~5 |
| input-determinism | active | z/x wire · `KeyX`→`KeyQ` 이설 · 프리즈 규칙 · EF 재배포 · 오토파일럿 | AC-6~11 |
| progression-save | active | 게이트 8/40 · 투자 비례 스케일링 · 2슬롯 · `SAVE_VERSION` 8 | AC-12~15 |
| ui | active | 연구소 장착 패널 · HUD 쿨다운 2칸 · 조작 안내 | AC-16~19 |
| content | active | 42종 저작 · 아이콘 42장 · i18n 84키 × 2언어 | AC-20~23 |
| powerup-integration | active | 장착 2개 한정 선택지를 24종 풀에 append | AC-24~25 |

보류 컴포넌트 없음.

## Goal

기체 타입 7종 각각에 **고유 액티브 스킬 6종**을 신설한다. 3계열에 2개씩 붙고 그 계열의
base 누적 투자 **8(저티어) / 40(고티어)** 에서 열리며, 열린 것 중 **최대 2개**를 연구소에서
장착해 **z(슬롯1) · x(슬롯2)** 로 발동한다. 비용은 **쿨다운뿐**이고, 계열 누적 투자량이
위력·쿨다운을 연속으로 개선한다. 효과는 **즉발 공격 · 이동기 · 짧은 자기버프 3결**로 한정하며,
각 기체의 6종은 그 기체의 **시그니처 패시브를 능동적으로 건드리도록** 저작한다.

## Constraints

- **결정론**: `InputFrame.special` 비트 9·10 에 append (0~8 점유 중, 22비트 여유). 재배치 금지.
- **해시**: 신규 상태는 쿨다운 2개뿐. `hashWorld` 맨 꼬리 **조건부 폴드**(둘 다 0이면 무폴드).
- **방향**: 이동 입력 방향, 정지 중엔 `player.angle`(조준각) — **대시와 동일 규칙**. 신규 방향 필드 없음.
- **프리즈**: 레벨업 3택·조우 detour 중 z/x 입력은 **버린다**(큐잉 금지). 기존 파워업 우선 분기 아래에 배치.
- **주체**: 플레이어 + 오토파일럿. **방어 배치의 수호 기체(AI)는 제외.**
- **파워업**: 24종 풀에 **append 만**(인덱스 0~23 = 와이어 값). 오퍼 개수는 3~4 유지(`special` 비트 1~2 가 2비트).
- **세이브**: `Ship` 에 2슬롯 추가 → `SAVE_VERSION` 7→8, `migrateV7toV8` 스탬프 + `normalizeShip` 기본값.
- **아이콘**: 42장 개별(ADR-0015 유니크 예외 편입). 파일명 축은 `active_<shipSlug>_<n>.png` 계열.
- **키**: 조우 detour 이탈 `KeyX` → `KeyQ` 이설. `KeyZ` 는 원래 미사용.
- **밸런스 수치**: 42종의 실제 쿨다운·계수는 **출시 전 일괄 패스로 defer**.

## Non-Goals

- 설치물·소환·지속 생성물 (드론·터렛·지뢰)
- 룰 변경급 효과 (시간 감속·오염 정화·강제 은신 진입)
- 공용 에너지 자원 / 런당 충전 횟수 / HP 대가
- 런 중 장착 교체
- 방어 배치 수호 기체(AI)의 액티브 사용
- 키 리바인딩 UI 신설
- 스트라이커에게 시그니처 비트 부여
- 대시(Space) 거동 변경

## Acceptance Criteria

**sim-core**
- [ ] AC-1 각 기체 6종이 `data/ships/<slug>.ts` 계열 구조에서 조회 가능하고, 42종 전부 id 가 고유하다
- [ ] AC-2 발동 시 쿨다운이 설정되고 매 틱 감소하며, 쿨다운 중 재입력은 무시된다
- [ ] AC-3 효과가 즉발 공격·이동기·자기버프 3결 중 하나로 분류되고, 그 외 kind 를 만들지 않는다
- [ ] AC-4 발동 방향이 이동 입력 방향이고, 이동 입력이 0이면 `player.angle` 로 떨어진다
- [ ] AC-5 쿨다운 2개가 `hashWorld` 맨 꼬리 조건부 폴드이며, 둘 다 0인 런은 폴드를 실행하지 않는다

**input-determinism**
- [ ] AC-6 `KeyZ`/`KeyX` 가 `special` 비트 9·10 으로 실려 리플레이에 기록된다
- [ ] AC-7 조우 detour 이탈이 `KeyQ` 로 동작하고 `KeyX` 는 더 이상 detour 를 이탈시키지 않는다
- [ ] AC-8 `pendingLevelUp` 프리즈 중 z/x 를 눌러도 해제 후 스킬이 발동하지 않는다 (버려짐)
- [ ] AC-9 detour 중 z/x 를 눌러도 복귀 후 스킬이 발동하지 않는다
- [ ] AC-10 오토파일럿이 쿨다운이 돌아 있고 조건을 만족하면 액티브를 발동한다 (순수·결정론 유지)
- [ ] AC-11 deno fixtures 재생성 + `verify-invasion` EF 재배포 후 액티브 사용 리플레이가 검증 통과한다

**progression-save**
- [ ] AC-12 계열 base 누적 < 8 이면 저티어가 잠기고, ≥ 8 이면 열린다 (고티어는 40)
- [ ] AC-13 계열 누적량이 늘면 그 계열 2종의 위력·쿨다운이 개선되며, 값은 `skillInvest` 에서만 파생한다 (별도 저장 없음)
- [ ] AC-14 장착은 최대 2개이며 3개째 시도가 거부된다
- [ ] AC-15 `SAVE_VERSION` 7 프로필을 로드하면 빈 슬롯 2칸으로 정규화되고 손실이 없다

**ui**
- [ ] AC-16 연구소에서 계열별 액티브 2칸이 보이고, 잠긴 것은 필요 투자량이 표시된다
- [ ] AC-17 연구소에서 장착/해제가 되고 즉시 저장된다
- [ ] AC-18 HUD 좌하단에 장착 2개의 아이콘과 쿨다운 진행이 표시된다 (`pointer-events` 주의)
- [ ] AC-19 튜토리얼 힌트에 z/x 안내가 추가되고 en/ko 둘 다 나온다

**content**
- [ ] AC-20 42종 전부가 해당 기체의 시그니처 패시브를 능동적으로 건드린다 (스트라이커 6종은 교과서형 — 시그니처 없음이 설계)
- [ ] AC-21 아이콘 42장이 `assets/` 에 실재하고 `tests/uiAssetPresence.test.ts` 계열 테스트가 통과한다
- [ ] AC-22 i18n 키 84개(name/desc × 42)가 en/ko 양쪽에 있고 `tests/i18n.test.ts` 가 통과한다
- [ ] AC-23 **하네스 화면에서 42종 전부의 발동이 육안 확인된다** (배선 증명)

**powerup-integration**
- [ ] AC-24 장착한 2개에 대응하는 파워업 선택지가 3택 풀에 나오고, 미장착 스킬 선택지는 나오지 않는다
- [ ] AC-25 신규 파워업이 인덱스 24 이상으로 append 되어 기존 0~23 와이어 값이 불변이다

**전역 게이트**
- [ ] AC-G1 액티브 미사용 런의 골든 해시가 **바이트 불변**이다 (`striker-prem8.json`, deno fixtures, invasionHash)
- [ ] AC-G2 `pnpm test` 그린 + `tsc` 통과 (node-shims 함정 재발 방지)

## Assumptions Exposed & Resolved

| 가정 | 도전 | 해소 |
|---|---|---|
| 화살표 이동을 새로 만들어야 한다 | 코드 확인 | 이미 구현돼 있음 ([controller.ts:110](../../src/input/controller.ts:110)) — 축 제거 |
| 기체당 5종 | 트리가 3계열이라 5는 안 나눠짐 | **6종**(계열당 2)으로 변경 |
| 5종이 다 열려 있다 | 성장 축 4개째의 세대교체 비용 | 트리 게이트로 해금, 단 저티어를 8 로 낮춰 Lv8 부터 살아남 |
| `x` 키가 비어 있다 | 조우 detour 이탈이 점유 | detour 이탈을 **`KeyQ`** 로 이설 |
| 정지 중엔 마지막 이동 방향 | 대시와 규칙이 갈리고 신규 해시 필드가 필요 | **조준각 폴백**(대시와 동일)으로 통일, 신규 필드 0 |
| 프리즈 중 입력은 알아서 되겠지 | 컨트롤러가 파워업 픽 대기 중 다른 special 을 통째로 버림 | **명시적으로 버린다** — 큐잉하면 오버레이 닫힐 때 오발 |
| 봇은 상관없다 | 오토파일럿이 `SPECIAL_NONE` 만 내 벤치가 스킬을 안 밟음 | **오토파일럿도 쓴다** (방어 AI 와는 별개 사안) |
| 3결로 좁혀도 42종이 다를 것이다 | 변주 축이 수치뿐이라 기체 간 중복 위험 | **시그니처 파생 원칙**으로 저작 규칙화 |
| 모든 기체에 시그니처가 있다 | 스트라이커 `signatureBit: -1` | **"무색함"이 정체성** — 교과서형 6종, 학습 기준선 |
| 단위 테스트면 완료 | 이 리포 반복 결함 8건이 배선 누락 | **3중 게이트**(화면 확인 + 골든 불변 + EF 검증) |

## Technical Context

| 접점 | 위치 | 메모 |
|---|---|---|
| `special` 비트 | [world.ts:306](../../src/sim/world.ts:306), [encounters.ts:28](../../data/encounters.ts:28) | 0~8 점유, 9~30 여유 |
| 입력 큐 | [controller.ts:129](../../src/input/controller.ts:129) | 파워업 우선 분기 — 액티브는 그 아래 |
| 프리즈 return | [world.ts:1209](../../src/sim/world.ts:1209) | `pendingLevelUp` 조기 return |
| 대시 폴백 | [world.ts:1651](../../src/sim/world.ts:1651) | 이동 입력 없으면 `player.angle` — 재사용할 규칙 |
| 오토파일럿 | [autopilot.ts:41](../../src/sim/autopilot.ts:41) | 순수 함수, `SPECIAL_NONE` 만 냄 |
| 파워업 풀 | [powerups.ts:52](../../src/sim/powerups.ts:52) | 24종, 인덱스 = 와이어 값 |
| 트리 스키마 | [types.ts:82](../../data/ships/types.ts:82) | `capstoneGate` 40 (해츨링만 44) |
| 연구소 UI | [pixi/researchLab.ts](../../src/ui/pixi/researchLab.ts) | ⚠️ **살아 있는 화면은 이쪽**([main.ts:52](../../src/main.ts:52) 가 마운트). `src/ui/researchLab.ts`(359줄)는 **DOM 레거시 = 죽은 파일** |
| 표시 문자열 규약 | [authoring.ts:16](../../data/ships/authoring.ts:16) | ⚠️ 트리 노드는 `node.name` 을 **`t()` 없이 그대로** 그린다 — 액티브는 `t()` 경유로 하고 연구소 액티브 패널이 `t()` 를 호출하게 만들어야 AC-22 가 화면과 일치한다 |
| 런 config 조립 | [runConfig.ts:123](../../src/run/runConfig.ts:123) | ⚠️ `Ship`→`WorldConfig` **유일 경로**. 신규 런 입력은 반드시 여기에만 추가 (이 저장소 배선 누락 8건의 발원지) |
| 예비역·수호 스냅샷 | [guardianLifecycle.ts:143](../../src/save/guardianLifecycle.ts:143), [callupPilot.ts:42](../../src/run/callupPilot.ts:42) | `GuardianBuild = { typeId, equipped, skillInvest }` — **장착 슬롯 자리 없음** |
| HUD | [hud.ts:278](../../src/ui/hud.ts:278) | `#pb-hud` 는 `pointer-events:none` |
| 세이브 | [profile.ts:78](../../src/save/profile.ts:78) | `SAVE_VERSION` 7, 스탬프 마이그레이션 관례 |
| 튜토리얼 | [tutorial.ts:139](../../src/ui/tutorial.ts:139) | 힌트 4줄이 유일한 조작 안내 채널 |

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|---|---|---|---|
| 액티브 스킬 | core domain | id, 기체타입, 계열, 티어(저/고), 결(즉발/이동/버프), 기본쿨다운, 계수 | 기체 타입이 6개를 가진다 · 시그니처 패시브에서 파생한다 |
| 장착 슬롯 | core domain | index(0/1), 액티브스킬id \| null | 기체가 2개를 가진다 · z/x 에 1:1 |
| 쿨다운 | core domain | 남은틱 | 슬롯마다 1개 · 해시 조건부 폴드 대상 |
| 계열 | supporting | slug, affinity, base누적투자 | 액티브 2종을 게이트한다 · 위력을 스케일한다 |
| 해금 게이트 | supporting | 임계(8 \| 40) | 계열 누적을 읽는다 |
| 발동 방향 | supporting | 이동입력 \| player.angle | 대시와 규칙 공유 |
| 시그니처 패시브 | external system | signatureBit | 액티브 저작의 원본 (스트라이커는 없음) |
| 파워업 선택지 | external system | 풀인덱스(24+) | 장착 슬롯을 참조한다 |
| 완료 게이트 | supporting | 화면확인 · 골든불변 · EF검증 | 6개 컴포넌트 전부에 걸린다 |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability |
|---|---|---|---|---|---|
| 1 | 7 | 7 | - | - | N/A |
| 2 | 8 | 1 | 0 | 7 | 88% |
| 3 | 8 | 0 | 0 | 8 | 100% |
| 4 | 9 | 1 | 0 | 8 | 89% |
| 5 | 9 | 0 | 0 | 9 | 100% |
| 6 | 9 | 0 | 0 | 9 | 100% |

## Interview Transcript

<details>
<summary>Q&A (Round 0 + 6 rounds)</summary>

**Round 0 — 토폴로지 확인**
Q: 6개 구성요소 데토폴로지가 맞습니까? / A: 맞다 · 6개 전부 활성

**Round 1 — Success Criteria (0.35)**
Q: 액티브 스킬이 '완성됐다'는 걸 무엇으로 증명합니까? / A: 3중 게이트
모호도 36% → 23%

**Round 2 — Constraint Clarity (0.55)**
Q: 프리즈(레벨업 3택 · 조우 detour) 중 z/x 입력은? / A: 그냥 무시한다
모호도 23% → 20.5%

**Round 3 — Constraint Clarity (0.65)**
Q: 오토파일럿은 액티브 스킬을 씁니까? / A: 쓴다 · 쓸 수 있을 때 발동
모호도 20.5% → 23% (Goal 재평가로 상승)

**Round 4 — Goal Clarity (0.72) · CONTRARIAN**
Q: 42종이 서로 다르다는 것을 무엇이 보장합니까? / A: 시그니처 파생 원칙
모호도 23% → 20.3%

**Round 5 — Goal Clarity (0.79)**
Q: 시그니처가 없는 스트라이커의 6종은 무엇에서 파생합니까? / A: '무색함'을 정체성으로
모호도 20.3% → 16.5%

**Round 6 — Constraint Clarity (0.78) · SIMPLIFIER**
Q: 정지 중 폴백을 대시와 통일할까요, 새 상태를 만들까요? / A: 대시와 통일 · 조준각 폴백
모호도 16.5% → **13%**

</details>
