# M4 선행 스파이크 — 시뮬 코어 Deno 결정론 검증

- 상태: **완료 · 통과**
- 일자: 2026-07-16
- 브랜치: `feat/m3-progression-complete`
- 관련: 마스터 플랜 §4-2, ADR-0005(결정론 · 리플레이 해시)
- 러너: `scripts/deno-verify/`, 픽스처 생성: `tests/denoFixture.test.ts`

## 1. 목적

마스터 플랜 §4-2의 최대 기술 리스크를 M4 착수 **전에** 실증한다:

> Edge Function(Deno)에서 시뮬 코어를 실행 → 클라이언트(브라우저 V8)와
> 상태 해시가 bit-identical 하게 일치하는가?

일치하지 않으면 "서버 재검증(부정행위 방지 · 리더보드 신뢰)" 아키텍처 자체를
재논의해야 하므로, 이 스파이크의 통과 여부가 M4 진행의 게이트다.

**범위**: Deno 런타임에서의 결정론 검증까지. Edge Function 실제 배포(Docker /
Supabase 로컬 스택)는 범위 밖 — §6에서 이관 리스크만 평가한다.

## 2. 방법

### 2.1 소스 무수정 원칙

`src/sim/`·`src/items/`는 읽기 전용으로 두고, 신규 파일(하네스·테스트·문서)만
추가했다. 프로젝트는 ESM + `.js` 확장자 import 스타일(`import ... from './world.js'`)
인데 실제 파일은 `.ts`다. 브라우저 빌드는 Vite(bundler resolution)가, vitest는
Vite가 이 `.js → .ts` resolve를 처리한다.

Deno는 기본적으로 확장자를 정확히 요구하지만, **sloppy-imports**(unstable)를
켜면 `.js` specifier를 같은 이름의 `.ts`로 resolve한다. `scripts/deno-verify/deno.json`
에 다음만 두면 소스 한 줄도 고치지 않고 시뮬 코어를 그대로 import할 수 있다:

```json
{ "unstable": ["sloppy-imports"] }
```

→ **비침습 우회 성공. 소스 수정 0건, import 확장자 문제 없음.**

### 2.2 교차 검증 구조(공정성)

계산 로직을 한 곳(`scripts/deno-verify/common.ts`)에 모아 Node와 Deno가 **문자
그대로 동일한 코드**를 돌린다. 시나리오 정의(`scenarios.ts`)도 공용이다.

```
scenarios.ts  ─┬─ (Node/vitest) denoFixture.test.ts → fixtures.json  [ground truth]
 common.ts    ─┘
              └─ (Deno) verify.ts → fixtures.json 재현 비교 → exit 0/1
```

- **Node 측**(`tests/denoFixture.test.ts`, `npm test`에 포함): 4개 시나리오를
  실행해 기대값을 `fixtures.json`으로 굳히고, Node 안에서 2회 실행이
  bit-identical함을 검증(입력 생성·시뮬·해시의 완전 결정론이 전제).
- **Deno 측**(`deno task verify`): 같은 시나리오를 재실행해 `fixtures.json`과
  bit-identical 비교. 하나라도 어긋나면 종료 코드 1(CI 게이트 가능).

### 2.3 비교 대상(모두 bit-identical 요구)

- 시나리오별 **최종 해시** + 매 600틱 **체크포인트 해시** 스트림
- **입력 로그 해시**(입력 생성 자체의 런타임 일치)
- **드랍 시드 시퀀스**(`state.loot` — 정산 입력. 서버가 같은 아이템을 재현하는 근거)
- **rollItem / rerollAffixes 결과**(id · slot · rarity · weaponType · uniqueId · affixes)
- **수학 표면 프로브**(§4)

## 3. 시나리오(최소 4종)

