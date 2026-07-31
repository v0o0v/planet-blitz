# 기존 결함 2건 조사 기록 (2026-07-31)

- 대상 커밋: `ef21cae`(= `origin/main`). 발단: `.omc/plans/active-gear-affix-impl-2026-07-31.md` §A
  (그 레인은 **보류**, 이 두 건은 독립적으로 살아 있다).
- 관련 정본: `docs/adr/0041-active-skills-ship-type-exclusive-player-only.md` ·
  `.omc/plans/active-skills-lane-contract.md` · `supabase/functions/verify-invasion/verifyInvasionCore.ts` 헤더(ADR-0028)
- 이 문서는 **조사·권고**다. 코드 변경 0줄.

---

## 0. 요약

| | 결론 |
|---|---|
| 결함 1 | `powerCentiOf` 를 호출하는 것은 42종 중 **17종**. 그중 **3종은 부분**(만료 훅의 폭발/회복 피해만). **25종은 투자에 전혀 반응하지 않는다.** ADR-0041 AC-13 후단(위력 단조 증가)이 그 25종에서 거짓 |
| 결함 1 검증 축 | **항진 확증됨.** 소비 경로를 통째로 끊는 뮤테이션에서 5,334개 테스트 중 **1개**(`denoFixture` 바이트 골든)만 실패하고 AC-13 단조성 테스트는 42종 전원 통과 |
| 결함 2 | `LoadoutConfig` 17축 중 상한이 있는 것은 **3개**(`fireRateMult`·`rangeAdd`·`dashCdMult`)뿐이고, 셋 다 **소비 지점에 올바로** 있다. **잘못된 위치의 클램프는 없다.** 나머지 축은 상한 자체가 없다 |
| 결함 2 실질 | 파워 상한은 ADR-0028 이 명시적으로 배제했다("정직 강자 오거부"). 그러나 `bulletCountAdd` 무제한은 래더 오염이 아니라 **검증 서버 DoS** 이고 이 논거로 배제되지 않는다 — 실측: 600틱 × 2000발 = **2,975ms** → 18,000틱 환산 **≈ 89초** ≫ 소프트 예산 20초. 정직 상한은 **13** |

---

## 1. 결함 1 — `activePowerCenti` 의 실제 도달 범위

### 1.1 실측 방법

`skillInvest` 는 sim 안에서 **딱 두 곳**에만 도달한다(전수 grep):
`src/sim/actives.ts:179`(쿨다운) · `src/sim/activeTypes.ts:60`(`powerCentiOf` → 위력).
따라서 **한 번만 발동**시키면(재발동 없음 → 쿨다운 차이가 관측에 못 들어온다) 남은 차이는
전부 위력 축이다.

42종 각각에 대해 `invest = 게이트` vs `게이트 + 40` 두 런(같은 시드·같은 입력, 30틱에 1회 발동,
900틱 관찰)의 관측량 시계열(투사체 수·투사체 피해 합·적 HP 합·플레이어 HP·좌표·버프 잔여 틱)을
바이트 비교했다.

### 1.2 결과 — 42종 전수

| kind | 종수 | 투자 반응 | 스킬 |
|---|---|---|---|
| **strike** | 14 | **완전**(`coeff.damage` 가 `scaleCenti(…, centi)` 를 지난다) | `as_{striker_firepower, bruiser_blade, arccaster_chain, phantom_assassin, hatchling_brood, mallow_squish, bubble_pop}_{lo,hi}` |
| **buff** | 3 | **부분** — 만료 훅의 1회 피해/회복만. 지속·무적·충전·흡수량은 **불변** | `as_striker_survival_hi`(`coeff.heal`) · `as_bruiser_fortify_hi`(`coeff.blastDamage`) · `as_bubble_film_hi`(`coeff.blastDamage`) |
| **buff** | 11 | **없음** | 위 3종을 제외한 buff 14종 |
| **dash** | 14 | **없음** | `as_{striker_mobility, bruiser_morph, arccaster_barrage, phantom_phase, hatchling_nurture, mallow_mend, bubble_drift}_{lo,hi}` |

