# 정련 공정 구현 계획 (ADR-0040)

- 작성: 2026-07-28
- 정본 설계: [ADR-0040](../../docs/adr/0040-refining-chain-push-your-luck.md) · 용어: [CONTEXT.md](../../CONTEXT.md) 경제 절
- 대상 화면: `src/ui/pixi/refinery.ts` (Pixi 정제소 — main.ts 가 쓰는 유일한 정제소)

## 요약

정제소의 단발 어픽스 리롤을 **정련 공정**(push-your-luck 연쇄)으로 감싼다. 순수 코어(값 밴드·
다중 고착) → 공정 상태기계 → UI → 연출 순으로 쌓고, 마지막에 사문화된 잠금 비용 축과 DOM
정제소를 걷어낸다.

## 사전 확인 (코드 실측, 2026-07-28)

| 확인 항목 | 결과 | 계획에 미치는 영향 |
|---|---|---|
| `requiredLevel` 파생 입력 | 등급 + 어픽스 **개수** + 드랍 단계 (`requiredLevel.ts:112`) | 값만 바뀌므로 요구 레벨 **구조적 불변**. 개수 증가는 금지 |
| `rerollAffixes` 재실행처 | `scripts/deno-verify/common.ts:99` (cross-runtime 결정론 하네스). `verify-invasion` EF 아님 | EF 재배포 불필요. deno-verify 시나리오만 갱신 |
| 퇴화 어픽스 범위 | `multibarrel`·`piercing`·`freezing` 이 `min === max` (24종 중 3종) | 값 밴드가 **무효인 어픽스가 존재**. UI·테스트가 이를 정상으로 다뤄야 함 |
| DOM `src/ui/refinery.ts` | `main.ts` 미사용(죽은 코드). `saveProfileStoreGuard.test.ts:237` 이 파일 경로를 문자열로 참조 | 삭제 가능하되 그 테스트 목록을 함께 수정 |
| `lockMultiplier` 소비처 | `data/economy.ts` · DOM 정제소 · `tests/economy.test.ts` | 제거 범위가 좁음 |
| 결과 확정 ↔ 연출 순서 | `persist()` (`pixi/refinery.ts:238`) 가 스핀(`:246`) 보다 **먼저** | 이 순서를 규율로 유지 |

## 상태 모델 (중요한 설계 판정)

ADR 은 "이탈 = 암묵적 멈추기 = 자동 확정"으로 정했다. 이를 **가장 견고하게** 구현하는 방법은
확정을 이탈 시점에 하는 것이 아니라, **인벤토리가 항상 최신 굴림 결과를 반영하게** 하는 것이다.

```
인벤토리(영속)  : 언제나 current — 굴릴 때마다 즉시 교체 + saveProfile
공정 상태(휘발) : baseline(공정 시작 스냅샷) · fastened(고착 인덱스) · lastRollAt
```

- **멈추기 / 화면 이탈 / 다른 장비 선택** → 공정 상태만 버린다. 인벤토리는 이미 최신이라 별도
  확정 동작이 없다 = 자동 확정이 무동작으로 성립한다
- **용해** → `baseline` 을 인벤토리에 다시 써서 되돌린다 (+ `saveProfile`)
- **브라우저 크래시** → 마지막 굴림 결과가 남고 고착만 사라진다. 광물을 내고 아무것도 못 받는
  경우가 존재하지 않는다

이 모델은 기존 `reroll()` 의 "확정 → 저장 → 연출" 흐름을 그대로 물려받는다.

## Phase 0 — 순수 코어

### 0-A. `src/items/roll.ts` 확장

```ts
export interface ReforgeOpts {
  /** 재추첨에서 제외할 어픽스 인덱스(누적 고착). */
  readonly fastened?: readonly number[];
  /** 값 품질 밴드 하한 비율 [0,1]. 0 = 현행 균등. */
  readonly band?: number;
}
export function reforgeAffixes(item: Item, seed: number, opts?: ReforgeOpts): Item;
```

**RNG 스트림 형태 불변이 최우선 제약이다.** 값 추첨은 밴드가 걸려도 `rng.int()` **1회**를 유지한다:

```ts
const lo = def.min + Math.round((def.max - def.min) * band);
const value = rng.int(lo, def.max);   // 호출 횟수 불변 → 스트림 형태 보존
```

`band = 0` 이면 `lo === def.min` 이라 **현행과 바이트 동일**한 결과가 나온다. 퇴화 범위
(`min === max`)는 밴드와 무관하게 항상 같은 값을 낸다 — 별도 분기 없이 산식에서 자연히 성립한다.

기존 `rerollAffixes(item, seed, lockedIndex?)` 는 **시그니처를 그대로 두고** 내부에서
`reforgeAffixes(item, seed, { fastened: [lockedIndex] })` 로 위임한다. deno-verify 시나리오와
기존 테스트가 손대지 않고 통과해야 한다(회귀 기준선).

