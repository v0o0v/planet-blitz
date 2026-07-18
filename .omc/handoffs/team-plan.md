# Handoff: team-plan → team-exec (방어 카드 시스템 구현)

- **정본 스펙**: `.omc/specs/grill-defense-card-system.md` (확정 결정 10라운드·구현 접점 표·AC 11항목). 용어는 `CONTEXT.md`(방어 카드 섹션), 차감 시점은 `docs/adr/0012-defense-card-snapshot-charge.md`.
- **브랜치**: `feat/defense-card-system` (origin/main `ba22bb0` 분기). lane 직렬 커밋, push/PR은 리드가.
- **OQ 확정 (리드 결정, 스펙 권장안 채택)**:
  - OQ#1 보관함 만석(20장) → **획득 차단** + 상점/합성 버튼 비활성화 안내
  - OQ#2 방어 성공 카드 확률 = base × (1 + clamp(공격자 전투력점수 − 내 전투력점수, 0, 5000)/5000) — 순수 함수로 data에
  - OQ#3 트리거 발동 연출 = 렌더 전용 배너(Lane D, 결정론 무관)
  - OQ#4 배치전 NPC 기지 카드 **없음** (1차 범위 외)
- **불변 제약 (전 lane)**:
  - 결정론(ADR-0005): sim/data에 Math.random·Date.now·pixi 금지, 클라·EF(Deno) 동일 모듈 공유
  - hashWorld는 조건부 append-only — 카드 미장착 침공·PvE 리플레이 해시 **바이트 불변**(fixtures diff 0으로 실증). 계보 마일스톤(PR#51)·수호(PR#35) 조건부 폴드 선례 참조
  - 서버 권위: 카드 소유·장착·횟수는 클라 직접 쓰기 금지(가드 트리거), EF는 스냅샷 권위 카드로 재실행
  - Rarity·RARITY_CODE 재사용(src/items/types.ts), 재번호 금지
  - SQL 함수 create or replace 시 기존 봉인/가드 블록 전수 대조(PR#29·#35 회귀 교훈)
- **수치 시작값(📝 튜닝 대상)**: 횟수 n6~10/m5~8/r3~6/u2~4, 합성 n→m 50%/m→r 20%/r→u 3%, 상점 재고 n3~4+m1~2, 보관함 20
- **위험**: EF 재배포·마이그레이션 원격 적용은 이번 범위 밖(리포만 — 사용자 승인 필요 항목으로 리드가 최종 보고에 명시)
- **검증 명령**: `npm test`(vitest), `npm run lint`, `npm run build`, deno task(supabase/functions 쪽 verify 태스크)

## Lane 순서와 산출 핸드오프
1. **Lane A** 카드 데이터+rollCard → `.omc/handoffs/lane-a-cards-data.md`
2. **Lane B** sim 통합(해시 불변) → `.omc/handoffs/lane-b-sim.md`
3. **Lane C** 스키마+EF+RPC → `.omc/handoffs/lane-c-server.md`
4. **Lane D** net+UI+i18n → `.omc/handoffs/lane-d-ui.md`
5. **Verify** 전체 게이트+리뷰 → 리드가 PR
