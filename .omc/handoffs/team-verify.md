## Handoff: team-verify → team-fix

`code-reviewer`(opus) 판정: **REQUEST CHANGES** (CRITICAL 1 · HIGH 1 · MEDIUM 4 · LOW 4).
lead 가 CRITICAL·HIGH 를 소스에서 직접 재확인했다. `verifier` 판정은 도착 시 이 문서에 합친다.

### lead 독립 확인 (통과)

| 항목 | 결과 |
|---|---|
| `corepack pnpm test` | 196 파일 / 3,715 테스트 전부 통과 |
| `corepack pnpm build` | **EXIT=0** (파이프 없이 실행해 실제 종료 코드 확보) |
| AC1 회귀 기준선 | `git diff --numstat tests/reroll.test.ts` **빈 출력** = 무수정 |
| 결정론 골든 | `fixtures.json` 추가 276 / **삭제 0** |
| 저장 ↔ 연출 순서 | `refinery.ts:391→396→397(persist)→400(startFx)` |

> ⚠️ **방법론 함정 기록:** 첫 검증 시도가 `corepack pnpm test \| tail -25` 형태였고
> `exit 0` 이 나왔다. **그 0 은 `tail` 의 종료 코드지 테스트의 것이 아니다** — 테스트가 전부
> 실패해도 0 이 나온다. 게다가 `tail` 이 파이프가 닫힐 때까지 버퍼링해 출력 파일도 비어 있었다.
> 게이트를 확인할 때는 파이프를 걸지 말고 파일로 리다이렉트한 뒤 `$?` 를 읽어라.

---

## 고칠 것

### 뿌리는 하나다
`busy` 가드가 **`reroll`·`fasten`·`stopRefining` 에만** 있고 **`select`·`setHeat`·`close` 에는 없다.**
레인 E 는 계약 §E-2 의 "`busy` 가드를 제거하지 마라"를 기존 호출부에서 지켰지만, **자기가 새로
만든 상태 전이**(장비 재선택·노 출력 변경)에는 확장하지 않았다. ADR-0040 §결과 절이
*"스텝이 늘어난 만큼 왕복도 늘어 `busy` 가드는 오히려 더 중요해진다"* 라고 예고한 바로 그 지점.

`spinning` 이 대신 막아 주지 못하는 이유: **`spinning` 은 `await` 뒤에야 세워진다.** 서버 왕복
구간을 잠그는 것은 오직 `busy` 다.

### [CRITICAL] 왕복 중 장비 재선택 → 장비 영구 소실 + id 중복
`src/ui/pixi/refinery.ts:294-301` (`select`)

1. 장비 A 선택 → 굴리기 → `item=A`·`chain=chainA` 캡처, `busy=true`, `await spend`
2. 왕복 중 목록에서 **B 클릭** → `select(B)` 가 통과(`spinning` 은 아직 false) →
   `selectedId=B`, `chain=openChain(B)`
3. 복귀 → `rollChain(chainA, …)` → `this.chain = outcome.next` 가 chainB 를 덮어씀
4. 다음 굴림: `item = selected() = B`, `chain = chainA` →
   `inventory[B의 위치] = A를 재단조한 객체` → **B 소실, A 의 id 가 둘.** `persist()` 즉시 저장

**수정**
- `select()` 에 `if (this.spinning || this.busy) return;`
- 추가 방어: `reroll()` 이 `await` 복귀 후 `this.selectedId !== item.id` 면 결과 반영을 포기
  (가드가 뚫려도 데이터는 안 깨지도록 — 이중 방어)

### [HIGH] 왕복 중 노 출력 변경 → 지불한 열 ≠ 적용된 열
`src/ui/pixi/refinery.ts:303-307` (`setHeat`) · `:357`(cost) · `:391`(rollChain)

`cost` 는 `await` **전에** `this.heat` 로, `rollChain` 은 `await` **후에** `this.heat` 를 다시
읽는다. 약불로 결제하고 왕복 중 강불로 바꾸면 **약불 값에 강불 밴드**(`band 0.55`)를 산다.
반대로 하면 강불 비용을 내고 위험만 낮춘다. 어느 쪽이든 화면에 띄운 "용해 위험 N%" 가 실제
판정과 달라져 ADR 의 *"확률은 굴리기 전에 실수치로 노출된다"* 가 깨진다.

