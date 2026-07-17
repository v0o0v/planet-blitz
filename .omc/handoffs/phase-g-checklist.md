# Phase G — M4 게이트 5종 최종 검증 체크리스트 (리드 작성, E·F 머지 후 실행)

계획 §4 Phase G + 마스터 §4 게이트. 각 항목은 "실행 증거"가 있어야 통과(주장 금지).

> **검증 완료(worker-g, 2026-07-17)** — 게이트 5종 + 회귀 전부 PASS. 상세 증거:
> `.omc/handoffs/phase-g-results.md`. 산출물: `scripts/e2e/invasionE2E.ts`·`probe.ts`.

## 게이트① 위조 100% 거부 (AC2) — PASS
- [x] `deno task verify-invasion` 전 시나리오(조작 해시·트림 입력·config 위조·self·쿨다운·랭크 윈도우) 거부 확인
- [x] 원격 EF 위조 제출 스모크(실 JWT 2계정) — rejected(final-hash-mismatch·outcome-mismatch·self insert 트리거 거부)

## 게이트② 침공 e2e (AC3) — PASS
- [x] 실 계정 2개(익명 Auth): A 방어 업로드 → B 매치메이킹 제안 → B 침공 → EF verified → 래더 스왑·복제약탈 원격 DB 실측
- [ ] 하네스 딥링크 실플레이 — **사람 실플레이 잔여**(사용자 몫). 기술 경로는 e2e로 전수 검증됨.

## 게이트③ 배치전 삽입 무변동 (AC4) — PASS
- [x] T-E3 재실행: 4승→rank13 삽입, existing_order_preserved=t, total=21(기존 상대 순서 불변)

## 게이트④ 풍화 무결 (AC5) — PASS
- [x] weather_defenses 1회: maintenance만 -5(2000→1900), profiles·items·ladder·layout+budget diff 0 (T-E2 재실행)

## 게이트⑤ 상호 침공·복수전 (AC6) — PASS(스크립트 e2e)
- [x] 두 계정 상호 침공 + 복수전(24h·쿨다운 무시·탈환+보너스 광물 +50) 원격 DB 실측
- [ ] **사람 실플레이 권장 구간**(사용자 안내) — UX 게이트 잔여.

## 회귀·결정론 (AC13) — PASS
- [x] `npm test`(512 tests)+`tsc`+eslint 전체, `deno task verify`·`verify-run`·`verify-invasion` 전부 녹색
- [x] src/sim 금지 심볼 lint 0(eslint clean), PvE fixtures 해시 불변
- [x] `get_advisors` security/performance — ERROR 0, WARN 전부 의도(문서화)

## 마감
- [x] phase-g-results.md 기록·checklist 갱신. README·계획 AC 체크박스·프로젝트 메모리·/cancel 은 리드 몫.
