# verify-run — 리플레이 전수 재실행 검증 (M4 Phase A)

ADR-0005 결정론 무결성의 서버측 게이트다. 클라이언트가 제출한 리플레이
`[시드 + 입력 로그 + config + 주장(해시·결과)]`를 서버(Deno Edge Function)가
**전수 재실행**해, 클라이언트가 보낸 값과 대조하고 `accept`/`reject`를 판정한다.

## 구조 — 검증 코어와 배선 분리

| 파일 | 역할 | 플랫폼 전역 참조 |
|---|---|---|
| `verifyCore.ts` | 순수 검증 로직 `verifyRun(raw): VerifyResult` | 없음(테스트/CI 대상) |
| `index.ts` | `Deno.serve` HTTP 래퍼(요청 파싱·응답) | `Deno` |
| `deno.json` | sloppy-imports·로컬 태스크 | — |

`verifyCore.ts`는 `Deno`·`window`·Node `process`를 일절 참조하지 않고
`src/sim/`(공유 소스, 갈림길①A)만 import 한다. 덕분에 브라우저(Vite)·Node(vitest)·
Deno(Edge Function) 어디서나 **동일한 코드**가 돈다 — 검증 코어의 이식성 자체가
무결성의 근거다. 테스트는 `index.ts`(Deno 전역)를 건드리지 않고 `verifyCore.ts`만
import 하므로 CI(vitest)에서 실행된다.

`.js` specifier(`../../../src/sim/replay.js`)는 프로젝트 ESM 규약이고, 실제 파일은
`.ts`다. Deno는 `deno.json`의 `unstable: ["sloppy-imports"]`로, Vite/vitest는
번들러 resolution으로 `.js → .ts`를 해소한다 — **sim 소스 무수정**.

## 제출 포맷 (`RunSubmission`)

```ts
{
  seed: number,
  config?: WorldConfig,          // 없으면 sim 기본값
  inputs: InputFrame[],          // 틱별 입력 로그
  claim: {
    finalHash: number,           // 클라이언트가 계산한 최종 해시
    hashStream?: number[],       // (선택) 틱별 해시 스트림. 있으면 매 틱 대조
    outcome: { victory: boolean, gameOver: boolean }  // 주장 결과(래더 근거)
  }
}
```

응답 `VerifyResult`:

```ts
{ verdict: 'accept' | 'reject', reason: ReasonCode, computed?: { finalHash, ticks, outcome, divergedAt? } }
```

`reason` 코드(기계 판독용, 영문 유지): `verified`(수락), 구조 오류
`malformed-*`·`empty-inputs`·`inputs-too-long`, 재실행 예외 `replay-threw`, 위조
`final-hash-mismatch`·`hash-stream-length-mismatch`·`hash-stream-divergence`·`outcome-mismatch`.

## 위조 방어 (A3, AC2)

서버 재실행 결과가 **항상 진실**이다(원칙2 서버 권위). 클라이언트 주장은 증거일 뿐.

| 공격 | 검출 |
|---|---|
| ① 조작된 최종 해시 | `final-hash-mismatch` |
| ② 변조된 입력 로그 | `final-hash-mismatch`(또는 `hash-stream-divergence`) |
| ③ 트림된(짧은) 로그 | `final-hash-mismatch` / `hash-stream-length-mismatch` |
| ④ 조작된 결과(승패 뒤집기) | `outcome-mismatch` |

## 검증 (배포 없이)

Supabase 프로젝트는 아직 없다. **배포하지 않는다.** 검증 코어를 두 런타임에서 돌려
무결성을 확인한다:

- Node/CI(vitest, 위조 거부 + 수락):

  ```
  npx vitest run tests/verifyRun.test.ts
  ```

- Deno(검증 코어 parity + 위조 거부, 대표 리플레이 6종 재실행):

  ```
  deno task verify-run
  ```

  (`scripts/deno-verify/` 에서. Node fixture(ground truth)의 최종 해시와 Deno
  재실행 해시가 bit-identical 함을 함께 확인 → 검증 코어 자체의 Node↔Deno 일치.)

- 기존 결정론 스트림 parity(체크포인트 해시, 4행성·보스·장기 런):

  ```
  deno task verify
  ```

## 이관 시 주의 (Supabase 프로젝트 생성 후, Phase B/D)

- import 전략: 로컬은 sloppy-imports(unstable)로 우회. 배포 경로에서는 사전 번들
  또는 supabase 런타임의 동일 플래그 지원 확인(스파이크 문서
  `docs/spikes/deno-determinism.md` §6-1).
- Deno/V8 버전 핀: 결정론은 "같은 V8"에 기댄다. supabase 런타임 버전을 명시적으로
  고정하고, 업그레이드 시 이 검증을 회귀 게이트로 재실행.
- config 신뢰: Phase A는 config를 그대로 재실행한다. 침공 검증(Phase D)에서 방어
  배치·로드아웃이 서버 저장본과 일치하는지 별도 대조가 필요하다.

## Phase D 착수 조건 (carry-forward 게이트, 리뷰 반영)

Phase A의 `verifyRun`은 "제출된 [seed+config+inputs]가 주장된 결과를 내적으로
재현하는가"만 증명한다. 침공/래더처럼 결과가 순위에 직결되는 흐름(Phase D 전수
검증)에 배선하려면, 아래 3건을 **먼저** 게이트해야 한다 — 지금 상태로는 배선 금지:

1. **config 정당성 대조.** 클라이언트가 보낸 `config`(방어 배치·로드아웃 등)를
   서버가 정의/보유한 값(DB에 저장된 `defenses`·인벤토리 등)과 대조하는 별도
   단계가 필요하다. 지금은 제출된 config를 그대로 믿고 재실행할 뿐이라, config
   자체를 조작해 제출하면 내적으로는 일관된(=accept되는) 위조가 가능하다.
2. **침공 제출은 `hashStream` 필수화.** Phase A에서는 `hashStream`이 선택
   필드였다(최종 해시만으로도 accept). 침공처럼 무결성이 최우선인 제출은
   `hashStream` 부재를 그 자체로 reject하는 정책으로 좁혀, 중간 발산 지점(위조
   추적 근거)을 항상 확보해야 한다.
3. **배포 시 재실행 시간예산/AbortSignal.timeout 가드.** Edge Function은 CPU
   wall-clock 상한이 있다(§6-4 스파이크 문서). 장기 리플레이(최대
   `MAX_INPUT_TICKS`)의 재실행이 상한을 넘지 않는지 실측하고, `AbortSignal.timeout`
   등으로 초과 시 명시적으로 실패(=reject, DoS 방지)하도록 `index.ts`에 가드를
   추가해야 한다. 지금은 무제한 대기다.
