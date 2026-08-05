# 스킬 훅 재료 인벤토리 (Planet Blitz sim)

> 2026-08-05 Explore 에이전트 전수 조사. 210스킬 설계의 훅 재료 정본.
> 경로는 리포 루트 기준.
> 공통 제약 3개는 매 항목에 반복하지 않고 여기 한 번만 둔다:
> **(공통-A)** `stepWorld`의 틱당 처리 순서가 곧 상태 해시의 정의다(`src/sim/world.ts:1399-1653`). 훅을 새 위치에 끼우면 골든·리플레이가 갈린다.
> **(공통-B)** 난수는 반드시 fork된 스트림(`waveRng`/`powerupRng`/`dropRng`/`eliteRng`/`supplyRng`/`worldRng`)에서만. 기존 스트림을 나눠 쓰면 무관한 드랍·웨이브가 통째로 밀린다.
> **(공통-C)** `src/sim/**` 를 건드리면 `verify-invasion`·`verify-commission` Edge Function 재배포가 필수(README `## 서버 배포`).

---

## 1. 이동·조작

| # | 요소 | ① 한 줄 | ② sim 위치 | ③ 훅 제약 |
|---|---|---|---|---|
| 1.1 | 이동 속도 | `moveX/moveY` 정규화 × `playerSpeed`(기본 720u/s) | `world.ts:1891-1908` | 속도는 `config.playerSpeed`(f64)에 직접 곱해진다. 감속 배율은 `slowMult`·`moduleSlow` 2개가 이미 곱해지는 자리 — 새 배율을 얹으려면 여기 곱셈을 하나 더 늘려야 하고, 배율 1이면 `v*1===v`로 비트 동일이라 해시 안전 |
| 1.2 | 대시 | `input.dash` + `dashCooldown===0` → 속도에 `dashSpeed`(2800) 임펄스 1틱 가산 | `world.ts:1917-1947`, 기본값 `world.ts:786-797` | **무적프레임 있음**: `dashIframes=10`. 유니크 위상장갑이면 `+PHASE_ARMOR_BONUS_IFRAMES`·쿨다운 배율. 대시는 **속도 가산**이지 순간이동이 아니다(액티브 `blink`와 다름). `dashCooldownTicks`는 여전히 **정수 틱**이라 감소형 배율이 하한 12 근처에서 삼켜질 수 있음(`powerups.ts:33-37` 경고) |
| 1.3 | 대시 잔상 소거 | 대시 순간 반경 내 적탄 소거(유니크 ⑪ / 기동 캡스톤) | `world.ts:1932-1946` | 중첩 시 **반경 합산이 아니라 큰 쪽 1회**. 새 스킬이 여기 끼면 같은 규율을 따라야 한다 |
| 1.4 | 발동 방향 폴백 | 이동 입력 → (길이<0.001이면) 조준각 | `world.ts:1870-1873` `resolveDirFallback` / `world.ts:1880-1889` `activeDirOf` | **대시와 액티브가 같은 규칙을 공유하는 단일 정본**(ADR-0041). 복제 금지 — 복제하면 두 규칙이 조용히 갈린다 |
| 1.5 | 정지/이동 상태 | 아크캐스터 시그니처가 "정지 틱"을 **입력으로** 판정(`moveX===0 && moveY===0 && !dash`) | `world.ts:2066-2075` | 속도가 아니라 **입력**으로 판정하는 것이 계약. 감속 장판·모듈 배율 때문에 속도는 신뢰 불가. `aux0`에 저장(0..600 clamp) |
| 1.6 | 조준 | `input.aim`(라디안) → `player.angle` 매 틱 대입 | `world.ts:1909` | 자동 조준(`nearestTarget`)이 실제 발사각을 정하므로 `aim`은 **캡스톤 레이저 방향·대시 폴백**에만 실효. "조준 방향 스킬"은 `player.angle`을 읽으면 된다 |
| 1.7 | 스크롤 앵커 ANCHOR/WORLD | 강제 스크롤 모드에서 엔티티가 창에 붙는지/월드에 남는지 가르는 순수 술어 | `src/sim/scrollMode.ts` `scrollAnchored`, 정책 정본 `docs/adr/0034-scroll-anchor-policy.md` | 플레이어는 **70% 부분 앵커**(`PLAYER_ANCHOR_PERCENT=70`), 살아 움직이는 실체는 ANCHOR, 지형·구조물만 WORLD. 앵커 델타는 `Math.trunc(delta*pct/100)` 정수. 신규 Entity 필드 0·해시 폴드 0이 이 축의 계약 — **스킬이 앵커 정책을 런타임에 바꾸면 그 계약이 깨진다** |
| 1.8 | 창 클램프 | 스크롤 모드에서 플레이어가 창 밖으로 못 나감 | `world.ts:1560-1565` | 벽 슬라이드 **이후**가 최종 권위. 순서 고정 |
| 1.9 | 벽 슬라이드 | 원 vs AABB 최소 침투 밀어내기(관통 방지) | `src/sim/los.ts` `slideCircleWalls`, 호출 `world.ts:1963-1975` | `blink`도 이걸 태운다(`activeTypes.ts:120-124`). 한 번에 미는 거리가 벽 두께(최소 120u)를 넘으면 터널링 — 그래서 스트라이커 2단 도약이 450×2로 쪼개져 있다 |

---

## 2. 회피·피격

