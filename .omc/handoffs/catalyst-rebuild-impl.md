# 인계 — 촉매 전면 재구축 구현 레인 (ADR-0052)

> **설계가 아니라 인계다.** 설계 정본은 `docs/adr/0052-*` + `.omc/plans/catalyst-rebuild-2026-08-06/**`
> 이고 여기를 고쳐서 설계를 바꾸지 않는다. 여기 적는 것은 **이 레인이 실측으로 알아낸 것**과
> **다음 레인이 밟을 지뢰**뿐이다.
>
> 앞 인계: `.omc/handoffs/skill-catalyst-merged-lane.md` · `.omc/handoffs/s3-checklist.md`
> (§「촉매 48종 배선 — 착수 불가다」가 이 레인의 출발점이다)

브랜치 `feat/catalyst-rebuild-impl`, 기준 main **`a04309c`**. 워크트리 `D:/ClaudeCowork/shooting-catalyst-impl`.

---

## 0. ⚠️ 착수 전에 알아야 할 것 — 인계가 낡았던 두 곳

1. **`pnpm test:sim` 은 존재하지 않는다.** ADR-0050 §결정 1(2026-08-07, PR #358)이 그 3파일과
   `vite.sim.config.ts`·`scripts/deno-verify/**` 를 전부 지웠다. 결정론은 기본 스위트의
   `tests/determinismGate.test.ts`(약 3초)가 상시로 지킨다. **검증은 2단이다** — 편집 중 지정 실행,
   PR 전 `pnpm verify`. 촉매 작업 지시서가 여전히 `test:sim` 을 요구하면 그것은 낡은 문장이다.
2. **선결 과제 상당수가 이미 main 에 있었다.** 스킬 배선 레인이 함께 깔았다:
   `SLOT_CAP` 8→3 · `CAP_RESOURCE_MULT_MAX` 리터럴화(`572443c`) · `catalystHooks.ts` 앵커 14개 +
   호출 계측 · `catalystSlots.ts`(폭 6 + 해시 꼬리 폴드) · `blastDamage` 사망 마킹(선결 ⑨, 8건
   부류로 완결) · `status.ts` 정지 축(`applyStasis`). **착수 전에 `git log -- src/sim/catalystHooks.ts`
   를 먼저 봐라.**

---

## 1. ⭐⭐ 무촉매 런 바이트 불변 — **방법과 기준값**

헌장이 못 박은 것: *"골든 재생성은 검증이 아니다. 근거는 재생성 **전에** 통과시킨 불변식
(무촉매 런 바이트 불변 대조)이어야 한다."*

⚠️ **`determinismGate` 로는 이것을 못 잰다.** 그 게이트는 **자기 재현성**(같은 시드 두 번 → 같은
해시)만 본다 — "이 브랜치가 스스로 결정론적인가"이지 **"main 과 같은가"가 아니다.** 골든 상수를
일부러 갖지 않는 파일이라(CLAUDE.md 가 그 이유를 적었다) 크로스 브랜치 대조를 거기 넣으면 안 된다.

그래서 **`scripts/catalystByteInvariance.ts`** 를 세웠다. 12런(행성 2 × 빌드 6) × **6000틱**을
`recordRun` 과 **같은 시드·설정·입력 조립**으로 돌려 per-tick 해시를 4구간으로 접어 JSON 으로 뱉는다.

```
npx tsx scripts/catalystByteInvariance.ts > impl.json      # 작업 브랜치
npx tsx scripts/catalystByteInvariance.ts > main.json      # main 체크아웃
```

**기준 sha256 (main `a04309c` == `feat/catalyst-rebuild-impl` 레인 A·C0 착지 시점):**

```
1550adcc35806a30faadbd2fa58693b72fc2b2f8ed6ee65671360654ee004d3f
```

**이 값이 바뀌면 촉매와 무관한 런의 거동이 갈린 것이다.** 골든 재생성으로 덮지 말고 원인을 찾아라.
구간을 넷으로 접어 두었으므로 **발산이 언제 시작됐는지가 diff 에서 바로 읽힌다.**

---

## 2. 1일차 판정 — 적↔해저드는 **§A** (예산 통과)

`audit.md` 가 미확정으로 남긴 것(`id 4`·`8`·`22`·`31`). 코드 대조 결론:

- 게이트 `state.catalystOn` 이 **이미 있다**(`world.ts:1343-1352`) → 신규 `WorldState` 칸 0
- 판별자·피해·처치가 전부 기존 필드 재해석 — `hazard.enemyType` 신규 코드값(`entities.ts:301`
  의 서브타입 선례 3건) · `e.hp` · `e.dead`
- per-tick 단계는 `catalystOn` **조건부 꼬리**라 무촉매 런은 루프 0회 → 해시 불변.
  같은 규율이 이미 5곳에서 작동한다(`stepEcho`·`stepEncounter`·`stepInvasionLayer`·오염·추격)

→ **§A 46 / §B 14 / §C 0**. 카드 축소 불필요.

**임계 미지 하나**: 규칙 문장이 *"한 해저드가 같은 적을 한 번만 때린다"* 를 요구하면 적별 장부가
필요한데 적 `iframes` 는 화상 마커가 점유하고 `aux0` 는 카드 여섯이 다툰다 → 그때는 §B 로 뒤집힌다.
회피법: 시한부 해저드를 `life` 로 1틱 활성으로 기술하거나(단발), 지속 장판은 *"머무는 동안 매 틱
소량"* 으로 쓰면 장부가 원리적으로 불필요하다.

### 삽입 지점 (실측)
- **권장**: `world.ts:4099` 직후 — `resolveCollisions` 의 격자 삽입 루프가 끝난 자리이자 아군탄
  해소 직전. `state.grid` 가 이미 차 있어 `grid.query(h.x, h.y, h.radius, cb)` 로 끝나고, 처치가
  같은 틱 `compact()` 에 잡힌다.
- **비권장**: `stepHazards`(`:1990`)와 `resolveCollisions`(`:1991`) 사이 — 격자가 아직 없어 전체 스캔.

### 촉매 해저드 동시 상한
`MAX_ACTIVE_GIMMICKS`(160)와 **무관하다** — `isGimmick` 의 해저드 조건이 `e.life < 0`(영구)뿐이라
시한부 촉매 해저드는 그 예산을 먹지도, 청크 컬링을 받지도 않는다. **`life` 가 유일한 소멸 경로라
사실상 무제한**이다. → **전용 상수 + 스폰 지점 자체 카운트**가 정답이고 선례가 있다:
`PO8_LIVE_CAP = 12`(`src/sim/skills/bubble.ts:252-260`) — 초과분은 **스폰만 생략하고 RNG 는
소비하지 않는다**(공통-B(c) 준수).
⚠️ **촉매 해저드를 영구(`life < 0`)로 만들지 마라** — 그 순간 `MAX_ACTIVE_GIMMICKS` 를 잠식해
청크 생성이 밀리고, 어느 청크가 밀리는지가 플레이어 경로에 의존해 **AC3 경로 독립성이 깨진다**.

---

## 3. 사용자 판정 (2026-08-08)

### 3-1. 대시 관통 → **통과 판정만 신설. 대시는 피해를 주지 않는다.**
`id 12`·`27`·`29` 의 되돌림 조항이 「대시로 적을 관통(해 죽이)면」인데 **sim 에 대시 피해도 통과
판정도 없다**(대시 블록은 `vx`/`vy`·`dashCooldown`·`iframes`·적탄 소거뿐, `iframes` 중엔 적도 안
맞는다). 되돌림 없이 얹으면 셋 다 단조 감소가 되어 헌장 §페널티 규율 3 위반이다.

**대시에 피해를 붙이지 마라** — ADR-0052 의 ADR-0021 개정문이 *"조작 코어(기체 이동·자동공격·
판정점)는 여전히 불변"* 이라고 명시했고, 대시를 공격기로 바꾸는 것은 210 스킬·전 기체 밸런스에
파급된다. `id 27` 의 "관통해 죽이면"은 **"통과한 적이 그 대시 중 죽으면"** 으로 읽는다.

