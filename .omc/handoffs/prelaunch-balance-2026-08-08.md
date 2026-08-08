# 출시 전 밸런스 확정 레인 — 인계 (2026-08-08)

워크트리: `D:\ClaudeCowork\worktrees\shooting\nifflheim-shelter-ui-9f0c5d`
브랜치: `claude-wt/peaceful-meninsky-867ab5` · **전부 미커밋**(37파일)

`pnpm verify` 는 아직 빨갛다 — **테스트 12건**이 남았고 그중 1건이 이 인계의 주제다.
`tsc --noEmit` · `eslint` 는 클린이다.

---

## 0. 이 레인이 무엇을 했나

원래 계획서(4단계: 치트패널 수정 → 플랫 시그니처 비율화 → 사용자 3런 → 재조정)는 완주했다.
그 위에 사용자가 플레이테스트 루프를 돌리며 밸런스를 직접 확정했다.

### 확정된 값 (전부 사용자 판정)

| 축 | 원래 | 확정 | 자리 |
|---|---|---|---|
| 플레이어 공격력 | 8 | **18.24** (+128%) | `src/sim/world.ts` `DEFAULT_WEAPON.damage` |
| 플레이어 HP | 100 | **151** (+51%) | `DEFAULT_CONFIG.playerHp` **+ 동기화 2곳** |
| 적 수 | ×1 | **×1.3** | `src/sim/enemyScale.ts` `ENEMY_COUNT_MULT` |
| 적 발사 빈도 | ×1 | **×1.3** | 같은 파일 `ENEMY_FIRE_RATE_MULT` |
| 바닥 해저드 빈도 | ×1 | **×0.5** | 같은 파일 `HAZARD_RATE_MULT` |
| 보스 HP | ×1 | **×2** | 같은 파일 `BOSS_HP_MULT` |
| 단계 HP 앵커 11 / 21 | 4 / 22 | **16 / 88** | `data/waves.ts` |
| 브루저 `maxHpBp` | 2500 | **2000** | `data/ships/bruiser.ts` |
| 아크캐스터 `maxHpBp` | −1000 | **−400** | `data/ships/arccaster.ts` |

⚠️ **HP 상수는 셋이 계약으로 묶여 있다** — `DEFAULT_CONFIG.playerHp` ·
`src/items/loadout.ts` `BASE_HP_REF`(maxHpPct 어픽스 기준) · `data/guardian.ts`
`PLAYER_BASE_HP`(침공 수호 파생). 셋 다 151 이다. 하나만 움직이면 조용히 갈린다.

### 구조 개정 셋 (상수가 아니라 형식이 바뀐 것)

1. **버블 막** — `FILM_ABSORB_FLAT = 60`(고정) → `FILM_ABSORB_HP_BP = 2500`(최대 HP 25%),
   런 단위 파생 필드 `WorldState.filmCapacity`. 절대 불사 임계를 없앴다.
2. **해츨링 병아리 탄** — `TURRET_BULLET_DAMAGE`(공유 상수 10) → `BROOD_DAMAGE_BP = 2000`
   (플레이어 발당 피해 20%), `ownerId === BROOD_MARK` 인 포탑에만.
3. **중반 격전 리더 이동 속도** — 결함 수정. `patterns/types.ts`
   `MID_CLASH_LEADER_SPEED = 520`. 사유는 아래 §4.

### 신규 파일 3

- `src/sim/enemyScale.ts` — 적 스케일 계수 모듈(원본 적 데이터를 안 건드리고 소비 지점에서 곱한다)
- `bench/incomingDps.ts` — **초당 피격량 계측기.** 이 레인의 모든 크기 결정의 근거다
- `tests/cheatPanelStandardBuild.test.ts` — 치트 패널 Lv1~4 스타터 킷 폴백 계약

---

## 1. ⭐ 남은 주제 — `tests/catalystResource.test.ts` 스트림 계약

### 무엇이 깨졌나

테스트: *"`id 15`+`id 19` 를 실은 런과 무촉매 런의 세 스트림이 600틱 뒤에도 같다"*
(`tests/catalystResource.test.ts:589~601`). 계약의 뜻은 **"촉매를 실어도 RNG 스트림이
안 밀린다"** 이고, 그게 깨지면 `bench/runCurve.ts` 의 짝지은 base↔cat 비교가 오염된다
(배수 안에 "카드의 힘"이 아닌 것이 섞인다).

