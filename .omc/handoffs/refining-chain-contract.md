# 정련 공정 — 레인 간 계약 (변경 금지)

ADR-0040 · 계획 `.omc/plans/refining-chain-2026-07-28.md` 의 구현 계약이다.
**모든 레인은 이 파일의 시그니처·키·상수 이름을 그대로 쓴다.** 다르게 만들면 병합이 깨진다.
바꿔야 할 이유를 발견하면 직접 고치지 말고 team-lead 에 보고한다.

## 파일 소유권 (다른 레인의 파일을 절대 건드리지 않는다)

| 레인 | 소유 파일 |
|---|---|
| A | `src/items/roll.ts` · `tests/reroll.test.ts` · `tests/reforge.test.ts`(신규) · `scripts/deno-verify/scenarios.ts` · `scripts/deno-verify/common.ts` |
| B | `data/economy.ts` · `tests/economy.test.ts` |
| C | `src/items/refiningChain.ts`(신규) · `tests/refiningChain.test.ts`(신규) |
| D | `src/i18n/catalog.ts` |
| E | `src/ui/pixi/refinery.ts` · `tests/pixiScreenPersistence.test.ts` |
| F | `src/ui/refinery.ts`(삭제) · `tests/saveProfileStoreGuard.test.ts` · `tests/requiredLevel.test.ts` |

## 레인 A — `src/items/roll.ts`

```ts
export interface ReforgeOpts {
  /** 재추첨에서 제외할 어픽스 인덱스(누적 고착). 중복·범위 밖은 무시. */
  readonly fastened?: readonly number[];
  /** 값 품질 밴드 하한 비율 [0,1]. 0 = 현행 균등 분포. */
  readonly band?: number;
}

export function reforgeAffixes(item: Item, rerollSeed: number, opts?: ReforgeOpts): Item;
```

**불변식(테스트로 잠근다)**

1. **RNG 스트림 형태 불변** — 값 추첨은 밴드 유무와 무관하게 `rng.int()` **정확히 1회**다.
   ```ts
   const lo = def.min + Math.round((def.max - def.min) * band);
   const value = rng.int(lo, def.max);
   ```
2. `band = 0` + `fastened = [i]` → 기존 `rerollAffixes(item, seed, i)` 와 **결과가 완전히 동일**
3. `rerollAffixes(item, seed, lockedIndex?)` 는 **시그니처·동작을 그대로 유지**하고 내부에서
   `reforgeAffixes` 로 위임한다. `tests/reroll.test.ts` 의 기존 케이스를 **한 줄도 고치지 않는다**
4. 어픽스 **개수**는 언제나 보존한다. 고착된 어픽스는 값·인덱스가 그대로 유지되고, 재추첨 풀에서
   해당 `def.id` 가 제외되어 중복이 생기지 않는다
5. 퇴화 범위(`min === max`: `multibarrel`·`piercing`·`freezing`)는 밴드와 무관하게 항상 같은 값

`band` 는 `[0,1]` 로 클램프하고, `fastened` 는 정렬·중복제거 후 쓴다.

## 레인 B — `data/economy.ts`

**제거:** `LOCKED_REROLL_MULT` · `lockMultiplier` · **`rerollCost` 함수 자체**

> ⚠️ **개정 (lead 승인, 레인 B 보고 반영)** — 원래 계약은 "`rerollCost` 의 `lockCount` 인자
> 제거"였으나, 인자를 빼면 `rerollCost(rarity, affixCount)` 가 `rerollBaseCost` 와 **완전히
> 동일한 껍데기**가 된다. 같은 값을 내는 함수 두 개는 나중에 한쪽만 고쳐지는 함정이므로
> 함수째 삭제한다. **소비처는 `rollCost(rarity, affixCount, heat)` 를 쓴다.**
> 레인 E 는 `src/ui/pixi/refinery.ts` 와 `tests/pixiScreenPersistence.test.ts:43` 의
> `rerollCost` import 를 `rollCost` 로 갈아끼워야 한다(그냥 인자만 지우면 컴파일 안 된다).

