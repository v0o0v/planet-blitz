# Deep Interview Spec: 촉매 상점 & 촉매 잔재

## Metadata
- Rounds: 6 (+ Round 0 토폴로지 게이트)
- Final Ambiguity Score: 12%
- Type: brownfield
- Generated: 2026-07-31
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED
- 선행 산출물: `CONTEXT.md`(촉매 잔재·촉매 상점 용어) · `docs/adr/0042-catalyst-shop-closed-residue-economy.md`

## Clarity Breakdown

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.88 | 0.25 | 0.220 |
| Success Criteria | 0.85 | 0.25 | 0.213 |
| Context Clarity | 0.90 | 0.15 | 0.135 |
| **Total Clarity** | | | **0.883** |
| **Ambiguity** | | | **0.117** |

## Topology

| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| 가격 저작 | active | 잔재 가격표 수치 확정 | `가격 = 10 × (10 / dropWeight)`, 환급 `floor(가격 × 0.5)`. 1×=10 / 파워축=50 / ascendant=100 |
| 화면 구성 | active | 촉매 보관함 확장 | 통합 단일 목록 — 한 행에 보유량·가격·[분해][구매] |
| 자산·문구 | active | 잔재 아이콘·i18n | PixelLab 아이콘 1장 이번 레인 포함 + 신규 i18n 키 |
| 레인 분할·검증 | active | 구현 순서·완료 증명 | 단일 레인 순차 + 3단 게이트 |

## Goal

촉매 보관함 안에 **촉매 상점**을 만든다. 촉매를 **분해**하면 전용 재화 **촉매 잔재**가 나오고,
그 잔재로 공용 촉매 30종을 상시 구매할 수 있다. 드랍 운을 종류 선택권으로 바꿔 주되,
촉매 총량은 늘지 않는다.

## Constraints

- **통화는 촉매 잔재 하나.** 크레딧·희귀 광물로는 촉매를 살 수 없다.
- **잔재의 유일 소스는 촉매 분해**, 유일 용처는 촉매 상점 구매. 런 드랍·PvP 보상 없음.
- **촉매 분해는 크레딧을 주지 않는다** (전량 잔재로 대체). 장비 분해는 종전대로.
- **공용 30종만 진열.** 특산 18종은 분해만 되고 구매 불가.
- 가격은 `dropWeight` 한 축에서만 파생. 보상축·행성별 가감 없음.
- **상시 전 카탈로그**, 로테이션 재고 없음, 해금 조건 없음.
- 구매 전용 — 상점에 매각 방향 없음. 플레이어 간 거래 없음.
- 잔재 잔고는 촉매 보관함 화면에서만 표시(전 화면 재화 칩에 올리지 않음).
- 온라인 전용(촉매 보유 정본이 서버라는 기존 계약 계승).
- sim 무관 — 해시·골든 불변, EF 재배포 불필요.

## Non-Goals

- 촉매 합성(같은 촉매 N개 → 상위) — 상점이 같은 문제를 푼다
- 일괄 분해(여러 종류 한 번에) — 오조작 피해가 되돌릴 수 없다
- 특산 촉매 판매 · 특산 분해 금지 · 특산 환급 프리미엄
- 잔재를 다른 재화로 환전
- 밸런스 수치 확정 — `K`·`r`은 `// BALANCE` placeholder

## Acceptance Criteria

- [ ] `가격 = 10 × (10 / dropWeight)` 순수 함수가 48종 전부에 대해 정수를 반환한다
- [ ] 환급 = `floor(가격 × 0.5)` — 흔한 촉매(가격 10)는 5, 파워축(50)은 25, ascendant(100)는 50
- [ ] `catalyst_defs.buy_price` 48행 시드가 TS 카탈로그 값과 일치한다 (vitest가 마이그레이션 파일을 읽어 대조)
- [ ] TS 가격을 바꾸고 시드를 안 고치면 그 테스트가 실패한다 (뮤테이션 검증)
- [ ] `profiles.catalyst_residue` 컬럼은 음수가 될 수 없고, `grant_currency`·3중 캡 파이프를 거치지 않는다
- [ ] `salvage_catalyst`가 크레딧을 지급하지 않고 잔재만 적립한다 (기존 크레딧 경로 제거 확인)
- [ ] `buy_catalyst(catalyst_id, qty)`가 잔재 차감과 `catalyst_inventory` 적립을 한 트랜잭션에서 처리한다
- [ ] 잔재 부족 시 아무것도 차감·적립되지 않고 거부 사유가 반환된다
- [ ] 특산 촉매(id ≥ 30)에 대한 `buy_catalyst` 호출이 서버에서 거부된다
- [ ] 통합 목록 한 행에 아이콘·이름·보유량·가격·[분해][구매]가 모두 보이고, 특산 행은 구매 버튼이 비활성이다
- [ ] 분해 시 종류별 수량을 지정할 수 있다
- [ ] 잔재 잔고 칩이 촉매 보관함 헤더에 표시되고, 다른 화면 상단 칩은 종전대로 2종이다
- [ ] 오프라인/미설정 세션에서 상점이 안내 문구를 내고 조작이 막힌다
- [ ] 실세션 관통 1바퀴: 분해 → 잔재 증가 → 구매 → `catalyst_inventory` 반영 → 화면 갱신
- [ ] 하네스로 화면을 띄워 통합 목록·버튼 상태를 육안 확인한다
- [ ] 잔재 아이콘 1장 생성 + pixellab-forge 리포 동기화까지 같은 세션에서 마감

## Assumptions Exposed & Resolved