### 이미 확보한 증거 (다시 하지 마라)

- **이분 완료**: `ENEMY_FIRE_RATE_MULT` 를 1.3 → 1.0 으로 되돌리면 **그린**.
  `ENEMY_COUNT_MULT` · `HAZARD_RATE_MULT` 를 되돌려도 **레드**(= 원인 아님).
- 갈린 스트림은 **`dropRng` 하나뿐**. `waveRng` · `powerupRng` 는 동일
  (`rngStates` = `[dropRng, waveRng, powerupRng]`, 같은 파일 140행).
- **최초 발산 t=462**: 처치 수 17(무촉매) vs 16(촉매). 플레이어 HP 는 **양쪽 103 동일**.
  즉 플레이어 생존 차이가 아니라 **적 하나가 한쪽에서만 죽었다**.
- 두 런의 `catalystMods` 는 **완전히 동일**하다(전 축 1.0). 즉 카드 15/19 는 적
  HP·피해·수를 안 건드린다 — 테스트 주석의 전제("이미 뽑힌 결과에 곱하거나 뒤에 붙기만")는
  적어도 `catalystMods` 축에서는 참이다.

### 남은 질문

`catalystMods` 가 같은데 **왜 적 하나가 한쪽에서만 죽는가.** 유력 가설(미검증):

1. **엔티티 배열 순서** — 카드 15/19 가 loot/crystal 엔티티를 추가하면 배열 인덱스가 밀린다.
   `nearestTarget` 의 동률 tie-break 이 배열 순서라, 동률이 한 번이라도 나면 조준이 갈린다.
   발사 빈도 ↑ 로 적 위치·타이밍이 달라져 그 동률이 처음 발생했을 가능성.
2. **해저드/탄이 적을 죽이는 경로** — `spawnHazard` 는 `ownerId` 를 싣는데, 잡몹 해저드가
   다른 잡몹에 피해를 주는 경로가 있는지 확인 필요(있다면 발사 빈도가 직접 처치 수를 바꾼다).
3. **`compact()` 순회** — 죽은 엔티티 정리 순서가 배열 구성에 의존하는지.

### 재현 스니펫

```ts
import { createWorld, stepWorld, DEFAULT_CONFIG, emptyInput } from '../src/sim/world.js';
const IDLE = emptyInput();
const a = createWorld(0xca7a, { ...DEFAULT_CONFIG });
const b = createWorld(0xca7a, { ...DEFAULT_CONFIG, catalysts: [15, 19] });
for (let t = 0; t < 600; t++) {
  stepWorld(a, IDLE); stepWorld(b, IDLE);
  if (a.kills !== b.kills) { console.log(t, a.kills, b.kills); break; }
}
// -> t=462  17 16
```

### 판정 기준

이것이 **이 레인이 만든 결함**인지 **원래 있던 취약성이 드러난 것**인지를 먼저 가른다.
후자라면(가설 1·3이면) 고칠 자리는 `enemyScale.ts` 가 아니라 tie-break/순회 쪽이고,
계약 자체를 더 튼튼하게 만드는 일이 된다.

⚠️ **계수를 되돌려서 테스트를 통과시키는 것은 답이 아니다** — `ENEMY_FIRE_RATE_MULT` 는
사용자가 화면을 보고 확정한 값이다(그걸 내리면 화면 탄 수가 +46% → +30% 로 내려간다).

---

## 2. 남은 기계적 정리 11건

전부 **관측 창·임계 기준선이 밸런스와 함께 움직인 것**이다. 이 레인이 앞서 같은 패턴을
여러 번 처리했으니 그 커밋들의 주석 형식을 그대로 따르면 된다.

| 파일 | 건수 |
|---|---|
| `tests/shipSignaturePhantom.test.ts` | 2 |
| `tests/shipSignatureWiring.test.ts` | 2 (팬텀 2건) |
| `tests/shipSignatureHatchling.test.ts` | 1 |
| `tests/skillStriker.test.ts` | 1 |
| `tests/skillPhantom.test.ts` | 1 |
| `tests/uniques.test.ts` | 1 |
| `tests/invasionFacility.test.ts` | 1 |
| `tests/invasionFormation.test.ts` | 1 |
| `tests/wallSlidePin.test.ts` | 1 |

