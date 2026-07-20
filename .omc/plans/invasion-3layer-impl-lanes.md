# 침공 3레이어 — 구현 레인 분해 (정찰 산출)

- 생성: 2026-07-20 정찰 워크플로(opus/high 5에이전트)
- 근거: .omc/plans/invasion-3layer-redesign.md, ADR-0017~0019, CONTEXT.md

## 요약

4개 축 정찰과 기획서를 근거로 M7a(침공 코어)를 12개 레인으로 세분화하고 M7b/M7c/M8을 굵은 레인으로 묶었다.

핵심 설계 판단 3가지:
① **신규 네임스페이스 우선, 레거시는 마지막에 일괄 삭제.** `src/sim/invasion/**` 와 `data/invasion/**` 를 새로 파고, 기존 `src/sim/defense.ts`(포탑 6종·DefenseLayout)·`src/ui/defenseCommand.ts`(15×9 격자·예산 20)는 **손대지 않은 채 병존**시킨다. 그래야 웨이브 0~2 동안 빌드가 살아 있고, 마지막 삭제 레인(L11) 하나만 레거시 파일을 소유한다. 레인 간 파일 겹침이 이 구조로 자연 해소된다.
② **해시 포맷 v2 로 1회 bump.** 정찰이 지적한 대로 `hashWorld` 침공 블록은 이미 4단 조건부 중첩(replay.ts:223-326)이고 3레이어 config+페이즈 상태를 얹으면 5단이 된다. 미출시 전제를 살려 **침공 블록만 통째로 v2 로 교체**하고 fixture 전량 재생성한다(PvE 블록은 바이트 미변 → `tests/determinism.test.ts`·`invasion.test.ts:295` 회귀 가드 유지). 이 판단을 웨이브 1에서 확정·실행한다.
③ **정규화 함수 단일화.** 현재 `src/ui/defenseCommand.ts:387 normalizeLayout` ↔ `verifyInvasionCore.ts:243 normalizeServerLayout` 이 "자구 일치" 구두 계약이라 한쪽만 고치면 전 침공이 `defense-mismatch` 로 오거부된다. M7a 에서 `src/sim/invasion/normalize.ts` 하나로 승격해 클라·EF 가 같은 모듈을 import 하게 만든다(EF 는 sloppy-imports 로 이미 `src/sim/**` 를 직접 읽는다).

웨이브 구조: W0(스키마 1레인) → W1(sim 코어 5레인 병렬) → W2(서버·DB·하네스·카탈로그 4레인 병렬) → W3(렌더·레거시 삭제 2레인). M7a 총 12레인.

## 채택 결정값 (기획서 §10 미결 해소)

