# Planet Blitz — M2 파밍 루프 구현 계획

- 상태: **draft (검토 대기)**
- 생성: 2026-07-15 (Planner, 마스터 플랜 §2 상세화)
- 근거 문서: [마스터 플랜](./planet-blitz-master-plan.md) §2, [GDD](../../docs/GDD.md) §3·§5·§6, [ADR-0003](../../docs/adr/0003-copy-loot-no-defender-loss.md)·[ADR-0005](../../docs/adr/0005-deterministic-replay-verification.md), [몹 패턴 스펙](../specs/deep-interview-enemy-patterns-difficulty.md), [재미 요소 스펙](../specs/deep-interview-fun-factors.md)
- 전제(선행 완료): **M1 전투 프로토타입** + **무한 스크롤 맵/2배 스케일/기믹/청크**([scroll-map 계획](./planet-blitz-scroll-map-plan.md)) 머지 완료. 본 계획의 모든 좌표·스폰·엔티티 작업은 무한 맵·플레이어 상대 스폰·`KIND_CODE` 9+·flat `Entity` 구조 위에 쌓인다.
- 대상 브랜치(제안): `feat/m2-farming-loop` (마일스톤당 1~5 PR 분할)

---

## 1. 요구사항 요약

목표(마스터 §2): **"런 → 드랍 → 장착 → 다음 런이 쉬워짐"의 디아2 도파민 사이클 완성.** 범위:

1. **아이템 데이터 모델** — 등급 4단계(노말/매직/레어/유니크), 어픽스 풀(접두 12+접미 12), 롤 규칙(매직 1~2, 레어 3~6), 버전 필드 포함 직렬화 스키마.
2. **로컬 세이브** — localStorage 프로필(기체 레벨·인벤·창고·행성 진행), 마이그레이션 가능 스키마(M4 Supabase 이관 대비).
3. **드랍 시스템** — 엘리트·보스 바닥 드랍(등급색 빔, 접촉 자동 획득), 보스 처치 확정 고등급, 잡몹은 자원·젬만.
4. **장비 시스템** — 8칸 장착 → 시뮬 스탯 파이프라인. **주무기 3타입**(발칸 + 스프레드 + 레일건) + 보조무기 2종.
5. **인벤토리 UI** — DOM 그리드 인벤 48 + 창고 96(확장 2회), 일괄 분해, 툴팁·비교.
6. **유니크** — 15점 중 5점(고유 효과가 시뮬에 훅).
7. **행성 2개 체제** — 베르단 추가(잡몹 4종·엘리트 2종·여왕 보스), 행성 선택 화면(성계 지도 초기판), 행성별 드랍 테이블·특산 광물 2종.
8. **티어 시스템** — 정찰/교전 2티어(섬멸은 M3), 패턴 진화(교전=서브탄), **엘리트 어픽스** 8종 중 4종 + 교전 1개 부여 규칙.
9. **재미 요소** — 변칙 경보 3종(중력 폭풍·군체 대발생·암흑 성운), 유니크 세리머니(슬로모+플래시 — 렌더 전용).
10. **기체 레벨** — 경험치 누적·레벨업(~Lv40 기준, 캡은 열어둠), 스킬 포인트 적립만(트리는 M3).

**비범위**: 스킬트리(M3)·리롤(M3)·섬멸 티어(M3)·행성 3~5(M3)·Supabase/PvP(M4)·퇴역/계보(M5)·사운드(M5 폴리시).

---

## 2. 설계 원칙 + 핵심 결정 갈림길

