<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# run — 런 설정·의뢰서

## 목적

**런 하나가 시작되기 전에 확정되는 것들.** 어떤 기체·장비·스킬·촉매·행성·단계로 출격하는지를
`runConfig` 하나로 조립하고(리플레이 검증이 이 config 를 대조한다), 의뢰서(Commission) 시스템의
타입·상수 정본을 담는다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `runConfig.ts` | 런 설정 조립 — **단일 정본**. 서버는 리플레이의 `config` 를 이것으로 재도출해 대조한다 |
| `commission.ts` | 의뢰서 스키마 — **타입 단일 정본** |
| `commissionConstants.ts` | 의뢰서 상수 단일 정본 |
| `commissionServerConstants.ts` | 의뢰서 **서버 축** 상수 — SQL 미러의 TS 정본 |
| `commissionGrantDelivery.ts` | 의뢰 확정 지급물 배송 — 서버 발급 원장(`commission_grants`) → 플레이어 세이브 |
| `callupPilot.ts` | 예비역 소집 pilot 조립(ADR-0024) — 순수 함수 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **`commission*` 을 고치면 `verify-commission` Edge Function 재배포가 따라온다**(번들에 실린다).
- `commissionServerConstants.ts` 는 SQL 과 **같은 값을 두 곳에 적는 유일하게 허용된 자리**다 —
  한쪽만 고치면 서버와 클라의 판정이 갈린다. 반드시 함께 움직인다.
- 배송은 멱등이어야 한다 — 판정자는 `src/save/itemPresence.ts` 하나다.
- 제약 계약(주문)은 **위반이 원천 불가능하도록** 조립 단계에서 걸러진다(장비는 조립에서 빠지고
  금지 파워업은 3택 풀에서 빠진다). sim 이 감시하지 않는다.

### 테스트 요구사항

`tests/runConfig*.test.ts` · `commission*.test.ts` · `runConfigCallup.test.ts` ·
`reserveCallupIntegration.test.ts`.
서버 축은 `scripts/deno-verify/` 와 `supabase/tests/` 가 함께 본다.

### 공통 패턴

- 전부 순수 함수. 조립 결과는 해시에 들어가므로 필드 추가는 신중히 한다.

## 의존성

### 내부

`src/items/**` · `src/save/**` · `src/sim/commission*` · `data/commissionBosses.ts`

### 외부

없음.

<!-- MANUAL: -->