⚠️ 판정은 **선분(swept) 대 원**이어야 한다 — 대시는 한 틱에 여러 픽셀을 건너뛴다
(`point-blank-immunity-swept-collision` 이 같은 결함을 이미 한 번 겪었다).

### 3-2. 태그쌍 상한 위반 → **재태깅**
카탈로그가 헌장 §태그쌍 4장 상한을 **스스로 어기고 있었다**: `도박+수확` **9장** ·
`도박+정밀` **8장**(48중 17장이 두 쌍에). 헌장은 3판에서 `{정밀,도박}` **6장**을 *"태그 시스템의
해상도가 깎인다"* 로 기각했다.

**물증**: 48C3 전수 스윕에서 **유효 조합 12,430 중 95.74%에서 공명이 발동**했다 — 공명이 "선택"이
아니라 기본값이다. 헌장 의도(약공명은 **우연히** 만나는 경로, 강공명은 전 슬롯을 바치는 **선택**)와
정반대다.

→ **태그만** 고친다(규칙문·상한·훅·id·slug 불변). 끝나면 `audit.md` 전수 대조표 재실행 + 발동률
재측정이 **의무**다(헌장이 명시).

### 3-3. `id 20 resonance` 표시명 → **동조**(EN `Attunement`)
시스템 용어 "공명"과 충돌한다. 헌장이 *"한글 표시명은 바꿀 수 있다(slug 는 불변)"* 라고 명시했고
`slug: 'resonance'`·id·아이콘 파일명은 그대로다. EN 도 같은 충돌이라 함께 바꿨다.