**신설:**

```ts
/** 노 출력 3단계 — 약불·중불·강불. */
export type Heat = 'low' | 'mid' | 'high';
export const HEATS: readonly Heat[] = ['low', 'mid', 'high'];

export interface HeatSpec {
  /** 광물 비용 배수. */
  readonly costMult: number;
  /** 실패(용해) 위험 배수. */
  readonly riskMult: number;
  /** 어픽스 값 품질 밴드 하한 [0,1]. */
  readonly band: number;
}

// TODO(밸런스): 계수는 출시 전 일괄 튜닝. 앵커 = mid 가 현행 단발 리롤과 동일 비용(×1).
export const HEAT: Record<Heat, HeatSpec> = {
  low:  { costMult: 0.6, riskMult: 0.6, band: 0 },
  mid:  { costMult: 1,   riskMult: 1,   band: 0.25 },
  high: { costMult: 2,   riskMult: 1.8, band: 0.55 },
};

/** 굴림 1회 비용(광물, 정수). = rerollBaseCost × HEAT[heat].costMult, 올림. */
export function rollCost(rarity: Rarity, affixCount: number, heat: Heat): number;

/** 고착 누적이 정하는 기본 용해 위험 [0,1]. 고착 0 → 정확히 0. */
export function baseRisk(fastenedCount: number, affixCount: number): number;

/** 실제 용해 위험 [0,1] = baseRisk × HEAT[heat].riskMult, RISK_MAX 로 클램프. */
export function meltRisk(fastenedCount: number, affixCount: number, heat: Heat): number;
```

**산식(플레이스홀더, TODO(밸런스) 주석 필수)**

```ts
export const RISK_CAP = 0.85;   // baseRisk 상한
export const RISK_EXP = 1.5;    // 진행 비율 지수
export const RISK_MAX = 0.95;   // 노 출력 배수 적용 후 최종 상한

baseRisk(n, count) = n <= 0 || count <= 0 ? 0 : RISK_CAP * Math.pow(n / count, RISK_EXP)
```

`rerollBaseCost` · `canAfford` · 리스펙 · 창고 확장 함수는 **그대로 둔다**.

**불변식:** `fastenedCount === 0` 이면 어떤 `heat` 에서도 `meltRisk` 가 **정확히 0**이다.
하위 호환이 이 한 줄에 걸려 있다.

## 레인 C — `src/items/refiningChain.ts` (신규 순수 모듈)

Pixi·i18n·네트워크·`Math.random` 을 **모른다**. 난수는 전부 인자로 주입받는다.

```ts
export interface ChainState {
  /** 공정 시작 시점 스냅샷(용해 복귀점). */
  readonly baseline: Item;
  /** 현재 굴림 결과 — 인벤토리에 항상 이 값이 반영돼 있다. */
  readonly current: Item;
  /** 고착된 어픽스 인덱스(오름차순, 중복 없음). */
  readonly fastened: readonly number[];
  /** 이번 굴림 이후 아직 고착을 쓰지 않았는가(굴림당 1개 규칙). */
  readonly canFasten: boolean;
}

export function openChain(item: Item): ChainState;

/** 고착. canFasten=false·이미 고착된 인덱스·범위 밖이면 상태를 그대로 돌려준다(예외 아님). */
export function fasten(s: ChainState, index: number): ChainState;

export interface RollOutcome {
  readonly next: ChainState;
  /** 용해했는가. true 면 next.current === baseline, next.fastened === []. */
  readonly melted: boolean;
  /** 모든 어픽스가 고착되어 공정이 끝났는가. */
  readonly complete: boolean;
}

/**
 * 굴림 1회. `riskRoll` 은 호출부가 넘기는 [0,1) 난수(UI 는 Math.random, 테스트는 고정값).
 * `riskRoll < meltRisk(...)` 이면 용해한다.
 */
export function rollChain(
  s: ChainState,
  heat: Heat,
  reforgeSeed: number,
  riskRoll: number,
): RollOutcome;

/** 모든 어픽스가 고착됐는가(= 더 굴릴 것이 없다). */
export function isComplete(s: ChainState): boolean;
```