**수정 (가드만으로는 부족 — 구조를 고쳐라)**
- `reroll()` 진입 시 `const heat = this.heat;` 로 **스냅샷**하고, `currentCost()` 와
  `rollChain()` 이 **같은 지역 변수**를 쓰게 한다. "지불한 열"과 "적용된 열"이 별개 출처인 것이
  근본 문제다
- `setHeat()` 에도 `busy` 가드 추가

### ⚠️ [lead 추가 발견] 진입점 가드만으로는 닫히지 않는다 — `await` 복귀 후 재검증이 필수

리뷰어의 처방(진입점 3곳에 `busy` 가드)은 **필요하지만 충분하지 않다.** `main.ts` 가
**`close()` 를 거치지 않고 `refinery.hide()` 를 직접 부르는 곳이 5군데**다(화면 전환·런 시작 등
`main.ts:593 · 849 · 1834 · 1848 · 2005`). `close()` 에 가드를 걸어도 그 경로는 전부 통과한다.

일반화하면: **가드는 창을 좁힐 뿐 없애지 못한다.** `await` 구간 동안 외부(다른 화면·하네스·
테스트)가 상태를 바꿀 수 있는 한, 복귀한 코드는 자기가 떠날 때의 세계가 아직 있다고 가정하면
안 된다.

**그래서 `reroll()` 의 `await` 복귀 직후에 재검증을 넣어라 (진입점 가드와 함께, 둘 중 택일이 아니다):**

```ts
const res = await spendCurrencyOnServer(0, cost, 'reroll');
// … res 분기 처리(광물 반영) …

// ⚠️ 여기서부터 "떠날 때의 세계"를 믿지 않는다. 재화는 이미 차감됐으므로 굴림 결과는
//    반드시 적용하되(플레이어가 값을 치렀다), 그 사이 바뀐 상태를 덮어쓰지는 않는다.
const stillSame = this.selectedId === item.id;
const stillVisible = this.root.visible;

const outcome = rollChain(chain, heat, seed, riskRoll);   // heat 는 진입 시 스냅샷한 지역 변수

// 인벤토리 반영·저장은 **무조건** 한다 — 이 아이템의 굴림 값을 이미 지불했다.
const idx = this.profile.inventory.findIndex((it) => it.id === item.id);
if (idx >= 0) this.profile.inventory[idx] = outcome.next.current;
this.persist();

// 화면 상태 갱신은 아직 같은 장비를 보고 있을 때만. 다르면 chain 을 덮어쓰지 않는다
// (덮어쓰면 selectedId 와 chain 이 갈려 다음 굴림이 남의 슬롯에 쓴다 — CRITICAL 의 뿌리).
if (!stillSame) return;
this.chain = outcome.next;
this.hint = outcome.melted ? t('refine.chain.melted') : '';
if (stillVisible) this.startFx(outcome.melted ? 'melt' : 'spin');
```

이 재검증이 CRITICAL·HIGH·`close()` MEDIUM 셋을 **한 자리에서** 닫는다. 진입점 가드는 그 위에
얹는 1차 방어다(사용자가 애초에 그 창에서 조작하지 못하게).

**테스트로 잠글 것:** `spend` 를 수동 resolve 가능한 Promise 로 만들어 `await` 창을 열어 두고,
그 안에서 ① 다른 장비 `select()` ② `setHeat()` ③ `hide()` 를 각각 수행한 뒤 resolve 해서,
세 경우 모두 **인벤토리에 id 중복이 없고 장비 개수가 보존되며** 원래 장비만 갱신되는지 단언해라.
이것이 CRITICAL 의 실제 재현 테스트다 — 순차 단위 테스트로는 이 창이 열리지 않아 3,715개가
전부 그린이었다.

### [MEDIUM] `close()` 가드 누락 → 숨겨진 화면에서 Ticker 누수
`src/ui/pixi/refinery.ts:620-625`. 왕복 중 X 클릭 → `hide()` → 복귀한 `startFx()` 가
`render()` 를 돌리고 위험>0 이면 `Ticker.shared.add` 를 건다. 데이터 손실은 없고 render 누수다.
**수정:** `close()` 에 동일 가드.