---

## 4. 설계 문서 오류 (문서를 고칠 사람이 필요하다 — 규칙 본문과는 충돌하지 않는다)

전부 **요약표의 갱신 누락**이고 규칙 본문은 멀쩡하다. `impl-contract-table.md` §정본 내부 불일치에
근거와 함께 적어 뒀다.

| # | 위치 | 문서 | 실제 |
|---|---|---|---|
| 1 | `catalog-common.md` §보상 축 분포·§상한 합성 | `id 15 extraction` 이 **자원축**, 상한 2.5 | 본문 명세는 **드랍 ×2.4**(4판에서 `id 17` 과의 중복 판별을 깨려고 옮겼다고 명시) |
| 2 | `audit.md` §공명 12 표의 훅 열 | `밀도강`·`도박강`·`침식강` = §B, `점화약` = §A | 같은 문서의 §강등 3종 실행 완료·§4판에서 올라간 둘이 **정반대**. §재집계(§B = 점화약·정밀강)가 맞다 |
| 3 | `audit.md` §훅 예산 재집계 §A 행 | **44** | 총 60(카드 48+공명 12) − §B 14 − §C 0 = **46**. 23+12+9 로 둘을 빠뜨렸다. `catalog-signature.md` §검산은 46 이라 그쪽이 맞다 |
| 4 | `catalog-common.md:374` | 해저드 피해 지점 `world.ts:4010` | 실제 **`world.ts:4544-4558`** |
| 5 | `audit.md:117` | §B 확정 시 **21** | 작업 지시서는 18 이라 적었다 — 회계 원본이 갈려 있다(판정이 §A 라 지금은 무해) |
| 6 | `catalog-common.md` §검산 훅 예산 | §A 33 / §B 9 | 3판 수치. `audit.md` 5판 재집계가 정본 |

---

## 5. 이 레인이 세운 구조

### 5-1. `src/data/catalysts.ts` — 규칙 모델
**폐기**: `RewardAxis`·`PenaltyAxis`·`PowerStat` 6+6+5 격자 · `reward`/`penalty` 필드 ·
`perStack` 4상수 · `catalystRewardMult`/`catalystPenaltyMult`/`catalystPowerMult`/`resourceMultOf`.
**신설**: `tags` · `cap{axis,mult}` · `hook` · `voidOnModes?` · `SIGNATURE_CAP` ·
`isWithinSignatureCap` · `hasCatalyst` · `catalystVoidOnMode` · `axisCapMult` · `resourceCapMult` ·
`allAxisCapMult` · `CATALYST_CAP_MIRROR` · `MODE_HOOK` 6→**18**.
**거동 변경**: `normalizeCatalystArray` 가 **중복을 제거**한다(유니크 주입). 전에는 스택 보존이었다.
**불변**: `id`·`slug`·`dropWeight`·아이콘 48장·가격 함수 전부 — 48종 구매가·환급액이 재작성 전후로
**동일**하고 그것을 리터럴 표로 잠갔다(`tests/catalysts.test.ts` 의 `PRICE_BASELINE`).

