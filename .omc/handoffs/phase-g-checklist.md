# Phase G — M4 게이트 5종 최종 검증 체크리스트 (리드 작성, E·F 머지 후 실행)

계획 §4 Phase G + 마스터 §4 게이트. 각 항목은 "실행 증거"가 있어야 통과(주장 금지).

## 게이트① 위조 100% 거부 (AC2)
- [ ] `deno task verify-invasion` 전 시나리오(조작 해시·트림 입력·config 위조·self·쿨다운·랭크 윈도우) 거부 확인
- [ ] 원격 EF에 위조 페이로드 제출 스모크(실 JWT 2계정) — rejected 확인

## 게이트② 침공 e2e (AC3)
- [ ] 실 계정 2개(익명 Auth)로: A 방어 업로드 → B 관제탑 제안 → B 침공 런 → 제출 → EF 재실행 verified → 래더 스왑·약탈 반영 확인(원격 DB 조회)
- [ ] 하네스 딥링크로 실플레이(수동 or 오토파일럿) — 브라우저 검증은 `/harness` + `__pb.harness.ff`

## 게이트③ 배치전 삽입 무변동 (AC4)
- [ ] 신규 계정 배치전 5회 → 삽입 전후 기존 유저 rank 상대 순서 불변 쿼리 증거(Phase E 통합테스트 재실행)

## 게이트④ 풍화 무결 (AC5)
- [ ] cron 함수 수동 1회 실행 → defenses.maintenance만 -5, profiles.save·items·ladder 전 컬럼 diff 0 증거

## 게이트⑤ 상호 침공·복수전 (AC6)
- [ ] 두 계정 상호 침공 + 복수전(24h 창·쿨다운 무시·탈환+보너스) e2e — **사람 실플레이 권장 구간**(사용자 안내)

## 회귀·결정론 (AC13)
- [ ] `npm test`+`tsc`+eslint 전체, `deno task verify`(parity)·`verify-run`·`verify-invasion` 전부 녹색
- [ ] src/sim 금지 심볼 lint 0, PvE fixtures 해시 불변
- [ ] `get_advisors` security/performance 재점검(신규 경고 0 또는 의도 문서화)

## 마감
- [ ] supabase/README.md·계획 문서 AC 체크박스 갱신, 프로젝트 메모리 갱신, /oh-my-claudecode:cancel