### 정리 원칙 (이 레인이 지킨 것 — 이어서 지켜라)

- **리터럴을 정본 파생으로 바꿔라.** 기본 피해·기본 HP 를 테스트가 리터럴로 박아 두면
  밸런스를 만질 때마다 빨개진다. 이 레인은 `buildStatus`·`skills`·`loadout`·
  `shipSignatureStriker` 를 `DEFAULT_WEAPON.damage` / `DEFAULT_CONFIG.playerHp` 파생으로
  바꿨다. 같은 형태를 이어라.
- **관측 창이 좁아 실패하면 하한을 낮추기 전에 창이 왜 막히는지 재라.** 해츨링에서
  틱을 늘려도 안 되는 것을 실측(무입력 파일럿이 세그먼트 처치 목표 앞에서 kills 가 1,800틱에
  28 로 멈춘다)으로 확인한 뒤에 하한을 내렸고, 그 실측을 주석에 남겼다.
- **처치 수가 동타가 되면 `enemyHpSum` 으로 갈아타라**(선례: `shipSignatureWiring.test.ts`
  동명 필드 — "피해 산술 변화가 처치 수를 못 바꿔도 여기선 보인다").

---

## 3. 이미 끝난 정리 18건 — 근거를 남겨 뒀다

### ⭐ 교환 대조를 재생성보다 **먼저** 했다

레인이 바꾼 밸런스 상수 **14개를 전부 원래 값으로 되돌리자** `enemyStasis` ·
`volleyExtraction` · `catalystResource` 가 **48/48 그린으로 복원**됐다. 즉 해시 발산의
원인은 그 상수들뿐이고 숨은 회귀는 없다. 그 근거를 각 골든 주석에 적어 뒀다.

형식이 바뀐 둘은 등가 계수로 되돌렸다: `FILM_ABSORB_HP_BP` 2500 → **6000**(기본 HP 100 에서
옛 고정값 60), `BROOD_DAMAGE_BP` 2000 → **12500**(기본 피해 8 에서 옛 고정값 10).

### 재녹화한 골든

- `tests/pilotFrameFreeze.test.ts` — 18/18 전량(재동결 이력 주석 추가)
- `tests/volleyExtraction.test.ts` — 6건
- `tests/enemyStasis.test.ts` — 1건

### 부수적으로 드러난 진짜 갈림 (테스트로 못 박아 뒀다)

기본 피해가 정수 8 → 소수 18.24 가 되면서 **`marksmanDamage`(순수 함수, `Math.trunc` 규약)와
`world.ts` 인라인 산술이 처음으로 값이 갈린다**(27 vs 27.24). 예전엔 우연히 같았다.
`tests/shipSignatureStriker.test.ts` 가 그 갈림 자체를 단언한다 — 다음 사람이 "순수 함수를
쓰면 되지 않나" 로 되돌리지 않도록.

---

## 4. 함께 고친 결함 하나 — 중반 격전 리더 (밸런스 아님)

**증상**: 사용자 신고 *"4단계부터 스테이지 단계가 너무 안 올라가"*.

**원인**: 런의 4번째 구간(중반 격전, `WaveSegment.clash`)은 6구간 중 유일하게 전진 게이트가
처치 수가 아니라 **"격전 리더 처치" 하나뿐**이다(`killGoal: 0`). 그런데 리더 기반 정의는
`planet.elites[0]` 이고 **6행성 전부** 그 자리가 `standoff` 이동에 속도 140~170 인 포대형이다.
플레이어 속도는 **720**. 즉 움직이는 플레이어에게 리더가 **원리적으로 도달할 수 없고**,
자동 조준은 최근접을 고르므로 주변에 잡몹이 있는 한 조준 대상조차 안 된다.

**이 레인이 만든 결함이 아니다** — 원래 있었고 적 수 +30% 가 드러나게 했다.

**수정**: `patterns/types.ts` 에 `MID_CLASH_LEADER_SPEED = 520` 을 두고 `applyMovement` 가
마커(`aux1 === MID_CLASH_LEADER_MARK`)를 보고 `def.speed` 대신 쓴다. 마커 없는 적은 종전과
비트 동일. 정의 교체는 불가(카르곤 `elites[1]` 은 `stationary` 속도 0 이라 더 나쁘다).