### 5-2. ⚠️ `catalystMods` 를 **지우지 않았다** — 촉매 전용이 아니었다
축 모델을 지우면 이 번들도 같이 지우고 싶어지는데, 실측 소비자가 둘 더 있다:
- **조우 제단 부스트**(`encounters/light.ts:406-412`)가 `drop` 을 런 중에 곱한다
- **스킬 앵커**(`skillHooks.ts:950`)가 `rarity` 를 인자로 받는다

즉 이것은 이제 "촉매 배율 번들"이 아니라 **런 배율 번들**이다. `resolveCatalystMods` 는 **항상
중립**을 반환하게 하고 필드는 남겼다 — 재작성된 48종 중 여럿이 **런 중에** 이 노브를 쓴다
(`id 0` 전리품 더미가 적을 가속 · `id 30` 세그먼트 적 상한 누진 · `id 43` 구름 안 적 가속).
구 모델과의 차이는 **출격 시점에 축 테이블에서 한 번 접히는 것이 아니라 규칙이 런 중에 조건부로
쓴다**는 것이다.
⚠️ 그러므로 `state.catalystMods` 는 읽기 전용이 아니다. 쓸 때는 필드 직접 대입이 아니라
**번들 통째 교체**(스프레드)를 따라라 — `encounters/light.ts:406-412` 가 선례이고 사유가 거기 있다.

### 5-3. ⚠️ 촉매 드랍 배율을 **주입 목록에서 파생하지 않는다**
구 코드는 `catalystRewardMult(ids,'catalystDrop')` 로 **카드를 꽂았다는 사실만으로** 배율을 세웠다 —
그것이 곧 헌장 §상한 근거 규율이 금지한 **무조건 배율**이다. 촉매 드랍축 4종(`id 21`·`33`·`38`·`45`)은
전부 조건부다. `CatalystDropInput.catalystDropMult?`(기본 1)로 옮겨 **sim 이 규칙 발동을 실제로 세어
넘기게** 했다.

### 5-4. `src/sim/catalystMarks.ts` — 적 `aux0` 비트 인코딩 표 (선결 ①)
23/32비트. `aux1` 무접촉(`MID_CLASH_LEADER_MARK` 가 매 런 확정 점유 — 덮으면 중반 격전이 공짜 통과).
**대상은 `kind === 'enemy'` 뿐이다** — `aux0` 는 kind 마다 뜻이 달라서 플레이어(장갑·클로크·커션)나
보스(추격 취약화 플래그)에 찍으면 안 된다. 접근자(`readMark`/`writeMark`/`clearMarks`)를 우회해
비트를 직접 만지지 마라. **모든 쓰기는 촉매 게이트 안쪽**(`aux0` 는 `hashEntity` 가 접는다).

### 5-5. `EntitySnapshot.catalystMark` (선결 3 — 감사표 §미해결 3)
`aux0`/`aux1` 이 스냅샷에 없어 **도금 색·금빛 표식·동조 광선·강탈 외곽선·그림자 다섯 카드의 신호가
렌더에 도달할 수단이 아예 없었다.** 가시성은 ADR-0052 에서 **채택의 전제조건**이라 연출 편의가
아니라 선결이다. ⚠️ `aux0` 원값이 아니라 **촉매 구역만** 싣는다(원값을 흘리면 렌더가 보스의
취약화 플래그를 도금 단계로 오독한다). 스냅샷은 해시 대상이 아니라 sim 계약은 불변이다.

### 5-6. `src/data/catalystResonance.ts` — 공명 12, `data/` 리프
sim·EF 가 **같은 표를 읽어야** 재실행이 갈리지 않는다(감사표 §미해결 5). `resolveResonance` 가
유일 정본 — 한 런에 하나, 강 우선, 동급이면 태그 우선순위. **네 곳이 각자 판정하면 갈린다.**

---

## 6. ⭐ 48C3 전수 상한 — 손 계산이 **세 번째로** 틀렸다

`scripts/catalystCapSweep.ts` + `pnpm cap:sweep`. 테스트는 3ms(전수는 스크립트가, 테스트는 대표
조합 + 산식 불변식만 — 전체 스위트 예산 55초를 지키려고).

**유효 조합 필터가 결정적이다**: 48C3 = 17,296 중 **4,866 이 불가능**하다(특산 3장이거나 서로 다른
행성 특산 2장 — 런은 한 행성에서 벌어진다). 이 필터를 안 넣으면 상한이 과대평가된다.