| # | 요소 | ① | ② | ③ |
|---|---|---|---|---|
| 2.1 | 판정점(hitbox) | 피격 판정만 반경 **8**(기체 반경 32의 1/4), 픽업은 관대한 기체 반경 | `world.ts:391` `PLAYER_HIT_RADIUS`, 적용 `world.ts:3687-3722` | ADR-0010 계약. **이로운 접촉/해로운 접촉이 다른 반경**이다. 반경을 바꾸는 스킬은 이 두 축 중 어느 쪽인지 명시해야 한다 |
| 2.2 | **그레이징 — sim 미구현** | 스침 판정은 **렌더 전용 연출**이고 보상이 없다 | `src/render/effects/grazeSpark.ts:2-22` (`isGraze`) | sim에는 그레이징 상태가 **존재하지 않는다**. "스치면 자원" 계열 스킬은 **신규 시스템**이다: 판정을 sim으로 내리고 카운터를 `WorldState`에 추가 → 조건부 해시 폴드 설계 필요 |
| 2.3 | 피격 무적(iframes) | 피해를 입으면 `hitIframes=40`틱 무적, 매 틱 1 감소 | `world.ts:1912`(감소), `world.ts:3872`(설정), 기본값 `world.ts:795` | 무적 중에는 **피해 누적 루프 자체가 조기 반환**(`world.ts:3739`)이라 버블 막도 안 닳는다. 지속 무적 스킬은 "큰 값 1회"가 아니라 **매 틱 재설정**이어야 종료와 동시에 풀린다(`activeHandlers/striker.ts:29-32` `refreshIframes`) |
| 2.4 | HP·최대 HP | `player.hp`/`maxHp`. 기본 100 | `world.ts:796`, 회복례 `powerups.ts:160-167` | `hp`는 f64가 될 수 있다(엘리트 배율 접촉 피해). `Math.round`/`trunc`를 게이트 밖에 두면 **시그니처 없는 런의 소수 피해까지 바꿔 해시가 갈린다** — 이 경고가 코드에 4번 반복돼 있다 |
| 2.5 | 실드 | 플레이어 실드는 **없다**. 실드는 침공 코어/포탑 전용(`targetY` 필드) | `world.ts:3561-3569` | 플레이어 실드를 새로 만들려면 신규 상태. 대신 **버블 방막**(`aux0` = 흡수 내구)이 사실상 실드 슬롯 |
| 2.6 | 피해 배수 | `PLAYER_DAMAGE_TAKEN_MULT = 2` — 피격 통로 하나에만 곱한다 | `world.ts:416`, 적용 `world.ts:3779` | **감쇠 사슬의 맨 앞**이 계약: 무대배율 → **피해배수** → 브루저 장갑 → 버블 막 → 말로우 완충 → 생존 캡스톤. 순서를 바꾸면 "치명타 1회 무효"가 잘못된 값으로 치사를 판정한다. 모드 페널티(압사·후방압박·장외)·침공 이동벽·반사 피해는 **이 통로 밖**이라 배수를 안 받는다 |
| 2.7 | 감쇠 사슬 슬롯 5개 | 장갑 감소 / 막 흡수 / 완충 지연 / 캡스톤 무효 / 무대 배율 | `world.ts:3760-3930` | 여기가 "피격 반응" 스킬의 **단일 진입점**. 단, 침공 코어모듈 반사·응징 2종은 이 사슬을 우회해 `player.hp`를 직접 깎는다(`world.ts:3553-3556`, `3588-3592`) — 우회 경로에서는 `noteDirectPlayerDamage`(`world.ts:2315`)만 호출된다 |
| 2.8 | 피격 후속 트리거 | 실제로 hp가 깎였을 때만 도는 블록(과열 리셋·반응장갑 펄스·위상 전환막) | `world.ts:3869-3928` | 캡스톤이 무효화한 피격·막이 전량 흡수한 피격은 **"없던 피격"**이라 여기 도달하지 않는다. "맞으면 발동" 스킬은 이 안에 넣어야 의미가 일관된다 |

---

## 3. 무기

### 3.1 주무기 5종 (`weaponType`)

| 코드 | 이름 | 발사 구조 | 위치 |
|---|---|---|---|
| 0 | 발칸 | 부채꼴 볼리, 플레이어 좌표에서 생성 | `world.ts:2678-2703` |
| 1 | 스프레드 | 발칸과 같은 분기, loadout 기준값만 다름 | 동상 |
| 2 | 레일건 | 표적 방향 단발, 관통·탄속으로 승부 | `world.ts:2602-2618` |
| 3 | 미사일 | `bulletCount`발 유도(`MISSILE_MARK=0x3155110` 마커) | `world.ts:2620-2643`, 선회 `world.ts:3162` `homeMissile` |
| 4 | 빔 | 속도 0 정적 세그먼트를 사거리만큼 깔고 짧은 수명으로 재도포, pierce 9999 | `world.ts:2645-2676` |

- **탄 생성 위치**: 레일건·미사일·발칸/스프레드는 전부 `player.x/y`. 빔만 `player + cos/sin × i×간격`.
- **관통**: `bullet.pierce` 예산 감소, 0에서 소멸(`world.ts:3624-3628`). 유니크 관통자이로는 무한관통 + `b.phase`(관통 횟수)로 피해 증폭, 수렴프리즘은 빔 전용 동형.
- **멀티배럴**: `weapon.bulletCount` + `spread`. 유니크 쌍둥이항성이 스프레드 한정 ×2.
- **사거리**: `BASE_WEAPON_RANGE=1650` (`world.ts:593`). "닿는 거리"가 계약 — 조준 상한(`weaponReach` `world.ts:2522`)과 탄 수명 보정(`reachLife` `world.ts:2536`)이 **반드시 같은 값**을 쓴다. `0=무제한` 센티널은 폐기됐다.
- **탄속**: `bulletSpeed` 기본 1800.
- **발사 간격**: `fireCooldownQ` — 단위가 틱이 아니라 **1/256틱 고정소수점**(`constants.ts:60` `FIRE_CD_Q`). 하한 2틱(`FIRE_CD_MIN_Q`). `player.cooldown`을 매 틱 256씩 깎고 발사 시 `+=`로 **음수 잔여분 carry**(`world.ts:2545-2552`). ⚠️ 스킬이 발사 간격을 만질 때 이 단위를 틀리면 256배 어긋난다.

**③ 훅 제약**: `state.weapon`은 파워업이 in-place 변형하는 단일 객체다. 스킬이 일시적으로 무기를 바꾸려면 **원복 책임**이 스킬에 있다(sim에 "임시 스탯" 틀이 없다). `subDamage`/`subCooldown`(`world.ts:2798`,`2825`)처럼 **읽는 시점 배율**로 표현하는 편이 안전하다.

### 3.2 보조무기 5종 (`subWeaponType`, 독립 사이클)

