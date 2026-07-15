# M3 Lane 2 핸드오프 — 콘텐츠 볼륨 (B1~B4)

- 작성: 2026-07-16 (Executor, M3 Lane 2)
- 브랜치: `worktree-agent-a4dcb100a58f3410b` (격리 워크트리, `feat/m3-progression-complete` = 2f0eae9 기준 분기)
- 커밋:
  - `23031ce` feat(m3): 니플헤임·아르케·섬멸 티어·원소 상태이상·유니크 15점 (구현 + M2 테스트 3건 갱신)
  - `8ab813d` test(m3): 신규 콘텐츠 25건 단위 검증
- 검증: `npm test` 175/175 녹색(150 baseline + 25 신규), `npx tsc --noEmit` 클린, `npm run lint` 0 경고
- 범위: plan Phase B(B1~B4) 전부. push/PR 없음(커밋만).

## 구현 요약

### B1 니플헤임 (`data/planets/niflheim.ts`, `data/bosses/niflheim-flagship.ts`)
- 잡몹 4종(유령 요격기·서리 포수·서리 균열·냉기 정비선, typeIndex 10~13) + 엘리트 2종(14~15).
- 유령 기함 보스 3페이즈: 신규 공격 `laserNet`(레이저 그물 격자) + `slowField`(감속 지대) + 기존 ring/spiral/summon/aimedBurst.
- 감속 지대: `HAZARD_SLOW`(subtype 2, append) + `WorldState.playerSlowTicks`(신규 스칼라, hashWorld append-only). 접촉 다음 tick부터 이동 속도 ×0.5.

### B2 아르케 (`data/planets/arke.ts`, `data/bosses/arke-obelisk.ts`)
- 잡몹 4종(파쇄 골렘·정밀 포탑·분쇄 토템·복원 드로이드, typeIndex 16~19) + 엘리트 2종(20~21).
- 수호자 오벨리스크 3페이즈: 신규 공격 `polygonSpin`(기하학 회전 다각형 탄막, boss.targetX에 기준각 누적) + ring/spiral/aimedBurst.
- `data/planets/index.ts`에 NIFLHEIM(2)·ARKE(3) 등록 → 성계 지도 자동 노출(M2 Lane4 INT-1 방식). `ENEMY_BY_TYPE` 22종 append.

### B3 섬멸 티어 (`data/waves.ts`, `src/sim/waves.ts`, `src/sim/patterns/index.ts`, `src/sim/elite.ts`)
- `TIER_PARAMS` 데이터 주입(갈림길③A): `{ hpMult, densityMult, eliteCount, subBullets }` 티어별 행.
  - **정찰(0)·교전(1)은 M2 거동 byte-identical 보존**(hpMult 1·subBullets 0·densityMult 1·eliteCount 0/1). 회귀 0.
  - 섬멸(2): subBullets 3(fragments 밀도↑ + mortar 방사 견제탄), densityMult ×1.5, eliteCount 2, hpMult ×4.5.
- 레벨 캡 100·섬멸 진입 게이트: `LEVEL_CAP`, `ANNIHILATION_UNLOCK_LEVEL=60`, `canEnterTier(tier, level)`.
- 엘리트 어픽스 8종 완성: M2 4종 + 재생하는(4)·보호막의(5)·폭발성의(6)·광폭한(7). `ELITE_AFFIX_COUNT=8`.
  - 재생=매 틱 회복(stepEnemies), 보호막=받는 피해 ×0.5(bullet-hit), 폭발성=대형 사망 폭발(spawnEliteDeathFx 확장), 광폭=접촉피해·속도↑.