문서 손 계산이 **전축 최악을 놓친 원인이 또 같은 패턴**이다 — 희귀도축 최악 3장이 **전부 `도박`
태그라 강공명이 뜨는데** 그것을 못 봤다. 헌장이 "손으로 하지 마라"고 적은 사유가 3판·4판에 이어
**세 번째로** 재현됐다.

⚠️ **재태깅 후 스윕을 반드시 다시 돌려라** — 태그가 바뀌면 공명 발동이 바뀌고 축별 최댓값도 바뀐다.
`CAP_RESOURCE_MULT_MAX` 는 그 **재측정값**으로 정한다(현행 리터럴 2.2 는 설계 상한을 크게 잘라낸다).

---

## 7. 되살릴 것 — 파킹된 브랜치 둘

`origin` 에 보존돼 있다. **완성됐고 테스트·뮤테이션까지 붙어 있다.**
- **`feat/catalyst-progress`** (`1754eb7`) — `id 9 epiphany` · `id 14 mastery`
- **`feat/catalyst-defense`** (`b10e54d`) — `id 24 chainreaction`

막고 있던 것은 *"구 축 보너스 + 신 고유 효과 이중 적용"* 이었는데(데이터의 `reward.axis` 가
런타임에 실제로 소비됐다), **축 모델을 지웠으므로 그 사유가 사라졌다.** 되살릴 때:
- `world.ts` 의 촉매 파워 굽기 블록도 함께 지워졌으니 이중 적용 경로가 둘 다 닫혔다
- `feat/catalyst-progress` 의 `tests/catalystProgress.test.ts` 는 **RNG 소비량 불변**을
  `powerupRng.getState()` 로 직접 잠그는 형태다 — 그대로 재사용해라
- ⚠️ `ChainReactionSlot` 이 **슬롯 0·1 을 선점**했다. 전역 배분표(아래)와 충돌하는지 먼저 봐라

---

## 8. ⛔ 다음 레인이 먼저 풀어야 할 것 — **슬롯 폭 6이 모자란다**

`CATALYST_SLOT_COUNT = 6`(`src/sim/catalystSlots.ts`)이고 그 파일이 **"48종 전역에서 정적으로
유일한 배분표가 필요하다"** 고 적었다. 그런데:

- **공용 §B 7종**(`5·10·16·25·26·28·29`)은 서로 **임의로 공존**할 수 있으므로 각자 유일한 슬롯이
  필요하다 → 이미 7 > 6 이다.
- 특산은 **같은 행성끼리만 공존**하므로 행성 간 슬롯 재사용이 가능하다(니플헤임 `36`·`38` 만
  같은 행성이라 둘은 갈라야 한다).
- 카드당 **2칸**을 요구하는 것이 셋 있다(그 파일 헤더가 6 = 3장 × 2칸으로 도출한 근거).

→ **폭을 늘려야 한다.** 늘리면 고정폭 폴드가 바뀌어 **골든 전량 재생성 대상**이 되는데, ADR-0052 는
그것을 이미 §귀결로 명시했으므로 새 비용이 아니다. 다만 **한 번에 정확히 정하고 늘려라** — 두 번
늘리면 재생성이 두 번이다. 배분표를 먼저 확정한 뒤 폭을 도출해라. 폭을 늘리기 전에 `replay.ts` 의
촉매 슬롯 폴드 주석(**append-only 계약**, 진짜 맨 꼬리인지 확인하라는 경고)을 반드시 읽어라.

### 배분 규칙 — 무엇이 슬롯을 **안** 먹는지부터 확정해라
폭을 도출하기 전에 아래 셋을 먼저 걷어내면 남는 것이 작아진다.

1. **적 단위 상태는 슬롯이 아니라 `aux0` 다** — `id 1`(강탈) · `id 6`(도금) · `id 15`(실린 액수) ·
   `id 17`(금빛 액수) · `id 20`(동조) · `id 29`(이동 불능) · `id 36`(그림자) · 점화 약공명(밀려남).
   전부 `catalystMarks.ts` 의 비트 구역이고 **월드 슬롯을 한 칸도 안 먹는다.**