| 코드 | 이름 | 구조 | 상수 |
|---|---|---|---|
| 0 | 사이드킥 | 빠른 단발 볼트, 근접 자동 조준 | `world.ts:2755-2760` |
| 1 | 스캐터 | 3발 광각 산탄, 짧은 사거리 | `world.ts:2763-2771` |
| 2 | 기뢰장 | 플레이어 위치 정지 발사체(반경 64·수명 150·관통예산 40 = 총피해 상한) | `world.ts:2776-2781` |
| 3 | 센트리 | 주기적 임시 자동 포탑 배치(드론베이 로직 재사용) | `world.ts:2784` |
| 4 | 호밍 플레어 | 유도 미사일, 느린 연사·강한 단발 | `world.ts:2789-2794` |

**③**: 사이클 카운트다운을 플레이어의 **미사용 `timer` 필드에 실어** 신규 해시 필드 0으로 유지한다(`world.ts:2725-2745`). `timer`는 이미 보조무기가 점유했으므로 새 스킬이 이 칸을 쓰면 충돌한다.

### 3.3 원소 (실제 구현)

`src/sim/status.ts` 전체 — **적 엔티티의 미사용 필드를 재활용**한다:

- **화염(dot)**: `applyBurn` — `enemy.iframes` = 남은 틱(기본 `FIRE_DURATION=120`), `enemy.dashCooldown` = 틱당 피해. 갱신 시 더 강한 값 유지. 틱 진행 `tickEnemyStatus`(`status.ts:80`)
- **냉기(슬로우)**: `applySlow` — `enemy.ownerId` = 남은 틱(`COLD_DURATION=90`), 배율 `COLD_SLOW_MULT=0.55` **고정**. 어픽스 값은 불리언 게이트일 뿐 강도에 관여 안 함(`status.ts:59-66`)
- **전격(연쇄)**: `applyChain` — 즉발, `CHAIN_RADIUS=260`, 최대 3마리, **엔티티 배열 순서**로 결정론 선택. 잔존 상태 없음
- **플레이어 감속**: `state.playerSlowTicks` 스칼라, `PLAYER_SLOW_MULT=0.5`·90틱. **대시 임펄스에는 미적용**(회피 여지 보존)

부여 지점은 전부 `world.ts:3599-3604` 한 곳.

**③ 훅 제약(중요)**: 냉기가 `ownerId`를 점유해서 **적에게 "소속" 마커를 붙이는 스킬과 정면 충돌**한다. 화염은 `iframes`+`dashCooldown` 2칸을 먹는다. 즉 **적 대상 신규 디버프를 3개 이상 동시에 걸 여유 필드가 이미 없다** — 4번째 축은 `aux0/aux1`로 가야 하는데 그건 9번 항목의 계약과 부딪힌다.

---

## 4. 크리티컬 / 처치 / 킬 쿼터