**계획 §A 의 "14종" 표기는 관측 기준으로는 맞고 호출 기준으로는 틀리다.** 호출은 17건 17종이며,
`bruiser.ts:94` 는 계획 rev.3 변경 로그가 놓친 세 번째 만료 훅이다.

> ⚠️ **그 3종은 기본 조건에서 관측되지 않는다.** 첫 스윕에서 셋 다 `NO-EFFECT` 로 나왔다 —
> 회복은 플레이어가 만피라 `Math.min(maxHp, …)` 에 먹히고, 폭발은 반경 안에 적이 없었다.
> 플레이어 HP 를 깎고 표적을 반경 안에 두자 비로소 드러났다:
>
> | 스킬 | invest=게이트 | invest=게이트+40 |
> |---|---|---|
> | `as_striker_survival_hi` | 회복 후 hp 82 | hp 100(만피 도달) |
> | `as_bruiser_fortify_hi` | 표적 −224 | 표적 −320 |
> | `as_bubble_film_hi` | 표적 −216 | 표적 −312 |
>
> **함의**: 위력 축을 관측량으로 단언하는 AC 를 쓸 때, 이 3종은 조건을 세워 주지 않으면
> "불변"이라는 **거짓 음성**을 낸다. 음성 케이스로 쓰면 그 자체가 새 항진이 된다.

### 1.3 미반응 25종의 "위력 축"이 실제로 무엇인가

복구를 논하려면 무엇을 곱할지가 있어야 한다. 전수 확인 결과 **곱할 수치가 없는 스킬이 다수**다:

| 축 | 소비 지점 | 스킬 수 | 비고 |
|---|---|---|---|
| `coeff.distance` | `blink`(`activeTypes.ts:110`) | dash 14 전부 | 유일하게 "공용 헬퍼 한 곳"이 성립하는 축 |
| `coeff.ticks` | `setBuffTicks`(`:131`) | buff 14 전부 | 지속 시간 |
| `coeff.iframes` | `refreshIframes`(`striker.ts:28`) | 2 | `setBuffTicks` 미경유 |
| `coeff.perTick` | `advanceRecharge`(`bubble.ts:43`) · `setStillTicks`(`arccaster.ts:45`) · `addUnhitTicks`(`mallow.ts:32`) | 4 | 서로 다른 3개 leaf 함수 |
| `coeff.stacks`·`vaults`·`advance`·`rechargeTicks`·`debtDiv`·`period` | 각 핸들러 지역 | 8 | 축이 전부 다르다 |
| **상수 직접 대입** | `FILM_ABSORB_FLAT`(`bubble.ts:119,123,134`) · `ARMOR_MAX_STACKS`(`bruiser.ts:44,69,74`) · `OVERCHARGE_APEX_TICKS`(`arccaster.ts:91,99,112`) · `CLOAK_*`(`phantom.ts`) · `HATCH_*`(`hatchling.ts`) · `CUSHION_RECOVER_TICKS`(`mallow.ts`) | 다수 | **`coeff` 에 수치가 없다 — 곱할 대상 자체가 없다** |

그리고 `coeff: Readonly<Record<string, number>>`(`data/ships/actives/types.ts:101`)라
**tsc 는 이 축들을 열거하지 못한다.** 즉 "복구 누락"은 컴파일러가 절대 못 잡는다.

### 1.4 검증 축의 항진 — 뮤테이션으로 확증

| 뮤테이션 | 결과 |
|---|---|
| **A. 소비 절단** — `powerCentiOf`(`activeTypes.ts:60`)를 `return 100` 으로 | `pnpm test` **5,334 중 1 실패** — `tests/denoFixture.test.ts` 뿐. **AC-13 단조성 테스트(42종)는 전원 통과.** `activeSkills`·`activeSkillWiring`·`activeSkillRunConfig`·`activeSkillUi`·`shipHashBaseline`·`invasionHash` 전부 그린 |
| **B. 순수 함수 절단** — `activePowerCenti`(`index.ts:120`)를 `return 100` 으로 | `tests/activeSkills.test.ts` AC-13 이 **42종 전원 실패** |