**규칙**

- `openChain` → `baseline === current === item`, `fastened = []`, `canFasten = false`
  (굴리기 전에는 고착할 수 없다)
- `rollChain` 성공 → `current = reforgeAffixes(baseline대신 current, seed, { fastened, band: HEAT[heat].band })`,
  `canFasten = true`
- `rollChain` 용해 → `current = baseline`, `fastened = []`, `canFasten = false`
- `fasten` 성공 → `fastened` 에 index 추가(정렬 유지), `canFasten = false`
- 어픽스 0개 아이템은 애초에 공정 대상이 아니다(호출부가 거른다)

## 레인 D — `src/i18n/catalog.ts`

**제거(ko·en 양쪽):** `refine.lockNote` · `refine.cost.locked` · `refine.lock.title.lock` ·
`refine.lock.title.unlock`

**유지:** `refine.lock.alt.locked` · `refine.lock.alt.unlocked`(고착 아이콘 대체텍스트로 재사용) ·
`refine.cost.normal` · 나머지 `refine.*` 전부

**신설(ko·en 양쪽, 키 이름 그대로 — 총 14종. 아래 표가 정본이다):**

| 키 | ko | en |
|---|---|---|
| `refine.chain.heat.low` | `약불` | `Low heat` |
| `refine.chain.heat.mid` | `중불` | `Medium heat` |
| `refine.chain.heat.high` | `강불` | `High heat` |
| `refine.chain.heat.hint` | `노 출력이 높을수록 값이 잘 나오지만 비용과 용해 위험도 오릅니다` | `Higher heat rolls better values, but costs more and raises melt risk` |
| `refine.chain.risk` | `용해 위험 {n}%` | `Melt risk {n}%` |
| `refine.chain.fasten` | `고착` | `Fasten` |
| `refine.chain.fastenHint` | `굴린 뒤 어픽스 하나를 고착할 수 있습니다 (해제 불가)` | `After a roll you may fasten one affix (cannot be undone)` |
| `refine.chain.fastenedCount` | `고착 {n}/{total}` | `Fastened {n}/{total}` |
| `refine.chain.stop` | `공정 멈추기` | `Stop refining` |
| `refine.chain.rollBtn` | `굴리기` | `Roll` |
| `refine.chain.cost` | `굴림 비용: 광물 {n}` | `Roll cost: {n} minerals` |
| `refine.chain.melted` | `용해 — 고착이 전부 풀렸습니다` | `Melted — all fastened affixes released` |
| `refine.chain.complete` | `공정 완주 — 모든 어픽스를 고착했습니다` | `Refining complete — every affix fastened` |
| `refine.chain.noBand` | `이 어픽스는 값이 고정이라 노 출력의 영향을 받지 않습니다` | `This affix has a fixed value; heat does not affect it` |

카탈로그의 기존 정렬·주석 스타일을 따른다. ko·en 키 집합이 정확히 일치해야 한다.

## 레인 E — `src/ui/pixi/refinery.ts`

상세 패널을 정련 공정 UI 로 교체한다. **결과 확정·저장이 연출보다 먼저**라는 현행 순서를
반드시 유지한다(`persist()` → `setInterval` 스핀).

- 노 출력 3버튼(라디오, 기본 `mid`) — 선택 시 비용·위험 즉시 갱신
- 위험 표시: `refine.chain.risk`. **고착 0개면 표시 자체를 숨긴다**
- 어픽스 행: 자물쇠 토글 → **고착 버튼**. `canFasten === false` 거나 이미 고착이면 비활성.
  고착 행은 금색 링 + 잠김 아이콘 유지. 퇴화 범위 어픽스에는 `refine.chain.noBand` 툴팁
