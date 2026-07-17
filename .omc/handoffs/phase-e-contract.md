# Handoff: Phase D → Phase E (계약 확정판, 리드 2026-07-17)

Phase D 머지 완료(main `f4b55c8`, PR #27). verify-invasion EF v1 ACTIVE(원격), 마이그레이션 3건 적용 상태. 초안 `phase-e-draft.md`를 아래로 대체·확정한다.

## Phase D 확정 사실 (E가 전제할 것)
- 침공 파이프라인: `invasions` insert(pending, 트리거가 self-invasion raise) → EF `verify-invasion`(전수 재실행·layout 정규화 대칭·쿨다운/랭크윈도우 확정 직전 강제) → `apply_invasion_result`(스왑 격차≤30·복제 약탈 상한 200·프로필 오름차순 락).
- 매치메이킹 `get_invasion_targets()`: defenses.active 직접 조인(ladder.defense_id 미사용 — E에서 풍화 앵커로 백필 검토가 이월 항목).
- 방어 업로드: 클라 defenseSync가 UPDATE 우선 upsert. budget은 서버 트리거가 layout에서 재산출.
- 순위표: `get_ladder_top(p_limit,p_offset)`.

## lane 분할 + 파일 소유권
- **lane e-server**: `supabase/**`(신규 마이그레이션·EF 수정), `scripts/deno-verify/**`, Deno·vitest 서버 테스트. **src/ 수정 금지**(단 `data/seedBases.ts`는 e-client 소유 — 서버 시드 SQL은 그 데이터를 복제하지 말고 마이그레이션에 자체 포함하되 e-client와 layout 동일성 합의).
- **lane e-client**: `src/**`, `data/**`, `tests/**`(vitest), 하네스. **supabase/ 수정 금지.**
- 둘 다 git commit 금지(리드 일괄), 서브에이전트 금지, 문서 한글.

## 계약 (양 lane 공통 전제)
1. **NPC 시드 기지 20개**: 실제 `profiles`+`defenses`(+배치전 대상 목록) 행으로 시드해 **기존 침공 파이프라인을 그대로 재사용**한다. `profiles.id → auth.users` FK 처리는 e-server 판단: ⓐ마이그레이션에서 `auth.users` 직접 insert(고정 UUID, seed 관행) 또는 ⓑadmin API. 선택·근거 문서화. NPC는 ladder에 **미리 배치**(rank 1~20 초기 시드 아님 — 난이도 분포에 맞는 자리, e-server가 GDD·계획 §5 근거로 확정·문서화).
2. **배치전(AC4)**: PvP 해금 후 첫 5회는 `get_placement_targets()`(NPC 전용 제안, 쿨다운 무시)로 NPC 기지 침공 → verify-invasion 재사용(단 **배치전 중에는 스왑·약탈 발동 금지** — 공격자 ladder 미보유 상태의 apply 동작을 명시적으로 정의) → 5회 완료 시 `apply_placement_result()`가 성적으로 초기 rank 삽입. **기존 유저 상대 순서 불변**(삽입점 이하 rank+1 shift는 허용 — AC4를 '상대 순서 불변'으로 해석, 근거 명시). `ladder.placed` 플래그 활용.
3. **풍화 pg_cron(AC5)**: `pg_cron` 확장 활성, 주 1회(일요일 자정 UTC) `defenses.maintenance = greatest(0, maintenance-5)`. **자원·장비·순위 절대 불변** — cron 함수가 defenses.maintenance 외 아무것도 안 건드림을 테스트로 증명. 침공 시뮬의 "0%→포탑 50%" 소비는 이미 sim에 있는지 e-client가 확인(없으면 보고만, sim 수정 금지).
4. **정비 회복**: RPC `repair_defense()`(security definer) — 크레딧 차감+maintenance=100 원자 처리. 크레딧은 profiles.save 안 자원이므로 서버가 save.credits 차감(구조 확인 후 구현, 불가하면 대안 문서화). 클라 정비 UI는 이 RPC만 호출.
5. **비활성 침하**: pg_cron 별도 잡 — `ladder.last_active` 30일+ 프로필 주기 순위 하락(하락폭 e-server 기본안·문서화). 상대 순서 원칙 준수.
6. **클라 배치전 UI**: 관제탑에 배치전 모드(0~5회 진행 표시, NPC 타깃 제안), 완료 시 순위 진입 연출. 정비 UI(방어 사령부에 정비도 표시+정비 버튼). `data/seedBases.ts`는 클라 표시용 메타(이름·난이도)+layout(예산 20·normalizeLayout 통과 필수) — e-server 시드 SQL과 layout 동일성은 상호 검증.

## Risks
- auth.users 직접 시드는 Supabase 내부 스키마 의존 — 실패 시 admin API 폴백.
- pg_cron이 프로젝트 플랜에서 활성 가능한지 e-server가 먼저 확인(불가 시 스케줄 대안 문서화·구현은 잡 함수까지).
- 배치전 스왑 금지가 Phase D apply의 미배치 엣지 정의와 충돌하지 않는지 e-server가 대조.