### 0-B. `data/economy.ts` 개편

- `lockMultiplier` · `LOCKED_REROLL_MULT` **제거**
- `rerollCost(rarity, affixCount, lockCount)` → `rollCost(rarity, affixCount, heat)` 로 대체.
  `heat` 는 노 출력 3단계이고 비용은 `rerollBaseCost × HEAT[heat].costMult`
- 노 출력 테이블을 여기 한곳에 둔다 — 비용 배수 · 위험 배수 · 값 밴드가 한 상수에 모여야
  "한 몸으로 움직인다"는 계약이 코드에서 읽힌다

```ts
export type Heat = 'low' | 'mid' | 'high';           // 약불 · 중불 · 강불
export const HEAT: Record<Heat, { costMult: number; riskMult: number; band: number }>;
// TODO(밸런스): 계수는 출시 전 일괄 튜닝. 앵커 = mid 가 현행 단발 리롤과 동일 비용.
```

### 0-C. 위험 산식

```ts
/** 고착 누적이 정하는 기본 실패율. 고착 0 → 0. */
export function baseRisk(fastenedCount: number, affixCount: number): number;
/** 실제 실패율 = baseRisk × HEAT[heat].riskMult, [0,1] 클램프. */
export function rollRisk(fastenedCount: number, affixCount: number, heat: Heat): number;
```

`fastenedCount === 0` 이면 어떤 노 출력에서도 **정확히 0** 이어야 한다 — 하위 호환이 이 한 줄에
걸려 있다.

## Phase 1 — 공정 상태기계

새 순수 모듈 `src/items/refiningChain.ts`. Pixi·i18n·네트워크를 모르고, 난수는 **주입**받아
테스트 가능하게 한다.

```ts
export interface ChainState {
  readonly baseline: Item;
  readonly current: Item;
  readonly fastened: readonly number[];
  /** 이번 굴림 이후 아직 고착을 쓰지 않았는가(굴림당 1개 규칙). */
  readonly canFasten: boolean;
}
export function openChain(item: Item): ChainState;
export function fasten(s: ChainState, index: number): ChainState;
export function roll(s: ChainState, heat: Heat, seed: number, riskRoll: number):
  { next: ChainState; melted: boolean; complete: boolean };
```

- `riskRoll` 은 호출부가 넘기는 [0,1) 난수 — UI 는 `Math.random()`, 테스트는 고정값
- `melted === true` → `next.current = baseline`, `next.fastened = []`
- `complete` = 모든 어픽스가 고착됨 → 공정 자동 종료
- `fasten` 은 `canFasten === false` 이거나 이미 고착된 인덱스면 **무시**(예외 아님)

## Phase 2 — Pixi UI 개조 (`src/ui/pixi/refinery.ts`)

상세 패널 재구성:

1. **노 출력 선택기** — 약불·중불·강불 3버튼(라디오). 선택에 따라 아래 비용·확률이 즉시 갱신
2. **실패 확률 표시** — 굴리기 버튼 바로 위에 실수치(`용해 위험 32%`). 고착 0개면 표시 자체를
   숨긴다(위험이 없다는 사실이 시각적으로도 없어야 한다)
3. **어픽스 행** — 자물쇠 토글을 **고착 버튼**으로 교체. 고착 완료 행은 금색 링 + 잠김 아이콘
   유지, 미고착 행은 `canFasten` 일 때만 활성
4. **비용** — `rollCost(rarity, affixCount, heat)`
5. **멈추기 버튼** — 공정이 열려 있을 때만 노출(= 고착이 1개 이상). 누르면 공정 상태만 버린다

기존 유지: 그리드·툴팁·휠 스크롤·`busy` 재진입 가드·`persist()` 의 `store ?? undefined` 함정 주석.

`spendCurrencyOnServer(0, cost, 'reroll')` 은 **스텝마다 그대로** 호출한다(ADR-0040). `busy` 가드는
스텝 수가 늘어난 만큼 더 중요해지므로 제거하지 않는다.

## Phase 3 — 연출: 위험의 가시화

무게중심은 **누르기 전 긴장**이다. 전부 render-only이고 결과에 영향이 없다.

- **노 광량** — 실패 확률에 비례해 화면 하단·버튼 주변 열기(주황 → 적색)가 짙어진다
- **미열(微熱) 진동** — 확률이 높을수록 굴리기 버튼과 고착 칩이 미세하게 떤다
- **고착 칩 축적** — 고착할 때마다 칩이 하나씩 박히는 짧은 연출 + 위험 표시가 즉시 점프
- **굴림** — 기존 12프레임 슬롯머신 유지. 고착 행은 안 돈다(현행 `spinTexts[i] = null` 그대로)
- **용해** — 고착 칩이 녹아내리며 화면이 식는다. 짧고 명확하게(반복 피로 방지)
- **완주** — 전용 연출 + 소리 한 번