- 하단: `굴리기`(비용·잔액 게이트) + `공정 멈추기`(고착 ≥ 1 일 때만)
- 장비를 새로 고르거나 화면을 나가면 공정 상태만 버린다(인벤토리는 이미 최신)
- 연출(위험 가시화): 위험이 오를수록 굴리기 버튼 주변 열기가 짙어지고 미세 진동.
  용해는 짧고 명확하게, 완주는 전용 연출 1회. 전부 render-only
- 시각 레지스터는 **카툰나무풍** 유지

### 상태기계 사용법 — 레인 C 가 넘긴 것 (그대로 따라라)

1. **완주 신호는 `rollChain` 이 아니라 `fasten` 직후에 잡는다.** 굴림은 고착 수를 바꾸지 않으므로
   `RollOutcome.complete` 는 "입력이 이미 완주였다"는 뜻일 뿐이다. UI 는 `fasten` 한 뒤
   `isComplete(next)` 로 완주를 판정하고 완주 연출을 띄워라
2. **완주 상태에서 `rollChain` 은 아무 일도 하지 않는다**(lead 지시로 상태기계가 직접 막는다 —
   완주 후 굴림은 얻을 것이 0인데 위험은 최댓값이라 순수 손해다). UI 도 굴리기 버튼을
   비활성화해라 — 이중 방어이지 둘 중 하나가 아니다
3. `fasten` 이 무시될 때는 **입력 상태 참조를 그대로** 돌려준다. `next === state` 레퍼런스
   비교로 "무시됐다"를 판별할 수 있다(범위 밖·중복·`canFasten === false` 전부 예외가 아니라 무시)
4. `isComplete` 는 어픽스 0개 아이템에 `false` 를 돌려준다 — 빈 배열을 완주로 읽지 않는다.
   애초에 어픽스 0개는 정제소 목록에 오르지 않는다(`rerollable()` 이 거른다)

### ⚠️ 절대 깨뜨리면 안 되는 기존 회귀 테스트 (lead 실측)

`tests/pixiScreenPersistence.test.ts` 는 **private 메서드를 캐스팅으로 직접 찔러** 정제소를
검사한다. 네가 메서드 이름을 바꾸면 이 테스트가 컴파일 단계에서 깨지고, 그때 테스트를
"고치는" 손쉬운 길은 단언을 지우는 것이다 — **그 길로 가지 마라.**

```ts
const r = refinery as unknown as { select(i: Item): void; reroll(): Promise<void> };
r.select(item);
const p1 = r.reroll();
const p2 = r.reroll();          // 동시 클릭 재현
await Promise.all([p1, p2]);
expect(profile.minerals, '광물이 이중 차감됐다').toBe(1_000_000 - cost);
```

지켜야 할 것:

1. **`select(item)` 과 `reroll()` 이라는 메서드 이름을 유지해라.** `reroll()` 은 이제 "굴림 1회"
   를 뜻하고 현재 선택된 노 출력을 쓴다. 이름을 바꾸고 싶으면 바꾸지 말고 보고해라
2. **`busy` 재진입 가드를 제거하지 마라.** 이 테스트가 존재하는 이유가 그거다 — `spinning` 은
   `await` **뒤에야** 세워지므로 서버 왕복 창을 막는 것은 `busy` 뿐이다. 스텝이 늘어난 정련
   공정에서는 이 창이 더 자주 열린다
3. 331행 `rerollCost(item.rarity, item.affixes.length, 0)` 를
   **`rollCost(item.rarity, item.affixes.length, 'mid')`** 로 갈아끼워라. `mid` 가 `costMult 1`
   앵커라 기대값 산술이 그대로 성립한다 — **이 테스트가 mid 앵커의 존재 이유다.** 기대값
   숫자를 손으로 고쳐 맞추지 마라
