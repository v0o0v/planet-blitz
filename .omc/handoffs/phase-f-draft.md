# Phase F 계약 초안 (draft — Phase E 머지 후 확정)

## lane 분할(예정)
- **lane f-server**: 복수전 서버 로직(침공당해 순위 상실 시 24h 복수권 — invasions 이력 기반, 쿨다운 무시 판정, 성공 시 자리 탈환+보너스 광물 지급을 apply_invasion_result 확장 또는 별도 함수로), `verify-pve-sample` EF + pg_cron(상위 N%·시간당 획득 상한 이상치·랜덤 1% 재실행, 적발 시 런 무효+`profiles.flagged`=true, AC11 — 기본안 OQ-M4-2), 스티커 알림 저장 채널(테이블 또는 invasions 컬럼).
- **lane f-client**: `data/stickers.ts` 12종(톤 확정: "가벼운 유머·도발, 조롱·모욕 아님" — 자유 입력 금지, AC12), 침공/방어 성공 시 스티커 선택·상대 알림 표시 UI, 리플레이 관전 뷰(invasions.replay 결정론 재실행 재생 — 하네스 ff 패턴 참조), 복수전 UI(관제탑에 복수 대상 표시·쿨다운 무시 배지).

## 미결(리드 판단)
- PvE 런 서버 기록이 현재 profileSync 에 어느 수준으로 올라가는지(F4 샘플링의 입력) — Phase B 산출 확인 후 확정.
- 스티커 알림 전달 채널: 폴링(관제탑 진입 시 최근 invasions 조회) vs realtime — 기본안: 폴링(단순, MAU 규모에 충분).
- 복수전 순위 "자리 탈환" 정의: 원래 rank 복원 vs 현재 시점 스왑 — GDD §8 재확인 필요.
