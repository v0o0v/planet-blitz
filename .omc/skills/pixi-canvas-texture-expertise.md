---
name: pixi-canvas-texture-expertise
description: Pixi v8 에서 캔버스를 텍스처로 쓸 때는 반드시 CanvasSource — 베이스 TextureSource 로 감싸면 GPU 텍스처가 경고 없이 빈 채로 남는다
triggers:
  - CanvasSource
  - TextureSource
  - 캔버스를 텍스처로
  - uploadMethodId
  - 빈 텍스처
  - 스프라이트가 투명한데 캔버스엔 픽셀
  - three.js Pixi 합성
  - offscreen canvas texture
  - Texture.from(canvas)
---

# Pixi v8 캔버스 텍스처는 `CanvasSource` 여야 한다

## The Insight

Pixi v8 의 `TextureSource` 는 **추상 베이스 클래스**다. 실제 업로드는 하위 클래스
(`CanvasSource` / `ImageSource` / `VideoSource`)가 `uploadMethodId` 로 결정한다.
베이스 클래스에 캔버스를 넣으면 Pixi 는 **어떻게 올릴지 모른 채 그냥 넘어간다** —
예외도, 경고도, 콘솔 로그도 없다. GPU 텍스처는 빈 채로 남고 스프라이트는 투명해진다.

```ts
new TextureSource({ resource: canvas })   // ❌ 조용히 빈 텍스처
new CanvasSource({ resource: canvas })    // ✅
```

원칙은 이것이다: **런타임 리소스를 감쌀 때 베이스 타입이 타입 체크를 통과한다고 해서
동작한다는 뜻이 아니다.** 이 API 는 타입 시스템이 아니라 `uploadMethodId` 라는 런타임
디스패치로 갈리므로, tsc 도 eslint 도 잡아주지 않는다.

## Why This Matters

증상이 **디버깅을 가장 오래 끄는 형태**로 나타난다:
- 소스(three.js 등)는 정상 렌더 — 오프스크린 캔버스에 픽셀이 실제로 있다
- 스프라이트도 정상 — `texture` 바인딩·크기·위치·tint 전부 올바르다
- 예외 0건, 경고 0건
- **화면에만 아무것도 없다**

2026-07-30 보스 3D 레인에서 사용자가 "보스가 안 보인다"고 **두 번** 신고할 때까지 이 상태로
있었다. 그 사이 프레이밍·틴트·밝기를 각각 고쳤는데(전부 실재하는 별개 결함이었지만) 근본은
이 한 줄이었다.

## Recognition Pattern

- 캔버스를 Pixi 텍스처로 넘기는 코드가 있다(three.js 합성, 2D 캔버스 생성 아트, 비디오 프레임)
- 캔버스를 `drawImage`/`getImageData` 로 읽으면 **픽셀이 있다**
- 그런데 화면의 스프라이트는 비어 있다
- 예외·경고가 전혀 없다

## The Approach

**① 진단은 `uploadMethodId` 한 줄로 끝난다.**
```js
tex.source.constructor.name   // 'CanvasSource' 여야 한다
tex.source.uploadMethodId     // 'image' 여야 한다 ('unknown' 이면 이 결함)
```

**② 확신이 없으면 `Texture.from(canvas)` 를 써라** — 리소스 타입을 보고 알맞은 Source 를
자동 선택한다. 직접 `new XxxSource` 를 쓰는 경우는 아틀라스처럼 **여러 텍스처가 한 소스를
공유해야 할 때**뿐이고, 그때도 하위 클래스를 명시해야 한다:

```ts
const source = new CanvasSource({ resource: atlasCanvas });
const boss   = new Texture({ source, frame: new Rectangle(0,   0, 160, 160) });
const player = new Texture({ source, frame: new Rectangle(160, 0, 160, 160) });
// 프레임마다 source.update() 로 재업로드
```

**③ 이 결함은 캔버스를 재서는 절대 못 잡는다.** 캔버스에는 항상 픽셀이 있기 때문이다.
검증은 합성된 화면에서 해야 한다 — [[render-screen-verification-expertise]] 참조.

## 관련 사실 (같은 레인에서 확인)

- 오프스크린 캔버스(DOM 에 없음)는 합성되지 않으므로 `preserveDrawingBuffer: false` 여도
  WebGL 드로잉 버퍼가 유지된다. 즉 이 결함의 원인은 드로잉 버퍼 소실이 **아니다**.
- 아틀라스 방식(캔버스 한 장 + frame 다른 텍스처 N개)이면 프레임당 GPU 업로드가 1회다.
  슬롯마다 캔버스를 만들면 업로드가 슬롯 수만큼 늘어난다.