2. **틱의 순수 파생은 슬롯이 아니다** — `id 33`(안전 원 중심 = `mix32(floor(tick/JUMP), SALT)`) ·
   침식 강공명(반경 = `floor(tick/1800)` + `state.wave.segmentIndex`) · `id 12`(누적 비율 =
   현재 최대 HP ÷ 기준 최대 HP). 설계가 **일부러** 이렇게 쓴 것이라 저장하면 §B 로 되올라간다.
3. **기존 필드 재해석은 슬롯이 아니다** — 도박 강공명(`state.loot[0]` 의 `rarity` 예약값) ·
   `id 13`(`bullet.radius`) · `id 2`/정밀 약공명/밀도 강공명(`bullet.pierce`).

**남는 것(월드 슬롯 실수요) — 배선 레인이 확정할 후보**:
공용 `5`(정련로) · `10`(예고 큐) · `16`(kills 델타) · `25`(열) · `26`(방향 지속) ·
`28`(방벽 지속 + 방향 = **2칸**) → **8칸**. 이 일곱은 서로 임의 공존하므로 **전부 유일해야 한다.**
특산 `36`(경로 큐, 2칸일 수 있다) · `38`(복구 진행도) · `41`(관문 3종 상태) · `46`(조각 수) →
같은 행성끼리만 겹치므로 **니플헤임 `36`·`38` 만 갈리면 되고 나머지는 재사용 가능** → **3~4칸**.
정밀 강공명(반사) → **1칸**. 한 런에 공명은 하나뿐이라 공명끼리는 재사용된다.

⚠️ **`id 29` 는 §B 재등급 후보다** — `audit.md` 가 §B 로 올린 사유가 *"이동 불능을 표현할 수단이
없다(`COLD_SLOW_MULT` 고정)"* 였는데, 그 사이 `status.ts` 에 **정지 축(`applyStasis`/
`enemyStatusStopMult`)이 생겼다**(스킬 배선 레인 S9 작업). 수단이 생겼으므로 §A 로 내려갈 수 있고,
그러면 §B 예산에 **여유 1** 이 생긴다. **배선 레인이 코드로 확인하고 재등급하라** — 그때
`audit.md` 와 `impl-contract-table.md` 를 함께 고쳐야 한다.

→ 위 합이 대략 **12~13칸**이다. **여유를 크게 잡아 한 번에 정하되**, 미배정 슬롯의 오인덱스가
**조용한 무연산**이 되는 것이 `skillSlots.ts` 가 폭을 좁게 고른 사유임을 기억해라 —
`assertCatalystSlot` 이 범위 밖을 **던지므로** 그 함정은 이미 닫혀 있다.

---

## 8-2. 이 레인이 **직접 잡은 결함 셋** (병렬 레인 산출물의 이음매에서 나왔다)

레인별 산출물은 각자 초록이었는데 **이음매**가 셋 새 있었다. 같은 형태를 반복하지 마라.

1. **상한 합성식이 세 곳에 흩어졌고 그중 하나만 공명을 셌다.**
   `catalysts.ts:axisCapMult`(촉매분만) · `catalystCapSweep.ts:axisTotal`(공명 포함) ·
   `consume_catalysts`(공명 포함) — 그런데 하네스 모의가 **반쪽인 첫 번째**를 써서 서버 영수증과
   값이 갈렸다. → 공명 포함본을 `catalystResonance.ts` 에 **유일 정본**으로 세우고
   (`axisCapMultWithResonance`/`resourceCapMultWithResonance`/`allAxisCapMultWithResonance`),
   `catalysts.ts` 쪽은 "부분합"이라고 주석에 못 박았다.
   ⚠️ `catalysts.ts` 가 공명을 못 세는 것은 게으름이 아니라 **모듈 방향**이다 — 공명 파일이
   `catalysts.ts` 를 import 하므로 반대는 순환이다.
2. **하네스 모의가 서버보다 관대했다.** `normalizeCatalystArray` 가 중복을 **제거**하므로
   `[15,15]` 가 조용히 `[15]` 로 통과했는데 서버 게이트 (e)는 **거부**한다 — "하네스에선 되는데
   출격하면 튕기는" 거짓 그린이다. → **정규화 전 원본 배열**로 중복을 판정하게 고치고 특산
   상한도 붙였다. **순서가 계약이다.**