### 설계 원칙
1. **결정론은 절대 조건(ADR-0005 승계)**: 드랍·아이템 롤·변칙·엘리트 어픽스 부여는 전부 시드 RNG 파생. `Math.random`/`Date.now`/플랫폼 trig 금지 lint(`src/sim/`)를 신규 코드에 그대로 적용. 신규 state/weapon 필드는 `hashWorld`(`replay.ts:96-156`)에 **append-only**, 신규 kind는 `KIND_CODE` 14+ append(1~13 불변, `entities.ts:35-50`).
2. **런 입력 = [시드 + 입력로그 + 로드아웃 + 변칙]**: 장착 장비가 런 결과를 바꾸므로 **로드아웃 스냅샷을 `Replay.config`에 포함**해 서버 재실행이 동일 결과를 재현(검증 유효성 유지). 세이브(localStorage)는 sim 밖 렌더/메타 계층.
3. **아이템 생성 = 순수 함수**: 드랍이 나르는 것은 아이템 실체가 아니라 **드랍 시드 + 등급 + 출처(행성/티어)**. 아이템 어픽스 확정은 `rollItem(dropSeed, rarity, source)` 순수 함수(클라이언트·Edge Function 공용)로 사후 재현. 검증 재실행이 같은 시드에서 같은 아이템을 낳는다.
4. **데이터 주도 확장**: 베르단 로스터·어픽스·유니크·드랍 테이블은 `data/*.ts` 행 추가로 흡수(코드 아닌 데이터 작업화 — 마스터 리스크 톱2 완화). 패턴 엔진(`src/sim/patterns/`)·웨이브 디렉터(`src/sim/waves.ts`)는 골격 유지.
5. **UI/시뮬 분리**: 인벤·툴팁·세리머니·성계 지도는 DOM 오버레이(`src/ui/`)·렌더 계층 전용. 시뮬 결과에 무영향.

### 핵심 결정 갈림길

#### ① 드랍→아이템의 결정론 경계 (어디서 아이템을 확정하나)
| 옵션 | Pros | Cons |
|---|---|---|
| **A. 시뮬은 드랍 시드만 방출, 아이템은 공용 순수 함수 `rollItem`로 사후 확정 ★채택** | sim 상태 비대화 없음, 서버 검증이 같은 시드→같은 아이템 재현, 어픽스 풀 확장이 sim 해시 레이아웃 불변 | 드랍 시드 생성·전달 규약 필요 |
| B. 시뮬 안에서 아이템 전체를 굴려 엔티티/상태에 실음 | 단일 위치 | `Entity` flat 구조에 어픽스 배열 안 맞음(해시 레이아웃 파손), sim 비대화, 어픽스 풀 변경마다 해시 위험 |
| C. 클라이언트에서만 `Math.random`으로 롤 | 단순 | ADR-0005 위배(서버 재현 불가 → 위조 가능) — **기각 필수** |

**채택 A 근거**: `Entity`는 어픽스 배열 같은 가변 길이 데이터를 담기에 부적합(해시는 고정 필드 순회, `replay.ts:64-90`). 드랍은 **드랍 시드(u32)를 나르는 이벤트**로 방출하고, 정산에서 `rollItem`(공용 순수 모듈 `src/items/roll.ts`)이 어픽스를 확정. Edge Function도 같은 `roll.ts`를 import해 재현. C는 위조 가능이라 ADR-0005 정면 위배로 기각, B는 해시 레이아웃 리스크로 기각.

#### ② 로드아웃이 런에 반영되는 지점
| 옵션 | Pros | Cons |
|---|---|---|
| **A. 로드아웃 → 파생 스탯 계산 → `WorldConfig`/초기 `WeaponStats`에 주입, `Replay.config`에 포함 ★채택** | 서버가 config 재사용해 재현, 기존 config 해시 필드(`replay.ts:106-125`) 확장으로 흡수, 파워업이 이미 config/weapon 변형 훅 재사용 | config 스키마 확장·해시 append 필요 |
| B. 런 중 매 틱 장비 스탯 재계산 | 실시간 반영 | 불필요(런 중 장비 안 바뀜), 비용·복잡도↑ |
| C. 장비 스탯을 sim 밖에서만 적용(렌더 표시) | 단순 | 시뮬 결과 미반영 → "강해짐" 체감 소멸, 검증 무의미 |

**채택 A 근거**: 파워업이 이미 `state.weapon`·`state.config`를 결정론적으로 변형(`powerups.ts:34-108`)하므로, 장비 파생 스탯을 **런 시작 시 1회** 같은 필드에 주입하면 자연 정합. 로드아웃 파생 스탯을 `Replay.config`(→ `hashWorld` cfg 필드)에 포함해 서버 재현. B는 과설계, C는 핵심 목표(강해짐 체감) 상실로 기각.

