/**
 * verify-run Edge Function 진입점 (M4 Phase A · Deno.serve 래퍼).
 *
 * HTTP 배선만 담당한다 — 요청 JSON을 파싱해 검증 코어(`verifyRun`)에 넘기고 그
 * 결과를 JSON 응답으로 돌려준다. 실제 검증 로직은 `verifyCore.ts`(플랫폼 전역 무참조)에
 * 있어 vitest·Deno 어디서나 테스트 가능하다.
 *
 * ⚠️ 이 파일은 `Deno` 전역을 참조하므로 Node/tsc 대상에서 import 하지 않는다
 * (tsconfig include 밖 + 테스트는 verifyCore만 import). Supabase 프로젝트가 아직
 * 없으므로 **배포는 하지 않는다**. 로컬 검증은 verifyCore를 대상으로 한다.
 *
 * 로컬 기동(참고, 배포 전 수동 확인용 — Supabase 관용대로 Deno.serve 사용):
 *   deno task serve   (= deno run --allow-read --allow-net index.ts, 기본 포트 8000)
 * 스모크(다른 셸에서):
 *   curl -X POST localhost:8000 -d '{"seed":1,"inputs":[...],"claim":{...}}'
 */

import { verifyRun } from './verifyCore.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    // 'method-not-allowed'는 verifyCore.ts의 ReasonCode 유니온 밖이다(의도적) — 이
    // 값은 검증 코어가 재실행 전에 내리는 판정이 아니라, HTTP 배선 계층(이 파일)이
    // 요청 자체를 코어에 넘기기도 전에 거절한 전송 계층 사유다. ReasonCode에 섞으면
    // "재실행 결과에 대한 판정"과 "요청이 검증 대상조차 못 됐다"는 서로 다른 층위가
    // 뒤섞여 클라이언트 분기가 애매해지므로 문자열 그대로 둔다(리뷰 권고, 최소 수정).
    return json({ verdict: 'reject', reason: 'method-not-allowed' }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // 'invalid-json'도 위와 동일한 이유로 ReasonCode 밖의 전송 계층 사유다 — 파싱
    // 자체가 실패해 verifyRun 호출까지 가지 못했다는 뜻.
    return json({ verdict: 'reject', reason: 'invalid-json' }, 400);
  }

  // verifyRun 은 신뢰 불가 입력을 내부에서 전부 검증한다(구조 오류도 reject 로 반환).
  const result = verifyRun(body);
  return json(result, 200);
});