3. **재태깅이 SQL 태그 시드 9행을 낡게 만들었다.** 계약 테스트가 잡았다 — 이것이 lane E 가
   태그를 **하드코딩하지 않고 컬럼으로 실은** 설계의 값어치다(판정 로직은 안 고쳤다).

부수로 둘 더: 구 `power` 축이 사라져 `catalyst_axis_power_*` 5장이 등재에서 빠졌다(실물은
원래 없던 부채라 지울 파일은 없다) · `catalystNet` 의 스택 전제(`[2,15,15]`)가 유니크 주입으로
낡았다.

## 8-3. ⚠️ 병렬 레인 운용에서 실제로 밟은 것

- **한 레인이 `git stash push <path>` 를 썼다**(약 30초, 파일 1개). `git stash` 는 **리포 전역**이라
  같은 워크트리의 다른 레인을 오염시킬 수 있다. 그 레인이 자기 편집 생존을 확인했고 이후 전체
  스위트가 초록이라 실해는 없었지만, **병렬 레인에서 stash 는 금지**로 지시해야 한다.
- **`vi.mock` 은 모듈 내부 호출을 못 잡는다.** 앵커 레인이 `onDashSweptCatalyst` **안에서**
  `onDashPierceCatalyst` 를 부르자 지역 바인딩을 타 계측이 **0**을 냈다. 통지를 `world.ts` 로
  올려 해결. **앵커를 세우면 호출부 계측을 같이 세워라**가 이 리포의 규율인 이유가 이것이다.

## 8-4. ⛔ SQL 은 **실행으로 검증되지 않았다** — 적용 전에 반드시 파싱시켜라

`supabase/migrations/20260808060000_catalyst_axis_mirror_resonance.sql` 은 이 레인의 산출물 중
**유일하게 실행 검증이 안 된 것**이다. 이 머신에 `psql`·`docker` 가 없고(`supabase` CLI 는 있으나
로컬 DB 없이는 lint 불가), `pgsql-parser` 류 JS 파서도 설치 실패했다. **`supabase-planet-blitz`
MCP 서버는 비대화형 세션이라 인증하지 못했다**(대화형 `claude` 에서 `/mcp` 필요).

**한 것 — 구조 검사(실측 출력)**:
```
달러 인용 $$ 4개(짝) · 작은따옴표 균형 OK · 괄호 균형 OK · begin 1 / end 12
function: catalyst_cap_resource_mult_max, consume_catalysts
table:    catalyst_resonances        alter: catalyst_defs ×5, catalyst_resonances ×1
catalyst_defs 시드 48행, id 0~47, 중복 0
cap_axis 어휘 = {drop, resource, rarity, xp, catalystDrop} 정확히 5종
catalyst_resonances 시드 12행, 태그 6종, 쌍 중복 0
clamp 리터럴 = 2.2  ← TODO
```

**못 한 것**: `cross join lateral unnest` · `array_position(plpgsql 상수, …)` ·
`array_agg(distinct … order by …)` · DECLARE 초기화자의 함수 호출 — **문법이 실제로 서는지는
파싱해 봐야 안다.** 구조 검사는 균형만 보지 의미를 못 본다.

→ **원격 적용 전에 스테이징이나 로컬 postgres 에서 한 번 파싱시켜라.** 적용 스크립트
`scripts/apply-catalyst-axis-mirror-migration.ps1` 이 준비돼 있고, 검증부는 값 고정이 아니라
**구조 검사**로 짜서 재태깅·재튜닝이 와도 안 낡는다.

⚠️ **적용 순서: 클라 먼저, SQL 나중.** `consume_catalysts` 가 중복·특산3장 로드아웃을 **거부하기
시작**하므로, 그런 로드아웃을 아직 만들 수 있는 클라가 살아 있으면 출격이 서버에서 튕긴다
(SLOT_CAP 8→3 때와 같은 순서).

## 9. 검증 명령 (이 레인 실측)

```
npx vitest run tests/determinismGate.test.ts tests/catalystFoundation.test.ts tests/catalystAnchors.test.ts
npx tsx scripts/catalystByteInvariance.ts    # → sha256 이 §1 기준값과 같아야 한다
npx vite-node scripts/catalystCapSweep.ts
pnpm verify                                   # ⚠️ 파이프에 물리지 마라 (exit code 가 tail 것이 된다)
```