| # | 요소 | ① | ② | ③ |
|---|---|---|---|---|
| 4.1 | **크리티컬 — 없다** | 확률적 치명타 시스템이 sim에 존재하지 않는다 | 전수 grep 0건. `CAP_SURVIVAL_CRIT`(`capstones.ts:22`)는 "치명**피격** 1회 무효"로 이름만 겹친다 | 크리티컬은 **신규 시스템**. 확률을 쓰면 새 RNG fork 필요(공통-B), 무확률 결정론 크리(예: N번째 타격 확정 크리)로 설계하면 카운터 1개로 끝난다 |
| 4.2 | 킬 카운트 | `state.kills` — **모든 사망 경로가 `e.dead=true`로 수렴하고 집계는 `compact()` 한 곳** | `world.ts:4026` `compact`, 해설 `world.ts:2130-2133` | 이 단일 수렴이 계약이다. "처치 시 발동" 스킬은 지점별 훅을 심지 말고 `state.kills` 델타를 읽어라(해츨링 선례 — `aux0`에 마지막 스냅샷) |
| 4.3 | 킬 쿼터 = 런 길이 | 세그먼트 전진이 고정 타이머가 아니라 **처치 할당**(ADR-0011) | `data/waves.ts:315-327` `SEGMENTS` — killGoal 10/40/46/**0(중반격전)**/52/63/**0(보스)** 합계 **240** | ⚠️ `SEGMENTS[0].killGoal=10`은 **침공 해시 때문에 불변 고정**. killGoal 합계를 만지면 `xpToNext(10+66L)` 계수를 다시 재야 한다(`world.ts:418-445` — 과거 실제로 레벨업이 5~8→14~18로 폭주한 이력) |
| 4.4 | 콤보 | 젬 획득당 +1, 120틱 창, ×1.5 상한(10스택) | `world.ts:360-364`, `comboMultiplier` `world.ts:507`, 갱신 `world.ts:4168` | XP에만 곱한다. 콤보를 피해에 쓰려면 신규 배선 |
| 4.5 | 처치 부가 효과 | 엘리트 사망 시 파편/폭발 | `elite.ts:119` `spawnEliteDeathFx` | 여기가 "사망 연쇄" 선례 |

---

## 5. 픽업

| # | 요소 | ① | ② | ③ |
|---|---|---|---|---|
| 5.1 | 자석 반경 | 기본 420, 반경 안에서 젬이 1520u/s로 빨려옴 | `world.ts:365-370`, 로직 `world.ts:3294-3315` `stepGems` | `state.magnetRadius`는 이미 해시 대상 정수. 파워업 2종(+15%/+12%)과 유니크 탐욕의심장이 스택 상한까지 올린다 |
| 5.2 | 자석 버프 | `magnetEmitter` 기믹 접촉 → `magnetBuffTicks` 동안 반경 ×`MAGNET_BUFF_MULT` | `world.ts:921-925`(필드), `world.ts:3297` | **시간제 버프 필드의 유일한 기존 선례**(액티브 버프 외). 새 반경 버프는 이 칸을 재사용 가능 |
| 5.3 | 경험치 젬 | `spawnGem`, XP값이 `damage` 필드에 실림 | `entities.ts:303-311`, 수거 `world.ts:3934` `collectGem` | XP 이원화(ADR-0036): **런 풀 `state.xp`는 단계 무관 고정**, 메타 풀 `xpTotal`만 단계·행성인기 배율. 스킬이 XP를 만질 때 어느 풀인지 반드시 정해야 한다 |
| 5.4 | 전리품(loot) | 엘리트 드랍. **아이템 실물이 아니라 드랍시드(u32)+등급코드만** sim에 존재 | `entities.ts:450-465` `spawnLoot`, 수거 `world.ts:3965` `collectLoot` | sim은 아이템 계층을 런타임 의존하지 않는다(ADR-0005). 스킬이 "드랍 조작"을 하려면 시드/등급 축까지만 |
| 5.5 | 자원 | 보급 습격 격추·에코 안정화 → `state.resources` | `world.ts:931-932`, 소수 캐리 `world.ts:851-858` `catalystResourceMilli` | 소수 자원은 milli 정수 캐리로 결정론 유지. **크레딧·광물은 sim에 없다** — 정산 계층(`src/save/settlement.ts`) 소관 |
| 5.6 | **회복 픽업 — 없다** | 바닥 회복 아이템이 존재하지 않는다 | — | 회복은 파워업(즉시 +HP)·위상전환막·스트라이커 만료 훅뿐. "회복 오브젝트"는 신규 kind 필요(KIND_CODE 32부터 append) |
| 5.7 | 기믹 픽업 3종 | `magnetEmitter`(자석버프) / `bombDevice`(반경 피해+적탄소거) / `turretPickup`(임시 아군 포탑) | `entities.ts:408-420`, 접촉 `world.ts:3703-3720` | `turretPickup`+`DRONE_MARK`/`BROOD_MARK`가 **sim의 유일한 아군 유닛 메커니즘**이다. 소환물 스킬은 이걸 재사용하면 자동조준·수명·컬링제외·렌더가 공짜(`world.ts:2226-2242`) |
| 5.8 | 드랍 판정 | 등급 4단(normal/magic/rare/unique) + 설계도. 엘리트 드랍 게이트·보스 확정 드랍 | `src/sim/drops.ts:17-19`, `270`, `309`, `330` | `dropRng` 전용 스트림. 행성 인기 배율은 **수량**에만, 품질에는 절대 안 곱한다(ADR-0022) |

---

## 6. 런 내 성장 — 파워업 24+2종

`src/sim/powerups.ts:92-373`. **인덱스가 wire 값이라 재정렬 절대 금지**, 신규는 append.

| idx | id | 이름 | 효과 |
|---|---|---|---|
| 0 | rapid-fire | 고속 연사 | 발사간격 ×0.9 |
| 1 | twin-shot | 증설 포신 | 탄환 +1, spread +0.06 |
| 2 | heavy-rounds | 고폭탄 | 피해 +8% |
| 3 | piercing-rounds | 관통탄 | 관통 +1 |
| 4 | thrusters | 추진기 증강 | 이속 +6% |
| 5 | dash-coils | 대시 코일 | 대시 재충전 −8%(하한 12) |
| 6 | reinforced-hull | 강화 장갑 | 최대HP +10, 즉시회복 |
| 7 | gem-magnet | 자기장 코일 | 자석반경 +15% |
| 8 | spread-pellets | 산탄 증설 | 탄환+1·확산↑ (스프레드) |
| 9 | spread-choke | 초크 개조 | 피해 +10% (스프레드) |
| 10 | rail-penetrator | 관통 강화 코어 | 관통 +1 (레일건) |
| 11 | rail-overcharge | 과충전 코일 | 피해 +10%·탄속 +8% (레일건) |
| 12 | missile-salvo | 연장 발사관 | 미사일 +1 |
| 13 | missile-warhead | 고폭 탄두 | 피해 +10% (미사일) |
| 14 | beam-intensifier | 빔 증폭기 | 피해 +10% (빔) |
| 15 | beam-focuser | 집속 렌즈 | 사거리 +120 (빔) |
| 16 | fp-focus | 화력 집중 | 피해 +8% |
| 17 | fp-cadence | 속사 조율 | 발사간격 ×0.92 |
| 18 | sv-plating | 보강 도금 | 최대HP +12 |
| 19 | sv-evasion | 회피 부스터 | 대시 재충전 −8% |
| 20 | mb-overdrive | 기동 오버드라이브 | 이속 +5% |
| 21 | mb-collector | 수집 증폭 | 자석반경 +12% |
| 22 | muzzle-velocity | 고속 사출 | 탄속 +8% |
| 23 | field-medkit | 야전 응급팩 | 최대HP +8 |
| **24** | active-tune-1 | 슬롯 1 조율 | **슬롯1 액티브 계열 투자 +2** |
| **25** | active-tune-2 | 슬롯 2 조율 | 슬롯2 계열 투자 +2 |

- **레벨업 프리즈**: `state.pendingLevelUp`이면 `stepWorld`가 **최상단에서 조기 return**(`world.ts:1412-1427`). 픽은 `SPECIAL_POWERUP_PICK`을 실은 그 틱에 적용된다.
- **3택 구조**: `drawPowerupChoices`(`powerups.ts:485-527`) — 정수 가중 무복원 추첨.
- **필터 계약(중요)**: 오프빌드·오프모드·미장착 슬롯·의뢰 봉인 계열은 **pool 진입 자체를 막는다**(`powerups.ts:491-502`). 항목만 append하고 필터를 안 넣으면 **가중 총합이 바뀌어 같은 시드에서도 뽑히는 파워업이 통째로 달라진다**.
- **강화 폭 상한**: 피해 배율은 어떤 파워업이든 **최대 +10%**, 그 외는 기준값의 5~15%. `tests/powerupMagnitude.test.ts`가 전수 기계 검증(`powerups.ts:13-21`).
- ③ 훅으로서: 24/25번이 **"신규 상태 0으로 액티브를 강화한 모범 사례"**다 — `skillInvest` 계열 투자를 올리면 위력·쿨다운이 파생으로 따라온다. 210종 설계 시 이 패턴이 가장 싸다.

---

## 7. 적

| # | 요소 | ① | ② | ③ |
|---|---|---|---|---|
| 7.1 | 패턴 엔진 | 이동 컴포넌트 × 공격 컴포넌트 조합(데이터 주도) | `src/sim/patterns/types.ts` + `index.ts` | 적 `vx/vy`는 이동 컴포넌트가 **매 틱 대입으로 덮어쓴다** → 넉백을 속도에 실으면 다음 틱에 흔적 없이 사라지고 **화면상 아무 일 없는데 그 틱 해시만 갈린다**(`world.ts:2278-2283`). 넉백은 반드시 **좌표 직접 변위** |
| 7.2 | 엘리트 어픽스 8종 | 0 분열 / 1 가속 / 2 자기장 / 3 완강 / 4 재생 / 5 보호막(받는 피해 절반) / 6 폭발성 / 7 광폭 | `src/sim/elite.ts:18-27` | 어픽스는 **`pierce` 필드에 `affixCode+1`로 저장**(0=일반). 적의 `pierce`는 이미 점유됨 |
| 7.3 | 보스 | 3페이즈 + 과열 창(`iframes>0` 동안 **받는 피해 2배**) | `src/sim/boss.ts`, `entities.ts:430-440`, 배수 `world.ts:3537` | 보스 `iframes`는 무적이 아니라 **취약**이다. 무적 재활용 불가 — 추격 모드 무적 포식자가 `aux0`로 따로 판정하는 이유(`world.ts:3529-3534`) |
| 7.4 | 보스 진행도 | 보스 등장까지 남은 진행도 파생 | `src/sim/bossProgress.ts` | 순수 파생 — 해시 미접 |
| 7.5 | 편대(formation) | 침공 L1 리더 + 편대원. `aux0`=카탈로그 id, `aux1`=진형 진행 틱 | `entities.ts:43-44`, `src/sim/invasion/formation.ts` | 편대 좌표는 **창 중심 기준**이고 플레이어 좌표에 의존하지 않는 것이 파일 계약 |
| 7.6 | 소환(해츨링 brood) | 누적 처치가 임계를 넘으면 병아리 드론 1기 출격(동시 4기 상한) | `world.ts:2244-2273` `stepHatchBrood` | **RNG 미소비**가 계약(고정 4방향 배치). `spawnEnemy`는 `waveRng`를 소비해 결정론을 깨므로 아군 소환에 절대 쓰면 안 된다. 상한은 `BROOD_MARK`만 세고 `DRONE_MARK`(드론베이·센트리)와 공유하지 않는다 |
| 7.7 | 적탄 4종 | BK_ACCEL(가감속) / BK_HOMING(락 만료 후 직진) / BK_CURVE(곡사) / BK_SPLIT(퓨즈 후 분열) | `src/sim/bullets.ts:32-38`, 필드 매핑 `bullets.ts:14-21` | 적탄이 `enemyType`·`maxHp`·`targetX`·`targetY`·`timer`·`phase` **6칸을 이미 전부 점유**했다. 적탄에 새 축을 얹을 자리가 없다 |
| 7.8 | 탄 소거 | 반경 내 적탄 `dead=true` | 공용 헬퍼 `activeTypes.ts:154` `clearEnemyBullets`; 다른 소거 경로 4개: 대시 잔상(`world.ts:1940`), 캡스톤 레이저(`world.ts:2719`), 폭탄기믹, 위상전환막(전체 소거 `world.ts:3925`) | 소거는 **부수효과만·반환 없음**. 소거 수를 세어 보상을 주려면 반환값이 필요한데 그러면 헬퍼 시그니처가 바뀐다(0c 동결 대상) |
| 7.9 | 탄 상한 | 세그먼트별 `bulletCap` 300→2000 | `data/waves.ts:317-327`, `world.ts:883-886` | 적탄 대량 생성 스킬(반사·전환)은 이 상한을 존중해야 프레임이 산다 |

---

## 8. 지형·환경

| # | 요소 | ① | ② | ③ |
|---|---|---|---|---|
| 8.1 | 벽 | AABB. `radius`=halfW, `targetX`=halfH가 **단일 정본** | `entities.ts:355-362` `spawnWall` | 이동슬라이드·LOS·창클램프가 전부 이 2필드를 읽는다. 병렬 half-extent 필드 신설 금지 |
| 8.2 | 파괴가능 벽 | `hp>0` 자체가 파괴가능 표식 — **별도 kind 없음** | `entities.ts:370-382` `spawnBreakableWall` | 신규 kind를 안 만든 덕에 이동차단·창클램프·LOS·압사 기하가 전부 공짜. 스킬이 벽을 만들 때 이 선례를 따르는 게 가장 싸다 |
| 8.3 | destructible | 부수면 젬 드랍, 이동은 통과 | `entities.ts:385-401` | 모드 목표 판정은 `src/sim/modes/objective.ts` **한 곳에서만**(같은 술어를 여러 곳에 적어 화면과 규칙이 갈린 결함 이력) |
| 8.4 | 해저드 3종 | 0 박격(mortar) / 1 용암(lava) / 2 감속장판(slow) | `patterns/types.ts:28-34`, 진행 `world.ts:3345`, 활성 술어 `world.ts:3368` `hazardActive` | `life<0` = 영구 지형 해저드(청크 컬링으로만 소멸). 감속장판만 **무적 무관**으로 감속을 건다(`world.ts:3730-3738`) |
| 8.5 | 청크 절차 생성 | 좌표별 순수 RNG로 기믹 배치, 청크 단위 all-or-nothing | `world.ts:1712-1780` `activateChunks`, `src/sim/chunks.ts` | 활성 기믹 상한 `MAX_ACTIVE_GIMMICKS`(48). 스킬 소환물이 `isGimmick`에 걸리면 **컬링에 잘리고 상한을 잡아먹는데 조용히 일어나 "가끔 안 나온다"로만 관측된다**(`world.ts:2235-2237`) |
| 8.6 | 행성 모드 6종 | vampire 0 / blockBreak 1 / racing 2 / chase 3 / shrink 4 / contamination 5 | `src/sim/planetMode.ts`, 구현 `src/sim/modes/*` | **모드가 바꿔도 되는 것은 환경뿐**(`modes/AGENTS.md`). 아이템·스킬·드랍은 모드가 안 건드린다. 파워업 풀에 모드 문맥 선택지 소수 섞는 것까지가 한계 |
| 8.7 | 대피소(shelter) | 추격 모드. 전량 확보하면 무적 포식자가 취약화(`boss.aux0=1`) | `entities.ts:488-494`, `src/sim/modes/chase.ts`, 판정 `world.ts:1638-1641` | inert 오브젝트(충돌·격자·컬링 어디에도 없음). `aux0`=대피소 인덱스 |
| 8.8 | 조우 프레임워크 | 런당 최대 1회 opt-in 희귀 이벤트(≈2%) 5종: treasureVault(워프) / oscarAltar(3택 도박) / sealedGuardian / shardRain / ghostConvoy | `data/encounters.ts:104-109`, `src/sim/encounter.ts`, 경량 4종 `src/sim/encounters/light.ts` | **detour는 `stepWorld` 최상단 단일 분기**(`world.ts:1445-1449`) — 산발 `if (!inDetour)` 게이트 금지가 명시 계약. 경량 4종은 상태를 **정수 1개(`rt.aux`)에 비트 패킹**(`light.ts:32-44`), RNG 0회 소비. `EncounterRuntime`에 필드 추가 금지 |
| 8.9 | 에코 신호 | 시드 파생 ≈3% 서사 이벤트, 반경 체류로 안정화 | `src/sim/echo.ts`, 호출 `world.ts:1588` | 조우의 원형. `echoRuntime` 존재 시에만 조건부 해시 폴드 |
| 8.10 | 오염 셀(톡사르) | 오염 노드가 결정론 확산으로 오염 셀을 뿌리고, 노드 파괴가 정화로 되돌린다 | `src/sim/modes/contamination.ts`, 호출 `world.ts:1614-1617` | **확산과 정화는 한 쌍**이다 — 정화가 없으면 오염이 단조 증가라 "되돌릴 수 없는 숨은 카운트다운"이 된다(과거 사용자 신고) |
| 8.11 | 중반 격전 | 모드가 아니라 **매 런 확정 등장하는 구조 비트**(ADR-0032). 리더 처치가 게이트 | `src/sim/modes/midClash.ts`, `data/waves.ts:322` | `killGoal:0` 세그먼트 |

---

## 9. 액티브 스킬 공용 헬퍼 + aux 인코딩 계약

### 9.1 발동 엔진

`src/sim/actives.ts:146-181` `stepActives`. 호출 위치는 `world.ts:1548` — **`stepPlayer` 직후가 계약**이다. 프리즈·detour 분기가 위에서 조기 return하므로 **플래그 하나 없이** 프리즈 중 z/x가 구조적으로 버려진다(AC-8·AC-9). 위로 옮기면 즉시 깨진다.

- 입력 비트: `SPECIAL_ACTIVE_SLOT1 = 1<<9`, `SLOT2 = 1<<10` (`data/inputBits.ts:33-35`), 키 z/x (`src/input/controller.ts:55-59`)
- **쿨다운 중 재입력은 무시**(큐잉 금지, AC-2)
- 런타임 상태는 `WorldState` 평평한 정수 4개: `activeCd0/Cd1/Buff0/Buff1` (`world.ts:1054-1061`)
- 해시: 넷이 **전부 0이면 한 폴드도 실행 안 함**. 하나라도 0이 아니면 **넷 전부** 고정폭 폴드(부분 폴드 금지)

### 9.2 작성자 분리(0c 계약 — 어기면 검증이 항진)

> **공통 발동 코드는 쿨다운 2개만 세운다. 버프 잔여 틱 2개는 핸들러가 세운다.** 공통 코드는 감소만.

이걸 어기면 `buffTicks` 관측량 단언이 핸들러 본문과 무관하게 참이 되어 배선 전수 테스트 ②가 항진이 된다.

### 9.3 공용 헬퍼 5개 (`src/sim/activeTypes.ts`)

| 헬퍼 | 위치 | 시그니처·계약 |
|---|---|---|
| `fanStrike` | `:72-104` | 부채꼴 탄막. `state.weapon`의 speed/radius/life를 centi 배율로 스케일해 재사용. 관측량 = **투사체 개수** |
| `blink` | `:110-125` | 즉시 변위 + 벽 슬라이드. 관측량 = **좌표 변화**. 대시와 달리 순간이동 |
| `setBuffTicks` | `:131-134` | 슬롯 버프 잔여 틱 설정. **핸들러 전용** |
| `blastDamage` | `:137-151` | 반경 내 enemy·boss에게 즉시 피해 |
| `clearEnemyBullets` | `:154-162` | 반경 내 적탄 소거 |
| 보조 | `powerCentiOf`(`:59`) / `scaleCenti`(`:64`) | centi 정수 배율 — **부동소수 금지** |

**⚠️ 위력 배율의 도달 범위는 42종이 아니라 17종이다**(`data/ships/actives/index.ts:130-139`): `strike` 14종의 `coeff.damage` + buff 3종의 만료 훅뿐. **이동거리·버프지속·무적·충전·흡수량은 투자에 불변**. `tests/activeSkillPowerScope.test.ts`가 이 범위를 잠근다.

- 쿨다운: `max(18, baseCooldown − floor(inv/4)*2)` 정수 전용
- 위력: `100 + inv*2` centi
- 3결 한정: `strike` / `dash` / `buff` — **그 외 kind를 만들지 않는다**(AC-3). 210종 설계 시 이게 가장 큰 구조적 제약이다
- 훅 3종: 발동 핸들러 / `SUSTAIN`(지속 매 틱) / `EXPIRE`(만료 틱 1회)

### 9.4 aux0/aux1 인코딩 계약

정본 표는 `world.ts:1992-1998`. (⚠️ **문서 상호참조가 낡았다** — `activeTypes.ts:22`·`data/ships/actives/types.ts` 등이 "world.ts:1721-1731"을 가리키지만 그 줄은 현재 청크 코드다.)

```
브루저     aux0 = 장갑 스택(0..8)                      aux1 = 마지막 피격 이후 경과 틱
아크캐스터 aux0 = 연속 정지 틱(0..600)                 aux1 = 미사용(0)
팬텀       aux0 = 연속 무피격 틱(0..359)               aux1 = 은신 해제 첫 타 토큰(0/1)
해츨링     aux0 = 마지막 출격 시점 state.kills 스냅샷  aux1 = 미사용(0)
말로우     aux0 = 적립된 지연 피해(비음 정수)          aux1 = 연속 무피격 틱
버블       aux0 = 남은 막 내구(0..FILM_ABSORB_FLAT)    aux1 = 마지막 파열 이후 경과 틱
스트라이커 — 시그니처 없음. aux를 읽지도 쓰지도 않는다(이것이 설계)
```

**③ 제약**:
- `aux0/aux1`은 **정수 전용** — `hashU32(ToUint32)`로 접히므로 소수부가 조용히 사라진다
- 한 런에 시그니처는 정확히 **하나**(`state.sigBit` 정규화, `world.ts:2033-2040`). 과거 별칭 버그로 침공에서 자기강화 위조가 accept된 이력
- 42종 액티브가 **이 6쌍의 의미를 비트는 것**으로 개성을 만든다. 즉 210종 신규 스킬도 **기존 6쌍의 의미 안에서** 설계하는 게 가장 싸고, 벗어나면 `WorldState` 평평 정수 신설 → 조건부 폴드 설계가 필요
- `Entity`에 새 필드를 넣는 것은 **금지에 가깝다** — `ENTITY_HASH_LAYOUT`이 바뀌어 조건부 폴드 중립화가 **원리적으로 불가능**해진다(`world.ts:1040-1043`)

---

## 10. 버프/디버프 상태 구조 — "기존 틀이 있는가"

**결론: 범용 시간제 상태 시스템은 없다.** 대신 **5가지 재활용 관용구**가 선례로 굳어져 있다.

| 관용구 | 대상 | 예 | 위치 |
|---|---|---|---|
| ① `WorldState` 평평한 정수 | 플레이어/월드 | `playerSlowTicks`·`magnetBuffTicks`·`activeBuff0/1`·`invasion3Bombs` | `world.ts:925,930,1059-1061` |
| ② `Entity` 미사용 필드 재활용 | 적 | 화염=`iframes`+`dashCooldown`, 냉기=`ownerId` | `status.ts:16-21` |
| ③ `aux0/aux1` | 플레이어(시그니처) | 위 9.4 표 | `world.ts:1992-1998` |
| ④ 플레이어 미사용 필드 | 플레이어 | `targetX`=캡스톤 소진 표식, `targetY`=위상전환막 쿨다운, `timer`=보조무기 사이클, `phase`=과열 스택 | `world.ts:3862`,`1915`,`2725`,`3607` |
| ⑤ 센티넬 마커 | 소속 판정 | `ownerId`에 `MISSILE_MARK`/`SPLIT_FRAGMENT_MARK`/`DRONE_MARK`/`BROOD_MARK`/`RACING_WALL_MARK` | `world.ts:2497` 등, 규율 `CONTEXT.md` |

**③ 훅 제약(가장 중요한 결론)**: 플레이어 필드 슬롯이 **사실상 포화**다 — `timer`·`phase`·`targetX`·`targetY`·`aux0`·`aux1`·`iframes`·`dashCooldown`·`cooldown`이 전부 점유됐다. 210종 스킬이 각자 상태를 요구하면 **범용 상태 배열이 필요하고 그건 신규 시스템**이다. 설계 대안 두 가지:
- (a) 스킬 상태를 `activeBuff0/1` 잔여 틱 + `SUSTAIN` 훅으로만 표현(현행 42종이 하는 방식) → 상태 0
- (b) `WorldState`에 고정 폭 정수 배열 1개를 추가하고 **전부 0이면 무폴드** 조건부 꼬리 폴드 설계 → 기존 골든 바이트 불변 유지 가능

---

## 11. 기타

| # | 요소 | ① | ② | ③ |
|---|---|---|---|---|
| 11.1 | 촉매 | 런 1회 소모품. sim 내부 4축 배율(`drop`·`rarity`·`xp`·`resource`) ≥ 1 | `src/sim/catalystMods.ts:31-90`, `config.catalysts` `world.ts:693` | `createWorld`가 한 번 해석해 `state.catalystMods`에 싣는 **단일 정본**(배선 누락 방어). 침공은 항상 `[]`(PvE 전용). 순수 파생이라 해시 미접 |
| 11.2 | 스토리/사연 카운터 | `hitsTaken`·`overchargeKills`·`cloakBreaks`·`broodLaunches`·`cushionHealed`·`filmPops` | `world.ts:1022-1038` | **`hashWorld`가 절대 접지 않는다**(순수 메타). 스킬 발동 관측을 새로 세려면 여기가 안전한 자리 |
| 11.3 | 침공에서 액티브 적용 범위 | `activeSlots`는 `buildRunConfig`가 무조건 스탬프하므로 **침공에서도 액티브가 발동한다** | `src/run/runConfig.ts:247-254,303` | 단, **팬텀 시그니처는 침공에서 통째로 비활성**(`world.ts:2104`) — 억제(대가)를 걸 수 없는데 배율(이득)만 남으면 공짜로 강해지기 때문. 버블 파열은 게이트 안 함(근거 `world.ts:2288-2295`). **신규 스킬도 "침공에서 대가를 걸 수 있는가"를 반드시 판정해야 한다** — 못 걸면 게이트 |
| 11.4 | 오토파일럿 | 순수 결정론 입력 봇 | `src/sim/autopilot.ts` | **⚠️ 오토파일럿은 액티브를 절대 안 누른다.** 전 분기가 `special: SPECIAL_NONE`이고 `dash: false`다(`autopilot.ts:79-174`, 예외는 파워업 픽 `packPowerupPick(0)` 하나). 즉 **210종 스킬은 벤치·밸런스 하네스·회귀 런에서 한 번도 발동되지 않는다** — 밸런스 자동 측정을 하려면 오토파일럿에 발동 정책을 새로 넣어야 하고, 그 순간 기존 벤치 골든이 전부 갈린다 |
| 11.5 | 의뢰 제약 계약 | 봉인된 파워업 계열은 3택 pool 진입 자체를 막는다 | `powerups.ts:502` `commissionBansPowerupLine` | **위반 처리기를 만들지 마라** — 제약은 위반이 원천 불가능한 축만 쓴다 |
| 11.6 | 오염 런(tainted) | 치트·하네스 개입 표식 | `world.ts:1095` `markTainted` | 거동·해시 무영향. 하네스로 스킬을 테스트하면 그 런은 정산·제출에서 제외 |

---

# 스킬 훅으로 쓰기 좋은 상위 20개 — 난이도 3단 분류

## A. 기존 틀 재사용 (신규 상태 0 · 해시 폴드 0) — 즉시 가능

| 순위 | 훅 | 재사용할 틀 |
|---|---|---|
| 1 | **`fanStrike` 계수 조합** | 탄수·피해·확산각·관통·탄속·반경 6축이 이미 파라미터화(`activeTypes.ts:72`). strike 계열 수십 종이 데이터만으로 나온다 |
| 2 | **`blink` 거리·단수** | 단을 쪼개면 벽 슬라이드가 단마다 걸림(스트라이커 2단 도약 선례). 거리·단수·중간 효과 조합 |
| 3 | **`blastDamage` + `clearEnemyBullets`** | 반경·피해 2축. 폭발·정화형 |
| 4 | **`aux0/aux1` 의미 비틀기 (6기체 × 2칸)** | 42종이 정확히 이걸 한다 — 충전/소각/고정/주입/청산/부채화. **가장 생산적인 축** |
| 5 | **`SUSTAIN`/`EXPIRE` 훅** | "지속 중 매 틱" + "끝나는 순간 폭발/회복". 브루저 fortify_hi·버블 film_hi·스트라이커 survival_hi가 선례 |
| 6 | **`refreshIframes` 패턴** | 매 틱 iframes 재설정 = 지속 무적. 무적을 자원화하는 계열 |
| 7 | **`state.weapon` 읽는 시점 배율** | `subDamage`/`subCooldown` 선례(`world.ts:2798`,`2825`). 원복 책임 없이 일시 강화 |
| 8 | **`turretPickup` + 신규 마커** | 자동조준·사격·수명·컬링제외·렌더가 전부 공짜. 소환 계열의 유일한 저비용 경로 |
| 9 | **`state.kills` 델타** | 처치 집계가 `compact()` 한 곳으로 수렴 — 훅 누락이 원리적으로 불가 |
| 10 | **파워업 계열 투자 +N (idx 24/25 패턴)** | 위력·쿨다운·가중이 전부 `skillInvest`에서 파생. 신규 필드 0으로 강화를 표현 |
| 11 | **원소 3종 부여 재사용** | `applyBurn`/`applySlow`/`applyChain`이 이미 leaf 순수 함수 |
| 12 | **엘리트 어픽스·보스 과열 창 읽기** | `eliteAffix`·`iframes>0` 술어를 조건으로 쓰는 상황 반응형 |

## B. 신규 상태 필요 (조건부 해시 폴드 설계 — 중간 비용)

| 순위 | 훅 | 필요한 것 |
|---|---|---|
| 13 | **크리티컬** | 결정론 크리(N번째 확정)면 카운터 1개. 확률 크리면 **새 RNG fork 필수**(공통-B) + 해시 폴드 |
| 14 | **적 대상 4번째 디버프 축** | 적 필드 포화(`iframes`/`dashCooldown`/`ownerId`/`pierce` 점유). `aux0/aux1`로 가면 9.4 계약과 충돌 → 적 aux 인코딩 표를 새로 정의해야 함 |
| 15 | **플레이어 범용 버프 슬롯 확장** | `WorldState` 고정폭 정수 배열 + "전부 0이면 무폴드" 꼬리 폴드. 210종이면 사실상 필수 |
| 16 | **콤보를 피해축에 연결** | `comboMultiplier`는 XP에만 걸림. 배선 추가 + 밸런스 재측정 |
| 17 | **회복 오브젝트 kind** | `KIND_CODE` 32부터 append(30/31 재사용 금지). 스폰·컬링·픽업 반경 배선 |
| 18 | **모드별 스킬 변주** | `planetMode` 게이트는 이미 있으나 "모드는 환경만 바꾼다" 규율(`modes/AGENTS.md`)과 충돌 — ADR 개정이 필요 |

## C. 신규 시스템 필요 (구조 변경 — 높은 비용)

| 순위 | 훅 | 왜 무거운가 |
|---|---|---|
| 19 | **그레이징** | sim에 판정·상태·보상이 **전무**(렌더 연출뿐). 탄별 근접 판정을 sim으로 내리면 틱당 O(탄수) 비용 + 신규 카운터 + 해시 폴드. 대신 체감 보상이 가장 큰 축 |
| 20 | **4번째 `ActiveKind`(설치물·소환물·지속장판)** | ADR-0041이 3결(`strike`/`dash`/`buff`)로 **한정**하고 Non-Goal ①이 설치물·소환물을 명시 금지. `OBSERVABLE_BY_KIND` 대응 전수 테스트·배선 전수 테스트 ①②③가 전부 3결 위에 서 있어 ADR + 테스트 3종 + 관측량 축을 함께 개정해야 한다 |
| (+) | **오토파일럿 스킬 발동 정책** | 위 11.4. 넣는 순간 벤치·밸런스·회귀 골든이 전량 재생성 대상. 하지만 **넣지 않으면 210종의 밸런스를 자동으로 잴 수단이 없다** — 210종 설계의 실질적 선결 과제 |

---

## 설계 시 반드시 먼저 읽어야 할 문서

- `docs/adr/0041-active-skills-ship-type-exclusive-player-only.md` — 3결 한정·위력 적용 범위·Non-Goal
- `docs/adr/0005-deterministic-replay-verification.md` — 결정론 계약
- `docs/adr/0010-small-hitbox-generous-dodge.md` — 판정점 철학
- `docs/adr/0034-scroll-anchor-policy.md` — ANCHOR/WORLD
- `docs/adr/0049-skill-rebuild-flat-unique-mechanics.md` — 이번 재구축 결정
- `src/sim/AGENTS.md` — 처리 순서·RNG fork·해시 규율
