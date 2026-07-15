# Handoff: M1 Phase 2 → Phase 3

- **완료(태스크 7~11)**: 기체 완성(WASD·마우스 조준·대시·HP·피격 무적) / 자동 공격(발칸, 최근접 자동 조준·연사, WeaponStats 증폭 훅) / 충돌(공간 해시 그리드) / 적 4종(패턴 컴포넌트 엔진 + 데이터) / 웨이브(6구간 예산표 + 8카드 시드 추첨).
- **검증**: `npm run test` 36 passed(기존 23 + 신규 13) / `npm run lint` 0 / `npm run build` 성공. 브라우저(5180) 실플레이: 적 tick0 스폰, 발칸 자동 격파(38 kill/33s), 플레이어 피격 HP 100→44, 해저드 예고→활성 확인. (스크린샷은 프리뷰 환경 WebGL readback 타임아웃으로 미획득 — scene graph로 스프라이트/오버레이 생성·위치 확증.)

## 신규/변경 파일
- `src/sim/constants.ts` (신규 leaf): TICK_RATE·DT·ARENA_*. world↔patterns 순환 방지용.
- `src/sim/entities.ts` (신규 leaf): 단일 `Entity` struct + `EntityKind`(player/enemy/bullet/enemyBullet/hazard/gem) + `KIND_CODE` + 팩토리(spawnBullet/spawnEnemyBullet/spawnHazard/spawnGem).
- `src/sim/collision.ts` (신규): `SpatialHash<T>`(결정론 순회) + `circlesOverlap`.
- `src/sim/patterns/{types.ts,index.ts}` (신규): 이동(chargeStraight/stationary/standoff/seekWounded) × 공격(fragments/mortar/lava/heal) 컴포넌트. `updateEnemy(state,e,def,player)`.
- `src/sim/waves.ts` (신규): `WaveRuntime`, `updateWaves`, `enemyDefFor`, 포메이션 배치.
- `data/enemies.ts`·`data/waves.ts` (신규): 적·웨이브 데이터.
- `src/sim/world.ts` (대폭 개편): 더미 제거 → 전투 루프. `WeaponStats`·`DEFAULT_WEAPON`, `WorldState`에 weapon·waveRng·wave·bulletCap·enemyBulletCount·kills·gems 추가. stepWorld 고정 순서.
- `src/sim/{snapshot,replay}.ts`·`src/render/{textures,entityRenderer}.ts`·`src/main.ts`·`src/bench/bench.ts` 동기 갱신.
- `tsconfig.json`: include에 `data` 추가.

## Phase 3 훅 지점
1. **파워업 스탯 훅**: `WorldState.weapon`(WeaponStats) 객체를 in-place 수정하면 즉시 발칸에 반영(캐시 없음). 필드: fireCooldown·bulletSpeed·damage·bulletCount·spread·pierce·bulletRadius·range·bulletLife. 발칸 외 파생(대시 쿨다운↓ 등)은 `WorldState.config`/플레이어 필드 수정. 파워업 선택은 `InputFrame.special`의 `SPECIAL_POWERUP_PICK`(예약됨) 프레임으로 입력로그에 기록 → 결정론 유지(플랜 리스크표).
2. **웨이브→보스 전환 훅**: 6구간(`SEGMENTS[5].boss=true`) 진입 시 `world.wave.boss=true`로 세워지고 일반 스폰 정지. 여기서 보스 엔티티 스폰(태스크 15). 보스는 새 `EntityKind`가 아니라 `enemy` + 신규 typeIndex 또는 전용 kind로 추가 가능 — **kind 추가 시 반드시 `KIND_CODE`(entities.ts)·`hashEntity`(replay.ts)·`snapshotWorld`(snapshot.ts)·`EntityRenderer.textureFor`(entityRenderer.ts) 동기 갱신**(핸드오프 규율).
3. **젬/콤보 훅**: 적 사망 시 `compact()`가 `spawnGem` 호출(현재 값 없음). 자석 수거·콤보 배율은 여기 + 플레이어-젬 충돌부(`resolveCollisions` gem 분기, 현재 `state.gems++`만)에 추가.
4. **정산 화면 데이터**: `world.kills`·`world.gems`·`world.tick`·seed 이미 집계 중. HUD는 `src/ui/hud.ts` + `main.ts`.

## 주의점 (Phase 1 규율 + 신규)
- stepWorld 틱 순서는 **해시에 영향** — 순서 변경 시 결정론 테스트 갈림. 현재: player→waves→enemies→autoAttack→projectiles→hazards→collisions→compact.
- 새 RNG 스트림은 `world.rng.fork(name)`로 WorldState에 영속 저장(매 틱 fork 금지). 현재 `waveRng`만. 패턴은 무-RNG 결정론(위치·타이밍이 상태의 순함수).
- `Entity.dead`는 틱 내 임시 플래그 — compact 전 소거되어 **해시에 미포함**. 나머지 신규 필드(maxHp·enemyType·cooldown·phase·life·damage·pierce·targetX/Y·ownerId)는 hashEntity에 포함됨. 필드 추가 시 hashEntity 갱신.
- `enemyBulletCount`는 틱당 재계산 스냅샷(cap 체크용). `bulletCap`은 `updateWaves`가 세팅.
- `data/`는 `src/sim/`가 import(순수 데이터라 lint 시뮬 제약 무해). tsconfig include에 포함.
- DEV 훅 `window.__pb.injectInput`은 이제 렌더도 수행(프레임 구동 시 화면 반영). `entityRenderer` 노출.

## 남긴 TODO / 미완 (Phase 2 범위 밖 — 의도적)
- 보스 전투(태스크 15) = Phase 3. 6구간은 현재 스폰만 멈추고 대기(무한). `world.wave.done`은 마지막 구간 타이머로 세워지나 종료 화면 없음.
- 플레이어 HP 0 시 게임오버 처리 없음(HP만 0 클램프). 정산/사망 = Phase 3(태스크 16).
- 젬은 수거 시 `world.gems++`만(경험치·레벨업 없음) = Phase 3(태스크 12~13).
- 렌더는 전 엔티티 Sprite 기반(탄 포함). 2,000발 60fps 목표는 벤치 씬(Phase 4) 담당 — 필요 시 게임플레이 탄을 ParticleContainer로 이관.
- 밸런스 수치: **구간 예산표(적 12→44, 탄 300→2,000)는 스펙 §수치 초안 출처**. 개별 적 HP·접촉 데미지·발사 쿨다운, 발칸 스탯은 **M1 프로토타입 임의 튜닝**(스펙 미명시) — 재미 게이트(태스크 20)에서 조정 예정.