### B4 어픽스 24종 + 상태이상 + 유니크 15점
- 어픽스 24종(`data/affixes.ts`, `src/items/types.ts`): 원소 프리픽스 3종(작열=fireDmg, 빙결=coldSlow, 방전=lightning). PREFIXES 12 + SUFFIXES 12.
- 상태이상 시스템(신규 `src/sim/status.ts`): 화염=지속피해, 냉기=감속, 전격=인접 연쇄(즉발).
  - 적 재활용 필드로 관리: `enemy.iframes`=burn 틱, `enemy.dashCooldown`=burn 틱당 피해, `enemy.ownerId`=감속 틱. **적은 이 세 필드를 쓰지 않아 거동 충돌·해시 변경 없음**(uniques.ts 관례 승계). 미장착 시 모두 0 → 기존 콘텐츠 완전 불변.
  - `LoadoutConfig`에 `fireDmg/coldSlow/lightning` append(hashWorld loadout 블록 뒤 append-only). `computeLoadoutStats`가 원소 어픽스 합산.
  - 명중 적용은 `resolveCollisions`의 아군탄-적 분기(enemy에만, 보스 제외 — 보스 재활용 필드 충돌 방지).
- 유니크 15점(`data/uniques.ts`, `src/sim/uniques.ts`): M2 5 + M3 10(bit 5~14). 전 7슬롯 커버.
  - **시뮬 실훅 구현**: 특이점 발생기(8, 흡인)·반응 장갑(9, 반격 펄스)·위상 전환막(10, 저체력 폭발+회복, player.targetY 쿨다운 재활용)·잔상 추진기(11, 대시 적탄 소거)·탐욕의 심장(12, 콤보·자석 스택)·유물 증폭기(14, 경험치↑).
  - **슬롯·비트만 확정(효과 통합 대기)**: 군집 벌통(5, 미사일=weaponType 3)·수렴 프리즘(6, 빔=weaponType 4)·쌍둥이 항성(7, 스프레드 발사)·도박사의 칩(13, 파워업 +1). autoAttack·파워업 미개입(Lane1/Lane4 영역).

## Lane 간 충돌 예상 지점 (통합 시 주의)
- **`src/sim/world.ts`**: Lane 1(autoAttack 미사일·빔 분기)과 병행 편집. 나는 autoAttack **미개입** — stepEnemies(상태이상·특이점), stepPlayer(감속·잔상·위상막 쿨다운), resolveCollisions(원소·엘리트 피해·반응/위상막), collectGem(탐욕·유물)만 수정. import 블록·LoadoutConfig 확장에서 텍스트 충돌 가능.
- **`src/items/loadout.ts`**: Lane 1이 스킬 합류부 수정. 나는 `neutralLoadout`/`zeroSums`/`computeLoadoutStats`의 **원소 필드 3개**만 추가. 병합 시 두 확장 모두 유지 필요.
- **`src/sim/replay.ts` hashWorld**: loadout 블록 끝에 `fireDmg/coldSlow/lightning` 3필드, 최후미에 `playerSlowTicks` append. Lane 1이 스킬 config를 append하면 **순서 조정 합의 필요**(둘 다 append-only 원칙이므로 순서만 고정하면 결정론 유지).
- **weaponType 코드 3·4**: 군집 벌통(3)·수렴 프리즘(6)의 무기타입 의존부는 상수 가정만. 발사 로직은 Lane 1, 통합 검증은 Lane 4.
- **KIND_CODE/typeIndex/uniqueMask bit**: 전부 append-only 준수. Lane 간 신규 번호 배정 시 겹침 확인(현재: enemy typeIndex 0~21, unique bit 0~14, HAZARD subtype 0~2).

## 밸런스 메모 (재미 게이트 루프 이관)
- 교전(1) HP ×2.2는 plan 밸런스 표 값이나 M2 테스트(berdan 완주·drops 엘리트) 회귀 방지 위해 현재 ×1 유지. 튜닝 시 TIER_PARAMS.hpMult[1] 한 곳만 수정.
- 원소 상태이상은 enemy에만 적용(보스 제외). 보스 원소 상태이상이 필요하면 별도 보스 전용 상태 필드 신설 필요(보스는 iframes/dashCooldown/targetX 사용 중).