#### ③ 주무기 3타입의 발사 로직 구조
| 옵션 | Pros | Cons |
|---|---|---|
| **A. `WeaponStats`에 `weaponType` 필드 + `autoAttack`를 타입별 발사 분기 ★채택** | 최소 침습, 기존 fanned volley(`world.ts:642-671`) = 발칸 케이스로 흡수, M3 5타입 확장 여지 | `autoAttack` 분기 추가 |
| B. 무기별 전략 객체(다형성) | 확장성 | 결정론 순서·해시 필드 관리 복잡, 오버엔지니어링(3타입뿐) |
| C. 파워업처럼 무기 타입도 데이터 apply | 통일성 | 발사 궤적 로직은 apply로 표현 부적합 |

**채택 A 근거**: 현 `autoAttack`은 부채꼴 볼리 하드코딩. `weaponType`(0=발칸 연사, 1=스프레드 광각 다탄, 2=레일건 관통 고속 단발)로 분기하면 3타입을 최소 변경으로 수용하고 M3의 미사일·빔(5타입 완성)은 분기 추가로 확장. `weaponType`은 u32로 `hashWorld` weapon 블록에 append. B/C는 3타입 규모에 과함/부적합으로 기각.

> **≥2 viable option 확보**: 세 갈림길 모두 실현 가능한 대안 2개 이상 유지. 각 채택안의 기각 근거 명시.

---

## 3. 수용 기준 (AC)

- [ ] **AC1 (아이템 모델)**: `rollItem(dropSeed, rarity, source)`가 동일 입력에 동일 아이템(등급·어픽스 목록·수치)을 반환 — 순수성 단위 테스트. 매직 어픽스 1~2, 레어 3~6 개수 규칙 준수.
- [ ] **AC2 (결정론·검증)**: 동일 [시드+입력+로드아웃+변칙] 2회 실행 시 틱별 해시 100% 일치 + **드랍 시드 시퀀스 동일** → 두 실행의 `rollItem` 결과 동일. `tests/determinism.test.ts` 확장, CI 게이트 유지.
- [ ] **AC3 (드랍)**: 엘리트·보스 처치 시 바닥 드랍 발생(등급색), 접촉 자동 획득. 보스 처치 시 확정 고등급(레어 이상) 1개. 잡몹은 젬/자원만(장비 0). — 단위 테스트.
- [ ] **AC4 (장비→스탯)**: 로드아웃 변경이 런 초기 `WeaponStats`/`WorldConfig`에 반영되고 서버 재현(config 해시 반영). 무기 3타입 각각 다른 발사(연사/광각/관통) — 타입별 단위 테스트.
- [ ] **AC5 (세이브)**: 프로필 저장·로드 왕복 무손실, `saveVersion` 필드 존재, 구버전→신버전 마이그레이션 함수 통과. localStorage 손상 시 안전 복구(기본 프로필).
- [ ] **AC6 (인벤/분해)**: 인벤 48 + 창고 96(확장 2회 = 창고 → 최대치), 일괄 분해가 노말·매직→크레딧, 레어+→광물로 정확 환산. 툴팁·장착중 비교 표시.
- [ ] **AC7 (유니크)**: 유니크 5점의 고유 효과가 시뮬에 실제 훅(로드아웃 반영 후 런 거동 변화 검증). 유니크 드랍 시 세리머니 발동(렌더 전용, sim 무영향).
- [ ] **AC8 (행성 2개)**: 베르단 잡몹 4종(역할 4슬롯)·엘리트 2종·여왕 보스 3페이즈 가동. 성계 지도에서 카르곤/베르단 선택 → 각 드랍 테이블·특산 광물 반영.
- [ ] **AC9 (티어)**: 정찰/교전 선택 가능(교전 = 서브탄 추가 패턴 진화 + 드랍 상향). 교전 엘리트에 어픽스 1개 부여(시드 RNG), 명판 표시.
- [ ] **AC10 (변칙 경보)**: 런 시작 ~25% 확률 제안(시드 RNG), 수락 시 3종 효과(중력 폭풍 탄속↓·드랍↑ / 군체 대발생 적×2·약체 / 암흑 성운 시야↓·유니크↑) 반영. 수락·거부 런의 정산 차이 재현.
- [ ] **AC11 (레벨)**: 경험치 누적·레벨업, 스킬 포인트 적립(사용은 M3). ~Lv40 구간 진행감.
- [ ] **AC12 (lint·회귀)**: `src/sim/` 금지 심볼 0건. 기존 테스트 전부 통과(의미 보존 갱신만).