A + B 를 나란히 놓으면 결론이 강제된다: **AC-13 은 순수 함수만 지킨다.** 위력이 실제로
sim 에 도달하는지는 **어떤 의미 단언도 지키지 않고**, 오직 `denoFixture` 바이트 골든만
"뭔가 달라졌다"를 알린다 — 그리고 그 골든은 이 축을 건드리는 레인이라면 어차피 재녹화된다.

정확한 소재: `tests/activeSkills.test.ts:84-101`. 42종 전수로 `activeCooldownTicks`·
`activePowerCenti` 를 **직접** 호출해 단조성을 잰다. 함수 자체는 옳고, 단언도 옳고,
**그 함수의 반환값이 25종에서 버려진다는 사실만 이 테스트의 시야 밖**이다.

### 1.5 선택지와 권고

#### (가) 범위를 좁혀 명문화 — **권고**

ADR-0041 AC-13 후단을 *"위력 = **피해 축** 한정. 계열 투자는 strike 14종의 피해와 buff 3종의
만료 피해/회복을 단조 증가시키고, 이동 거리·버프 지속·무적·충전·흡수량은 투자에 불변이다"* 로
개정한다. 쿨다운 전단(42종 단조 감소)은 **참이므로 그대로 둔다**(`actives.ts:179` 가 42종 공용).

- 비용: ADR 1건 개정 + 테스트. **코드 거동 변화 0 → 골든 이동 0, EF 재배포 0.**
- 추가할 잠금 2종:
  1. **양성**: strike 14종에서 투자 증가가 관측량을 움직인다(§1.1 방법 그대로).
  2. **음성**: dash 14 + buff 11 = **25종**에서 관측량이 **불변**이다. ⚠️ §1.2 의 3종은
     여기서 **제외**해야 한다 — 조건을 안 세우면 거짓 음성이고, 세우면 양성이다.
  - 이 두 축은 뮤테이션 A 에서 **양성 쪽이 실패**하므로 항진이 아니다.
- 근거: §1.3 이 보여주듯 미반응 25종의 절반가량은 **`coeff` 에 스케일할 수치가 아예 없다**.
  "위력 배율"이라는 개념이 그 스킬에 존재하지 않으므로, 좁히는 것이 은폐가 아니라 정확한 기술이다.

#### (나) 공용 헬퍼 부분 복구 — 기각 권고

`blink`·`setBuffTicks` 에 `def` 를 넘겨 안에서 곱한다. 복구되는 축은 **`distance`·`ticks` 뿐**.

- 비용: 시그니처 2건 변경(동결 계약 §1 ①② 에는 미포함이라 위반은 아니다) + 호출부 28곳 +
  **28종 전체의 실효 성능 변화** → `shipHashBaseline`·`invasionHash`·`denoFixture`·
  `progressionPath`·`emergentRunLength`·`standardBuild`·`integration` 등 골든 이동 +
  `verify-invasion` **EF 재배포 필수** + 침공 24시드 밴드 재측정.
- 대가에 비해 얻는 게 일관되지 않다: 같은 buff 안에서 **지속은 늘고 무적·충전·흡수량은 안 는다**.
  "어떤 buff 는 강해지고 어떤 건 안 강해진다"는 (가)보다 설명하기 나쁘다.

#### (다) 전면 복구 — 별도 레인

`coeff` 를 `Record<string, number>` 에서 **명명 축 유니온**으로 바꿔 tsc 가 열거하게 만든 뒤,
축마다 스케일 여부를 저작자가 선언한다. 상수 직접 대입(§1.3 마지막 행)도 `coeff` 로 끌어내야 한다.

- 이건 ADR-0041 0c 동결 계약 §1 ①(`ActiveSkillDef` 필드 집합)을 **실제로 건드린다.**
- 42종 재저작 + 밸런스 패스 동반. **이번 레인의 부피가 아니다.**

**권고: (가) 를 지금 하고, (다) 를 밸런스 패스와 묶어 백로그에 올린다.** (나)는 비용 대비
일관성 손해라 하지 않는다.

---

## 2. 결함 2 — 로드아웃 파생 값의 클램프 위치

### 2.1 전제 재확인 (실측)

