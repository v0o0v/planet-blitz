# Phase E 계약 초안 (draft — Phase D 머지 후 확정)

Phase D 산출(verify-invasion EF·apply_invasion_result()·get_invasion_targets())을 전제로 한 lane 분할 초안. D 리뷰 결과에 따라 리드가 갱신한다.

## lane 분할(예정)
- **lane e-server**: 배치전 순위 삽입 함수(`apply_placement_result` — 기존 유저 rank 무변동 삽입, AC4), 풍화 pg_cron(주 1회 일요일 자정 UTC, `defenses.maintenance -5%p`, 0%→포탑 50% 규칙은 sim 쪽 소비 — cron은 수치만), 비활성 침하 pg_cron(30일+ 미접속 주기 하락), `pg_cron`/`pg_net` 확장 활성. 마이그레이션 + 원격 적용 + AC5 검증(자원·장비·순위 무변동 쿼리 증거).
- **lane e-client**: `data/seedBases.ts` NPC 시드 기지 20개(난이도 분포 하위~중위, DefenseLayout JSON — 예산 20 규칙·normalizeLayout 통과 필수), 배치전 UI 플로우(PvP 해금 첫 5회 → NPC 기지 침공 → 성적 집계 → 순위 삽입 요청), 정비 UI(크레딧 정비 — 서버 RPC 경유, 클라 직접 maintenance 쓰기 불가·가드 트리거 존재), 하락 예고 알림.

## 미결(리드 판단 필요)
- 배치전 성적→초기 순위 곡선(계획 §5: 신규 진입 완화) — 기본안: 5회 승수 기반 구간 삽입(하위 40~80% 구간).
- NPC 기지는 ladder 에 실제 행으로 넣나(placed NPC profiles) vs 별도 테이블 — 기본안: `profiles`에 NPC 플래그 없이 **별도 seed 데이터**로 두고 배치전은 ladder 밖에서 계산(기존 순위 무변동 보장이 자명해짐). D 구현 형태 보고 확정.
- 정비 회복 RPC(`repair_defense`)는 E 범위 — 크레딧 차감과 maintenance 갱신 원자 처리(service_role).
