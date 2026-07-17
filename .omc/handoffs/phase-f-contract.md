# Handoff: Phase E → Phase F (계약 확정판, 리드 2026-07-17)

`phase-f-draft.md`를 대체한다. Phase E 산출(NPC 시드·배치전·풍화 cron·repair_defense·sim maintenance 소비) 전제.

## lane 분할 + 파일 소유권
- **lane f-server**: `supabase/**`, `scripts/deno-verify/**`, 서버 테스트. src/·data/ 수정 금지.
- **lane f-client**: `src/**`(sim 제외 — sim 필요 시 보고만), `data/**`, `tests/**`, 하네스. supabase/ 수정 금지.
- git commit 금지(리드 일괄), 서브에이전트 금지, 문서 한글.

## 계약
1. **복수전(F1, AC6)**: 침공당해 순위를 잃은 방어자에게 24h 복수권 — 판정 근거는 `invasions`(verified·attacker_won=true·스왑 발생) 이력. 서버: `get_revenge_target()`(복수 대상·잔여 시간 반환, 쿨다운 무시 플래그) + `apply_invasion_result` 확장(복수 성공 시 자리 탈환 + 보너스 광물 지급 — 광물은 profiles.save 자원, repair_defense의 save 갱신 패턴 재사용). "자리 탈환" 정의 = 현 시점 스왑(원래 rank 복원이 아님 — 단순·악용 여지 적음, GDD §8 재확인 후 어긋나면 보고). 복수전은 랭크 격차 30 가드 예외(쿨다운 무시와 함께).
2. **도발 스티커(F2, AC12)**: `data/stickers.ts` 12종(자유 입력 금지) — 톤 "가벼운 유머·도발, 조롱·모욕 아님". 침공/방어 성공 시 1개 선택 → 상대 알림. 서버: `invasions.sticker`(smallint 0..11, 제출 후 1회만 설정 — 트리거로 불변 강제) 또는 별도 경량 방식(f-server 판단·문서화). 전달 채널 = 폴링(관제탑 진입 시 최근 invasions 조회) — realtime 금지(기본안).
3. **리플레이 관전(F3)**: 침공당한 리플레이 재생 — `invasions.replay` 로드 → 로컬 결정론 재실행(runReplay)을 렌더와 함께 재생. 관제탑 침공 이력에서 진입. `world.tainted` 마킹으로 정산·제출 오염 방지(기존 하네스 ff 패턴 참조). 렌더 전용 — sim 무수정.
4. **PvE 샘플링(F4, AC11)**: EF `verify-pve-sample` + pg_cron — 대상 선정: 상위 N%(기본 5%) + 시간당 획득 상한 이상치 + 랜덤 1%(OQ-M4-2 기본안). PvE 런 서버 기록이 전제 — **profileSync가 PvE 런 결과를 어느 수준으로 올리는지 f-server가 먼저 확인**하고, 리플레이가 서버에 없으면 이 단계에서는 "통계 이상치 플래그"만 구현하고 리플레이 재실행 샘플링은 착수 조건 문서화(PvE 리플레이 업로드는 별도 결정 — 용량·빈도 트레이드오프라 리드/사용자 판단). 적발 시 런 무효+`profiles.flagged`(서버 전용 필드 기존 가드 활용).
5. **알림 표시(f-client)**: 관제탑 진입 시 "새 침공 결과 n건"(스티커 포함) 배너. 폴링 전용.

## Risks
- PvE 리플레이 미보유 시 F4 축소 범위(통계만) — 계약 4의 조건 분기 준수.
- 복수전 격차 가드 예외가 HIGH 리뷰 지적(랭크 리프프로그)을 재개방하지 않는지 — 복수 대상 검증(직전 스왑 상대 한정)을 서버가 강제해야 함.
- 스티커 문구는 사용자 취향 영역 — 톤 가이드 준수해 12종 제안하되 PR 본문에 "사용자 검수 요망" 명시.