**교환 대조 실측**(플레이어가 계속 원을 그리며 이동, 30초):

| | 리더가 사거리(1650) 안 | 거리 중앙값 |
|---|---|---|
| 카르곤 전 → 후 | 54% → **100%** | 1574 → 1304px |
| 베르단 전 → 후 | 41% → **100%** | 1768 → 1356px |
| 니플헤임 전 → 후 | 94%(30초 생존) → **100%**(2초 처치) | 730 → 1331px |

⚠️ **520 은 체감 미검증값**이다(TODO(밸런스) 표기). 사용자가 이 수정 뒤 재플레이를 안 했다.

---

## 5. 마무리에 남은 일

1. §1 해결 · §2 11건 정리
2. `pnpm verify` 전량 그린 (**파이프에 물리지 마라** — exit code 가 덮인다)
3. `.omc/plans/balance-queue.md` 에 절 추가(현재 마지막 §R50):
   - **§R51 장비 축 포화** — 어픽스 롤 값이 아이템 레벨과 무관해 표준 장비가 `8칸 × 6어픽스`
     로 포화한다. 실측 근거가 이번에 더 강해졌다: **사용자 런에서 Lv100 maxHp 276 <
     Lv50 maxHp 337**. 만렙이 절반 레벨보다 약하다. ADR-0037 이 어픽스 롤을 불가침으로
     못 박았으므로 별도 레인.
   - **§R52 이 레인의 일반화** — ①계산으로 넣은 보상이 이중 보상이었던 사례
     (`ENEMY_DAMAGE_MULT` 0.6 → 1.0, 계측기가 잡았다) ②봇은 카이팅해서 탄 증가를 못 잰다
     (난이도 델타는 사람만) ③진행 게이트가 하나뿐인 구간은 그 게이트 도달 가능성을 먼저 검사하라
     (격전 리더) ④밸런스 상수를 리터럴로 박은 테스트는 튜닝할 때마다 빨개진다 → 정본 파생.
4. 브랜치 → PR → 머지(사용자 상시 승인). **PR 본문은 한글, 수치 근거를 표로.**
   **사용자 5런의 체감과 기록을 반드시 인용하라** — 이 레인의 결론이 그 위에 서 있다:

   | 런 | 시간 | 결과 | HP 손실 | 사용자 체감 |
   |---|---|---|---|---|
   | Lv1 / 단계1 | 108초 | 사망(보스 25% 남김) | 100% | (공격력 +10% 지시) |
   | Lv50 / 단계10 (1차) | 80초 | 승리 | **0%** | "좀 쉬웠다" |
   | Lv100 / 단계20 (1차) | 100초 | 승리 | 5.8% | "좀 쉬웠다" |
   | Lv50 / 단계10 (2차) | 80초 | 승리 | 9.5% | "아직도 좀 쉽긴해" |
   | Lv100 / 단계20 (2차) | 85초 | 승리 | 10.1% | "아직도 좀 쉽긴해" |

   전 런 `tainted: false` · 스트라이커 · 카르곤 · 치트 패널 「표준 빌드 점프」.
   ⚠️ **마지막 앵커 2배(16/88)만 재플레이로 검증되지 않았다** — "확정하자" 지시와 함께
   들어왔다. 출시 후 텔레메트리에서 가장 먼저 다시 볼 값이다.

---

## 6. 명목표 최종 상태 (`pnpm bench:nominal --gear=none`)

```
SHIP        DPS    EHP    POWER   RATIO
striker   190.0  151.0    28690   1.000
bruiser   185.2  201.1    37243   1.298
arccaster 194.2  145.0    28155   0.981
phantom   211.6  137.0    28990   1.010
hatchling 201.5  166.0    33443   1.166
mallow    164.5  194.3    31962   1.114
bubble    201.0  147.4    29619   1.032
SPREAD max/min = 1.323  (band <= 1.35)  PASS
```

`--sens` 감도: 중간 4종은 가정치 변형에 순위가 뒤집힌다(모델 해상도 안에서 구분 불가 —
건드리지 마라). 브루저 1위·아크캐스터 꼴찌만 고정이라 그 둘만 조정했다.