- `verify-invasion` EF 는 제출된 `config.loadout` 을 **그대로** 쓰고 `computeLoadoutStats` 를
  재실행하지 않는다 — `verifyInvasionCore.ts` 헤더 "⚠️ 잔여 신뢰 범위(문서화된 한계,
  ADR-0028 연기 확정)". **계획 §A 의 진술은 정확하다.**
- `LoadoutConfig` 는 해시에 그대로 접힌다(`src/sim/replay.ts:346-368`) — 즉 위조본도
  **내적으로 일관**돼 재실행이 갈리지 않는다.
- ⚠️ **같은 헤더가 미리 답을 하나 못 박아 뒀다**: *"미봉책(파워 절대 상한 클램프)은 정직 강자
  오거부 회귀라 배제한다."* 따라서 **밸런스성 파워 상한을 권고하는 것은 정본과 충돌한다.**
  아래 §2.4 는 그 논거가 **적용되지 않는** 축만 다룬다.

### 2.2 `LoadoutConfig` 17축 전수 — 상한의 유무와 위치

소비 지점은 `src/sim/world.ts:1020-1037`(`createWorld` 1회 적용)과 런타임 몇 곳이다.

| 축 | sim 소비 지점 | 상한 | 위치 판정 |
|---|---|---|---|
| `weaponType` | `world.ts:1022` | 없음 | 범위 밖은 `autoAttack` 분기가 기본으로 떨어진다(무해) |
| `subWeaponType` | `world.ts:2600` | `< 0` 조기 반환 | 소비 지점 ✅ |
| `damageMult` | `world.ts:1023` · `subDamage:2559` | **없음** | — |
| `fireRateMult` | `world.ts:1024` `Math.max(2, …)` · `subCooldown:2591` `< 2 → 2` | **있음** | **소비 지점 ✅** |
| `bulletCountAdd` | `world.ts:1025` → `autoAttack:2381,2443` 루프 횟수 | **없음** | **§2.3 DoS** |
| `pierceAdd` | `world.ts:1026` | **없음** | — |
| `bulletSpeedMult` | `world.ts:1027` | **없음** | 탄속 상한은 `tests/bulletTunnelInvariant.test.ts` 가 **정직 조립 경로로만** 잰다 |
| `spreadAdd` | `world.ts:1028` | **없음** | 정직 경로에선 무기 타입만 기여(≤0.5) |
| `rangeAdd` | `world.ts:1032` `Math.max(0, …)` | **있음** | **소비 지점 ✅** |
| `moveSpeedMult` | `world.ts:1033` | **없음** | — |
| `maxHpAdd` | `world.ts:1035` | **없음** | — |
| `dashCdMult` | `world.ts:1034` `Math.max(12, …)` | **있음** | **소비 지점 ✅** |
| `magnetMult` | `world.ts:1036` | **없음** | — |
| `xpMult` | `world.ts:3661` | **없음** | — |
| `uniqueMask` | 다수(비트 검사) | 불필요 | 비트 검사라 값 범위가 의미 없다 |
| `fireDmg`·`coldSlow`·`lightning` | `world.ts:3167-3169` | **없음** | — |

**핵심 판정 — 잘못된 위치의 클램프는 하나도 없다.** 존재하는 상한 3종은 전부 소비 지점에 있다.
`src/items/loadout.ts` 에 있는 두 정규화(`normalizeShipBaseBp:197` · `normalizeLineageBonus`
(`data/guardian.ts:174`))는 **`LoadoutConfig` 출력이 아니라 입력**(정적 로스터 데이터·계정 계보 bp)을
정규화하는 것이라 위조 표면이 아니다 — 위조자는 산출물인 `damageMult` 를 직접 쓰므로 이 두 함수를
지나지 않는다. 즉 **"이미 방어가 있는 축"으로 오인하지 말 것**: `damageMult` 는
`normalizeLineageBonus` 로 상한이 걸린 축이 아니라 **상한이 없는 축**이다.

### 2.3 상한 없음이 실제로 무엇을 허용하는가 (실측)