- 웨이브 슬롯 = 6 (기획 제안값 채택). 빈 슬롯은 기본 수비대 자동 충원.
- L2 설치 소켓 = 맵 템플릿별 상이: 직선형 12 / 굴곡형 10 / 병목형 8. 기획의 '10개 내외'를 템플릿 성격(소켓 많음/보통/적음)에 맞춰 구체화.
- L3 기물 소켓 = 6, 수호 기체 슬롯 = 2(MAX_GUARDIAN_SLOTS 현행 유지 — SQL inject_guardian_authority 의 limit 2 를 안 건드려도 되므로 3자 매핑 리스크가 줄어든다), 보스 슬롯 = 1.
- 코어 모듈 슬롯 = 2 (미결 #2, 범위 1~3 중 채택). 1은 선택 재미가 없고 3은 M7a 밸런스 검증 부담이 크다. 스키마는 배열이라 확장은 상수 변경 1줄.
- 시간 예산: L1 5400틱(90초) / L2 5400틱(90초) / L3 7200틱(120초) / 총 18000틱(300초). 레이어별 예산은 soft(소진 시 강제 전이 — 진행이 막히지 않게), 총 18000 만 hard(gameOver).
- src/sim/defense.ts:254 DEFAULT_TIME_LIMIT_TICKS(10800) 을 수정하지 않고 src/sim/invasion/constants.ts 에 INVASION_TOTAL_TICKS=18000 을 신설한다. 구 상수는 L11 에서 파일과 함께 삭제 — 웨이브 0~2 동안 구 침공 경로가 살아 있어야 빌드가 그린이다.
- 레이어 클리어 회복 보너스(미결 #3) = 최대 HP 20% 회복 + 폭탄 +1(보유 상한 내). L1→L2, L2→L3 두 번. 정수 연산(Math.round(maxHp*20/100)).
- 전멸 가속(미결 #7) = 정수 centi-percent. 기본 100cp, 구간 전멸 상태에서 매 틱 +2cp, 비전멸 시 -4cp, clamp[100, 200](최대 ×2). f64 누적 금지 — scaleFireCooldown(defense.ts:369-386)의 정수 centi-percent 선례를 따른다. 파괴 불가 해저드(life<0)는 전멸 판정에서 제외.
- 코어 HP = 8000 (구 CORE_HP 3000 대비 상향). 3분 단일 아레나의 최종 목표에서 5분 원정의 마지막 관문으로 성격이 바뀌었고, L3 에 보스 1 + 수호 2 + 기물 6 이 함께 붙는다.
- 기본 수비대(결정 #22) 구체값: 빈 웨이브 슬롯→정찰 드론편대 lv1 노말 / 빈 소켓→속사포 lv1 노말 / 빈 기물 소켓→비움 / 빈 보스 슬롯→강철 골리앗 lv1 노말. 충원은 정규화가 아니라 **스폰 단계 주입** — layers 직렬화·해시를 오염시키지 않아 '빈 슬롯'과 '기본 수비대 명시 배치'가 같은 해시가 되는 혼동을 막는다.
- 해시 전략: 조건부 접기 5단으로 늘리지 않고 **INVASION_HASH_VERSION=2 로 침공 블록 전면 교체 + fixture 전량 재생성**(미출시 전제 활용). PvE 블록(replay.ts:156~222)은 한 바이트도 수정하지 않아 tests/determinism.test.ts·invasion.test.ts:295 의 PvE 불변 회귀 가드가 그대로 산다. 이 판단은 L1 레인이 W1 에서 실행.
- Entity 확장 예산: 신규 kind 8종 append + 범용 정수 슬롯 aux0/aux1 2개 추가로 hashEntity 레이아웃을 M7a 에서 1회만 확정. M7b/M7c 는 필드 추가 없이 aux 재활용 — 필드 포화(22필드, kind별 재활용 빽빽)를 반복적 해시 계약 변경으로 만들지 않는다.
- 정규화 단일화: normalizeLayout(defenseCommand.ts:387)·normalizeServerLayout(verifyInvasionCore.ts:243)의 '자구 일치' 구두 계약을 폐기하고 src/sim/invasion/normalize.ts 공유 모듈로 승격. EF 는 sloppy-imports 로 이미 src/sim/** 를 직접 읽으므로 추가 인프라 불요.
- 배치 예산제 폐지 시점: defense_layout_cost SQL 함수와 예산 상한 20 게이트(20260717010000:113 raise)는 **L7 의 신규 마이그레이션에서 폐기**하고 슬롯 수·유효성 검증으로 대체. 클라 미러 defenseSync.ts:47 defenseLayoutCost 는 같은 레인이 동반 삭제.
- EF 재실행 예산: SOFT_RERUN_BUDGET_MS 8000 → 20000 상향 + simBench 로 18000틱 3레이어 실측 게이트 테스트 추가. 20초를 못 지키면 L3 엔티티 상한(기물 6·수호 2·보스 1)이나 컬링 반경을 먼저 조인다.
- 방어 성공 보조 보상(미결 #5) = 코어 모듈 드랍 폐지, 크레딧 정액만. data/defenseCards.ts:282 defenseSuccessDropChance / :299 DEFENSE_DROP_BASE_CHANCE 는 M7b-core-modules 레인에서 제거. 기획 §4 '방어체 획득 경로에서 제외(부익부 방지)' 와 정합.
- 콘텐츠명 i18n 규약 확정: `def3.<id>.name` / `def3.<id>.desc` 를 src/i18n/catalog.ts EN 정본에 등재, KO 는 Record 타입 강제. 검증은 하드코딩 목록이 아니라 **카탈로그 배열에서 파생**(data/stickers.ts + tests/i18n.test.ts:28-36 선례). M7a 임시 카탈로그(11종) 때 규약을 세워야 M7c 풀 카탈로그(26종+)에서 한글 하드코딩이 쌓이지 않는다.
- data/** 를 eslint simCoreRestrictions 대상에 편입(L0 레인). 현재 files:['src/sim/**'] 만 적용되는데 sim 이 data/guardian.ts·lineage.ts·defenseCards.ts 를 런타임 import 하므로 Math.random/Date.now 가 들어가도 안 잡힌다. 3레이어 데이터가 대량 유입되기 전에 막는다.
- M7a 범위 제외 항목 2개(M7c 이월): ①압축 프레스(이동 벽) — 터널링 방지 전제 '벽 최소 폭 120u > 최대 대시 스텝 59u' 를 깨서 끼임·터널링 처리 신설이 필요, ②L2 경로 분기(상하 갈림길, 기획 §10-8 확장 예약).
- 침공 쿨다운·복수전·래더 스왑(미결 #4) = 기존 규칙 그대로 유지. 5분 런은 3분 대비 1.67배라 1시간 쿨다운·격차 30 스왑 규칙의 성격을 바꾸지 않는다. apply_invasion_result(20260718160000:305)의 해당 블록은 무수정.

## 웨이브 순서

**웨이브 0 (단독, 선행 필수)** — L0-schema
스키마·상수·공유 정규화가 나머지 11레인 전부의 입력이다. 작지만(타입+상수+normalize) 반드시 혼자 먼저 끝내야 한다. 특히 L0 이 선언하는 **스텝 훅 시그니처**(StepFormationFn/StepFacilityFn/StepCoreRoomFn)가 있어야 L2 가 world.ts 배선을 쓰면서 L3/L4/L5 의 구현을 기다리지 않는다.

**웨이브 1 (5레인 병렬)** — L1-determinism / L2-scroll-phase / L3-formation / L4-facility / L5-core-room
파일 겹침 0. 핵심 배선 규약 2개:
- **world.ts 는 L2 단독 소유.** L4 가 만든 wallIndex.ts 를 호출하는 것도, L3/L4/L5 의 스텝 함수를 stepWorld 에 꽂는 것도 전부 L2 가 한다. 다른 레인은 world.ts 를 절대 열지 않는다.
- **src/sim/defense.ts 는 W1 에서 아무도 수정하지 않는다.** L5 는 guardianBridge.ts 로 import 만 한다. 이 파일의 유일한 소유자는 마지막 L11 이다.
- L1(해시)은 L2~L5 가 만드는 kind·필드를 먼저 예약해 두는 방식(kind 8종 + aux0/aux1)이라 W1 안에서 병렬이 성립한다. W1 종료 시점에 L1 이 fixture 를 최종 재생성한다.

**웨이브 2 (4레인 병렬)** — L6-verify-ef / L7-db-net / L8-harness-run / L9-garrison-catalog
L6 은 L1(해시 v2)·L0(normalize) 확정 후. L8 은 L2(페이즈 머신) 확정 후. L7·L9 는 L0 만 있으면 된다.
L7 의 DB 작업은 **브랜치 DB(create_branch)에서 먼저** — 로컬 Supabase 스택이 없어 원격 직접 적용은 이 규모에 위험.

**웨이브 3 (2레인, 순차)** — L10-render → L11-legacy-purge
L10 은 L1(신규 kind)·L2(스크롤) 확정 후. **L11 은 반드시 맨 마지막 단독**이다 — 여기서 처음으로 레거시가 사라지므로, 그 전까지는 신·구가 병존해 빌드가 항상 그린이다. L11 이 끝나야 M7a 완료 판정(침공 1회 e2e).

**M7b 이후**: M7b-inventory 와 M7b-core-modules 는 병렬 가능, M7b-command-ui 는 inventory 뒤, M7b-acquisition 은 inventory 뒤. M7c 는 M7b 전체 뒤, M8 은 M7c 뒤(아트 파이프라인만 M7c 와 병행 착수 가능).

## 레인

### L0-schema — 3레이어 배치 스키마 정본 + 공유 정규화 + 상수

- 마일스톤: M7a
- 선행: 없음
- 소유 파일:
  - `src/sim/invasion/types.ts`
  - `src/sim/invasion/constants.ts`
  - `src/sim/invasion/normalize.ts`
  - `src/sim/invasion/index.ts`
  - `eslint.config.js`
  - `tests/invasionSchema.test.ts`

**산출물**

InvasionLayers 스키마 확정: l1={waveSlots:(FormationRef|null)[6]}, l2={templateId, sockets:(FacilityRef|null)[]}, l3={boss:BossRef|null, guardians:GuardianPlacement[2], props:(PropRef|null)[6], core:{hp,x,y}, modules:(ModuleRef|null)[2]}. 각 Ref = {catalogId:number, level:number, ascension:number, affixSeed:number, rarity:number}(정수만, f64 없음). 시간·가속 상수(L1 5400 / L2 5400 / L3 7200 / TOTAL 18000틱, 가속 100~200cp) 정의. 클라·EF 공유 normalizeInvasionLayers()/layersEqual() 를 여기 하나로 승격 — defenseCommand.ts:387 ↔ verifyInvasionCore.ts:243 의 '자구 일치' 구두 계약을 코드 단일화로 해소. W1 레인들이 구현할 스텝 훅 시그니처(StepFormationFn/StepFacilityFn/StepCoreRoomFn)를 인터페이스로 선언해 world.ts 소유 레인이 import 만으로 배선하게 한다. eslint.config.js 의 simCoreRestrictions 적용 대상에 data/** 추가(정찰 지적: sim 이 data/guardian.ts 등을 런타임 import 하는데 lint 규율 밖).

**검증**

tests/invasionSchema.test.ts — ①normalize 멱등성(normalize(normalize(x))===normalize(x)) ②슬롯 상한 초과 절단(waveSlots 7개→6, props 8개→6, modules 3개→2) ③미지정 필드 기본값 주입(null 슬롯 유지, level 미지정→1) ④layersEqual 이 모든 하위 필드를 실제로 대조하는지 필드 전수 mutation 테이블 테스트(누락=위조 프리패스이므로 필드마다 1케이스 강제) ⑤정수 전용 불변식(모든 Ref 필드가 Number.isInteger) ⑥eslint 설정에 data/** 가 포함됐는지 config 단위 검증

### L1-determinism — Entity 필드 예산 확정 + 침공 해시 블록 v2 + fixture 전량 재생성

- 마일스톤: M7a
- 선행: L0-schema
- 소유 파일:
  - `src/sim/entities.ts`
  - `src/sim/replay.ts`
  - `scripts/deno-verify/fixtures.json`
  - `scripts/deno-verify/main.ts`
  - `tests/determinism.test.ts`
  - `tests/denoFixture.test.ts`
  - `tests/invasionHash.test.ts`

**산출물**

정찰이 지적한 두 부채(Entity 22필드 포화 / hashWorld 4단 중첩)를 M7a 착수 시점에 한 번에 청산한다. ①EntityKind·KIND_CODE 에 3레이어 신규 kind append: formationMember, facilityTurret, facilityHazard, facilitySpawner, defenseBoss, l3Prop, decoyCore2(기만 홀로그램), coreModuleFx. ②Entity 에 범용 확장 슬롯 aux0/aux1(정수) 2개를 append 하고 hashEntity 레이아웃을 여기서 1회 확정 — 이후 M7b/M7c 는 필드 추가 없이 aux 재활용. ③hashWorld 의 침공 블록(replay.ts:223-326)을 통째로 v2 로 교체: 첫 폴드에 INVASION_HASH_VERSION=2, 이어서 layers 를 조건부 접기 없이 평탄 직렬화(웨이브 슬롯 6 → 소켓 N → l3 → modules), 그 뒤 런타임 페이즈 상태(phase, phaseEnterTick, scrollX/Y, accelCp)를 접는다. **PvE 블록(:156~222)은 한 바이트도 건드리지 않는다.** ④fixtures.json 전량 재생성 + Deno 교차검증 재수행.

**검증**

tests/determinism.test.ts — PvE 해시 스트림이 v2 이후에도 기존 기대값과 바이트 동일(회귀 가드 유지). tests/invasionHash.test.ts(신규) — ①같은 layers·seed 로 두 번 재실행 시 해시 스트림 100% 일치 ②layers 의 임의 1필드 변조 시 첫 틱부터 해시 발산(필드 전수 파라미터화) ③페이즈 전이 틱이 해시에 반영되는지(전이 틱만 다른 두 런이 갈리는지) ④KIND_CODE append-only 스냅샷(기존 코드값 재배치 금지 가드) ⑤hashEntity 필드 순서 골든 테스트. tests/denoFixture.test.ts — 재생성 fixtures 로 Node↔Deno 비트 일치

### L2-scroll-phase — 강제 스크롤 sim 권위 카메라 + L1→L2→L3 페이즈 머신 + 전멸 가속 + 이중 타임아웃

- 마일스톤: M7a
- 선행: L0-schema
- 소유 파일:
  - `src/sim/world.ts`
  - `src/sim/invasion/step.ts`
  - `src/sim/invasion/phase.ts`
  - `src/sim/invasion/scroll.ts`
  - `src/sim/snapshot.ts`
  - `tests/invasionPhase.test.ts`
  - `tests/invasionScroll.test.ts`

**산출물**

정찰이 '가장 위험'으로 꼽은 3지점을 모두 이 레인이 처리한다. ①sim 권위 카메라 승격: WorldState 에 scrollX/scrollY/scrollAxis 추가, snapshot.ts:74-80 의 cameraX=player.x 파생을 침공에서만 스크롤 창 기준으로 분기(PvE 는 무변경). ②페이즈 머신: phase 0=L1(종스크롤,+Y→-Y) 1=L2(횡스크롤,+X) 2=L3(고정). 전이는 스크롤 오프셋이 레이어 길이에 도달하거나 레이어 예산 소진 시. 전이 틱에 잔여 적·투사체 처리 규칙을 명시(적=제거, 플레이어 투사체=유지, 자원=승계, 최대 HP 20% 회복 + 폭탄 +1). ③**compact() 의 무조건 core→victory(world.ts:2156-2159)를 phase===2 한정으로 조건화** — L1/L2 클리어가 victory 로 새면 stepWorld 첫 줄 가드(:664)에 걸려 런이 그 자리에서 죽는다. ④checkInvasionTimeout(:734) 을 레이어별 soft(스크롤 강제 전이) + 총 18000틱 hard(gameOver) 이중 구조로. ⑤전멸 가속: 구간 전멸 판정을 countKind 라이브 스캔 + 정수 cp 로, 전멸 시 매 틱 +2cp / 비전멸 시 -4cp, clamp[100,200]. ⑥stepPlayer 의 'no arena clamp'(:960-969) 를 침공에서만 스크롤 창 클램프로 분기. ⑦stepProjectiles(:1603) 컬링 기준을 침공에서 스크롤 창 기준으로 분기 + L4 가 제공하는 wallIndex 를 여기서 호출해 탄-벽 broad-phase 도입(world.ts:1631-1634 의 '활성 벽 ≤19 전제' 경고 해소). ⑧stepWorld 침공 게이트에 stepInvasion() 단일 디스패치 배선(L3/L4/L5 모듈을 L0 이 선언한 시그니처로 import).

**검증**

tests/invasionPhase.test.ts — ①L1 코어 없음 상태에서 웨이브 전멸 후 전이가 victory 를 세우지 않음 ②L2 클리어도 동일 ③L3 코어 파괴만 victory ④전이 틱 결정성(같은 입력→같은 전이 틱 2회) ⑤자원 승계(전이 전후 hp/bomb) ⑥총 18000틱 도달 시 gameOver, 17999 는 아님 ⑦레이어 예산 소진 시 강제 전이. tests/invasionScroll.test.ts — ①스크롤 오프셋이 틱 순수 함수 ②가속 cp clamp[100,200] ③스크롤 창 클램프로 플레이어가 창 밖 이탈 불가 ④컬링 분기가 PvE 경로를 안 건드림. tests/determinism.test.ts 는 L1 소유이므로 이 레인은 PvE 해시 회귀를 로컬 스모크로만 확인 후 L1 에 보고

### L3-formation — L1 편대 스폰 — RNG 미소비 절대좌표 진형

- 마일스톤: M7a
- 선행: L0-schema
- 소유 파일:
  - `src/sim/invasion/formation.ts`
  - `data/invasion/formations.ts`
  - `tests/invasionFormation.test.ts`

**산출물**

정찰 최대 함정 대응: 기존 formationPositions(waves.ts:264-336)은 (a)플레이어 상대 오프스크린 배치 (b)state.waveRng 소비 라서 강제 스크롤·전멸 가속과 정면 충돌한다. **재사용하지 않고 신규 어휘를 만든다.** FormationDef{id, members:{enemyTypeIndex, dx, dy, delayTicks}[], entryPattern} — 진형이 오프셋 배열로 데이터에 내장되고 스폰 좌표는 scrollY 절대 기준. 적 스폰은 반드시 waves.ts:246 summonEnemy(RNG 미소비) 경유, spawnEnemy(:232, waveRng.int 소비) 금지. 임시 카탈로그 3종: 정찰 드론편대(V자 직진) / 요격 편대(좌우 협공) / 강습 돌격편대(플레이어 위치 가속 돌진). 구성원은 data/enemies.ts 의 기존 22종을 참조만 하고 append 하지 않는다(ENEMY_BY_TYPE 인덱스가 해시 계약이고 tests/m3Content.test.ts:138 이 연속성 강제 — M7c 에서 22부터 append).

**검증**

tests/invasionFormation.test.ts — ①스폰 전후 state.waveRng 내부 커서 불변(RNG 미소비 계약, rng 상태 직접 비교) ②스폰 좌표가 플레이어 위치와 무관(플레이어를 옮겨도 동일 좌표) ③진형별 오프셋 골든 스냅샷 ④slot=null 일 때 스폰 0 ⑤동일 seed 2회 재실행 시 스폰 순서·좌표 바이트 동일

### L4-facility — L2 설비 — 방향 제한 방어포 · 주기 온오프 해저드 · 드론 스포너 · 벽 인덱스

- 마일스톤: M7a
- 선행: L0-schema
- 소유 파일:
  - `src/sim/invasion/facility.ts`
  - `src/sim/invasion/hazardCycle.ts`
  - `src/sim/invasion/wallIndex.ts`
  - `data/invasion/facilities.ts`
  - `data/invasion/mapTemplates.ts`
  - `tests/invasionFacility.test.ts`

**산출물**

정찰이 '신규 코드 필요'로 분류한 sim 빈틈 4개를 채운다. ①**방향 제한 사격**: 기존 fireTurret(defense.ts:658)은 항상 atan2(player-t) 전방위이고 TurretSpec 에 facing/arc 필드가 없다. FacilitySpec 에 facingDeg/arcDeg 신설 — 벽부착 설비가 벽 반대편으로만 사격. ②**주기 온오프 해저드**: 현행 해저드는 windup 1회→active 1회→소멸 또는 영구(life<0)뿐이라 레이저 격자의 반복 토글이 표현 불가 → 신규 상태머신(periodTicks/onTicks/phaseOffset, 정수만). ③드론 스포너: summonEnemy 경유, 카운터는 Entity.aux0(L1 이 도입) 사용. ④**wallIndex.ts**: SpatialHash(collision.ts, 무수정 재활용) 기반 활성 벽 broad-phase 를 제공 — 호출은 world.ts 소유 레인(L2)이 한다. 압축 프레스(이동 벽)는 터널링 전제('벽 최소 폭 120u > 최대 대시 스텝 59u')를 깨므로 **M7a 범위에서 제외**, M7c 로 이월(정찰 위험 #7). 임시 카탈로그 4종: 속사포 / 관통 레일포(예고선) / 곡사 박격포 / 레이저 격자(주기 해저드). 맵 템플릿 3종 소켓 좌표: 직선형 12 / 굴곡형 10 / 병목형 8.

**검증**

tests/invasionFacility.test.ts — ①arcDeg 밖 각도의 플레이어에게 미사격, 안쪽에서만 사격 ②해저드 주기 토글이 틱 순수 함수(period=120,on=40 에서 on/off 경계 틱 골든) ③스포너 RNG 미소비 ④wallIndex 가 활성 벽 80개에서도 직접 스윕과 동일 결과(정확도) + 판정 횟수 감소(성능) ⑤예고선(windup) 동안 무피해, active 에서만 피해 ⑥맵 템플릿 소켓 좌표가 상·하 벽 안쪽에 있는지 기하 검증

### L5-core-room — L3 코어방 — 방어 보스 · 기물 · 코어 · 수호 슬롯 2 재배선

- 마일스톤: M7a
- 선행: L0-schema
- 소유 파일:
  - `src/sim/invasion/coreRoom.ts`
  - `src/sim/invasion/guardianBridge.ts`
  - `data/invasion/defenseBosses.ts`
  - `data/invasion/props.ts`
  - `tests/invasionCoreRoom.test.ts`

**산출물**

①방어 보스 1종(강철 골리앗) — data/boss.ts 의 BossAttack 판별 유니온 8종 + BossPhaseDef 3페이즈 라운드로빈 문법을 **복제**해 data/invasion/defenseBosses.ts 에 별도 레지스트리로 둔다(기존 data/boss.ts 는 PvE 정본이라 미수정). updateBoss(src/sim/boss.ts) 골격도 읽기 전용 재사용. ②기물 3종: 실드 발생기(코어 보호막 — 먼저 파괴 강제) / 중력 앵커(HAZARD_SLOW 재사용) / 고정 주포. ③코어: L3 전용 HP 8000(구 CORE_HP 3000 대비 상향 — 5분 원정의 최종 관문), 모듈 슬롯 2. ④**guardianBridge.ts**: src/sim/defense.ts 의 spawnGuardian(:497)/stepGuardians(:525)/normalizeMaintenance(:361)/scaleFireCooldown(:382) 을 **import 만 하고 수정하지 않는다**(defense.ts 는 L11 레거시 삭제 레인 단독 소유). 수호 슬롯 2 매핑을 l3.guardians[i] ↔ 활성 수호 i 로 재배선. ⑤정비도 풍화는 배치된 방어체에만 적용(결정 #18) — scaleFireCooldown 을 편대·설비·기물에 확대 적용, 수호만 회복 불가(바닥 50%).

**검증**

tests/invasionCoreRoom.test.ts — ①보스 3페이즈 전이(체력 임계 기반, 결정성) ②실드 발생기 생존 중 코어 무적, 파괴 후 피해 통과 ③중력 앵커 감속이 playerSlowTicks 로 반영 ④코어 HP 0 → victory(단 phase===2 일 때만 — L2 소유 로직과의 통합은 L2 테스트가 커버) ⑤수호 슬롯 i↔배열 i 매핑 골든(정찰 위험: SQL/EF/클라 3자 비트 동일 필요) ⑥정비도 0% 에서 설비 발사 간격이 정확히 2배(정수 centi-percent 산술, f64 누적 없음)

### L6-verify-ef — verify-invasion 3레이어 확장 + 300초 예산 + 재실행 CPU 실측

- 마일스톤: M7a
- 선행: L0-schema, L1-determinism
- 소유 파일:
  - `supabase/functions/verify-invasion/verifyInvasionCore.ts`
  - `supabase/functions/verify-invasion/index.ts`
  - `supabase/functions/verify-invasion/deno.json`
  - `src/bench/simBench.ts`
  - `tests/verifyInvasion.test.ts`

**산출물**

①layoutEquals(:206)/normalizeServerLayout(:243)/isValidLayout(:287) 을 **폐기하고 L0 의 src/sim/invasion/normalize.ts 를 직접 import**(EF 는 sloppy-imports 로 이미 src/sim/** 를 읽는다) — 클라·서버 정규화 갈림의 구조적 해소. ②시간 예산 3중 불일치 동시 해소: index.ts:333/336 의 timeLimitTicks 를 18000 으로, verifyInvasionCore.ts:547 대조·:554-556 입력 길이 게이트가 따라가는지 확인. ③**SOFT_RERUN_BUDGET_MS 8000 → 20000** 상향 + simBench 로 18000틱 3레이어 재실행 벽시계 실측(Edge Runtime CPU 한도 초과가 이 대개편 최대 인프라 리스크). ④resolveSnapshotAuthority(:488)·SNAPSHOT_FRESHNESS_MS(:417)·injectGuardianAuthority(:364) 골격은 무수정 재활용, authority jsonb 키만 확장. ⑤deno task check → deno task bundle 로 dist.index.js 재생성(gitignore:53 로 워킹트리에 없음 — 배포 전 필수).

**검증**

tests/verifyInvasion.test.ts — ①정직한 3레이어 런 accept ②**위조 필드 전수 reject**: 웨이브 슬롯 교체 / 소켓 설비 교체 / 기물 제거 / 보스 등급 하향 / 코어 모듈 추가 / 방어체 레벨 하향 각각 1케이스(누락 = 위조 프리패스이므로 필드 전수 파라미터화 강제) ③입력 18000틱 accept, 18001틱 invasion-inputs-too-long ④timeLimitTicks 불일치 defense-mismatch ⑤스냅샷 만료(1h+1ms) 시 라이브 폴백 ⑥스냅샷 재사용 reject. src/bench/simBench.ts — 18000틱 3레이어 재실행 벽시계 리포트(20초 초과 시 실패하는 게이트 테스트 포함)

### L7-db-net — DB 3레이어 마이그레이션 + 예산 게이트 폐지 + net 계층 재배선

- 마일스톤: M7a
- 선행: L0-schema
- 소유 파일:
  - `supabase/migrations/20260721000000_m7a_invasion_3layer.sql`
  - `supabase/migrations/20260721010000_m7a_seed_bases_3layer.sql`
  - `src/net/defenseSync.ts`
  - `src/net/invasion.ts`
  - `src/net/invasionGateway.ts`
  - `tests/netInvasion.test.ts`
  - `tests/netDefense.test.ts`

**산출물**

**신규 마이그레이션으로만 갈아끼운다(기존 파일 수정 금지 — 이미 원격 적용됨).** ①defenses.layout 을 3레이어 jsonb 로 재정의 + 기존 행 truncate·재시드(미출시). ②defense_layout_cost(20260717010000:54)와 guard_defenses_client_write 의 **예산 상한 20 게이트(:113 raise) 폐지** → 슬롯 수·유효성 검증으로 대체(결정 #14: 슬롯이 곧 예산). 클라 미러 defenseSync.ts:47 defenseLayoutCost 동반 삭제. ③inject_guardian_authority(20260718110000:46)의 경로를 layout->'l3'->'guardians' 로, limit 2 유지 — **SQL·EF·클라 3자 슬롯 매핑을 동시 수정**(하나만 놓치면 정직한 런이 전량 defense-mismatch). ④begin_invasion v4 재작성: **최신본 20260718160000:185 전문을 베이스로** 해야 자기침공 3차 가드·쿨다운이 소실되지 않는다. authority jsonb = {layers, maintenance, modules}. ⑤apply_invasion_result 는 20260718160000:305 최신본에서 카드 차감 블록만 코어 모듈로 치환하고 락 순서·멱등·복수·스왑·약탈 골격 무수정. ⑥get_invasion_targets/get_placement_targets/get_revenge_targets 3종 반환 layout 을 3레이어로 + 정찰 부분 공개(실루엣·등급·승급만, 정확 스펙 제외 — 결정 #15). ⑦NPC 시드 20기지 3레이어 재시드(난이도 밴드 7/7/6 정합). **검증은 create_branch 로 브랜치 DB 에서 먼저** — supabase/config.toml 도 로컬 스택도 없어 원격 직접 적용은 이 규모에 위험.

**검증**

tests/netInvasion.test.ts — ①게이트웨이 왕복에서 layers 정규화가 L0 모듈과 동일 결과 ②Supabase 미설정 시 no-op(null 반환, throw 금지) 규율 유지 ③스냅샷 authority 파싱. tests/netDefense.test.ts — ①슬롯 초과 배치 업로드 거부 ②업서트 전략(delete→insert 금지, 정비도 보존) 유지 ③defenseLayoutCost 참조 완전 제거. supabase/tests/ 에 phase_m7a_verification.sql 추가 — 브랜치 DB 에서 begin_invasion→apply_invasion_result e2e

### L8-harness-run — 하네스 침공 진입 훅 + 3레이어 배치 프리셋 + main.ts 런 배선

- 마일스톤: M7a
- 선행: L0-schema, L2-scroll-phase
- 소유 파일:
  - `src/harness/core.ts`
  - `src/harness/cheatPanel.ts`
  - `src/harness/presets.ts`
  - `src/main.ts`
  - `tests/harness.test.ts`

**산출물**

정찰이 '3레이어 검증의 병목'으로 지목한 지점: src/harness/** 에 invasion 문자열이 **0건**이고 Harness.startRun 은 PvE 전용({seed,planet,tier,anomaly,maxSegments})이라 침공을 자동 검증할 수단이 아예 없다. ①HarnessHost/Harness 에 startInvasion({layers, seed, maintenance}) 훅 신설. ②PresetKind 에 3레이어 배치 프리셋 3종 추가('def3-empty'=전 슬롯 기본 수비대 / 'def3-mid' / 'def3-maxed'). **preset 은 런 시작 전에 걸어야 비오염**(core.ts:289-297 markTaintedIfLive). ③치트 패널에 침공 시작 버튼 + 레이어 점프(?invasionLayer=1|2|3). ④main.ts:601 startInvasionRun 을 3레이어 InvasionConfig 로 재배선 + 레이어 전환 시 배경 텍스처 교체(main.ts:669-671 패턴 재사용, f64 modulo 를 렌더러 전달 전 취하는 규약 유지). ⑤ADR-0008 오염 런 격리: 하네스 침공은 recorder 를 붙이되 정산·래더 제출 경로와 분리.

**검증**

tests/harness.test.ts — ①startInvasion 이 3레이어 월드를 만들고 phase 0 에서 시작 ②프리셋이 런 시작 전 적용되면 taint 플래그 미설정, 런 중 적용하면 설정 ③레이어 점프가 해당 phase 로 진입 ④하네스 침공 런이 정산 제출을 호출하지 않음(오염 격리)

### L9-garrison-catalog — 기본 수비대 자동 충원 + 임시 카탈로그 레지스트리 + 콘텐츠명 i18n 규약

- 마일스톤: M7a
- 선행: L0-schema
- 소유 파일:
  - `data/invasion/garrison.ts`
  - `data/invasion/catalog.ts`
  - `data/seedBases.ts`
  - `src/i18n/catalog.ts`
  - `tests/invasionCatalog.test.ts`
  - `tests/i18n.test.ts`
  - `tests/seedBases.test.ts`

**산출물**

①**기본 수비대**(결정 #22): 빈 웨이브 슬롯→정찰 드론편대 lv1 노말, 빈 소켓→속사포 lv1 노말, 빈 기물 소켓→비움(과충전 방지), 빈 보스 슬롯→강철 골리앗 lv1 노말. 소유·강화·풍화 대상 아님 → 정규화 단계가 아니라 **스폰 단계에서 주입**해 layers 직렬화·해시를 오염시키지 않는다. ②임시 카탈로그 레지스트리: 편대 3·설비 4·기물 3·보스 1 을 **배열 인덱스=계약** 규율(data/stickers.ts:32 / data/enemies.ts:91-95 주석 모범)로 등록, catalogId 는 append-only. M7c 풀 카탈로그(편대 8·설비 9·기물 6·보스 3)와의 경계를 파일 단위로 미리 갈라 중간 상태에서 테스트가 계속 깨지는 것을 막는다. ③**콘텐츠명 i18n 규약 확정**: src/i18n/catalog.ts 헤더가 유예해 둔 'carry-forward' 를 여기서 결론낸다 — `def3.<id>.name` / `def3.<id>.desc` 키를 EN 정본에 등재하고 KO 타입 강제, 검증은 STICKERS 선례(tests/i18n.test.ts:28-36)대로 **카탈로그 배열에서 파생**해 신규 방어체 추가 시 i18n 누락이 자동으로 잡히게 한다. 이름에 이모지 금지(Pixi 두부). ④data/seedBases.ts 의 20행 description 을 3레이어 어휘로 재작성('저격 회랑'·'이중 포좌'·'장애물로 진입로를 좁힌' → 편대/설비/기물/보스 어휘). 구조(id·UUID·밴드·순번)는 무변경이라 회귀 0.

**검증**

tests/invasionCatalog.test.ts — ①catalogId 전역 유일·연속 ②배열 인덱스 append-only 골든 스냅샷 ③기본 수비대 충원이 결정론(같은 layers→같은 스폰) ④충원이 layers 직렬화를 변경하지 않음(해시 불변) ⑤빈 배치 100% 기본 수비대로 런이 끝까지 도는지 스모크. tests/i18n.test.ts — 카탈로그 배열에서 파생한 def3.* 키가 EN/KO 양쪽에 전수 존재 + 빈 문자열 금지 + 이모지 미포함. tests/seedBases.test.ts — 기존 개수 20·UUID 스킴·밴드 분포 7/7/6 유지(layout 은 원래 미검사라 회귀 0)

### L10-render — 레이어별 배경·전환 연출 + 신규 kind 스프라이트

- 마일스톤: M7a
- 선행: L1-determinism, L2-scroll-phase
- 소유 파일:
  - `src/render/invasionBackdrop.ts`
  - `src/render/entityRenderer.ts`
  - `src/render/textures.ts`
  - `tests/invasionRender.test.ts`

**산출물**

정찰 결론: 배경 스크롤은 이미 cameraX/cameraY 구동이라 **방향 파라미터화가 불필요**하다 — sim 카메라만 축을 바꾸면 종/횡이 그대로 성립한다. 따라서 이 레인의 실제 작업은 ①레이어별 배경 텍스처 3종(L1 대기권·L2 회랑 격벽·L3 코어방) 등록 + 전환 크로스페이드, ②L1 이 추가한 신규 kind 8종의 스프라이트 매핑(미등록은 조용히 null→폴백이라 결함이 안 보임), ③예고선(관통 레일포)·주기 해저드 온오프의 시각 표현. 배경 텍스처 교체 호출은 main.ts 소유 레인(L8)이 하고, 이 레인은 invasionBackdrop.ts 로 API 만 제공. L2 회랑에 구조적 지형이 필요하면 AutotileBackground(src/render/autotile.ts) 가 후보이나 M7a 는 TilingSprite 로 충분.

**검증**

tests/invasionRender.test.ts — ①신규 kind 전수가 스프라이트 매핑을 갖는지(KIND_CODE 배열 파생 — 누락 자동 검출) ②레이어별 배경 텍스처 3종이 textures.ts 에 등록 ③크로스페이드 알파가 전이 틱의 순수 함수 ④예고선 렌더가 windup 틱에만 표시

### L11-legacy-purge — 레거시 일괄 삭제 — 포탑 6종 · 15×9 격자 · 배치 포인트 · 구 프리뷰

- 마일스톤: M7a
- 선행: L6-verify-ef, L7-db-net, L8-harness-run, L9-garrison-catalog, L10-render
- 소유 파일:
  - `src/sim/defense.ts`
  - `src/ui/defenseCommand.ts`
  - `src/render/defensePreview.ts`
  - `src/render/defensePreviewOverlay.ts`
  - `src/ui/controlTower.ts`
  - `src/ui/pixi/controlTower.ts`
  - `tests/invasion.test.ts`
  - `tests/defenseCommand.test.ts`
  - `tests/placement.test.ts`
  - `tests/controlTower.test.ts`

**산출물**

**삭제는 여기 한 레인에만 모은다** — 웨이브 0~2 동안 레거시가 온전히 살아 있어야 빌드가 깨지지 않고, 다른 레인이 이 파일들을 절대 건드리지 않으므로 충돌이 0 이다. 삭제 순서: ①src/sim/defense.ts 에서 TURRET_VULCAN..TURRET_TESLA(:58-239)·TURRET_SPECS·TurretSpec·fireTurret(:651-733)·TurretPlacement/ObstaclePlacement/CorePlacement/DefenseLayout(:260-317)·CORE_COST/OBSTACLE_COST·DEFAULT_TIME_LIMIT_TICKS(:254)·guardianSlots 레거시 필드 제거. **잔존시킬 것**: spawnGuardian/stepGuardians/normalizeMaintenance/scaleFireCooldown/MAINTENANCE_FULL/MAX_GUARDIAN_SLOTS(L5 의 guardianBridge 가 import 중) — 이들을 src/sim/invasion/guardian.ts 로 이관하고 defense.ts 는 파일째 삭제하거나 얇은 재수출만 남긴다. ②src/ui/defenseCommand.ts 1580줄 전체 삭제(GRID_COLS/ROWS/CELL_W/H/SPAWN_*/DEFENSE_BUDGET_BASE/placementCost/TURRET_DISPLAY/buildPalette/죽은 .pb-tabs CSS 포함). **격자 상수를 defensePreviewOverlay.ts:17-26·src/ui/controlTower.ts:279·src/ui/pixi/controlTower.ts:1164 가 동시에 import 하므로 3곳을 같은 커밋에서 정리**해야 조용히 어긋나지 않는다. ③defensePreviewOverlay.ts 전체 삭제, defensePreview.ts 는 3레이어 재작성을 M7b UI 레인에 넘기고 여기서는 진입점 스텁화. ④controlTower 양판의 previewCells()/renderReconPanel() 15×9 미니 격자를 제거하고 정찰 표시를 임시 텍스트로(정식 재설계는 M7b). ⑤tests/invasion.test.ts:60-77(배치 스폰)·:157-194(포탑 6종 발사 스모크) 삭제, :78-114(결정론)·:195-293(정비도)·:294-300(PvE 불변)은 3레이어 스키마로 이식. ⑥고아 i18n 키 정리(def.turret.name.*/def.pal.*/def.budget.* — tests/i18n.test.ts 가 키 정합을 검증하므로 정리 누락이 곧 테스트 실패).

**검증**

①tsc + 전체 vitest 그린(현재 756개 기준, 삭제분 제외·이식분 포함) ②grep 게이트: GRID_COLS/DEFENSE_BUDGET_BASE/TURRET_SPECS/defenseLayoutCost 참조 0건을 확인하는 테스트 ③tests/i18n.test.ts 고아 키 0 ④침공 1회 e2e 스모크(하네스 startInvasion → L1→L2→L3→코어 파괴 → verify accept)

### M7b-inventory — 방어체 인벤토리·강화 3축 (레벨·승급·어픽스 리롤)

- 마일스톤: M7b
- 선행: L11-legacy-purge
- 소유 파일:
  - `data/defenseUnits.ts`
  - `src/items/rollDefenseUnit.ts`
  - `src/net/defenseUnits.ts`
  - `supabase/migrations/2026072x_m7b_defense_units.sql`
  - `tests/defenseUnits.test.ts`

**산출물**

data/defenseCards.ts 의 어픽스→시드 롤→인스턴스 구조(CardAffixDef:87 / CardAffixRoll:232 / CardInstance:244)를 **복제**해 방어체 어픽스 엔진 구성. 장비 어픽스 엔진(StatKey)은 플레이어 파생 스탯 어휘라 재사용 불가 — 카드가 CardStatKey 를 따로 만든 전례를 따른다. Rarity/RARITY_CODE(src/items/types.ts:24-39) 4등급 사다리와 nextRarityUp 은 무수정 재활용. defense_cards 테이블 RLS 패턴(본인 select, 쓰기 service_role) 복제.

**검증**

같은 시드→바이트 동일 롤, 어픽스 id 전역 유일, 승급 사다리 상한, 레벨 스케일 정수 산술(Math.round(a*b/c) 관용구)

### M7b-command-ui — 방어 사령부 Pixi 전면 개편 (레이어 탭 3 + 보관함) + 공용 부품 승격

- 마일스톤: M7b
- 선행: L11-legacy-purge, M7b-inventory
- 소유 파일:
  - `src/ui/pixi/defenseCommand.ts`
  - `src/ui/pixi/tabs.ts`
  - `src/ui/pixi/scrollArea.ts`
  - `src/ui/pixi/modal.ts`
  - `src/ui/pixi/listRow.ts`
  - `src/render/defensePreview.ts`
  - `tests/defenseCommandPixi.test.ts`

**산출물**

**처음부터 Pixi 로**(DOM 혼용 시 캔버스 UI 가 DOM 오버레이 아래로 깔리고 z-index 로 못 뒤집는다 — 실측). 탭 바는 Pixi 화면 어디에도 없어 완전 신규(디자인 결정 선행 필요). private 부품 3종 승격: scrollArea(cardsView.ts:460, 마스크 Graphics 는 히트테스트 제외라 휠은 클립 Container hitArea 에)·renderModal(controlTower.ts:1404)·listRowBg(cardsView.ts:108). **행 클릭은 행 Container 에**(바탕 Graphics 면 텍스트가 삼킨다). 코어 모듈 화면 진입은 반드시 suspend/resume(show() 면 미저장 편집 소실). 3레이어 프리뷰 + 시험 침공(ADR-0008 오염 격리 유지).

**검증**

탭 전환 상태 보존, 슬롯 편집 왕복 정규화, panelContent 여백 기하, 시험 침공이 정산·리플레이 제출 경로를 안 태움

### M7b-core-modules — 카드 → 코어 모듈 개명·재배선 (27개 파일)

- 마일스톤: M7b
- 선행: L11-legacy-purge
- 소유 파일:
  - `data/coreModules.ts`
  - `src/sim/moduleEffects.ts`
  - `src/net/modules.ts`
  - `src/ui/pixi/modulesView.ts`
  - `supabase/functions/modules/`
  - `supabase/migrations/2026072x_m7b_core_modules.sql`

**산출물**

**표시 문자열 개명과 wire 필드명을 반드시 분리**한다 — src/sim/replay.ts·defense.ts 의 직렬화 키가 개명에 닿으면 서버 재실행과 바이트 일치가 깨진다(ADR-0005). 테이블은 rename 이 아니라 신규 테이블 + 구 경로 폐기(EF 3개가 이름에 결속). CardStatKey 8종이 구 아레나 전제(turretDamagePct·coreShieldFlat 등)라 3레이어 어휘로 재정의 — defense_cards.card jsonb 계약과 RPC 동반 변경.

**검증**

모듈 효력 결정론, 소모 횟수 차감 멱등, 개명 후에도 해시 스트림 불변(wire 필드 미변 가드)

### M7b-acquisition — 설계도 드랍 · 제작 · 침공 약탈 복제 · 정찰 화면

- 마일스톤: M7b
- 선행: M7b-inventory
- 소유 파일:
  - `src/sim/drops.ts`
  - `data/planets/index.ts`
  - `src/ui/pixi/controlTower.ts`
  - `supabase/migrations/2026072x_m7b_blueprint_drops.sql`

**산출물**

PlanetDropTable 에 행성별 특산 방어체 필드 append(기존 4행 안전). sim 은 방어체 카탈로그를 알면 안 되므로 rollBlueprintDrop 은 {seed, tableIndex} 불투명 코드만 방출하고 확정은 메타 레이어(현행 rarityCode 와 동일 철학). **가장 싼 길은 새 Entity kind 가 아니라 state.loot 항목에 append-only 필드 1개**(hashEntity 레이아웃 미변). 정찰: 레이어별 실루엣·등급 색·승급 별만 공개, 정확 스펙은 1회 침공 후 해금.

**검증**

드랍 결정론, 행성별 분배, 정찰 응답에 정확 스펙 미포함(정보 누출 가드)

### M7c-content — 풀 카탈로그 · 유니크 방어체 · 압축 프레스(이동 벽) · 밸런스 · 배치전 재구성

- 마일스톤: M7c
- 선행: M7b-inventory, M7b-acquisition
- 소유 파일:
  - `data/invasion/formations.ts`
  - `data/invasion/facilities.ts`
  - `data/invasion/props.ts`
  - `data/invasion/defenseBosses.ts`
  - `data/enemies.ts`
  - `src/sim/invasion/movingWall.ts`
  - `supabase/migrations/2026072x_m7c_seed_rebalance.sql`

**산출물**

편대 8·설비 9·기물 6·보스 3 완성(M7a 임시분에 append-only 확장). 신규 적 종류는 ENEMY_BY_TYPE 에 22 부터 append(중간 삽입 금지 — tests/m3Content.test.ts:138 이 연속성 강제). 유니크 고유 효과는 DefenseCardUniqueDef{params:Record<string,number>} 문법 복제. **M7a 에서 이월한 압축 프레스(이동 벽)**: 터널링 방지 전제 '벽 최소 폭 120u > 최대 대시 스텝 59u' 를 깨므로 끼임·터널링 처리 신설. 데이터 물량이 현행 data/ 총량(2,995줄)에 필적.

**검증**

카탈로그 전수 i18n 키, ENEMY_BY_TYPE 연속성, 이동 벽 터널링 0(고속 대시 스윕 케이스), 밸런스 스모크(각 난이도 밴드 클리어율)

### M8-champion — 기체 챔피언화 — 트리 타입별 일반화 → 신규 2종 → 로스터 5종

- 마일스톤: M8
- 선행: M7c-content
- 소유 파일:
  - `data/skills.ts`
  - `data/ships/`
  - `src/sim/shipSignature.ts`
  - `src/ui/pixi/hangar.ts`

**산출물**

data/skills.ts 의 3계열×20노드 구조(SKILL_TREES + 인덱스 슬라이스 규약)를 타입별로 일반화 → 신규 타입 2종 우선 출시 → 로스터 5종 완성. 고유=트리+시그니처 패시브+스탯 보정+외형 / 공통=장비 8슬롯·조작·판정점. 첫 기체=스트라이커 자동 지급, 퇴역 시 전체 개방 자유 선택. **아트 의존 큼** — pixellab 파이프라인 병행이며 생성분은 pixellab-forge 리포 동기화 규칙 대상. 수호 기체 AI 가 타입 시그니처를 반영하면 방어 로스터 다양성이 저절로 는다(확장 여지).

**검증**

타입별 트리 노드 수·캡스톤 정합, 시그니처 패시브 결정론, 퇴역 후 로스터 전체 선택 가능, 기존 스트라이커 빌드 해시 불변

## 미해결 위험

- **EF 재실행 CPU 한도가 이 대개편의 최대 인프라 리스크.** 틱 10800→18000(1.67배) × 3레이어로 틱당 엔티티 증가 → verify-invasion/index.ts:39 SOFT_RERUN_BUDGET_MS 는 경고만 남기고 중단 불가(동기 루프)라 Supabase Edge Runtime 이 먼저 끊으면 검증 자체가 실패한다. L6 의 simBench 실측이 20초를 넘으면 L3 엔티티 상한·컬링을 조여야 하고, 최악의 경우 '전 구간 재실행' 대신 '샘플 구간 재실행'이라는 아키텍처 변경이 필요하다. **L6 을 웨이브 2 초반에 배치해 조기 발견할 것.**
- 수호 슬롯 매핑 3자 정합(SQL inject_guardian_authority 20260718110000:46 / EF injectGuardianAuthority verifyInvasionCore.ts:364 / 클라 buildGuardianPlacements). 경로를 layout->'l3'->'guardians' 로 옮길 때 하나만 놓치면 **정직한 런이 전량 defense-mismatch 로 오거부**된다. L5·L6·L7 세 레인에 걸쳐 있어 웨이브 경계를 넘는 유일한 결속 — 통합 시 슬롯 i↔수호 i 골든 테스트로 3자를 한 번에 검증할 것.
- layoutEquals 확장 누락 = 보안 구멍. 신규 3레이어 필드를 대조에 안 넣으면 공격자가 약화된 가짜 방어를 제출해도 accept 된다. L0 의 layersEqual 과 L6 의 위조 reject 테스트를 **필드 전수 파라미터화**로 강제했지만, M7b/M7c 에서 필드를 추가하는 레인이 테이블 갱신을 잊으면 조용히 뚫린다. 스키마 필드 목록에서 테스트 케이스를 파생시키는 형태로 만들 것.
- supabase/config.toml 도 로컬 스택도 없어 마이그레이션 검증이 원격(qxgbxwyccbxokdgwxcuw) execute_sql 실측에 의존한다. defenses.layout 재정의 + 예산 게이트 폐지 + begin_invasion v4 는 되돌리기 어려운 규모라 **브랜치 DB(create_branch)에서 먼저** 돌려야 한다.
- begin_invasion 은 마이그레이션 3개, apply_invasion_result 는 5개에 걸쳐 replace 돼 왔다. **최신본(20260718160000:185 / :305) 전문을 베이스로 재작성하지 않으면** 이전 리뷰 픽스(자기침공 3차 가드·쿨다운 거부·격차 30 스왑·profile_id 오름차순 락)가 조용히 소실된다. L7 레인의 1차 작업은 코드 작성이 아니라 최신본 전문 확보여야 한다.
- dist.index.js 가 .gitignore:53 로 무시되고 현재 워킹트리에 **없다** — supabase/README.md:164 의 '워킹트리 유지' 서술과 불일치. 배포 전 반드시 `deno task bundle` 재실행. 이 사실이 인수인계 문서에 반영돼 있지 않아 다음 세션이 stale 번들을 배포할 위험.
- L1(해시)과 L2~L5(신규 kind·필드 사용)의 병렬은 'kind·aux 필드를 L1 이 먼저 예약'한다는 전제 위에 선다. W1 중간에 L4 나 L5 가 예약분을 초과하는 상태를 필요로 하면 L1 이 재작업 + fixture 재생성을 다시 해야 한다. **W1 킥오프 시 kind 8종·aux 2개가 충분한지 L2~L5 가 먼저 합의**할 것.
- 탭 바 시각 규격이 카툰나무풍 세트에 정의돼 있지 않다(Pixi 화면 어디에도 탭 구현 0건). M7b-command-ui 는 코드 착수 전 디자인 결정(선택 상태·나무 프레임과의 연결 방식)이 선행돼야 하며, 이건 병렬화가 안 되는 직렬 구간이다.
- M7c 데이터 물량이 현행 data/ 총량(2,995줄)에 필적한다. M7a 임시 카탈로그(11종)와 M7c 풀 카탈로그(26종+)의 경계를 파일 단위로 갈라뒀지만, 카탈로그 인덱스가 해시 계약이라 중간 상태에서 append 순서를 한 번이라도 틀면 fixture 재생성이 또 필요하다.
- 기물 '기만 홀로그램'(가짜 코어)은 compact() 의 core→victory 함정과 정면으로 닿는다. 기존 카드가 별도 kind decoyCore(entities.ts:37)로 우회한 전례가 있으므로 L5 는 반드시 별도 kind 를 쓰고, L2 의 phase===2 조건화와 함께 통합 테스트해야 한다.
- L2 회랑의 상·하 긴 벽이 '활성 벽 ≤~19' 전제(world.ts:1631-1634 경고)를 즉시 깬다. L4 의 wallIndex 로 대응하지만 broad-phase 도입 자체가 탄-벽 판정 결과를 미세하게 바꿀 수 있고, 그러면 PvE 해시에도 영향이 갈 수 있다. **broad-phase 는 침공 경로에서만 활성화**하고 PvE 는 기존 직접 스윕을 유지하는 분기가 안전하다.
- 미결 #6(편대·설비의 행성별 분배)은 M7b-acquisition 의 입력인데 아직 미정이다. M7a 에는 영향이 없지만 M7b 착수 전에 확정 필요 — '이 편대 얻으러 이 행성 파밍' 동기가 이 분배 하나에 걸려 있다.