4. 하네스가 `'refinery'` 를 화면 키로 쓴다(`src/harness/core.ts:67`, `cheatPanel.ts:1075`
   `['refinery', '정제소']`). **화면 키를 바꾸지 마라** — 치트 패널 스크린 점프가 끊긴다

기본 노 출력은 **`mid`** 다(공정을 새로 열 때마다 mid 로 리셋).

### ⚠️ 레이아웃: 6어픽스에서 패널이 넘친다 (lead 실측 — 반드시 먼저 해결해라)

현행 상세 패널은 **이미 바닥에 거의 닿아 있다.** 산수:

```
inset = PANEL_BORDER 46 + PANEL_INNER_PAD 14 = 60
BOX_D.bottom = 60 + (PANEL_H 776 - 120) = 716
6어픽스: rowsEnd = AFFIX_TOP 200 + 6 × AFFIX_STEP 60 = 560
         rollY  = min(560 + 52, 716 - ROLL_H 64) = 612   → 굴리기 버튼이 612..676
         남는 세로 여백 = 716 - 676 = 40px
```

여기에 노 출력 3버튼(≈56) + 위험 표시(≈28) + 공정 멈추기 버튼(≈60) = **약 150px 를 더 넣어야
한다. 40px 밖에 없다 — 그대로 쌓으면 레어 6어픽스에서 버튼이 나무 테두리를 뚫는다.**

레어는 어픽스 3~6개라 6은 흔한 경우지 예외가 아니다. 이 리포는 카드·패널 넘침이 사용자 신고로
반복해서 올라온 이력이 있으니, "일단 쌓고 나중에 본다"로 넘기지 마라.

**권장 해법(합산 −20px, 검증은 네가 해라)**

1. **굴리기 · 공정 멈추기를 같은 행에 좌우로** 배치 (−60)
2. **위험 표시를 비용 줄에 인라인**으로 합침 — `굴림 비용: 광물 24 · 용해 위험 32%` (−28)
3. 노 출력 3버튼 행을 어픽스 목록과 비용 줄 사이에 (+68)

그래도 모자라면 `AFFIX_H` 52→44 · `AFFIX_STEP` 60→50 으로 줄여라(6어픽스에서 −60).

**좌표를 하드코딩하지 말고 부등식으로 파생시켜라** — 이 리포의 관례이고, 현행 코드도
`rollY = Math.min(rowsEnd + 52, BOX_D.bottom - ROLL_H)` 로 이미 그렇게 한다. 어픽스 수
1·2·3·6 전 경우에서 마지막 요소의 bottom 이 `BOX_D.bottom` 이하임을 **테스트로 단언해라**
(캔버스 없는 환경에서 `getLocalBounds()` 로 잴 수 있다. 단 텍스트 스텁은 글자를 실제보다 작게
재므로 겹침을 놓칠 수 있다 — 좌표 부등식으로 재는 편이 안전하다).

### 자산: 신규 아트 0 — 기존 텍스처로 전부 커버된다 (lead 정찰 확인)

`UI_ASSET_NAMES`(`src/ui/pixi/uiTextures.ts:160`)를 조사한 결과 **새 png 를 만들 필요가 없다.**
아래 매핑을 그대로 써라. `UI_ASSET_NAMES` 와 `assets/` 를 건드리지 마라.

| 용도 | 기존 텍스처 | 근거 |
|---|---|---|
| 약불 버튼 | `ui_btn_wood.png` | 갈색 = 가장 차가운 톤 |
| 중불 버튼 | `ui_btn_yellow.png` | 노랑 = 중간 열 |
| 강불 버튼 | `ui_btn_red.png` | 적색 = 최고 열 |
| 고착된 어픽스 행 | `ui_lock.png` | 현행 잠금 아이콘 그대로 |
| 고착 가능(미고착) 행 | `ui_unlock.png` | 현행 그대로 |
| 위험·비용 칩 | `ui_chip.png` | 현행 그대로 |