시각 레지스터는 **카툰나무풍**(UI 크롬)을 벗어나지 않는다. ADR-0031 발광 규율은 전투 화면
대상이라 여기엔 걸리지 않지만, 넷째 레지스터를 만들지 않는다는 원칙은 그대로다.

사운드는 `uiSound` 훅에 신규 큐 4종(고착·굴림·용해·완주). 절차 합성이라 외부 에셋 0.

## Phase 4 — 정리

- `src/ui/refinery.ts`(DOM 정제소) **삭제**. `tests/saveProfileStoreGuard.test.ts:237` 의 경로
  목록에서 제거. ADR-0014 의 DOM 일괄 삭제 방침과 정합하되, 이번엔 **정제소 한 건만** 걷는다
  (다른 DOM 화면은 건드리지 않는다)
- `tests/economy.test.ts` 의 `lockMultiplier` 절 → 노 출력 배수 절로 교체
- i18n: `refine.lockNote` · `refine.cost.locked` · `refine.lock.title.lock` **제거**,
  신규 키 추가(노 출력 3종 라벨 · 용해 위험 · 고착 · 멈추기 · 용해 · 완주). ko/en 양쪽
- `scripts/deno-verify/scenarios.ts` — 다중 고착·밴드 시나리오 추가(기존 시나리오는 불변 유지)
- 신규 UI 아이콘을 쓰면 `UI_ASSET_NAMES` 와 `assets/` 를 함께 갱신(`tests/uiAssetPresence.test.ts`
  가 결손을 잡는다)

## 수용 기준 (AC)

| # | 기준 | 검증 |
|---|---|---|
| AC1 | `band = 0` · 단일 고착이면 결과가 현행과 **바이트 동일** | `tests/reroll.test.ts` 기존 케이스 무수정 통과 |
| AC2 | 밴드 상향 시 값 기댓값이 단조 증가 | 고정 시드 다수 표본, `low ≤ mid ≤ high` |
| AC3 | 퇴화 범위 3종(`multibarrel`·`piercing`·`freezing`)은 밴드 무관 불변 | 전 밴드에서 값 = 1 |
| AC4 | 다중 고착이 값·순서 보존, 재추첨 풀에서 제외돼 중복 없음 | 신규 테스트 |
| AC5 | `requiredLevel` 이 공정 전후 불변 | `tests/requiredLevel.test.ts` AC6 확장 |
| AC6 | 고착 0개면 어떤 노 출력에서도 실패율 정확히 0 | 신규 테스트 |
| AC7 | 용해 시 `current === baseline`, 고착 전량 해제 | 상태기계 테스트 |
| AC8 | 굴림당 고착 1개 초과 불가, 고착 해제 불가 | 상태기계 테스트 |
| AC9 | 전 어픽스 고착 시 `complete`, 공정 자동 종료 | 상태기계 테스트 |
| AC10 | 화면 이탈 후 재진입 시 장비가 **마지막 굴림 결과** | Pixi 화면 테스트 |
| AC11 | 연출 시작 **전에** 판정·저장 완료 | 소스 순서 가드 테스트 |
| AC12 | `spend` 거부(오프라인·잔액부족) 시 굴림·용해 어느 것도 일어나지 않음 | 기존 거부 경로 테스트 확장 |

## 위험과 완화

| 위험 | 완화 |
|---|---|
| 밴드 도입이 RNG 스트림 형태를 바꿔 기존 골든이 깨진다 | 값 추첨을 `rng.int()` 1회로 고정. AC1 이 회귀 기준선 |
| 강불 밴드가 장비 파워를 과도하게 인플레 | 상한은 `def.max` 라 드랍 천장 불변. 계수는 밸런스 보류 |
| 퇴화 어픽스 3종에서 "강불인데 안 좋아짐" 오해 | UI 가 그 어픽스에 밴드 표시를 하지 않는다(`FLAG_STATS` 와 같은 결) |
| 스텝 증가로 `spend` 왕복이 늘어 이중 차감 창 확대 | `busy` 가드 유지 + AC12 |
| 반복 피로 | 용해 연출을 짧게, 굴림 연출은 현행 길이(12×70ms) 유지 |

## 실행 순서

`Phase 0 → 1` 은 순수 모듈이라 UI 없이 전부 테스트로 닫힌다. 여기까지 그린이 된 뒤 Phase 2 로
간다. Phase 3(연출)·4(정리)는 Phase 2 이후 병렬 가능.

`pnpm test` 와 **`pnpm build`(tsc)를 반드시 함께** 돌린다 — 테스트만 그린인데 tsc 가 깨져 있던
회귀가 이 리포에 전례가 있다.

## 밸런스 보류 항목

계수는 전부 출시 직전 일괄 튜닝 대상이다(프로젝트 방침).

- 고착 누적 → 기본 실패율 곡선의 형태와 계수
- `HEAT` 3단계의 `costMult` · `riskMult` · `band`
- `mid` 를 현행 단발 리롤과 동일 비용으로 두는 앵커가 적절한지