### [MEDIUM] `rollChain` 의 band 전달이 커버리지 0
`src/items/refiningChain.ts:112-115` ↔ `tests/refiningChain.test.ts`

`reforge.test.ts` 는 `band` 를 **직접 넘겨** 검증하고, `refiningChain.test.ts` 는 `heat` 를
넘기되 **값을 비교하지 않는다**(개수·id·불변성만). 즉 `band: 0` 하드코딩이거나 `riskMult` 를
`band` 자리에 넣었어도 **24케이스 전부 그린**이다. 노 출력 기능 전체가 이 한 줄에 달렸다.
두 레인이 각자 자기 쪽만 보고 **경계를 아무도 안 본** 사각지대.

**수정:** `rollChain(s,'low',seed,1)` 과 `rollChain(s,'high',seed,1)` 의 어픽스 값 총합 비교
1케이스. 같은 시드면 같은 어픽스가 같은 순서로 뽑히므로 공정한 비교다
(`reforge.test.ts:64-75` 가 이미 그 논거를 쓴다).

### [MEDIUM] AC10·AC11·AC12 테스트 근거 없음
- **AC10** `hide()` → `show()` 왕복 후 인벤토리가 마지막 굴림 결과인지
- **AC11** `persist()` → 연출 순서. **누가 `startFx()` 를 `persist()` 위로 올려도 지금은 어떤
  테스트도 빨개지지 않는다.** `saveProfile` spy 와 `setInterval` spy 의 호출 순서를 비교해 잠가라
- **AC12** `insufficient` 만 덮여 있고 **오프라인(`unavailable`) 분기 미검증**. 서로 다른
  `return` 이라 한쪽만으로는 부족

### [MEDIUM] 용해의 UI 배선 미검증
상태기계의 용해는 촘촘하지만 "용해 시 `inventory[idx]` 가 `baseline` 으로 되돌아가고
`persist()` 된다"는 UI 배선은 어떤 테스트도 안 밟는다. 이 리포에 *"단위 테스트 그린인데 배선이
통째로 없다"* 가 8건 누적된 이력이 있다. `Math.random` 을 0 으로 고정하고 고착 1개를 만든 뒤
굴리면 결정론적으로 용해한다.

---

## 후속으로 미루는 것 (LOW 4건 — PR 본문에 남긴다)

1. 사문화된 i18n 키 4종 — **lead 실측 확인**. `refine.cost.normal` · `refine.rollBtn` ·
   `refine.lock.alt.locked` · `refine.lock.alt.unlocked` 넷 다 카탈로그 밖 참조 **0건**
   (대조군 `refine.spinning`·`refine.reroll` 은 1건씩 살아 있어 grep 자체는 정상).
   특히 `refine.lock.alt.*` 는 계약이 "고착 아이콘 대체텍스트로 **재사용**하라"고 했는데
   레인 E 가 `makeIconButton` 의 이모지 폴백을 쓰면서 안 넘겼다 — 재사용하거나 함께 지워라.
   ko·en 양쪽에서 지워야 `tests/i18n.test.ts` 의 키 집합 일치 검사가 통과한다.
2. 노 출력 설명문 줄바꿈이 비용 줄과 닿을 가능성 — **추측**(렌더 미확인)
3. 어픽스 8개 이상에서 클램프가 겹침으로 전환(현재 도달 불가 — 레어/유니크 최대 6)
4. `insufficient` 거부 후 로컬 광물 미러가 서버 잔액과 갈린 채 칩에 남음(기존 화면 공통 패턴)

---

## 재검증 시 유의

`tests/denoFixture.test.ts` 단독으로 **약 380초**(전체 스위트 606초의 대부분)다. 수정 후
전체 재실행 예산에 반영해라. 이번 수정은 `src/ui/pixi/refinery.ts` 와 테스트에만 닿으므로
결정론 픽스처는 다시 움직이지 않아야 한다 — `fixtures.json` numstat 이 여전히 `276 0` 인지
확인해라.