**정직 상한 실측** — `computeLoadoutStats` 에 축별 최대 세트(8칸 전부에 그 축의 어픽스를 서로 다른
것끼리 최대 6개, 값은 전부 `max`) + 최대 스킬 투자 + 계보 5000bp + 최적 무기 타입:

| 축 | 정직 최댓값 |
|---|---|
| `damageMult` | 49.24 |
| `fireRateMult` | **−0.82** (아래 참고) |
| `bulletCountAdd` | **13** |
| `pierceAdd` | 18 |
| `bulletSpeedMult` | 5.61 |
| `rangeAdd` | 3050 |
| `moveSpeedMult` | 7.55 |
| `maxHpAdd` | 1013 |
| `dashCdMult` | 0.074 (하한 방향) |
| `magnetMult` | 13.48 |
| `xpMult` | 6.18 |
| `fireDmg` / `coldSlow` / `lightning` | 40 / 8 / 80 |

> 참고: `fireRateMult` 가 **음수**가 되는 것은 위조가 아니라 정직 경로에서도 도달한다 —
> `applyStatSums` 가 `*= 1 - sums.fireRatePct/100` 이라 합이 100% 를 넘으면 부호가 뒤집힌다.
> 소비 지점의 `Math.max(2, …)` 가 이를 흡수해 거동은 "최속에서 포화"로 단조롭다(결함 아님).
> 다만 **소비 지점 클램프가 없었다면 발사 쿨다운이 음수가 됐을 자리**라는 점에서, 이 리포가
> "상한은 소비 지점에" 규율을 이미 실천하고 있었다는 물증이다.

**DoS 실측** — `bulletCountAdd` 만 위조(`neutralLoadout()` 에 대입, 나머지 전부 중립):

| `bulletCountAdd` | 600틱 소요 | 틱 종료 엔티티 |
|---|---|---|
| 0 (기본) | 64ms | 59 |
| 13 (정직 상한) | 47ms | 170 |
| 200 | 326ms | 1,853 |
| **2,000** | **2,975ms** | 18,027 |

침공 재실행은 18,000틱이다. 2,000 발 위조는 선형 환산으로 **≈ 89초** — `index.ts` 의
소프트 예산 20초는 물론 Edge Runtime 의 CPU/wall 한도를 넘겨 **검증 함수 자체가 죽는다**.
EF 의 1차 DoS 방어선은 **입력 길이 상한뿐**이고(`index.ts` 헤더 명시), **틱당 비용에는
방어선이 없다**.

### 2.4 권고

두 축을 **분리**해야 한다. 하나는 ADR-0028 이 배제한 것이고, 하나는 아니다.

#### (A) 파워 절대 상한 — **권고하지 않음**

`damageMult`·`maxHpAdd`·`moveSpeedMult` 등에 밸런스성 상한을 거는 것. ADR-0028 이 명시적으로
배제했고(정직 강자 오거부), 근본 해법은 "아이템 획득·진행의 서버 권위 원장 이관"으로 이미 연기됐다.
이 조사는 그 결정을 뒤집을 새 근거를 찾지 못했다.

#### (B) 구조적 위생 가드 — **권고**

ADR-0028 의 반대 논거는 *"정직한 강자를 오거부한다"* 인데, 아래는 **정직 경로가 원리적으로
생산할 수 없는 값**만 막으므로 그 논거가 적용되지 않는다. 정직 런은 단 한 건도 값이 바뀌지 않는다.

신규 leaf `src/sim/loadoutGuard.ts` 에 `normalizeLoadout(lo): LoadoutConfig` 를 두고
**`createWorld` 의 소비 직전**(`world.ts:1020` `const lo = cfg.loadout;` 자리)에서 한 번 통과시킨다.

1. **유한성·정수성** — `Number.isFinite` 아닌 값은 중립값으로, 정수 축(`bulletCountAdd`·
   `pierceAdd`·`maxHpAdd`·`fireDmg`·`coldSlow`·`lightning`·`uniqueMask`·`weaponType`·
   `subWeaponType`)은 `Math.trunc`.