| 가정 | 도전 | 결론 |
|---|---|---|
| "사고 판다" = 양방향 매매소 | 환금은 이미 **분해**가 한다. 매각을 새로 만들면 환금 경로가 둘 | 상점은 구매 전용, 분해가 매각 역할 |
| 크레딧으로 사면 된다 | 자원축 촉매 → 크레딧 → 촉매 자기 증식 고리 | 전용 재화로 경제를 닫음 |
| 희소도 파생 = 연속 스펙트럼 | `dropWeight`는 실제로 상수 5개뿐 | 1× 25종 / 5× 4종 / 10× 1종 계단을 그대로 수용 |
| 잔재라는 재화가 꼭 필요하다 (Contrarian) | 직접 교환하면 컬럼·아이콘·미러·마이그레이션이 전부 불필요 | **부분 누적**이 잔재의 존재 이유 — 유지 확정 |
| 아이콘은 나중에 (Simplifier) | `makeCurrencyChip`은 아이콘 없이도 동작한다 | 그래도 이번 레인 포함 — 미루면 오래 잡히는 종류의 부채 |
| 특산도 팔아야 구제가 된다 | 특산의 "그 행성에 가야 얻는다"가 종류 축 차별화의 뿌리 | 공용 30종만 판매 |

## Technical Context

- 촉매 카탈로그 정본: `src/data/catalysts.ts` (공용 30 id 0~29, 특산 18 id 30~47)
- `dropWeight` 상수: `W_COMMON=10` · `W_POWER=2` · `W_POWER_SKILLALL=1` · `W_SIGNATURE=8` · `W_SIGNATURE_BOSS=4`
- 서버: `supabase/migrations/20260727000000_catalyst_ledger.sql` — `catalyst_inventory` · `catalyst_defs`(수동 미러, 동기화 의무 배너) · `grant_catalyst` · `consume_catalysts` · `salvage_catalyst`
- 재화: `profiles.credits`/`minerals`(numeric, `>= 0` 체크) + `currency_grants` 원장 + `grant_currency`(3중 캡)
- 화면: `src/ui/pixi/catalystArchive.ts` — 격납고 하위 화면, `show()`/`onClose` 규약, `makeScrollArea`·`listRowBg`·`panelContent` 사용
- net: `src/net/index.ts`의 `fetchCatalystInventoryOnline`·`salvageCatalystOnServer`

## Implementation Lane (단일 레인 순차)

1. **TS 순수 함수** — `catalystBuyPrice(id)`·`catalystSalvageValue(id)` + vitest
2. **마이그레이션** — `profiles.catalyst_residue` · `catalyst_defs.buy_price` + 48행 시드(TS에서 생성) · `salvage_catalyst` 보상 교체 · `buy_catalyst` 신설
3. **드리프트 가드 테스트** — 마이그레이션 파일 파싱 → TS 값 대조
4. **net 게이트웨이** — 잔재 잔고 조회 · `buy_catalyst` 호출 · 기존 salvage 반환 형태 갱신
5. **화면** — 통합 단일 목록(수량 지정 분해 + 구매), 잔재 칩
6. **자산** — PixelLab 잔재 아이콘 1장 → 캐시 등록 → pixellab-forge 리포 동기화
7. **검증** — vitest 그린 → 원격 마이그레이션 적용 → 실세션 관통 1바퀴 → 하네스 육안

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 촉매 | core domain | id, slug, kind, planet?, reward, penalty, dropWeight | 분해되어 촉매 잔재가 된다 · 상점에서 구매된다(공용만) |
| 촉매 잔재 | core domain | 잔량(정수) | 분해가 유일 소스 · 촉매 상점 구매가 유일 용처 |
| 촉매 상점 | core domain | 진열 목록(공용 30종) | 촉매 잔재를 받고 촉매를 준다 |
| 가격표 | supporting | catalyst_id, buy_price | `dropWeight`에서 파생 · `catalyst_defs`에 미러 |
| 촉매 보관함 | supporting | 행 목록 | 촉매 상점을 품는 화면 |
| 특산 촉매 | supporting | planet | 분해 가능, 구매 불가 |
| 보유 원장 | external system | profile_id, catalyst_id, qty | 서버 권위 |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability |
|-------|-------------|-----|---------|--------|-----------|
| 1 | 6 | 6 | - | - | N/A |
| 2 | 6 | 0 | 0 | 6 | 100% |
| 3 | 6 | 0 | 0 | 6 | 100% |
| 4 | 6 | 0 | 0 | 6 | 100% |
| 5 | 7 | 1 | 0 | 6 | 100% |
| 6 | 7 | 0 | 0 | 7 | 100% |

## Interview Transcript

<details>
<summary>Q&A (Round 0 + 6 rounds)</summary>

**R0 토폴로지:** 남은 미결 4개(가격 저작·화면 구성·자산 문구·레인 검증) → 넷 다 다룬다

**R1** (Constraint / 가격 저작) `dropWeight`가 상수 5개뿐이라 가격이 3단 계단이다. 그대로 둘까?
→ 그대로 둔다 (1/w 정비례). 앰비규어티 49%

**R2** (Criteria / 가격 저작) 1× 기준 단위는?
→ 10 (환급 5). 앰비규어티 43%

**R3** (Criteria / 화면) 보유와 상점을 어떻게 배치?
→ 통합 단일 목록. 앰비규어티 36%

**R4** (Contrarian) 잔재를 없애고 직접 교환하면 구현량 절반인데?
→ 잔재 유지 — 부분 누적이 핵심. 앰비규어티 33%

**R5** (Criteria / 레인) 어떻게 쪼개고 무엇으로 증명?
→ 단일 레인 순차 + 실세션 스모크. 앰비규어티 24%

**R6** (Simplifier / 자산) 아이콘을 이번 레인에?
→ PixelLab 1장 포함. 앰비규어티 **12%** ✅

</details>
