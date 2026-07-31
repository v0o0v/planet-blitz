# 액티브 스킬 장비 어픽스 — 조사·설계 기록 (2026-07-31, rev.3)

- 상태: **보류 (deferred)** — 착수하지 않는다. 구현 0줄.
- **이 파일이 유일한 기록이다.** ADR-0043 과 초안 계획(PR #216)은 **되돌렸다** —
  전체 재기획을 하기로 했으므로 "채택된 설계"가 main 에 남아 있으면 안 된다.
  다만 검토에서 나온 **기존 결함 2건은 이 기능과 무관하게 살아 있으므로**(§A) 남긴다.
- 선행 정본(유효): `docs/adr/0041-active-skills-ship-type-exclusive-player-only.md` ·
  `.omc/plans/active-skills-lane-contract.md`
- 경위: 그릴링 합의 → Planner/Architect/Critic 3라운드. rev.2 = Architect 반영,
  rev.3 = Critic 반영(CRITICAL 3건).

---

## A. 이 레인과 무관하게 **살아 있는 기존 결함 2건** ★

재기획 때 다시 발견하지 않도록 여기 남긴다. 둘 다 실측으로 확인했다.

### A-1 — `activePowerCenti` 가 42종 중 14종에서만 소비된다 (ADR-0041 AC-13 이 거짓)

`kind` 분포는 strike 14 / dash 14 / buff 14 인데, `powerCentiOf` 호출은 7개 핸들러 파일
합계 17건으로 **전부 피해 계산 경로**다. dash·buff 핸들러는 `def.coeff.distance` ·
`def.coeff.ticks` 를 **직접** 읽는다(실증: `src/sim/activeHandlers/bubble.ts:108-124`).

귀결: **`skillInvest` 를 아무리 부어도 28종의 위력은 변하지 않는다.** ADR-0041 AC-13
("투자량이 위력을 단조 증가시킨다")이 그 28종에서 성립하지 않는다. 순수 함수
`activePowerCenti` 는 단조지만 **소비되지 않으므로**, 그 함수만 보는 단조성 테스트는 항진이다.

부분 복구도 간단하지 않다 — buff 위력 축이 `ticks` 만이 아니다:
`coeff.iframes` → `refreshIframes`(`striker.ts:29,60,64,79,82`) ·
`coeff.perTick` → `advanceRecharge`(`bubble.ts:131`) ·
`bubble.ts:134` 는 상수 `FILM_ABSORB_FLAT` 직접 대입.
게다가 `coeff: Readonly<Record<string, number>>`(`data/ships/actives/types.ts:101`)라
**tsc 가 축을 열거하지 못한다.**

### A-2 — 로드아웃 파생 값에 클램프를 걸 때 **위치가 결정적이다**

`verify-invasion` EF 는 제출된 `config.loadout` 을 **그대로** 쓰고 `computeLoadoutStats` 를
재실행하지 않는다(ADR-0028 로 연기된 기존 한계, `verifyInvasionCore.ts` 헤더).
`LoadoutConfig` 는 리플레이 헤더에 스냅샷돼 나간다(`src/sim/replay.ts:347-368`).

따라서 **`src/items/loadout.ts` 합산 지점의 클램프는 위조본을 한 번도 만나지 못한다.**
어떤 로드아웃 축이든 상한을 걸려면 **sim·EF 공용 소비 지점**(값을 실제로 읽는 함수) 안에
두어야 한다. 이 레인의 첫 초안이 정확히 이 함정에 빠졌다.

---

## B. 재기획 때 다시 부딪힐 지점 3건

- **위상 장갑에 "발동 시 무적"은 불가** — 슬롯 2개가 독립 쿨다운(`activeCd0`/`activeCd1`)이라
  교대 발동 실효 간격이 **9틱**인데 `dashIframes` 10 + `PHASE_ARMOR_BONUS_IFRAMES` 16 =
  **26틱**이다(`world.ts:717` · `uniques.ts:103`). 영구 무적이 된다. `refreshIframes` 의
  `max` 갱신은 *단축*만 막고 *연장*은 못 막는다. **내부 쿨다운을 걸 필드도 없다** —
  `targetY`=전환막(`world.ts:1733,3641`) · `aux0/aux1`=기체 시그니처 · `phase`=과열 드럼 ·
  `ownerId`=냉기 감속이 전부 점유. 신규 필드는 곧 신규 해시 폴드다.
- **어픽스 풀 크기 변경의 파급** — `rollItem` 은 비복원 추출이라 풀이 커지면 **같은 drop seed 가
  다른 조합**을 낸다(RNG 소비 횟수는 불변 — `int` 은 span 무관 1회). `src/bench/standardBuild.ts`
  가 그걸 쓰므로 골든이 이동한다: `shipHashBaseline` · `progressionPath` · `emergentRunLength` ·
  `planetPopularity` · `integration` · `drops` · `berdan` · `standardBuild` · **`m3Content`
  (풀 크기 하드 단언 `:297-298`)** · **`scripts/deno-verify/` fixtures**(`RollProbe`
  `scenarios.ts:43-55` 가 클라↔EF 대조로 봉인). `reforgeAffixes`(`roll.ts:188`)도 같은 풀이라
  재단조·정련 테스트도 후보.
- **`hashWorld` 의 진짜 꼬리는 605행 직전**(액티브 폴드 ② `:595-604` 뒤, `return h` 앞)이다.
  `:367` 은 `if (lo !== undefined)` 블록 **내부**라 loadout 블록 확장으로 오독된다.

---

## C. 이하 원본 계획 (보류 — 참고용)

아래는 보류 시점의 rev.3 원문이다. `docs/adr/0043-...` 참조는 **되돌려져 더 이상 없다.**

---

## 0. RALPLAN-DR 요약

### 원칙 (5)

- **P1 — 배선 누락은 타입으로 막되, 타입이 못 막는 구간은 테스트가 막는다.**
  tsc 는 "인자를 넘겨라"만 강제하고 "**옳은 값**을 넘겨라"는 못 한다. 따라서 A 옵션 단독이
  아니라 **A + 단일 accessor + 진입점 경유 테스트** 세 겹이어야 P1 이 성립한다.
  (rev.1 은 tsc 단독으로 충분하다고 적었다 — Architect 가 자기모순을 지적했고 옳다.)
- **P2 — 미사용 런은 바이트 불변.** 단 이 원칙이 보호하는 것은 **해시 포맷**이지 골든
  **값**이 아니다. 어픽스 풀 변경은 값을 통째로 옮긴다 — 두 축을 혼동하지 않는다.
- **P3 — 검증은 관측량으로.** 해시 비교는 값이 실린 것만으로 참이라 항진이다.
- **P4 — 서버가 못 막는 축은 산식이 막는다.** 단 **"산식"의 위치가 결정적**이다 — EF 는
  제출된 `config.loadout` 을 그대로 쓰고 `computeLoadoutStats` 를 재실행하지 **않는다**.
- **P5 — 레이어 규율.** `src/sim/actives.ts` 는 `world.ts` 를 타입으로만 import 한다.

### 결정 드라이버 (상위 3)

1. **HUD·연구소 거짓말 방지** — 쿨다운 계산 지점 4곳
2. **기존 리플레이·골든 보존 범위** — 레인 부피를 정한다
3. **위조 방어선 부재** — EF 가 공격자 로드아웃을 안 본다

### 검토한 선택지

#### 파생 배선 — 옵션 A+ **(채택, rev.2 에서 보강)**

`activeCooldownTicks(def, invested, bonus)` · `activePowerCenti(def, invested, bonus)` 에서
`bonus` 는 정수 2개가 아니라 **`data/ships/actives/types.ts` 에 정의한 `ActiveBonus`
struct**(`{ cdPct, powerPct }`)로 받는다. 그리고 `LoadoutConfig → ActiveBonus` 변환을
**단일 accessor `activeBonusOf(loadout)`** 하나로만 만든다.

- 장: 누락이 컴파일 에러(A 의 장점) + `data/**` 가 sim 타입을 모름(C 의 기각 사유 해소) +
  훗날 축이 늘어도 시그니처 불변(C 의 장점 흡수) + **"0 을 손으로 넘기는 최단 경로"를
  코드에서 지운다**(A 단독의 구멍을 막는다).
- 단: 변환 accessor 가 한 겹 늘어난다.

#### 기각 — 옵션 B(호출부 개별 곱)

Architect 의 steelman 은 정당하다: A 가 못 막는 실패(연구소가 `0` 전달)를 실제로 막는 것은
축 ① 테스트뿐이고, 그렇다면 B 도 같은 보증에 도달한다. **그럼에도 A+ 를 유지하는 근거는
둘이며, 둘 다 측정 가능하다**(rev.2 의 "실수의 기본값이 다르다"는 반증 불가한 수사라 폐기 —
Critic M-4):

1. **미래 호출부**: 5번째 호출부가 생기면 A+ 는 인자를 **필수**로 강제하고 B 는 침묵한다.
   구조적 차이이지 심리적 차이가 아니다.
2. **개정 ①과 B 는 양립 불가** — 클램프가 파생 함수 **안**에 있어야 위조 경로를 막는데
   (§0.5), B 는 파생 함수를 안 건드리므로 클램프를 **4곳에 복제**하게 된다. 정본이 넷이 되면
   드라이버 3번(위조 방어선)이 곧바로 무너진다.

#### 유니크 훅 — 옵션 A' **(채택, 실측 확인됨)**

신규 leaf `src/sim/uniqueActiveHooks.ts`. 근거 실측: `src/sim/uniques.ts` 는 import 0줄
순수 leaf 이고 상수 3종(`PHASE_ARMOR_BONUS_IFRAMES:103` · `REACTIVE_PULSE_COUNT:149` ·
`PHASE_MEMBRANE_COOLDOWN:159`)이 전부 거기 있다. `spawnBullet` = `entities.ts:222`,
`TWO_PI` = `math.ts`. **world.ts 전용 심볼 의존 0** → 순환 없음.

`world.ts` 훅 배치(B')는 `actives.ts → world.ts` 런타임 import 로 순환이 되어 기각.

---

## 0.5 ADR-0043 개정 요구 2건 ★

이 두 건은 **구현 착수 전에 ADR 을 고쳐야** 한다 — 안 고치면 코드가 정본과 어긋난다.

### 개정 ① — 클램프 위치를 못 박는다 (CRIT · 보안)

ADR-0043 은 "산식에 구조적 클램프"라고만 적었다. **rev.1 계획은 이를 `loadout.ts` 합산
지점으로 해석했는데, 그러면 위조 방어가 0 이다.**

EF 는 제출된 `config.loadout` 을 그대로 쓴다(ADR-0043 §"왜 상한이 필요한가",
`verifyInvasionCore.ts` 헤더). `LoadoutConfig` 는 리플레이 헤더에 스냅샷돼 나가고
(`src/sim/replay.ts:347-368`), 위조본은 `activeCdPct: 999` 를 **직접** 실어 보낸다 —
`computeLoadoutStats` 를 한 번도 지나지 않는다.

**개정문**: *클램프는 `activeCooldownTicks` / `activePowerCenti` **안에만** 둔다. 이 두
함수가 클라·EF 공용 소비 지점이므로, 위조된 `LoadoutConfig` 도 반드시 이 벽을 지난다.
`loadout.ts` 합산 지점에는 클램프를 두지 않는다(이중 클램프는 정본을 둘로 만든다).*

### 개정 ② — `activePowerPct` 의 적용 범위 (HIGH · 기존 결함 노출)

**실측**: 42종의 `kind` 분포는 strike 14 / dash 14 / buff 14 이고, `powerCentiOf` 호출은
7개 핸들러 파일 합계 **17건으로 전부 strike 경로**다. dash·buff 핸들러는
`def.coeff.distance` · `def.coeff.ticks` 를 **직접** 읽는다
(실증: `src/sim/activeHandlers/bubble.ts:108-124`).

귀결: `activePowerPct` 어픽스는 **42종 중 14종에만 작동**한다. 그리고 이것은 우리 레인이
만든 문제가 아니다 — **`skillInvest` 투자로 인한 위력 증가도 같은 28종에서 작동하지 않는다.**
ADR-0041 AC-13("투자량이 위력을 단조 증가시킨다")이 **28종에서 이미 거짓**이다.

두 갈래 중 하나를 선택해야 한다(§7 에 미결로 올림):

- **(가) 범위를 명문화하고 좁힌다** — "위력 = 피해 축 한정. dash 변위·buff 지속은 불변."
  ADR-0043 에 명시하고, **dash/buff 액티브가 보너스에 불변임을 단언하는 음성 케이스**를 AC 에 추가.
  기존 결함은 별도 레인으로.
- **(나) 공용 헬퍼에서 적용해 28종을 복구한다 (추천)** — `blink(state, player, distance, dir)`
  (`activeTypes.ts:110`)와 `setBuffTicks(state, slot, ticks)`(`:131`)에 `def` 인자를 더하고
  **그 안에서** `powerCentiOf` 를 곱한다. 42종 핸들러 본문은 무수정, 적용 지점은 kind 당 1곳.
  tsc 가 28개 호출부를 강제한다. 부수 효과로 **ADR-0041 AC-13 이 42종 전부에서 참이 된다**.
  대가: dash/buff 액티브의 실효 성능이 변하므로 관련 골든이 추가로 이동한다.

---

## 1. 요구사항 요약

액티브 스킬의 **위력·쿨다운**을 장비 어픽스로 강화하고, 기존 유니크 3종에 "액티브 발동 시"
부수효과를 얹는다. 해금은 건드리지 않는다.

---

## 2. 수용 기준

| # | 기준 | 검증 방법 |
|---|---|---|
| AC-1 | `AFFIXES` 길이 28, prefix 14 / suffix 14 | `data/affixes.ts` 단언 + **`tests/m3Content.test.ts:297-298` 갱신** |
| AC-2 | 신규 4종의 `stat` 이 `activeCdPct` 2 · `activePowerPct` 2 | 전수 단언 |
| AC-3 | 장비 미착용 시 두 값 0 | `neutralLoadout()` 단언 |
| AC-4 | 쿨감 N% → sim·HUD·연구소 세 지점이 같은 정수. **각 진입점을 실제로 통과해서** 잰다 | `stepActives`(`actives.ts:179`) · `hudActives`(`hud.ts:139`) · `activeSlotViews`(`activeSkills.ts:49`) — 선례 `tests/activeSkillUi.test.ts:301` |
| AC-5 | 쿨감 런의 **재발동 실측 틱 수** < 무보너스 런 | 관측량 델타 |
| AC-6 | 위력 런의 strike 피해 합 > 무보너스 런 | 관측량 델타 |
| AC-6b | **(가) 선택 시**: dash 변위·buff 지속이 보너스에 **불변** / **(나) 선택 시**: 둘 다 증가 | 음성 또는 양성 케이스 |
| AC-7 | 쿨감 과적재 시 클램프 상한 준수. **`LoadoutConfig` 리터럴을 직접 구성**해 `activeCooldownTicks` 에 넣는다 | `computeLoadoutStats` 경유 금지 — 위조본은 그 함수를 안 지난다 |
| AC-8 | 위력 동일 (같은 방식) | 경계 테스트 |
| AC-8b | **착용 양성**: 쿨감 어픽스를 낀 아이템을 장착하면 `lo.activeCdPct > 0` | AC-3 은 대입을 통째로 빠뜨려도 통과한다(Critic M-6) — 이 양성 케이스가 짝이다 |
| AC-9 | **고정 로드아웃·고정 아이템 배열**로 폴드 추가 전/후 해시 바이트 동일 | 어픽스 풀과 **분리**해 잰다(rev.1 의 "기존 골든 통과"는 단계 1 이후 실행 불가) |
| AC-10 | 유니크 3종 부수효과가 **액티브 발동 시에만** | 오발동 테스트 |
| AC-11 | 위상 전환막 훅이 기존 저체력 발동과 쿨다운 공유 | 연속 발동 차단 |
| AC-11b | **위상 장갑 훅이 무적을 무한 연장하지 못한다** | §7 결정 2 의 안전 장치 단언. **슬롯 2개 교대 발동(실효 9틱)** 시나리오로 잰다 |
| AC-13 | 뮤테이션 **6건** 전부에서 해당 테스트 실패 | 수동 실행·기록 |
| AC-14 | 위조된 `LoadoutConfig`(쿨감 999)이 클램프에 막힌다 | **뮤테이션 ⑤가 압박.** rev.2 의 "코드 부재 단언"은 항진이라 폐기 |

> `tsc --noEmit` exit 0 은 수용 기준이 아니라 **빌드 전제**다(Critic 지적) — §5 검증 절차로 옮겼다.

---

## 3. 구현 단계

### 단계 0 — 기준선 녹화 (착수 **전**) ★ Critic M-1

AC-9 는 "폴드 추가 전/후 해시 바이트 동일"인데, **단계 1 이후에는 '전'을 만들 수 없다.**
변경 전 커밋의 detached 워크트리에서 **고정 로드아웃·고정 아이템 배열**의 해시를 녹화해
파일로 커밋한다(이 리포에 선례 있음 — 조우 프레임워크 레인).

이걸 안 하면 AC-9 는 문장으로만 존재하고 아무것도 증명하지 못한다.

### 단계 1 — 어픽스 축

| 파일 | 변경 |
|---|---|
| `src/items/types.ts` | `StatKey` 에 2개 append |
| `data/affixes.ts` | prefix 위력 2 · suffix 쿨감 2. 이름은 한글 리터럴(어픽스 관례 — `t()` 아님) |
| `src/items/loadout.ts:153` `zeroSums()` | 키 2개 (tsc 강제) |
| `src/items/skills.ts:34` `zeroStatSums()` | 키 2개 (tsc 강제) |
| `src/items/loadout.ts:62` `neutralLoadout()` | 0, 0 |
| `src/items/loadout.ts:314` 뒤 | 합산 대입 **(클램프 없음 — 개정 ①)** |
| `src/sim/world.ts:599-603` 뒤 | `LoadoutConfig` 정수 2칸 append |

> ⚠️ `applyStatSums`(`loadout.ts:134`)는 **전수 소비가 아니다** — 새 키를 안 읽어도 tsc 가
> 침묵한다. 적용을 314행 뒤에 두는 것은 gear·skill 2회 호출로 인한 이중 적용을 피하는
> 올바른 선택이지만, **"tsc 가 배선을 강제한다"는 보증이 여기서 끊긴다.** AC-3 이 이 구간의
> 유일한 잠금이다.

### 단계 2 — 파생·해시

| 파일 | 변경 |
|---|---|
| `data/ships/actives/types.ts` | `ActiveBonus` struct 신설 |
| `data/ships/actives/index.ts:108` | `activeCooldownTicks(def, invested, bonus)` — **클램프 여기** → `ACTIVE_CD_FLOOR` 최종 하한 |
| `data/ships/actives/index.ts:120` | `activePowerCenti(def, invested, bonus)` — **클램프 여기** |
| `src/sim/world.ts` 또는 `src/items/loadout.ts` | `activeBonusOf(loadout): ActiveBonus` 단일 accessor |
| `src/sim/actives.ts:179` | accessor 경유 전달 |
| `src/sim/activeTypes.ts:60` `powerCentiOf` | accessor 경유 전달 |
| `src/ui/hud.ts:139` | 동일 |
| `src/items/activeSkills.ts:49-50` | `activeSlotViews` 에 인자 추가 |
| `src/ui/pixi/researchLab.ts:637` | **R1 의 실체** — 여기가 `LoadoutConfig` 을 안 쥐고 있다 |
| `src/sim/replay.ts` **605행 직전** | 조건부 폴드 ③ — **액티브 폴드 ② 뒤, `return h` 앞** |

> ⚠️ **폴드 위치 정정(rev.1 오류)**: rev.1 은 `:367 뒤` 라고 적었는데 그 자리는
> `if (lo !== undefined)` **블록 내부**다. 실제 append-only 꼬리는 액티브 폴드 ②
> (`:599-604`) 뒤인 **605행 직전**이고, ADR-0043 도 "맨 꼬리"라고 적었다. 367행 삽입은
> 바이트로는 무해하지만 `replay.ts` 가 반복 선언한 "맨 꼬리 append" 규약을 깬다.

> **(나) 선택 시 추가**: `activeTypes.ts:110` `blink` · `:131` `setBuffTicks` 에 `def` 인자
> 추가 + 내부에서 `powerCentiOf` 곱. 호출부 28곳은 tsc 가 강제.

### 단계 3 — 유니크 3종

신규 leaf `src/sim/uniqueActiveHooks.ts` — `onActiveFired(state, player, uniqueMask)`.

- **위상 장갑**: `player.iframes` 상향. **⚠️ R8 — 무한 무적 방지 장치 필수.**
- **반응 장갑**: 방사 펄스. `world.ts:3613` 의 루프를 이 모듈로 **추출**하고 world.ts 는
  호출로 치환(복제 금지 — 두 규칙이 조용히 갈린다).
- **위상 전환막**: 적탄 소거. **`player.targetY` 내부 쿨다운을 기존 저체력 발동과 공유**(AC-11).

`src/sim/actives.ts` 발동 성공 직후 1줄 호출. **신규 sim 상태 0개 → 해시 폴드 추가 없음.**

### 단계 4 — 검증

신규 `tests/activeGearAffix.test.ts`. 축 ①은 **반드시 3개 진입점을 통과**해서 잰다 —
`activeCooldownTicks` 를 세 번 부르는 형태는 무조건 참인 **항진**이고 뮤테이션 ①을 못 잡는다.

| 축 | 뮤테이션 |
|---|---|
| ① 3지점 일치 | 한 진입점만 보너스 0 → **실패해야** |
| ② 재발동 틱 실측 | 클램프를 항상-0 으로 → **실패해야** |
| ③ 폴드 조건부성 | 폴드 가드를 항상 true → **실패해야** |
| ④ 유니크 오발동 | 발동 게이트 제거 → **실패해야** |
| **⑤ 위조 방어** ★ | **클램프를 `loadout.ts` 합산 지점으로 되돌린다** → 위조 `LoadoutConfig` 테스트가 **실패해야**. 이게 개정 ①(CRIT)을 압박하는 유일한 축이고, AC-14 의 항진(grep 부재 단언)을 대체한다 |
| **⑥ 위상 장갑** ★ | 결정 2 의 안전 장치를 제거 → AC-11b 가 **실패해야** |

뮤테이션 결과는 PR 본문에 표로 기록(`vitest exit 1` / `tsc exit 2` 형식).

### 단계 5 — 골든 재녹화 + 밴드 실측

**재녹화 범위(rev.2 에서 확대)** — 어픽스 풀은 `rollItem` 뿐 아니라
`reforgeAffixes`(`src/items/roll.ts:188`)도 쓴다:

- `shipHashBaseline` · `progressionPath` · `emergentRunLength` · `planetPopularity` ·
  `integration` · `drops` · `berdan` · `standardBuild`
- **`scripts/deno-verify/fixtures.json` + `scenarios.ts`** ★ 누락됐던 것 —
  `RollProbe`(`scenarios.ts:43-55`)가 `rollItem`·`rerollAffixes` 를 **클라↔EF 대조**로 봉인한다.
  레인 계약 §4 의 `denoFixture` 골든이 바로 이것이다.
- **`m3Content`**(풀 크기 하드 단언) · 재단조·정련 경로(`reforge`·`reroll`·`refiningChain`·
  `items`·`requiredLevel`·`net`·`save`·`dropTip`·`hangar*`) — **착수 시 시드 고정 기대값
  보유 여부를 실측해 범위를 확정**한다(현재는 후보 목록).

그리고: 침공 24시드 밴드 **측정만**(기록은 `.omc/research/`), 재녹화 diff 육안 확인.

### 단계 6 — 문서·배포

1. **ADR-0043 개정 ①②를 먼저 반영**(착수 전)
2. ADR-0041 에 "AC-13 은 ADR-0043 이 개정" 한 줄
3. PR → 머지 → **`verify-invasion` EF 재배포** → **보너스 낀 런으로 침공 제출 1회 accept**

---

## 4. 위험과 완화

| 위험 | 영향 | 완화 |
|---|---|---|
| **R1** `researchLab.ts:637` 이 `LoadoutConfig` 미보유 | 연구소만 옛 값 표시 (AC-4 위반) | 단계 2 **첫 작업**. **폴백 없음** — `src/ui/inventory.ts:18` 이 이미 UI 층에서 `computeLoadoutStats` 를 부르므로 배선 확장은 확실히 가능하다(Critic 확인). rev.2 의 "장비 미반영 명시" 폴백은 AC-4 우회 탈출구라 **삭제** |
| **R2** EF 재배포 전 클라 배포 | 보너스 낀 런 전부 거부 | 단계 6 순서 고정 |
| **R3** 재녹화가 실제 결함을 덮는다 | 회귀가 "이동"으로 위장 | diff 육안 확인 + AC-9(고정 로드아웃 대조, 어픽스 풀과 분리) |
| **R4** 침공 밴드 이탈 | 난이도 왜곡 방치 | ADR-0043 이 명시적으로 감수. 측정값 기록 |
| **R5** 전환막 쿨다운 미공유 | 액티브 연타로 적탄 무한 소거 | AC-11 |
| **R6** 순환 import | 빌드 실패 | A' leaf 배치(실측 확인) |
| **R7** 클램프를 나중에 넣으면 소급 불가 | 위조 구멍 | 단계 2 에 포함 |
| **R8 ★CRIT** **위상 장갑 영구 무적** | 정직한 플레이로 도달 가능 → EF 가 못 막음(P4 무력) | 실측: `dashIframes` 10(`world.ts:717`) + `PHASE_ARMOR_BONUS_IFRAMES` 16(`uniques.ts:103`) = **26틱**. 그런데 방어선은 `ACTIVE_CD_FLOOR` 18 이 아니라 **9틱**이다 — 슬롯 2개가 독립 쿨다운이라 교대 발동이 된다(Critic C-1). rev.2 의 완화책 2종(`max` 갱신 · 상한을 18 미만)은 **둘 다 문제를 안 푼다**. → **§7 결정 2 로 승격**. 위상 장갑은 `reqLevel: 18`(`data/uniques.ts:46`)이라 조기 획득 가능 |
| **R9** 축 ① 테스트가 항진 | 뮤테이션 ①을 못 잡음 | 진입점 경유 강제(AC-4) |
| **R10** 결정 2 에서 (B) 를 고르면 신규 필드 → **신규 해시 폴드** | 단계 3 의 "신규 상태 0개" 전제 붕괴, 골든·EF 범위 확대 | 쓸 수 있는 플레이어 정수 필드가 **없다**(실측: `targetY`=전환막 · `aux0/aux1`=시그니처 · `phase`=과열드럼 · `ownerId`=냉기). (A) 를 고르면 이 위험이 소멸한다 |

---

## 5. 검증 절차 (완료 게이트)

0. **동결 계약 정합 확인** — `activeCooldownTicks`·`blink`·`setBuffTicks` 시그니처 변경은
   `active-skills-lane-contract.md` §1 의 ①(`ActiveSkillDef` 필드 집합)·②(핸들러 시그니처)
   **어느 쪽에도 포함되지 않으므로 동결 위반이 아니다**(실측 확인).
1. `pnpm exec tsc --noEmit` exit 0 (**빌드 전제** — 수용 기준이 아니다)
2. `pnpm test` 전체 그린 (**`| tail` 금지** — exit code 가 `tail` 것이 된다)
3. 뮤테이션 **6건** 각각 **실패 확인 후 되돌림**
4. 재녹화 diff 육안 확인
5. 침공 24시드 밴드 측정값 기록
6. EF 재배포 후 **보너스 낀 런으로 침공 제출 1회 accept**

> 6번이 없으면 "서버가 이 런을 받는다"가 증명되지 않는다. ADR-0041 레인은 이 게이트를
> 미완으로 남겼다 — 이번엔 완주한다.

---

## 6. ADR (이 계획의 결정 기록)

- **결정**: 파생 배선은 옵션 **A+**(struct 인자 + 단일 accessor), 유니크 훅은 **A'**(leaf 모듈).
  클램프는 **파생 함수 안에만**.
- **드라이버**: HUD·연구소 거짓말 방지 · 골든 보존 범위 · 위조 방어선 부재
- **검토한 대안**: B(호출부 개별 곱 — 실수의 기본값이 나쁨) · C(`LoadoutConfig` 통째 —
  `data/**` 경계 파괴) · B'(world.ts 훅 — 순환)
- **선택 이유**: tsc 가 잡는 구간과 못 잡는 구간을 구분하고, 못 잡는 구간(값의 정확성)은
  단일 accessor 로 실수의 기본값을 바꾸고 진입점 경유 테스트로 잠근다.
- **귀결**: `data/ships/actives/{types,index}.ts` 시그니처 변경 · 골든 재녹화(범위 확대,
  deno fixtures 포함) · 침공 밴드 이동 감수 · EF 재배포 필수 · **ADR-0043 개정 2건 선행**
- **후속**: 침공 밴드 재측정(다음 레인) · 밸런스 수치 · (가) 선택 시 dash/buff 위력 결함 별도 레인

---

## 7. 미결 — 착수 전 결정 필요

### ★ 결정 1 — `activePowerPct` 적용 범위 (Critic C-3 로 재정의)

rev.2 는 "(나) 공용 헬퍼로 28종 복구 → AC-13 이 42종 전부에서 참" 이라 적었는데 **거짓이다.**
buff 위력은 `coeff.ticks` 만이 아니다(실측):

- `coeff.iframes` → `refreshIframes`(`striker.ts:29,60,64,79,82`) — `setBuffTicks` 미경유
- `coeff.perTick` → `advanceRecharge`(`bubble.ts:131`)
- `bubble.ts:134` 는 상수 `FILM_ABSORB_FLAT` 직접 대입
- `coeff: Readonly<Record<string, number>>`(`actives/types.ts:101`)라 **tsc 가 축을 열거 못 한다**

정정된 선택지:

- **(가) 범위를 좁혀 명문화** — "위력 = **피해 축 한정**". dash 변위·buff 지속·무적·충전은 불변.
  AC 에 **음성 케이스**(dash/buff 가 보너스에 불변) 추가. 기존 AC-13 결함은 별도 레인.
- **(나) `blink`·`setBuffTicks` 에만 적용** — 복구되는 축은 **`distance`·`ticks` 뿐**이고
  `iframes`·`perTick`·흡수량은 **여전히 미복구**. "42종 복구"가 아니라 "부분 복구"다.
  부분 복구는 "어떤 buff 는 늘고 어떤 buff 는 안 는다"를 만들어 **일관성이 (가)보다 나쁠 수 있다.**

### ★ 결정 2 — 위상 장갑 부수효과의 형태 (Critic C-1·C-2 로 재정의)

rev.2 의 "발동 시 `iframes` 상향"은 **두 겹으로 막혔다**:

- **C-1 산술**: 슬롯이 2개이고 쿨다운이 독립(`activeCd0`/`activeCd1`)이라 교대 발동 간격은
  18 이 아니라 **9틱**이다. `iframes` 26 ≫ 9 → 영구 무적. 그리고 `refreshIframes`
  (`striker.ts:29`)의 `max` 갱신은 *단축*만 막고 *연장*은 못 막는다.
- **C-2 필드 부재**: 내부 쿨다운을 걸려 해도 **쓸 필드가 없다.** `player.targetY` 는 전환막이
  점유(`world.ts:1733,3641`), `aux0/aux1` 은 기체 시그니처가 점유(계약 ③), `phase` 는
  과열 드럼, `ownerId` 는 냉기 감속. 신규 필드 → **신규 해시 폴드** → 단계 3 의
  "신규 상태 0개" 전제가 깨지고 골든·EF 범위가 계획 밖으로 나간다.

정정된 선택지:

- **(A) 효과를 바꾼다 (추천)** — "발동 시 **대시 쿨다운 즉시 회복**". `player.dashCooldown`
  (이미 해시됨)만 쓰므로 신규 필드 0, 그리고 **0 미만으로 못 내려가 상한이 구조적으로 존재**한다.
  위상 장갑의 기존 정체성(대시 강화)과도 정합.
- **(B) 무적을 유지하고 신규 필드 + 조건부 폴드를 감수** — 단계 2 범위에 폴드 하나 추가.
  ADR-0043 의 "신규 sim 상태 없음"을 개정해야 한다.
- **(C) 위상 장갑을 빼고 다른 유니크로 교체** — 3종 중 하나를 재선택.

### 나머지 미결

3. 어픽스 4종 min/max (밸런스 패스)
4. **쿨감 클램프 수치 — 밸런스가 아니라 안전 축**(Critic 지적). 하한은
   `ACTIVE_CD_FLOOR / ACTIVE_SLOT_COUNT` 에서 파생해야 한다(슬롯 2개 교대 발동 때문).
   착수 전 확정.
5. 위력 클램프 수치 (밸런스 패스)
6. 유니크 3종 부수효과 강도
7. **AC-11 부작용 결정**(Critic M-5) — 전환막 쿨다운을 액티브와 공유하면 액티브 1회 발동이
   저체력 긴급 회복을 **720틱(12초) 봉인**한다(`uniques.ts:159`). 기존 유니크의 방어 성능이
   순수 하락한다. 감수할지 분리 카운터를 쓸지 결정 필요.

---

## 9. rev.3 변경 로그 (Critic 반영)

| 항목 | 내용 |
|---|---|
| C-1 CRIT | 슬롯 2개 교대로 실효 간격 **9틱**. `max` 갱신은 연장을 못 막음 → 결정 2 로 승격 |
| C-2 CRIT | 위상 장갑 내부 쿨다운에 **쓸 필드가 없다**(targetY·aux·phase·ownerId 전부 점유) → 결정 2 |
| C-3 CRIT | (나)의 "42종 복구"가 거짓 — `iframes`·`perTick`·흡수량 미복구 → 결정 1 재정의 |
| M-1 | AC-9 실행 불가 → **단계 2 착수 전 detached 워크트리에서 기준선 녹화** 단계 신설(§3 단계 0) |
| M-2 | 뮤테이션 ⑤(클램프를 loadout.ts 로 되돌림 → 위조 테스트 실패) · ⑥(위상 장갑 게이트 제거) 추가. AC-14 항진 해소 |
| M-3 | AC-7 을 "`LoadoutConfig` **리터럴 직접 구성**" 으로 못 박음 |
| M-4 | B 기각 근거를 수사에서 **측정 가능한 2개**로 교체: ①필수 인자 강제 ②**개정 ①과 B 는 양립 불가**(클램프가 4곳 복제됨) |
| M-5 | AC-11 부작용(720틱 봉인)을 미결 7 로 승격 |
| M-6 | "AC-3 이 유일한 잠금"은 틀림 — 대입 누락 시 AC-3 은 **통과**한다. 착용 양성 케이스 신설 |
| 항진 | AC-12(tsc)는 수용 기준이 아니라 빌드 전제 → 검증 절차로 이동 |
| 표현 | "17건 전부 strike 경로" → `striker.ts:89`·`bubble.ts:141` 은 buff 만료 훅. 결론은 유효 |
| R1 | 과대평가 — `src/ui/inventory.ts:18` 이 이미 UI 층에서 `computeLoadoutStats` 를 부른다. **폴백("장비 미반영 명시") 삭제** — AC-4 우회 탈출구 |
| 계약 | `activeCooldownTicks`·`blink`·`setBuffTicks` 는 동결 계약 §1 의 ①②에 **미포함 → 위반 아님**(확인 문장 추가) |

---

## 8. rev.2 변경 로그 (Architect 반영)

| 항목 | 내용 |
|---|---|
| F-1 → 개정 ② | 위력이 42종 중 14종에만 작동. 기존 결함 노출. (가)/(나) 미결로 승격 |
| F-2 → 개정 ① | **클램프를 `loadout.ts` 에 두면 위조 방어 0.** 파생 함수 안으로 이동. AC-14 신설 |
| F-3 | 폴드 위치를 `:367 뒤` → **605행 직전**(진짜 꼬리)로 정정 |
| CRIT | **R8 위상 장갑 영구 무적**(26틱 무적 vs 18틱 쿨다운). AC-11b 신설 |
| HIGH | `scripts/deno-verify/` fixtures 재녹화 범위에 추가 |
| HIGH | 축 ①을 **진입점 경유**로 못 박음(항진 방지). AC-4 개정 |
| MED | `m3Content.test.ts:297-298` 풀 크기 단언 갱신 |
| MED | `reforgeAffixes` 경로 재녹화 후보 목록 추가(착수 시 실측 확정) |
| P1 | "tsc 단독으로 충분"을 철회 — 세 겹(타입 + accessor + 진입점 테스트)으로 재정의 |
| P2 | 해시 **포맷** 보존과 골든 **값** 이동을 분리 명시. AC-9 재정의 |
| 옵션 A → A+ | `ActiveBonus` struct + 단일 accessor `activeBonusOf` |