---

## 4. 구현 단계

> Phase A→B→C 순, D~F는 A 완료 후 병행 가능, G는 전부 후. **각 태스크 후 `npm test` + `tsc --noEmit` 통과**.

### Phase A — 아이템·롤 코어 (공용 순수 모듈) · 의존: 없음
- **A1. 아이템 타입·직렬화** — 신규 `src/items/types.ts`
  - `Rarity`(normal/magic/rare/unique), `AffixDef`(id·계열·범위·스탯키), `Item`(id·slot·rarity·affixes[]·uniqueId?·source), `saveVersion` 상수. 슬롯 7종 8칸(GDD §5): main/sub/armor/shield/engine/core/module×2.
- **A2. 어픽스 풀 데이터** — 신규 `data/affixes.ts`
  - 접두 12·접미 12(GDD §5 예시: 피해+%, 발사체+1, 관통+1, 이동속도, 자석 반경, 경험치+%, 광물 발견율…). 각 어픽스는 `statKey` → 파생 스탯 파이프라인(A4)이 소비.
- **A3. 롤 순수 함수** — 신규 `src/items/roll.ts`
  - `rollItem(dropSeed: number, rarity, source): Item` — 내부에 **로컬 시드 RNG**(`SeededRng(dropSeed)`, `src/sim/rng.ts` 재사용) 사용, `Math.random` 금지. 매직 1~2·레어 3~6 개수, 접두/접미 배분, 수치 롤. **클라이언트·Edge Function 공용**(sim 코어 lint 규율 준수 — `roll.ts`도 순수 유지).
  - ⚠️ 검증 핵심: `rollItem`은 sim과 동일한 결정론 규율. 동일 `dropSeed`→bit-identical 아이템.
- **A4. 파생 스탯 파이프라인** — 신규 `src/items/loadout.ts`
  - `computeLoadoutStats(equipped: Item[]): { weapon: Partial<WeaponStats>, config: Partial<WorldConfig>, worldMods }` — 8칸 장비 어픽스를 합산해 무기/이동/HP/자석 등 파생. 주무기 타입(`weaponType`)·보조무기 효과 포함. 유니크 고유 효과 훅 포인트.

### Phase B — 시뮬 통합 (로드아웃·드랍·무기타입·변칙) · 의존: A
- **B1. `WeaponStats`/`WorldConfig` 확장 + 로드아웃 주입** — `src/sim/world.ts:128-204`, `createWorld:296`
  - `WeaponStats`에 `weaponType: number` append. `WorldConfig`에 로드아웃 파생 필드(추가 HP·이동배율 등) 또는 별도 `loadout` 블록 append. `createWorld(seed, config)`가 config의 로드아웃 파생 스탯을 초기 `weapon`/player에 적용.
  - `hashWorld`(`replay.ts:106-125`)에 신규 config·weapon 필드 append-only. `Replay.config`(`replay.ts:22-27`)에 로드아웃 스냅샷 포함.
- **B2. 무기 3타입 발사 분기** — `autoAttack`(`world.ts:642-671`)
  - `weaponType` 분기: 0=발칸(현 부채꼴 볼리 유지) / 1=스프레드(광각 다탄, `bulletCount`↑·`spread`↑) / 2=레일건(고속·고관통 단발, `pierce`↑·`bulletSpeed`↑·`fireCooldown`↑). 보조무기 2종은 별도 `subWeapon` 발사 훅(신규 함수, 결정론).
