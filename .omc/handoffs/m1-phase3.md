# Handoff: M1 Phase 3 → Phase 4

- **완료(태스크 12~17)**: 경험치 젬(적별 가치)+자석 수거+젬 콤보(x1.5 cap) / 레벨업 3택 파워업 8종(결정론 입력로그 기록) / 보급선 습격(20초 창·격추 보상) / 보스 카르곤 용암요새전차(3페이즈+과열창+탄소거) / 격추 유머 연출+정산 화면+게임오버 / 구조화 HUD(HP·XP·타이머·콤보·보스바).
- **검증**: `npm run test` 49 passed(기존 36 + 신규 13) / `npm run lint` 0 / `npm run build` 성공. 브라우저(5180) 실플레이(DEV 훅 `window.__pb` 프레임 주입): 전투→킬11/젬/콤보5/레벨업(3택 [3,2,1])→파워업 픽(관통 0→1, pending 해제)→보급선 스폰(hp420)→보스 스폰(hp2200)→패턴 시전(적탄26, 과열 iframes267)→페이즈 전환(0→1, timer120, 적탄 26→0 소거)→게임오버→정산(격추 🪂). 스크린샷은 프리뷰 환경 WebGL readback 타임아웃으로 미획득 — scene graph + DOM 쿼리로 전 흐름 확증.
- **커밋**: 37c7943(sim 코어), df8954d(렌더/UI)

## 신규/변경 파일
- `src/sim/powerups.ts` (신규): `POWERUPS`(8종, id/name/desc/apply), `drawPowerupChoices(state,3)`(powerupRng 비복원 추첨), `applyPowerup(state,idx)`. apply는 순수 상태 변이(RNG·시간 미사용 — sim lint 통과).
- `src/sim/boss.ts` (신규): `updateBoss(state,boss,player)`, `BOSS_PHASE_TRANSITION_TICKS=120`, `BOSS_OVERHEAT_TICKS=300`. 보스 상태를 엔티티 제네릭 필드에 매핑(phase=페이즈, timer=전환연출, cooldown=다음패턴, iframes=과열창, pierce=패턴 순환 인덱스, targetX=나선 각도 오프셋).
- `data/boss.ts` (신규): `LAVA_FORTRESS`(BossDef) — 3페이즈 각 attacks(ring/spiral/lavaLine) 데이터.
- `src/sim/world.ts` (대폭 개편): WorldState에 xp·xpTotal·level·combo·comboTimer·maxCombo·magnetRadius·resources·pendingLevelUp·powerupChoices·powerupRng·supplyRng·supplyNextIndex·bossSpawned·gameOver·victory 추가. stepWorld 순서 재편(아래). `packPowerupPick`·`xpToNext`·`comboMultiplier` export.
- `src/sim/entities.ts`: EntityKind에 `supply`·`boss` 추가(KIND_CODE 7·8). `spawnGem(sink,x,y,xpValue)`(xp를 `damage` 필드에 저장), `spawnSupply`, `spawnBoss` 팩토리.
- `src/sim/patterns/types.ts`·`data/enemies.ts`: EnemyDef에 `xpValue` 추가(charger3·gunner4·special8·support5).
- `src/sim/replay.ts`(hashWorld)·`src/sim/snapshot.ts`(EntitySnapshot에 `flash` + boss active=과열) 동기 갱신.
- `src/render/textures.ts`(boss·supply 텍스처)·`src/render/entityRenderer.ts`(boss/supply textureFor + 과열/전환 tint) 갱신.
- `src/input/controller.ts`: `queuePowerupPick(idx)` + sample에서 `special` 패킹.
- `src/ui/hud.ts`(구조화 HUD, `set`은 디버그용 유지)·`src/ui/powerupOverlay.ts`(신규)·`src/ui/resultOverlay.ts`(신규)·`src/main.ts`(통합).
- `tests/progression.test.ts`(신규 13종)·`tests/combat.test.ts`(자석 수거 반영 1줄).

## stepWorld 틱 순서 (해시 영향 — 변경 시 결정론 테스트 갈림)
`gameOver/victory 가드 → pendingLevelUp 가드(픽 입력만 처리) → player → waves → enemies → boss → autoAttack → projectiles → gems(자석) → supply → hazards → collisions → compact → combo감쇠 → checkLevelUp → checkGameOver`

