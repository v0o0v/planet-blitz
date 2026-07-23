# Handoff: PvE 정산 서버 RPC (클라 배선용)

마이그레이션 `supabase/migrations/20260726000200_pve_settlement.sql`(ADR-0026/0027)이 재화를 서버 경로로만 늘리는 RPC 3종과 원장(`currency_grants`)·3중 캡을 세웠다. 클라(`src/`)는 로컬 `+=`/`-=` 직접 변경을 제거하고 아래 RPC를 호출한 뒤 응답의 `credits_left`/`minerals_left`로 표시 미러를 갱신한다. `profiles.credits`/`minerals`(numeric, worker-currency 컬럼)가 정본이고 `save.credits`/`minerals`는 표시 미러다.

## RPC 3종

### `settle_pve_run(p_summary jsonb) → jsonb`  (user JWT)
- 인자: `p_summary` = 정산 요약 `{ victory, planet, stage, finalTick, kills, resources, minerals }`. `resources`→credits, `minerals`→minerals 로 지급. `finalTick`·`stage`는 개연성 캡 산정에 쓰이니 반드시 실측값을 채울 것.
- 반환: grant_currency 결과 `+ { settled:true }` → `{ granted_credits, granted_minerals, credits_left, minerals_left, clamped, settled }`.
- 사용처: **런 정산** `src/save/settlement.ts:121`(자원→credits) + `:280-281`(살베지는 별도 grant, 아래). 런 자원·광물 파트를 이 RPC로 이관.

### `grant_currency(p_credits, p_minerals numeric, p_source text, p_metrics jsonb=null) → jsonb`  (user JWT)
- 3중 캡(개연성·per-call·누적)으로 주장액을 클램프해 가산. 극단 초과 시 `profiles.flagged=true`.
- 반환: `{ granted_credits, granted_minerals, credits_left, minerals_left, clamped:boolean }`.
- `p_source`: `'pve_run'`(settle_pve_run이 내부 호출) | `'salvage'`(대량 분해 `settlement.ts:280-281`) | `'story'`(사연 챕터 보상 `settlement.ts:207`, 크레딧만) | 기타=보수적 기본 상한.
- 사연 claim-once는 클라 원장(`storyRewardsClaimed`) 유지 — 재청구는 누적 캡이 유계.

### `spend_currency(p_credits, p_minerals numeric, p_reason text) → jsonb`  (user JWT)
- 본인 잔액 차감(부족 시 미차감·`ok:false`, 음수 인자 방어). 반환 `{ ok:boolean, credits_left, minerals_left }`.
- 사용처: 리스펙 `src/save/profile.ts:418` · 스태시 확장 `src/ui/inventory.ts:221`+`src/ui/pixi/hangar.ts:285` · 어픽스 리롤 `src/ui/refinery.ts:182`+`src/ui/pixi/refinery.ts:230`. (DOM/Pixi 2벌 중 라이브 판만 남길 것 — 설계 §클라 재배선 규율.)

## 주의
- 오염 런(ADR-0008)·하네스는 기존 격리대로 정산/RPC 호출 스킵.
- 캡 상수는 전부 placeholder(마이그레이션 상단 배너 = 의미 정본). 출시 전 밸런스 튜닝(defer-balance-tuning)에서 실데이터로 확정.
- `pve_runs`는 요약 로그로 개편 중 — 정산행은 `replay`/`client_result`에 임시 `'{}'`, `verified_status='verified'`(Lane 3=worker-teardown이 리플레이 컬럼·not null 제거 예정).
