# Handoff: 재화 서버 권위 — 완전 이관 설계 (Wave 2 착수 기준)

Lane 1(worker-currency)이 `profiles.credits`/`minerals` numeric 컬럼 + guard 봉인 + 소비 RPC 재작성을 끝내면, 아래 설계로 **나머지 client-pure 재화 경로 전부**를 서버 경유로 돌린다. 목표: 클라가 재화를 직접 못 쓰게(위조 불가) 하되, 정직 유저 체감은 불변.

## 클라-pure 재화 변동 전수 (grep 확인 완료)

**EARN (서버 grant 경로 필요):**
- `src/save/settlement.ts:121` 런 자원 → credits (`creditsGained = floor(resources)`)
- `src/save/settlement.ts:207` 사연 챕터 보상 credits (데이터 구동 SHIP_STORIES, claim-once)
- `src/save/settlement.ts:280-281` 살베지(대량 분해) credits/minerals

**SPEND (서버 spend 경로 필요):**
- `src/save/profile.ts:418` 리스펙 `credits -= respecCost`
- `src/ui/inventory.ts:221` + `src/ui/pixi/hangar.ts:285` 스태시 확장 `credits -= cost` (DOM·Pixi 2벌)
- `src/ui/refinery.ts:182` + `src/ui/pixi/refinery.ts:230` 장비 어픽스 리롤 `minerals -= cost` (DOM·Pixi 2벌)

> ⚠️ DOM(`src/ui/*.ts`)과 Pixi(`src/ui/pixi/*.ts`) 2벌 존재(ADR-0014 이관 진행 중). 어느 쪽이 라이브인지 확인 후, 죽은 DOM 판은 이 기회에 제거하거나 최소한 함께 서버 경유로. 라이브 판만 남기는 게 정석.

**이미 서버 RPC (Lane 1이 컬럼 기준으로 재작성):** repair_defense, spend_profile_currency 헬퍼(방어체 level/ascend/reroll/promote/craft), apply_invasion_result(loot·defense success), apply_module_purchase, salvage_core_module.

## 서버 RPC 설계 (신규 2 + 원장 1)

### `currency_grants` 원장 테이블
`(id, profile_id, source text, credits numeric, minerals numeric, created_at timestamptz)`. 시간당·일일 누적 캡의 근거이자 이상치 신호(flag_pve_anomalies 대체). 7일 GC cron.

### `grant_currency(p_credits, p_minerals, p_source text, p_metrics jsonb default null)` — user JWT, SECURITY DEFINER
3중 캡을 서버가 강제해 **클라 주장액을 클램프**한다("서버 재계산" = 지급액 재산정):
- **① 개연성 캡**: source='pve_run'이면 p_metrics(finalTick·stage·kills)로 상한 산정 — credits ≤ f(finalTick, stage). 성과 없이 큰 자원 주장 차단. (계수는 placeholder, 출시 전 밸런스.)
- **② per-call 캡**: source별 1회 지급 상한(pve_run·salvage·story 각각). story는 소액 고정 상한.
- **③ 누적 캡**: `currency_grants`에서 최근 1h·24h 합산 조회 → 남은 예산까지만. 초과분은 상한까지만 지급, 극단 초과는 `profiles.flagged=true`.
- 지급 = `min(주장액, ①, ②, 남은③)`을 컬럼에 반영 + 원장 insert + 갱신 잔액 반환.
- 사용처: 런 정산(settle), 살베지, 사연 보상. 사연 claim-once는 클라 원장(storyRewardsClaimed) 유지(재청구는 ③ 누적 캡이 유계) — 서버 claim 원장 이관은 선택적 후속 강화.

### `settle_pve_run(p_summary jsonb)` — user JWT
정산 요약(생존 틱·처치·자원·stage·planet 등)을 받아 `grant_currency(source='pve_run', metrics=요약)`로 credits/minerals 지급 + `pve_runs`에 요약 이력 1행(리플레이 없음). pve_runs는 요약 로그로 개편(replay·client_result 컬럼 제거), 7일 GC. **리플레이 업로드·샘플링 재검증 폐기(ADR-0026).**

### `spend_currency(p_credits, p_minerals, p_reason text)` — user JWT
잔액 확인 후 컬럼 차감, 갱신 잔액 반환. 잔액 부족이면 실패. 사용처: 리스펙·스태시 확장·장비 어픽스 리롤. (정확한 코스트는 클라가 계산 — 스펜드는 과소청구해도 재화 창조가 아니라 소액 sink 손해라 캡 불필요. 핵심 방어=잔액 이상 못 씀.)

## 클라 재배선 규율
- `save.credits`/`minerals` = **표시 미러**로 강등. 각 RPC 응답의 `credits_left`/`minerals_left`로 갱신.
- 위 7개 site: 로컬 `+=`/`-=` 직접 변경 제거 → 해당 RPC 호출 후 응답으로 미러 세팅.
- `serializeProfile`/`upsertProfile`은 credits/minerals를 계속 담아도 무해(guard가 서버 컬럼 봉인, Lane 1이 save->>'credits' 읽기 전부 제거). 단 서버가 재화를 save에서 안 읽는 걸 Lane 1 완료로 확증.
- 오프라인: 재화 변동은 서버 확정이라 오프라인 시 낙관적 미러만 갱신하고 재동기 시 서버값이 정본. `settleRun`은 credits/minerals 파트를 떼어내 grant RPC로, 나머지(아이템·XP·스킬포인트·진행·파편·스토리메트릭)는 기존대로 save 유지(기체/아이템 원장은 Lane 4 범위).
- 오염 런(ADR-0008)·하네스는 기존 격리대로 정산/서버 호출 스킵.

## 캡 상수
전부 placeholder(`CAP_*` 상수 한 곳 모음). 출시 전 밸런스 일괄 튜닝(defer-balance-tuning)에서 실데이터로 확정.