나무 → 노랑 → 빨강이 그 자체로 열 구배를 이루므로 노 출력 3단계가 **글자를 읽지 않아도**
읽힌다. 새 자산을 만들고 싶어지면 만들지 말고 team-lead 에 보고해라 — 아트 부채는 PixelLab
생성·캐시 등록·리포 동기화까지 딸려 오는 별도 레인이다.

`PixiButton`·`nineSlicePanel`·`makeIconButton` 은 텍스처가 없을 때 `fallbackColor` 로 도형을
그리므로, 테스트 환경(텍스처 미로드)에서도 레이아웃이 성립해야 한다.

**`PixiButton` API (lead 확인 — 있는 것만 써라)**

- `ButtonOptions`: `texture` · `width` · `height` · `label` · `onClick` · `fallbackColor` ·
  `fontSize` · `cap` · `sound` · `labelColor` · `lift`
- 메서드는 `setLabel(text)` · `setEnabled(enabled)` **둘뿐이다**
- ⚠️ **선택/토글 상태가 없다.** 노 출력 3버튼의 "지금 이게 선택됨" 표시는 직접 그려야 한다 —
  현행 정제소가 선택 장비에 쓰는 금색 링 관용구를 그대로 재사용해라:
  `ring.roundRect(2, 2, w - 4, h - 4, 9).stroke({ color: COLOR.gold, width: 3, alignment: 1 })`
  (미선택 버튼은 `alpha` 를 한 톤 낮추면 대비가 확실해진다 — 어픽스 행에 이미 쓰는 기법이다)
- `ui_btn_yellow.png` 는 바탕이 밝아 흰 라벨이 묻힌다. `labelColor: COLOR.darkLabel` 을 넘겨라
  (현행 굴리기 버튼이 이미 그렇게 한다)
- `sound` 로 UI 음 범주를 고를 수 있다: `uiConfirm`(굴리기) · `uiPositive`(고착) ·
  `uiNegative` · `uiNavigate`(기본). 새 사운드 에셋을 만들지 말고 이 범주를 재사용해라

`spendCurrencyOnServer(0, cost, 'reroll')` 은 굴림 스텝마다 그대로 호출하고, `busy` 재진입
가드를 **제거하지 않는다**. 거부(`insufficient`·오프라인)면 굴림도 용해도 일어나지 않는다.

## 레인 F — 정리

- `src/ui/refinery.ts`(DOM 정제소) **삭제**. `main.ts` 는 이미 Pixi 판만 쓴다
- `tests/saveProfileStoreGuard.test.ts:237` 의 경로 목록에서 `src/ui/refinery.ts` 제거
- `tests/requiredLevel.test.ts` 의 AC6 절을 확장: 다중 고착·밴드 적용 후에도 `requiredLevel` 불변

## 전 레인 공통

- 문서·주석·커밋 메시지는 **한글**. 코드 식별자는 영문 그대로
- **`pnpm` 이 PATH 에 없다. `corepack pnpm test` · `corepack pnpm build` 로 실행해라**
  (레인 F 실측)
- `src/ui/pixi/refinery.ts` 헤더 주석 4행이 삭제된 DOM `Refinery` 를 "기능 1:1 동등" 대상으로
  참조한다. 레인 E 가 그 파일을 재작성할 때 **함께 정리해라** — 존재하지 않는 파일을 가리키는
  주석이 남는다
- `pnpm test` 와 **`pnpm build`(tsc)를 반드시 함께** 돌린다 — 테스트만 그린인데 tsc 가 깨져
  있던 회귀가 이 리포에 전례가 있다
- 커밋하지 말 것. 파일만 남기고 team-lead 에 보고한다(브랜치는 하나이고 lead 가 커밋한다)
- 다른 레인의 파일을 읽는 것은 자유, **쓰는 것은 금지**
