# 액티브 스킬 레인 인터페이스 계약 (0c 동결)

- 계획 정본: `.omc/plans/active-skills-2026-07-31.md` (0a-16 신설 → 0c 최종화)
- 설계 정본: `docs/adr/0041-active-skills-ship-type-exclusive-player-only.md`
- 저작 정본: `.omc/plans/active-skills-catalog.md` (42종 표 + 아이콘 프롬프트 42줄)
- 상태: **동결**. 이후 레인은 아래 타입·시그니처·소유권을 변경하지 않는다.

---

## 1. 동결 계약 (7항)

### ① `ActiveSkillDef` 필드 집합 — `data/ships/actives/types.ts`
`id` · `shipTypeId` · `treeIndex` · `tier`(`'lo'|'hi'`) · `kind`(`'strike'|'dash'|'buff'`) ·
`observable`(`'projectileCount'|'displacement'|'buffTicks'`) · `baseCooldown` · `coeff`.

**`touchesSignature` 는 두지 않는다.** 우변이 `shipTypeId` 로 100% 파생 가능해 "저작자가 베껴
적었는가"만 검사하는 항진이 된다(계획 개정 3). 시그니처를 실제로 건드렸는지는
**시그니처 델타 테스트**(`tests/activeSkillWiring.test.ts` 배선 전수 ③)가 판정한다.

### ② 핸들러 시그니처 — `src/sim/activeTypes.ts`
```ts
(state: WorldState, player: Entity, def: ActiveSkillDef,
 dir: { x: number; y: number }, slot: number) => void
```
- `player` 를 인자로 받아야 핸들러가 `getPlayer(state)` 때문에 `world.ts` 를 import 하지 않는다.
- `dir` 이 필요한 이유: `mx`/`my` 는 `stepPlayer` 의 **지역 변수**이고 `WorldState` 는 입력을
  보관하지 않는다. 방향 해소는 `world.ts` 의 `resolveDirFallback`(대시 규칙 **재사용**)이 한다.
- `slot` 이 필요한 이유: `kind='buff'` 가 자기 잔여 틱 필드를 **직접** 세워야 한다(아래 ⑤).

부수 훅 2종(선택): `ActiveSustain`(지속 중 매 틱) · `ActiveExpire`(만료 틱 1회).

### ③ `aux0/aux1` 인코딩 표 — `src/sim/world.ts:1721-1731`
기체별 슬롯 의미의 **정본**. 어기면 시그니처 런타임 상태가 조용히 손상된다.
`aux` 는 이미 `ENTITY_HASH_LAYOUT` 의 조건부 꼬리라 **신규 해시 폴드가 불필요**하다.

### ④ `kind` ↔ `observable` 대응
`strike→projectileCount` · `dash→displacement` · `buff→buffTicks`.
정본은 `OBSERVABLE_BY_KIND`(`data/ships/actives/types.ts`)이고 전수 테스트가 강제한다.

### ⑤ 런타임 정수 4개의 **작성자 분리** ★
`WorldState.activeCd0/activeCd1/activeBuff0/activeBuff1`.

> **공통 발동 코드(`stepActives`)는 쿨다운 2개만 세운다. 버프 잔여 틱 2개는 핸들러가 세운다.**
> 공통 코드는 버프를 **감소만** 한다(감소는 0에서 양수로 올리지 못하므로 항진이 아니다).

이 문장이 없으면 위험하다 — 정수 4개가 한 묶음이고 한 폴드라, 구현자가 넷을 공통 코드에서
같이 초기화하도록 유도된다. 그러면 `buffTicks` 단언이 **핸들러 본문과 무관하게 참**이 되어
배선 전수 ②가 항진이 된다(계획 개정 3 CR-1 과 같은 기제의 재발).

### ⑥ 파일 소유권 (아래 2절)

