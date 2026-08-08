<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# supabase/functions — Edge Function

## 목적

Deno 런타임에서 도는 서버 로직. 각 함수는 `index.ts`(Deno.serve 래퍼) + `*Core.ts`(검증 코어)로
갈려 있어 **코어는 Node vitest 로도 검증**된다.

⚠️ **이 문단은 2026-08-08 까지 "검증 함수 둘이 `src/sim/**` 를 직접 import 해 시뮬 코어를 통째로
번들한다 — 서버가 제출된 리플레이를 그 번들로 재계산해 해시를 대조한다" 고 적고 있었다. 그것은
ADR-0050(서버 재실행 삭제) 이전의 사실이다.**

**지금은 둘 다 `src/sim` 을 싣지 않는다.** `verify-invasion/deno.json` 의 `//` 주석과
`verify-commission/index.ts` 헤더가 각각 그렇게 적고 있고, 실측 번들이 **3.4KB / 5.7KB**(재실행이
살아 있던 시절은 210KB~241KB)다. `verify-commission` 이 `src/` 에서 끌어오는 것은
`src/run/commission*` 둘뿐이다.

→ **`src/sim/**` 만 고친 레인은 재배포가 필요 없다.** 2026-08-08 촉매 배선 레인이 `src/sim` 을
광범위하게 고친 뒤 배포본과 새 번들을 대조했더니 **두 함수 다 바이트 동일**이었다
(`6267F36E…` / `D47C7749…`). 낡은 이 문장을 믿고 재배포하면 무연산에 시간만 쓴다 — 반대로
**이 문장이 낡은 줄 모르고 "필수"라고 보고하면 사용자를 오도한다**(실제로 그렇게 보고했다가 정정했다).

## 하위 디렉터리

| 디렉터리 | 역할 | 배포 대상? |
|---|---|---|
| `verify-invasion/` | 침공 제출 검증 + 위조 거부 | 예 — **이 함수 자신**을 고쳤을 때 |
| `verify-commission/` | 의뢰 런 검증 + 확정 지급물 발급 원장 | 예 — 이 함수 자신 또는 `src/run/commission*` |
| `verify-run/` | PvE 런 검증 코어 | 아니오(로컬 전용 — `bundle` 태스크 없음) |
| `modules/` | 코어 모듈 경제(구매·합성) | 아니오(type-only import — 시뮬을 번들하지 않는다) |
| `daily-reward/` | 일일 보상 수령(ADR-0048, 6축 전부) | 자체 로직만 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **재배포 여부를 "소스를 건드렸나"로 판단하지 마라.** 공유 모듈 때문에 안 건드린 함수의 번들이
  바뀌기도 하고, 반대로 건드렸는데 트리셰이킹이 걷어내 **바이트 동일**이기도 하다.
  `spb functions download` 로 배포본을 받아 로컬 번들과 해시를 비교하는 것이 유일하게 확실하다.
- **번들은 폐기용 detached 워크트리에서 만든다.** 배포 절차가 `index.ts` 를 자립 번들로 덮어쓰기
  때문에 본 워크트리에서 하면 오염이 남는다. 번들 소스 커밋이 `origin/main` 과 같은지도 대조한다.
- **인증 없이 엔드포인트를 때려 본 것은 부팅 검증이 아니다.** Authorization 헤더가 없으면 게이트웨이가
  `401 UNAUTHORIZED_NO_AUTH_HEADER` 를 돌려주고 함수는 부팅조차 안 한다 — anon 키로 게이트를
  통과시켜 본체 응답을 받아야 검증이 성립한다.
- 전체 절차·함정의 정본은 `.omc/skills/planet-blitz-supabase-deploy-workflow.md`, 배포 현황은
  `supabase/DEPLOYMENTS.md` 다.
- Deno 코드에서 `if not <integer>` 류의 파이썬식 관용구를 옮겨 쓰지 않는다 — 첫 호출에서만 터지는
  결함이 실제로 있었다.

### 테스트 요구사항

- `*Core.ts` 는 `tests/verify*.test.ts` 로 Node 에서 돈다.
- Deno parity·위조 거부는 `scripts/deno-verify/verifyRun.ts`·`verifyInvasion.ts`.
- **`pnpm test` 와 `deno-verify/fixtures.json` 이 전부 그린이어도 재배포는 필요하다** — 그 12
  시나리오는 침공 경로를 태우지 않는다.

### 공통 패턴

- `index.ts`(HTTP·인증·에러 매핑) ↔ `*Core.ts`(순수 검증·계획). 순수 쪽에 로직을 몰아 테스트한다.

## 의존성

### 내부

`src/sim/**` · `src/run/commission*` · `src/items/**`(재도출)

### 외부

Deno 표준 라이브러리 · `@supabase/supabase-js`(service_role)

<!-- MANUAL: -->