2. **DoS 축 상한** — `bulletCountAdd` 를 정직 상한(13)에서 넉넉한 배수(예: **64**)로 자른다.
   64 는 정직 최댓값의 4.9배라 어떤 정직 빌드도 닿지 않고, 틱당 비용은 실측 200 발보다도 낮다.
   같은 이유로 `pierceAdd` 도 자른다(비용 영향은 미실측 — 상한 근거는 정직 envelope 하나뿐이다).
3. **부호 가드** — 음수가 의미를 갖지 않는 축(`maxHpAdd` 는 음수 허용, `bulletCountAdd`·
   `pierceAdd`·`fireDmg`·`coldSlow`·`lightning` 은 0 하한).

**상한 수치의 정본은 `computeLoadoutStats` 의 실측 envelope 여야 한다** — 손으로 고른 상수를
박으면 훗날 어픽스가 늘 때 정직 빌드를 자르게 된다. 그래서 잠금 테스트를 **두 개** 둔다:

- **위조 테스트**: `LoadoutConfig` **리터럴을 직접 구성**(`computeLoadoutStats` 경유 금지)해
  `bulletCountAdd: 1e6` 을 넣고 `createWorld` → `state.weapon.bulletCount <= CAP` 단언.
- **정직 불변 테스트**(오거부 방지): §2.3 의 축별 최대 세트를 `computeLoadoutStats` 로 만들어
  `normalizeLoadout(x)` 가 **`x` 와 바이트 동일**임을 단언. 이게 (A) 와 (B) 를 갈라놓는 잠금이다.

**요구된 뮤테이션**: 클램프를 `loadout.ts` 의 합산 지점으로 옮긴다 → **위조 테스트가 실패한다**
(리터럴은 그 함수를 지나지 않는다). 정직 불변 테스트는 계속 통과하므로, 이 뮤테이션은
"위치"만을 정확히 압박한다. ✅ 요구 조건 충족.

### 2.5 골든·EF 파급

| 항목 | 파급 |
|---|---|
| `shipHashBaseline`·`invasionHash`·`denoFixture`·`progressionPath` 등 | **없음.** (B)는 정직 값에서 항등이라 sim 거동이 바이트 불변이다. §2.4 의 "정직 불변 테스트"가 이 주장의 물증이다 |
| 침공 24시드 밴드 | 재측정 불필요(같은 이유) |
| `verify-invasion` EF | **재배포 필수.** 클라이언트 측 클램프는 위조자가 클라를 안 쓰므로 무의미하다 — 가드가 실제로 방어하는 순간은 **서버 재실행**뿐이다. EF 는 `src/sim/**` 를 직접 읽으므로 배포만 하면 된다 |
| 결함 1 (가) 채택 시 | 골든·EF **전부 무영향**(문서·테스트만) |
| 결함 1 (나)/(다) 채택 시 | 골든 광범위 이동 + EF 재배포 + 밴드 재측정 |

---

## 3. 계획 §A 대비 정정 사항

| 계획 §A 진술 | 정정 |
|---|---|
| "`powerCentiOf` 호출은 … 17건" | 맞다. 다만 **17종**이고, 그중 `bruiser.ts:94`(`as_bruiser_fortify_hi` 만료 훅)는 rev.3 변경 로그가 놓쳤다 |
| "42종 중 14종에서만 소비" | **관측 기준으로는 맞고 호출 기준으로는 틀리다.** 호출 17 / 완전 반응 14 / 부분 반응 3 / 무반응 25 |
| "`bubble.ts:134` 는 상수 `FILM_ABSORB_FLAT` 직접 대입" | 맞다. 그리고 이런 상수 대입은 bubble 만이 아니라 **5개 기체에 걸쳐 있다**(§1.3) — 부분 복구가 더 나빠지는 진짜 이유 |
| "`loadout.ts` 합산 지점의 클램프는 위조본을 만나지 못한다" | 맞다. **다만 현재 그 자리에 잘못 놓인 클램프는 없다** — 새 클램프를 놓을 때의 함정이지 기존 결함이 아니다 |
| ("결함 2 = 기존 축 중 상한이 잘못된 것 찾기") | **전수 확인 결과 0건.** 기존 결함의 실체는 위치가 아니라 **부재**이고, 그중 방어 가능한 것은 파워가 아니라 **DoS 축**이다(§2.3) |