### ⑦ 하네스 치트 삽입 지점 (0a-14 실측 결과)
⚠️ **`src/harness/cheatPanel.ts` 에는 "치트 등록 배열"이 없다**(계획의 표현은 부정확했다).
탭별 빌더 함수가 `btn(label, handler, title?)` / `numInput` / `select` 로 DOM 을 명령형 조립한다.
- 슬롯 장착 UI → `buildMenusTab` 의 "장비 지급" 블록과 "기체 타입 치트(M8)" 블록 **사이**.
- 쿨다운 리셋 → `appendCombatCheats`(런 탭·보스전 탭 **공유**) 안. `if (!live)` 비활성 배열에 포함.
- 기체 타입 전환 치트는 **이미 있다**(신설 아님). 단 `setShipType` 이 `activeSlots` 도 리셋해야 한다.
- world 접근은 `harness.cheat((w) => {...})` 가 유일 경로다(`markTaintedIfLive` 자동).
- **preset 은 `WorldState` 를 건드리지 못한다** — `Profile` 또는 `InvasionLayers` 만 만든다.

---

## 2. 파일 소유권 (배타)

| 레인 | 배타 소유 | 금지 |
|---|---|---|
| **0a/0c (lead)** | `data/ships/actives/{types,index}.ts` · `data/inputBits.ts` · `src/sim/{world,replay,powerups,actives,activeTypes}.ts` · `src/run/runConfig.ts` · `src/items/{types,activeSkills}.ts` · `src/save/{profile,guardianLifecycle}.ts` · `src/run/callupPilot.ts` | — |
| **E1 · content** | `data/ships/actives/{striker,arccaster,phantom}.ts` · `src/sim/activeHandlers/{striker,arccaster,phantom}.ts` | 그 외 전부 |
| **E2 · content** | `data/ships/actives/{hatchling,mallow,bubble}.ts` · `src/sim/activeHandlers/{hatchling,mallow,bubble}.ts` | 그 외 전부 |
| **D · ui** | `src/ui/pixi/researchLab.ts` · `src/ui/hud.ts` · `src/main.ts`(HUD 갱신 호출부만) | **`src/ui/researchLab.ts`(DOM 레거시 = 죽은 파일) 접근 금지** |
| **F · art** | `assets/active_*.png` | 소스 코드 전부 |
| **input** | `src/input/controller.ts` · `src/ui/encounterOverlay.ts` | `src/sim/**` |
| **harness** | `src/harness/{core,cheatPanel,presets}.ts` | `src/sim/**` · `data/**` |
| **i18n** | `src/i18n/catalog.ts` · `tests/i18n.test.ts` | 그 외 전부 |

> **0b 파일럿(브루저)은 lead 가 이미 완성했다.** `data/ships/actives/bruiser.ts` +
> `src/sim/activeHandlers/bruiser.ts` 가 E 레인의 **본보기**다.

---

## 3. 배선 접점 요약 (실측 좌표)

| 접점 | 위치 | 형태 |
|---|---|---|
| `special` 비트 9·10 | `data/inputBits.ts`(정의) · `src/sim/world.ts`(재수출) | leaf 정의 — 순환 import 방지 |
| 발동 호출 | `src/sim/world.ts` 의 `stepPlayer(...)` **직후** | 프리즈·detour 분기가 위에서 조기 return → z/x 구조적 폐기(AC-8·9) |
| 방향 폴백 | `src/sim/world.ts` 의 `resolveDirFallback` | 대시가 쓰던 인라인 규칙을 함수로 뺀 것(**재사용**, 복제 아님) |
| 해시 꼬리 폴드 ① | `src/sim/replay.ts` 맨 꼬리 | 런타임 정수 4개 **all-or-nothing**(부분 폴드 금지) |
| 해시 꼬리 폴드 ② | ① 바로 뒤 | 장착 wire id 2칸. 순서는 **①→② 영구 고정**(AS-OQ11) |
| `WorldConfig.activeSlots` | `src/run/runConfig.ts` `buildRunConfig` | **둘 다 비면 필드 자체를 안 싣는다**(`planetMultCenti` 선례) |
| 파워업 24·25 | `src/sim/powerups.ts` | `offSlotActivePowerup` **`continue` 필터** — 미장착 시 pool 진입 차단 |
| 세이브 | `SAVE_VERSION` 8 · `migrateV7toV8` · `normalizeActiveSlots` | 스탬프만 올리고 채움은 정규화가 한다 |
| 예비역 박제 | `GuardianBuild.activeSlots` + `callupPilot` 전달 | **셋 다** 있어야 성립(PM-3) |

---

## 4. 검증 계약