| # | 시나리오 | config 핵심 | ticks | loot | 결과 |
|---|----------|-------------|------:|-----:|------|
| ① | 카르곤 정찰 기본 | planet0·tier0·내구 | 14056 | 1 | victory |
| ② | 베르단 교전 + 로드아웃 + 엘리트 어픽스 | planet1·tier1·스프레드+어픽스+유니크 | 14400 | 8 | victory |
| ③ | 변칙(이상현상) 수락 런 | anomalyAccepted + 로밍 | 2400 | 0 | 진행 |
| ④ | 유니크 장착 런(과열 드럼/관통 자이로) | uniqueMask bit0|bit2·레일건 | 14400 | 3 | victory |

②·④의 내구 파일럿 런은 보스까지 완주해 확정 드랍이 쌓이므로 드랍 시퀀스
결정론을 실전 경로로 게이트한다. ③은 이상현상 활성 + 스크롤맵 기믹(청크·벽·LOS)을
로밍으로 자극한다. rollItem 프로브는 rarity 4종 전부 + 유니크 레지스트리 resolve +
reroll(잠금/무잠금)을 커버한다.

> **역사적 각주(2026-07-24, ADR-0029)**: 시나리오 ③의 "변칙(이상현상)"과 아래 결과의
> 해시들은 **anomaly 폴드가 있던 pre-촉매 hashWorld 포맷**에서 채집된 기록이다. 변칙 경보는
> 이후 **촉매** 시스템으로 대체됐고(anomaly 중간 폴드 4개 제거 = 1회 포맷 범프), 지금 소스로는
> 이 해시들이 재현되지 않는다. 이 문서는 당시 Node↔Deno bit-identical 을 증거화한 **스파이크
> 스냅샷**이므로 값을 보존한다 — 현행 결정론 골든은 재생성분을 정본으로 쓴다.

## 4. 수학 표면 점검(과업 4)

sim이 쓰는 연산이 V8(Node) ↔ V8(Deno)에서 동일함을 단일 u32 해시로 증거화했다
(`common.ts` `mathProbe`, 512회 반복):

- **f64 기본 산술**(`+ - * / sqrt`): IEEE-754 correctly-rounded → 결정론 보장.
- **비트 연산 / `Math.imul`**: 정수 연산, 엔진 무관 정확.
- **`Math.fround`**: 단정도 반올림 — 두 런타임 동일 확인.
- **sim 자체 trig**(`src/sim/math.ts`의 `sin`/`cos`/`atan2`/`length`): 내장
  `Math.sin` 등은 correctly-rounded가 **아니어서** 엔진 버전 간 달라질 수 있는
  결정론 위험이라, 프로젝트는 기본 산술만으로 구현한 다항식 근사를 쓴다. 이
  플랫폼 무관성을 프로브가 직접 확인.

→ `mathProbe` 해시 `793092539` 가 Node·Deno에서 **동일**. 같은 V8 계열이라
예상대로 통과했고, 통과 증거를 픽스처로 남겼다.

## 5. 결과

두 런타임 모두 실행(참고):
- Node: `v24.13.0`
- Deno: `2.8.0` (V8 `14.9.207.2-rusty`)

```
=== Planet Blitz — Deno 결정론 교차 검증 ===
PASS 수학 표면 프로브  hash=793092539
PASS ① 카르곤 정찰 기본(로밍)              finalHash=932067480  ckpt=23 loot=1
PASS ② 베르단 교전 + 로드아웃 + 엘리트 어픽스  finalHash=952852774  ckpt=24 loot=8
PASS ③ 변칙(이상현상) 수락 런              finalHash=152774742  ckpt=4  loot=0
PASS ④ 유니크 장착 런(과열 드럼 / 관통 자이로)  finalHash=1498721294 ckpt=24 loot=3
=== 전체 통과: Node ↔ Deno bit-identical ===   (exit 0)
```

- **시나리오 4종 전부 · 체크포인트 75개 · 최종 해시 · 드랍 시퀀스 · 롤 결과 ·
  수학 프로브까지 bit-identical.**
