---
name: render-screen-verification-expertise
description: 렌더 결함은 중간 산출물이 아니라 합성된 화면에서 재야 한다 — 그리고 이 리포의 in-app Browser pane 에서는 그 측정이 구조적으로 불가능하다(대조군 필수, Chrome DevTools MCP 로 우회)
triggers:
  - 보스가 안 보여
  - 렌더는 되는데 화면에 안 나온다
  - 스프라이트가 투명
  - renderer.extract
  - extract.canvas opaque 0
  - 화면 검증
  - 합성 프레임 읽기
  - Browser pane 스크린샷
  - hidden pane rAF
  - 픽셀은 있는데 안 보인다
---

# 렌더 검증은 파이프라인 끝단에서 — 그리고 이 pane 에서는 그게 안 된다

## The Insight

**통과한 검증이 무엇을 증명했는지 물어라.** 렌더 파이프라인이
`소스 → 중간 버퍼 → GPU 업로드 → 합성 → 화면` 이라면, 중간 버퍼에 픽셀이 있다는 사실은
**그 앞 단계까지만** 증명한다. 뒤쪽 어느 단계가 통째로 죽어 있어도 그 계측은 계속 초록이다.

2026-07-30 보스 3D 레인에서 이걸 두 번 밟았다. `stage.canvas`(three 가 그린 오프스크린
아틀라스)를 `drawImage` 로 읽어 "불투명 픽셀 4,728개 — 정상"을 반복 확인했는데, 캔버스에는
**언제나** 픽셀이 있었다. 정작 죽어 있던 것은 그 다음 단계(Pixi GPU 업로드)였고, 사용자는
두 번 "보스가 안 보인다"고 신고했다.

두 번째 통찰이 따라온다: **측정 도구도 고장 날 수 있고, 고장은 '결함 발견'처럼 보인다.**
같은 세션에서 `renderer.extract.canvas(sprite)` 가 opaque 0 을 돌려줘 "GPU 텍스처가 비었다"는
결론으로 갈 뻔했다. 확실히 화면에 보이는 `player.png` 를 대조군으로 넣자 **그것도 0** 이었다 —
도구가 이 환경에서 작동하지 않았을 뿐이다.

## Why This Matters

이 두 실패는 방향이 반대라 더 위험하다.
- 중간 산출물 계측 → **거짓 통과**(결함을 놓치고 "검증 완료"를 보고한다)
- 고장 난 측정 도구 → **거짓 실패**(멀쩡한 코드를 뜯어고치러 간다)

둘 다 "숫자를 봤다"는 감각을 주기 때문에, 추측보다 더 확신하게 만든다.

## Recognition Pattern

- 사용자는 "안 보인다"는데 내 계측은 전부 정상이다
- 계측 대상이 화면이 아니라 **텍스처·캔버스·버퍼·자산 파일**이다
- 어떤 지표가 딱 0 / 딱 100% 처럼 극단값이다 (도구 고장의 전형)
- 파이프라인에 **조용한 폴백**이 있다(이 리포는 자산 누락·GL 실패를 전부 조용히 넘긴다)

## The Approach

**① 검증 대상을 파이프라인 끝단으로 옮겨라.** "무엇이 있다"가 아니라 "화면에 무엇이 나왔다"를
재라. 자산이 번들에 있다 ≠ 표시된다. 캔버스에 픽셀이 있다 ≠ 합성된다.

**② 모든 측정에 대조군을 붙여라.** 확실히 정상인 대상을 같은 도구로 함께 재라. 대조군도 같은
값을 내면 그건 결함이 아니라 도구 고장이다. **대조 없이 나온 0 을 결함으로 읽지 마라.**

**③ 이 리포의 in-app Browser pane 에서는 화면 검증이 구조적으로 불가능하다.** 실측:
- rAF 가 0회 → `__pb.gameApp.app.ticker.update()` 로 강제해야 한다 (기존에 알려진 함정)
- `renderer.extract.canvas(sprite)` → **확실히 보이는 스프라이트도 opaque 0**
- 합성 캔버스 `drawImage(app.canvas)` → `sprite.visible` 을 껐다 켜도 **델타 0**
  (마지막 합성 프레임을 계속 돌려준다)

→ 화면 검증은 **Chrome DevTools MCP** 로 실제 Chrome 을 띄워 스크린샷을 찍는다.
`mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page` → `evaluate_script` 로 상태 구성 →
`take_screenshot`.

**④ 보스를 화면에 붙잡아 두는 요령**(안 하면 오토파일럿이 몇 프레임 만에 죽여 정산 화면이 뜬다):
보스 세그먼트로 점프 → `harness.cheat` 로 보스 hp 복구 + 플레이어 무적 → **`harness.pause()`**.
sim 만 멈추고 rAF 는 계속 돌아 렌더가 살아 있다.

**⑤ 티어를 고정하라.** 계측 중 FPS 가 낮게 잡히면 티어가 low 로 떨어져 이펙트 게이트가 꺼진
화면을 보고 판정하게 된다.

## Example

```js
// ❌ 중간 산출물만 잰다 — 항상 통과한다
const d = ctx.drawImage(stage.canvas, ...) && ctx.getImageData(...).data;
let n = 0; for (...) if (d[k+3] > 8) n++;
return { opaque: n };          // 4728 "정상" — 그런데 화면엔 없다

// ✅ 끝단을 재되, 대조군을 함께 넣는다
for (const [sp, label] of [[bossSprite, 'BOSS'], [playerSprite, 'CONTROL']]) {
  const c = app.renderer.extract.canvas(sp);
  ...
}
// CONTROL 도 0 이면 → 결함이 아니라 도구 고장이다. Chrome DevTools MCP 로 옮겨라.
```