| 축 | 파일 | 무엇을 잡는가 |
|---|---|---|
| 배선 전수 ① 존재 대조 | `tests/activeSkillWiring.test.ts` | 레지스트리 ↔ 핸들러 누락 (물리적 2파일이라 항진 아님) |
| 배선 전수 ② 관측량 델타 | 같은 파일 | **핸들러 본문이 비었는지** — 해시 비교로는 못 잡는다 |
| 배선 전수 ③ 시그니처 델타 | 같은 파일 | `aux0/aux1` 을 실제로 건드렸는지(스트라이커 6종 제외, **제외 크기 단언 포함**) |
| 꼬리 폴드 존재 | 같은 파일 | **다른 모든 것을 고정하고 정수 4개만** 흔든다 — 부수효과로 대체되지 않게 |
| 관통 배선 | `tests/activeSkillRunConfig.test.ts` · `tests/activeSkillGuardian.test.ts` | PM-4 · PM-3 · AC-24 양성 / AC-25 음성 |
| 순수 규칙 | `tests/activeSkills.test.ts` | 게이트 경계 · 단조성 · 3개째 거부 · V8 마이그레이션 |
| 입력 | `tests/activeSkillInput.test.ts` | AC-6 · AC-7 **양방향** · 프리즈 중 폐기 |
| 골든 | `shipHashBaseline` · `invasionHash` · `denoFixture` · `determinism` | 액티브 미사용 런 **바이트 불변** |

### 뮤테이션 게이트 (전부 통과 기록 있음)
| # | 뮤테이션 | 결과 |
|---|---|---|
| M-① | 핸들러 1종 제거 | PASS (vitest exit 1 · tsc exit 2) |
| M-①b × 3 | strike/dash/buff 핸들러 **본문만** 비움(쿨다운 유지) | PASS |
| M-② | 꼬리 폴드를 무조건 폴드로 | PASS (골든 실패) |
| M-②b | 폴드 가드를 항상 false 로 | PASS — **이 게이트가 실제로 항진 하나를 잡았다**(아래) |
| M-③ⓐ | 파워업 필터 `continue` 제거 | PASS |
| M-③ⓑ | 파워업 필터를 항상-제외로 | PASS |

> **M-②b 가 잡은 것**: 최초 AC-5 단언은 `"발동 런 vs 미발동 런의 해시가 다르다"` 였는데, 발동은
> 투사체·`aux` 같은 **부수효과로도** 해시를 바꾸므로 **폴드를 통째로 지워도 통과했다**.
> → "다른 모든 것을 고정하고 정수 4개만 흔든다" + "네 정수를 개별로 구분한다(부분 폴드 금지)"
> 로 교체했다. 뮤테이션 게이트가 형식이 아니라는 물증이다.

---

## 5. 미결 항목 해소 (AS-OQ)

| # | 해소 |
|---|---|
| AS-OQ8 | **실측 완료.** 리플레이는 `seed+config+inputs` 만 담아 world 런타임을 직렬화하지 않는다 → 신규 정수는 리플레이 변경 불요. HUD 는 스냅샷 경유 **불필요**(`main.ts` 가 라이브 `WorldState` 를 쥐고 있고 `bossEta` 선례가 있다). preset 은 `WorldState` 를 못 건드린다 → `harness.cheat` 가 유일 경로. |
| AS-OQ9 | **실측 완료.** 치트 등록 "배열"은 없다(위 ⑦). |
| AS-OQ13 | **해소.** `strike` 대조군 차분은 **총 투사체 개수 차분**으로 확정. 대조군·발동군이 비트 동일이라 자동공격 잡음이 원리적으로 상쇄되므로 kind 로 좁힐 필요가 없다. |
| AS-OQ14 | **안전 판정.** `hashWorld` 는 매 호출 `FNV_OFFSET` 에서 시작하는 **틱 스냅샷**이지 누적 체인이 아니고, 클라·EF 가 같은 `src/sim/replay.ts` 를 쓴다. 게다가 **비단조 토글은 신규 형태가 아니다** — `hashEntity` 의 `aux0/aux1` 꼬리가 이미 엔티티마다·틱마다 켜졌다 꺼졌다 하고, `facility.ts` 의 `if (e.aux0 > 0) e.aux0--` 는 쿨다운 카운터가 0으로 자연 감소해 폴드를 끄는 **정확히 같은 의미론**이다. 조건: **부분 폴드 금지(all-or-nothing)** · 맨 꼬리 append-only · 정수 전용 `>>> 0` 정규화 후 판정. |