## Phase 4 훅 지점 (에셋 교체 — 태스크 18)
`src/render/textures.ts`의 `createPlaceholderTextures(renderer)` 반환 `PlaceholderTextures`가 유일한 스프라이트 소스. 현재 전부 PixiJS Graphics 도형. 실제 PNG/스프라이트시트로 교체할 슬롯:
| 슬롯 | 현재 도형 | 실 에셋 스펙(GDD/플랜) |
|---|---|---|
| `player` | 시안 삼각형 r18 | 기체 48px, 탑다운 회전 |
| `enemy[0]` charger | 붉은 삼각 r18 | 카르곤 파쇄차 32px |
| `enemy[1]` gunner | 주황 사각 r16 | 박격포 32px |
| `enemy[2]` special | 진홍 다이아 r22 | 용암샘 32px |
| `enemy[3]` support | 청록 육각 r15 | 수리드론 32px |
| `boss` | 육각 128px(용암 tint) | 보스 128px |
| `supply` | 청록 화물 92×52 | 보급선 |
| `bullet`/`enemyBullet` | 화이트코어+시안/적 아웃라인 r5 | 탄막 시트(가독성 규칙 유지) |
| `gem` | 초록 다이아 r8 | 젬 시트 |
- 교체 시 `entityRenderer.textureFor`의 kind→텍스처 매핑은 그대로. 보스 tint/scale 연출(과열=붉은 펄스, 전환=화이트 플래시)은 스프라이트 위에 곱연산 tint라 실 에셋에도 유효.
- `snapshot.ts`의 `active`(boss=과열)·`flash`(boss=전환)가 렌더 연출 트리거. `beams`(수리드론 회복빔)는 overlay Graphics.
- 배경 타일(카르곤 화산)은 미구현 — `gameApp.stage`에 배경 레이어 추가 지점(entityRenderer.layer 아래).

## Phase 4 벤치·튜닝 지점 (태스크 19·20)
- **벤치**(`src/bench/bench.ts`, `?bench=1`): 탄 2,000발 ParticleContainer 뼈대 존재. 게임플레이 탄은 아직 개별 Sprite(entityRenderer). 2,000발 60fps 미달 시 게임플레이 탄을 ParticleContainer로 이관 필요(현재 Sprite Map 방식).
- **밸런스 수치 출처**:
  - **스펙 준수**: 젬 콤보 x1.5 cap, 보급선 20초 창, 보스 3페이즈(70%/35%)·과열 5초 피해2배·전환 탄소거. 구간 예산표(Phase 2).
  - **M1 임의 튜닝(스펙 미명시)**: 콤보 계단(COMBO_STEP=0.05, 10스택=x1.5, 윈도우 120틱), 자석 반경 210·속도 760, xpToNext=10+level*6, 적별 xpValue, 보스 HP 2200·패턴 쿨다운·탄수, 보급선 HP420·스폰 tick[1800,6000]·보상 젬14. → 재미 게이트(태스크 20)에서 조정 대상.
- **파워업 8종 값**(world 필드/config/weapon 변이): 연사-18%·탄수+1·데미지+35%·관통+1·이속+12%·대시쿨-20%·최대HP+25·자석+40% — 전부 M1 임의 튜닝.

## 주의점 (규율)
- **kind 추가 규율**: supply·boss 추가 시 KIND_CODE·hashEntity(kind코드)·snapshotWorld·textureFor·collision·autoAttack(nearestTarget) 전부 갱신 완료. 추가 kind는 동일 6곳 동기.
- **파워업 결정론**: 후보는 `powerupRng.fork('powerups')`, 선택은 `InputFrame.special`에 `packPowerupPick(idx)`(SPECIAL_POWERUP_PICK | idx<<1)로 패킹 → 입력로그 기록 → 리플레이 재현. pendingLevelUp 중 stepWorld는 월드 동결(tick만 증가), 픽 프레임 도착 틱에 적용. **렌더는 정지 중에도 유지**(main ticker가 snapshot·render 계속, 오버레이 표시).
- **보스 필드 재활용**: 새 Entity 필드 추가 대신 기존 필드 재활용(iframes=과열, pierce=패턴인덱스, targetX=나선각). hashEntity에 이미 포함되어 결정론 안전.
- **DEV 훅 확장**: `window.__pb`에 `world`·`hud`·`powerupOverlay`·`resultOverlay` 노출(DEV 가드). 프레임 주입·상태 조작 검증용. 프로덕션 빌드 제외.
- **재시작**: 정산 재시작 버튼 = `window.location.reload()`(같은 seed 재현). 시드 랜덤 새 런은 Phase 4/메타 단계.

## 남긴 TODO / 미완 (Phase 3 범위 밖 — 의도적)
- 실 에셋(태스크 18)·성능 벤치 실측(태스크 19)·재미 게이트 5인 테스트(태스크 20)·PR 머지(태스크 21) = Phase 4.
- 게임플레이 탄 렌더는 여전히 개별 Sprite(Map 추적). 2,000발 실부하 시 ParticleContainer 이관 필요.
- 보급선 보상 `resources`는 M1 플레이스홀더(장비 드랍은 M2). 젬 다량(14개)+자원1.
- 파워업 중복 획득 스택 무한(예: 관통 계속). M1 프로토타입 의도 — 밸런스는 게이트에서.
- 카르곤 화산 배경 타일 미구현(단색 배경 0x0a0c14).
