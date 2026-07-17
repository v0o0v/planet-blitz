# Handoff: team-plan → team-exec (M4 잔여, Phase D 착수)

## 현재 상태 (2026-07-17, main `bfb8014`)
- **Decided**: Phase A(Deno 검증)·B(스키마+원격 적용 완료)·C(방어/침공 시뮬+에디터) 머지 완료. 스키마는 원격(`qxgbxwyccbxokdgwxcuw`)에 적용됨 — 7테이블·RLS·정책 13·트리거 9 실측 확인. 익명 Auth 활성. `.env.local`(VITE_SUPABASE_URL/ANON_KEY) 로컬 설정 완료(커밋 금지).
- **작업 브랜치**: `feat/m4-phase-d` (워크트리 `D:\ClaudeCowork\worktrees\shooting\supabase-connection-check-9bd96b`)
- **Remaining**: Phase D → E → F → G (`.omc/plans/planet-blitz-m4-plan.md` §4)

## Phase D lane 분할 + 파일 소유권
- **lane d-server**: `supabase/functions/**`, `supabase/migrations/**`(신규 마이그레이션), `supabase/README.md`, Deno 테스트. **src/ 수정 금지.**
- **lane d-client**: `src/ui/**`, `src/net/**`, `src/main.ts`, `src/harness/**`, `tests/**`(vitest). **supabase/ 수정 금지.**
- 두 lane 모두 **git commit 금지** — 리드가 완료 후 일괄 커밋·PR.

## D 서버↔클라 계약 (양 lane 공통 전제 — 어긋나면 리드에 보고)
1. **Edge Function `verify-invasion`** (verify_jwt=true, 호출자=공격자 본인):
   - 요청: `POST { invasion_id: string }`
   - 동작: invasions 행 로드(pending 확인, attacker=JWT uid 확인) → 리플레이 전수 재실행(verifyCore 확장, 방어 엔티티 포함) → client_result 대조 → verified_status/verified_result/attacker_won/verified_at 갱신 → 승리·순위 조건 충족 시 **래더 스왑 + 복제 약탈을 Postgres 함수 1개(security definer, 단일 트랜잭션)** 로 원자 처리.
   - 응답: `{ status: 'verified'|'rejected', attackerWon: boolean, ladder: { attackerRank, defenderRank } | null, loot: LootItem[] }`
2. **매치메이킹**: Postgres 함수 `get_invasion_targets()` (security definer) — 내 바로 위 3명 + (내 순위-30)~내 순위 구간 랜덤 1명 제안(GDD §8 해석; 서버 lane이 GDD 확인 후 확정, 계약은 "반환 shape" 고정): `[{ profile_id, rank, display_name, ship_summary jsonb, defense_id, layout jsonb, maintenance }]`. 재도전 쿨다운 1시간은 서버에서 강제(invasions 최근 행 검사).
3. **클라 제출 플로우**(d-client): invasions 행 insert(replay+client_result, RLS상 pending 강제) → `supabase.functions.invoke('verify-invasion', { invasion_id })` → 응답으로 결과 UI.
4. README "Phase D 착수 조건" 이행(서버 lane): 정찰 전면공개 3정책(`ships/defenses/guardians_select_others`)을 `get_invasion_targets()` 경유로 좁히기(정책 폐기), defenses INSERT budget_spent 검증 게이트.

## Risks
- verifyCore 는 PvE 런 검증용 — 침공(방어 엔티티 스폰) 확장 시 결정론 유지 필수(`src/sim/` 공유 소스 import, 갈림길①A).
- Edge Function service_role 컨텍스트 확증 미실측(README §확증 4) — d-server 가 배포 후 `select current_user, public.is_service_role()` 실측할 것.
- 클라 UI 는 defenseCommand(`?screen=defense`) 패턴 참조. 하네스 딥링크 `?screen=controlTower` 추가.