- **B3. 드랍 RNG 스트림 + 드랍 방출** — `world.ts` `createWorld`·`compact`(`world.ts:979-1011`)
  - `rng.fork('drops')` → `state.dropRng` 추가, `hashWorld`에 `dropRng.getState()` append(`replay.ts:99-103` 대칭). 엘리트/보스 처치 시(compact의 enemy/boss 분기 확장) **드랍 판정**(등급 추첨 = dropRng)·**드랍 시드 생성**(dropRng.next) → 바닥 드랍 엔티티(신규 kind `loot`, `KIND_CODE:14` append) 스폰. `loot` 엔티티는 `damage`에 드랍 시드, `enemyType`에 rarity 코드, 접촉 시 획득(정산에 드랍 시드·rarity·source 누적).
  - 잡몹은 기존 젬만(변경 없음). 보스는 확정 고등급 1개(dropRng로 rare/unique 결정).
- **B4. 엘리트 + 엘리트 어픽스** — `data/enemies.ts` 확장, `src/sim/patterns/` 훅, `src/sim/waves.ts`
  - 엘리트 = 잡몹 강화 변형(HP·명판). 교전 티어에서 엘리트에 **어픽스 1개** 부여(시드 RNG = waveRng 또는 신규 eliteRng, 8종 중 4종 구현: 분열하는·가속하는·자기장·완강한). 어픽스가 패턴/스탯 훅(예: 분열하는 = 사망 시 파편, 가속하는 = speed↑). 명판 표시는 스냅샷(`snapshot.ts`)에 어픽스 코드 전달.
- **B5. 변칙 경보** — `world.ts` `createWorld` + config, 신규 `src/sim/anomaly.ts`
  - 런 생성 시 anomalyRng(=`rng.fork('anomaly')`)로 ~25% 발동·종류 추첨. 수락 여부는 **런 시작 입력**(config 플래그 or 첫 입력 프레임 special 비트)으로 결정론 고정. 3종: 중력 폭풍(탄속×배율·드랍률↑), 군체 대발생(웨이브 maxEnemies×2·HP↓), 암흑 성운(시야는 렌더, 유니크 드랍률↑). config에 anomaly 필드 append + hash.

### Phase C — 세이브·메타 (localStorage) · 의존: A
- **C1. 프로필 스키마·저장소** — 신규 `src/save/profile.ts`
  - `Profile`(saveVersion·ships[]·inventory[]·stash[]·planetProgress·credits·minerals·skillPoints). `loadProfile()`/`saveProfile()` localStorage, `migrate(old)→new`. 손상 복구(try/catch → 기본 프로필). **sim 밖**(결정론 무관).
- **C2. 정산→세이브 연결** — `src/ui/resultOverlay.ts` + 신규 `src/save/settlement.ts`
  - 런 종료 시 누적 드랍(시드·rarity·source) → `rollItem`으로 아이템 확정 → 인벤 적재. 젬 XP → 기체 레벨/스킬포인트 적립. 사망 시 수거분 보존·보스 확정드랍만 상실(GDD §3, ADR-0003).

### Phase D — 인벤토리·장비 UI (DOM) · 의존: A,C
- **D1. 인벤/창고 그리드** — 신규 `src/ui/inventory.ts`
  - 48칸 인벤(6×8) + 96칸 창고(확장 2회, 크레딧). 아이템 1×1. 드래그/클릭 장착 → 8칸 슬롯. 장착 시 `computeLoadoutStats` 미리보기.
- **D2. 툴팁·비교·일괄 분해** — `src/ui/inventory.ts`
  - 아이템 툴팁(등급색·어픽스), 장착중 비교. 일괄 분해 UI: 노말·매직→크레딧, 레어+→광물(GDD §5). 인벤 가득 시 유도.
- **D3. 성계 지도(행성 선택)** — 신규 `src/ui/planetSelect.ts`
  - 카르곤/베르단 2개 + 티어(정찰/교전) 선택 → 런 시작 config(행성·티어·로드아웃·변칙) 구성. 초기판(M3에서 5행성·기지 맵 통합).

### Phase E — 베르단 행성 콘텐츠 · 의존: B
- **E1. 베르단 로스터** — 신규 `data/planets/berdan.ts` (또는 `data/enemies.ts` 확장)
  - 잡몹 4종(돌격·사수·특수·지원 역할 슬롯, 곤충 군체 테마), 엘리트 2종. `ENEMY_BY_TYPE`(`enemies.ts:89`) typeIndex append(카르곤 0~3 뒤 4~). 패턴은 기존 컴포넌트 엔진 데이터 조합.