- **음성 테스트**로 하네스가 실제로 불일치를 잡는지 확인: 픽스처의 `mathProbe`와
  ①의 `finalHash`를 각각 ±1 변조 → 정확한 경로와 함께 `FAIL` 2건 보고, 종료
  코드 **1**. (`deno task` 가 `Deno.exit(1)` 를 정상 전파 → CI 게이트 가능.)
- 유니크 레지스트리(side-effect import로 등록)도 양쪽에서 동일 resolve —
  예: ② 유니크 롤이 두 런타임 모두 `uniqueId: "phase-armor"`.

## 6. Edge Function 이관 시 주의점

이 스파이크는 **런타임 결정론**을 증명했다. 실제 Supabase Edge Function 이관 시
아래를 확인해야 한다(배포는 범위 밖이라 미검증 항목 포함).

1. **import 방식 / 번들링.** 로컬 검증은 sloppy-imports(unstable)로 `.js → .ts`를
   우회했다. Edge Function은 배포 시 번들되므로 두 갈래 중 하나를 택한다:
   - (권장) **사전 번들**: `deno bundle` 또는 Vite로 시뮬 코어를 확장자 문제 없는
     단일 ESM으로 굳혀 Function이 그 산출물을 import. sloppy-imports 같은 unstable
     플래그 의존을 배포 경로에서 제거해 안정적.
   - **또는** Edge Function 설정에서 동일 unstable 플래그 유지. supabase가 이
     플래그를 지원하는지 버전 확인 필요.
2. **supabase functions의 Deno 버전 고정.** 결정론은 "같은 V8"에 기댄다. 로컬
   검증은 Deno 2.8.0(V8 14.9). Supabase 런타임 Deno 버전이 다르면 이론상 trig
   내장 함수 차이가 문제가 될 수 있으나 — sim은 내장 trig를 **쓰지 않으므로**
   실질 위험은 낮다. 그래도 f64/`Math.fround`/`imul`은 IEEE·정수 규격이라
   버전 무관. **런타임 버전을 명시적으로 핀**하고, 업그레이드 시 이 하네스를
   회귀 게이트로 재실행할 것.
3. **DOM/브라우저 전역 없음 확인됨.** 시뮬 의존 그래프에 `window`·`document`·
   `pixi`·`Date.now`·`performance.now`·`Math.random`가 없다(검증함). Edge에서
   그대로 안전.
4. **입력 신뢰 경계.** 서버는 클라이언트가 제출한 `[seed + 입력 로그]`만 받아
   재실행하고 해시를 비교한다. 입력 로그 크기(장기 런은 수만 프레임)의 전송·
   저장 비용과, Function 실행 시간 상한(CPU wall-clock)을 M4에서 산정할 것.
   ②·④가 14400틱을 Deno에서 순식간에 재현하므로 시간 예산은 여유로울 전망.
5. **픽스처 회귀 게이트.** `fixtures.json`을 커밋해 `deno task verify`가 단독
   실행 가능하다. 시뮬 변경 시 `npm test`가 픽스처를 재생성하고, `deno task
   verify`로 이관 후에도 bit-identical을 재확인하는 2단 게이트를 CI에 넣기를 권장.

## 7. 결론

> **M4 아키텍처(Edge Function 서버 재검증) 진행 가능.**

시뮬 코어와 아이템 롤러는 Node(브라우저) V8과 Deno V8에서 상태 해시·드랍
시퀀스·롤 결과가 bit-identical하다. 최대 리스크는 해소됐고, 남은 것은 결정론
자체가 아니라 **번들링·런타임 버전 핀·실행 시간 예산**(§6)이라는 통상적 배포
엔지니어링 항목이다. 아키텍처 재논의는 불필요.

## 부록 A. 재현 방법

픽스처 생성(Node/ground truth):

```
npx vitest run tests/denoFixture.test.ts
```

Deno 교차 검증:

```
deno task verify
```

(`scripts/deno-verify/` 에서 실행. `deno.json`의 sloppy-imports가 `.js → .ts`
resolve를 담당하므로 별도 플래그 불필요.)