- **E2. 여왕 보스** — 신규 `data/bosses/berdan-queen.ts`
  - 3페이즈(소환+포위 탄막), 과열 창·페이즈 전환 탄 소거(기존 `boss.ts` 구조 재사용, `data/boss.ts` LAVA_FORTRESS 패턴 승계). 무리개체 소환.
- **E3. 행성별 드랍 테이블·특산 광물** — `data/` 드랍 테이블
  - 행성×티어 드랍 테이블(등급 확률·특산 광물 2종). `rollItem`의 `source`가 소비.

### Phase F — 유니크 + 세리머니 · 의존: A,B
- **F1. 유니크 5점** — `data/uniques.ts` + `src/items/loadout.ts` 훅
  - 15점 중 5점 구현(예: "쌍둥이 항성" 스프레드 2배·피해-30%, GDD §5). 고유 효과가 `computeLoadoutStats`에서 시뮬 파라미터로 훅(무기 타입 변형·특수 거동). 나머지 10점은 M3.
- **F2. 유니크 세리머니(렌더 전용)** — `src/render/` + `src/ui/`
  - 유니크 드랍 순간 0.5초 슬로모+금빛 플래시(GDD §5, 렌더 계층 전용 — 시뮬 결과 무영향). `loot` 엔티티 rarity=unique 감지 시 발동.

### Phase G — 검증 · 의존: 전부
- **G1. 테스트 신설/갱신** — `tests/`
  - `tests/items.test.ts`(rollItem 순수성·개수 규칙 AC1), `tests/loadout.test.ts`(파생 스탯·3타입 AC4), `tests/drops.test.ts`(드랍 판정·확정드랍 AC3), `tests/anomaly.test.ts`(AC10), `tests/save.test.ts`(왕복·마이그레이션 AC5). 기존 8+파일 의미 보존.
- **G2. 결정론 CI 게이트** — `tests/determinism.test.ts` 확장: 로드아웃·변칙·드랍 시드 포함 2회 해시+드랍시퀀스 일치(AC2).
- **G3. 파밍 게이트 계측** — 정산 로그로 게이트 측정(§ M2 게이트).
- **G4. e2e·브라우저** — `.claude/launch.json` 프리뷰로 드랍→장착→다음 런 강해짐 육안.
- **G5. PR** — 분할 PR → 머지(전역 git 규칙).

**M2 게이트(마스터 §2)**: ①레어 드랍 시 장비 교체 고민 실제 발생(테스터 관찰) ②같은 행성 3연속 파밍 의욕 유지 ③결정론 테스트 통과(장비 스탯 반영 포함) ④변칙 수락/거부 런 정산 차이 재현.

---

## 5. 밸런스/튜닝 항목

| 항목 | 방향 |
|---|---|
| 등급별 드랍 확률(정찰/교전) | 교전이 상향, 레어 체감 빈도가 "고민" 유발하되 범람 안 하게 |
| 어픽스 수치 범위 | 접두/접미 min~max — 매직<레어 파워, 유니크 고정+고유 |
| 무기 3타입 밸런스 | 발칸(연사 기준선)/스프레드(광각 저피해)/레일건(단발 고피해 관통) 체감 차별 |
| 엘리트 HP·어픽스 강도 | HP 스펀지 금지(GDD §6), 어픽스가 위협·보상 동시 상향 |
| 변칙 3종 트레이드오프 | 중력폭풍 드랍+50%·군체 적×2·암흑 유니크×2 — 위험↔보상 균형 |
| 티어 배율 | 교전 HP ×2.2 수준(GDD §6, 완만), 드랍 상향 |
| 레벨 곡선(~Lv40) | `xpToNext`(`world.ts:113`) 재조정, 파밍 반복 유도 |
| 분해 환산율 | 노말·매직→크레딧, 레어+→광물 — 버리기가 손해 아닌 변환 |

> 전부 M2 재미 게이트 튜닝 루프 대상. 1차값은 GDD 초안·M1 값 승계.

---

## 6. 리스크와 완화

| 리스크 | 심각도 | 완화 |
|---|---|---|
| `rollItem` 클라이언트·서버 불일치(부동소수·정수 롤 차이) | 상 | sim 코어와 동일 `SeededRng`·정수 산술만. `roll.ts`를 순수·플랫폼 독립 유지, 결정론 단위 테스트를 CI 게이트로. |
| 로드아웃 config 확장이 리플레이 포맷 파손 | 중 | 의도된 포맷 버전 범프(M1 기록 재검증 불요). config·weapon·state 필드 append-only, `KIND_CODE` 14+ append. |
| `Entity` flat 구조에 아이템 데이터 부적합 | 중 | 드랍은 시드만 나름(옵션①A). 아이템 실체는 sim 밖 `Item`. 해시 레이아웃 불변. |
| 세이브 스키마 M4 이관 어려움 | 중 | `saveVersion` + `migrate` 처음부터. 필드명·구조를 서버 스키마(ADR-0002) 예상 형태에 정렬. |
| 변칙·엘리트 어픽스로 밸런스·성능 붕괴 | 중 | 변칙은 확률·수치 상수화, 군체 대발생은 웨이브 캡(`bulletCap`·maxEnemies) 존중해 60fps 유지. |
| 콘텐츠 제작량(베르단 로스터·어픽스·유니크) | 중 | 데이터 주도(원칙4) — `data/*.ts` 행 추가. 패턴 컴포넌트 엔진 재사용. |

---

## 7. 검증 단계

1. **단위/결정론**: `npm test` — items/loadout/drops/anomaly/save 신규 + 확장 determinism(AC2). 각 Phase 종료 시 전체 녹색.
2. **타입/린트**: `tsc --noEmit` + ESLint — `src/sim/` 금지 심볼 0(AC12). `src/items/roll.ts`·`loadout.ts` 순수성 확인.
3. **서버 재현 모의**: `rollItem` 동일 드랍 시드 2회 호출 bit-identical(M4 Edge Function 재현의 선행 확인).
4. **e2e**: 런 완주→드랍→정산→장착→재런 강해짐 사이클(브라우저 프리뷰).
5. **게이트 계측**: 테스터 관찰·정산 로그로 M2 게이트 4항목.
6. **회귀**: 기존 테스트 의미 보존 통과(AC12).

---

## 8. 오픈 퀘스천 (기본안 포함 — `.omc/plans/open-questions.md` 기록)

- **OQ-M2-1** `[실행중-기본안有]`: 드랍 `loot` 엔티티 접촉 자동 획득 vs 자석 흡수 — 기본안: 접촉 자동(젬과 동일 감각, 결정론 단순).
- **OQ-M2-2** `[실행중-기본안有]`: 보조무기 2종 = 독립 발사 슬롯 vs 주무기 변조 — 기본안: 독립 발사 슬롯(`subWeapon` 훅).
- **OQ-M2-3** `[실행중-기본안有]`: 변칙 수락 UI = 런 시작 전 화면 선택 vs 런 내 첫 프레임 — 기본안: 시작 전 선택 → config 플래그(결정론·리플레이 단순).
- **OQ-M2-4** `[실행중-기본안有]`: 엘리트 어픽스 부여 RNG = waveRng 재사용 vs 신규 eliteRng 스트림 — 기본안: 신규 `rng.fork('elite')`(웨이브 추첨과 독립, 해시 대칭).
- **OQ-M2-5** `[실행중-기본안有]`: 암흑 성운 "시야↓"를 시뮬에 반영할지 vs 렌더 전용 — 기본안: **렌더 전용**(시야는 검증 불필요, sim 결정론 표면 최소화). 유니크 드랍률↑만 sim.
- **OQ-M2-6** `[실행전-스코프]`: 유니크 5점 선정 목록 — 기본안: 무기 타입별 대표 + 범용 1(§F1). 착수 전 5점 확정 권장.
- **OQ-M2-7** `[실행중-기본안有]`: 스킬 포인트 적립만(M3 트리 대기) 시 UI 노출 여부 — 기본안: 적립 수치만 표시, 사용 UI는 M3.

---

## 변경 이력
- 2026-07-15 최초 작성 (마스터 §2 + scroll-map 완료 전제, M1 코드 기반)
