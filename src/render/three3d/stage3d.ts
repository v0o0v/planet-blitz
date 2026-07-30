/**
 * 런타임 3D 레이어 — **오프스크린 three.js → Pixi 텍스처 아틀라스**.
 *
 * 이 게임은 Pixi v8 2D 렌더러다. 3D 를 넣는 길은 넷이고(pixi3d = v7 까지라 탈락,
 * Pixi 네이티브 3D = 로드맵, 공유 WebGL 컨텍스트, 오프스크린→텍스처) 이 파일은
 * **오프스크린→텍스처**를 구현한다. 공유 컨텍스트를 고르지 않은 이유는 셋이다:
 *
 *  1. three 패스는 전체화면 레이어라 씬 그래프에 끼워지지 않는다. 보스는 배경 위·HUD
 *     아래 **중간**에 있어야 하므로 렌더를 쪼개고 `Application` 자동 티커를 버려야 한다.
 *  2. 루트 레터박스 마스크(`app.ts` `stage.mask`) 밖이라 **3D 가 레터박스 띠 위로
 *     삐져나온다** — 같은 유형의 결함을 이미 한 번 신고받았다.
 *  3. 텍스처가 공유되지 않으므로(공식 문서 명시) 컨텍스트를 공유해서 얻는 이득이 없다.
 *
 * 오프스크린 방식은 반대로 **엔티티가 끝까지 평범한 Pixi 스프라이트로 남는다**. 그래서
 * tint 플래시·과열 펄스·스프라이트 풀·groundShadow·glow·radar·z-order 가 한 줄도 안 바뀐다.
 *
 * ── 아틀라스 ──
 * 슬롯마다 캔버스를 만들면 프레임당 GPU 업로드가 슬롯 수만큼 생긴다. 대신 **캔버스 한 장**을
 * 격자로 쪼개 slot 별 viewport+scissor 로 나눠 그리고, Pixi 쪽은 같은 `TextureSource` 를
 * 가리키는 `frame` 만 다른 텍스처 N개를 만든다 → **프레임당 업로드 1회**. 보스 다음으로
 * 플레이어 기체를 붙일 때 칸만 늘리면 된다.
 *
 * ── 픽셀아트 정합 ──
 * 슬롯을 표시 크기보다 **작게** 렌더하고 `TextureSource.defaultOptions.scaleMode='nearest'`
 * (app.ts 전역 기본값)로 확대하면, 부드러운 3D 가 아니라 **움직이는 픽셀아트**가 나온다.
 * 주변 픽셀 적·배경과 톤이 충돌하지 않는 이유가 이것이다.
 *
 * ⚠️ "작게"는 **화면 표시 크기 대비**다. 슬롯마다 표시 크기가 다르므로 렌더 해상도도 슬롯마다
 * 달라야 한다({@link SLOT_RES}) — 격자 칸 크기(`SLOT_SIZE`)를 그대로 물려받으면 표시 크기가
 * 작은 슬롯에서 **확대율이 1.0 이 되어 픽셀 경계가 아예 서지 않는다**. 플레이어 기체가 실제로
 * 그랬고 화면에서 흐릿하다는 신고를 받았다(2026-07-30).
 *
 * ── 결정론(ADR-0005) ── render-only. sim 에 아무것도 쓰지 않고 스냅샷만 읽으므로 골든 해시
 * 불변이다. 시간축도 sim 틱이 아니라 벽시계(연출 전용)를 쓴다.
 *
 * ── 폴백 ── WebGL 컨텍스트 생성 실패(테스트 환경·저사양·드라이버)면 `create()` 가 null 을
 * 반환하고 호출자는 기존 PNG 스프라이트 경로를 그대로 쓴다. 3D 는 **덧붙임**이지 대체가 아니다.
 */

import * as THREE from 'three';
import { CanvasSource, Rectangle, Texture } from 'pixi.js';

/** 아틀라스 격자 **한 칸의 크기**(px). 슬롯의 실제 렌더 해상도는 이 이하다({@link SLOT_RES}). */
export const SLOT_SIZE = 160;

/** 아틀라스 슬롯 이름 — 칸을 늘릴 때 여기에 추가한다. */
export type Slot3D = 'boss' | 'player';

/** 슬롯 → 아틀라스 격자 열 인덱스. 캔버스는 `SLOT_ORDER.length × SLOT_SIZE` 폭이 된다. */
const SLOT_ORDER: readonly Slot3D[] = ['boss', 'player'];

/**
 * 슬롯별 **렌더 해상도**(px). 격자 칸(`SLOT_SIZE`) 안의 좌상단 정사각형만 쓴다.
 *
 * ## 왜 슬롯마다 달라야 하는가 — 픽셀아트 정합은 **비율**의 문제다
 * 이 레이어의 룩은 "슬롯을 표시 크기보다 **작게** 렌더하고 nearest 로 확대"에서 나온다(파일 헤더).
 * 그런데 "작게"는 상대적이다 — 화면 표시 크기가 슬롯마다 다르기 때문이다:
 *
 * 기준은 **원래의 2D 아트가 가지고 있던 텍셀 밀도**다. 기체는 `player.png` 64px 이 표시 크기 96
 * 디자인 유닛에 들어가 **1.5배 확대**로 그려졌다 — 그 확대가 픽셀 경계를 만들고, 그게 이 게임의
 * 룩이다. 3D 슬롯을 그 원본과 같은 64px 으로 잡으면 텍셀 밀도가 정확히 같아진다.
 *
 * | | 표시(디자인 유닛) | 슬롯 | 확대 |
 * |---|---|---|---|
 * | `player.png` (기존 2D) | 96 | 64 | 1.5배 |
 * | 기체 3D (수정 전) | **240**(부풀었다) | 160 | **1.0배 → 확대 없음** |
 * | 기체 3D (수정 후) | 96 | **64** | **1.5배** |
 * | 보스 | — | 160 | — |
 *
 * 수정 전에는 **두 결함이 겹쳐** 있었다: ⓐ 텍스처 프레임이 커지면서 스프라이트가 2.5배로 부풀었고
 * (`entityRenderer` 의 `setSize` 재적용 주석이 정본) ⓑ 그래서 슬롯과 화면 크기가 같아져 확대가
 * 아예 일어나지 않았다. 결과가 "흐릿하다"는 신고였다(2026-07-30).
 *
 * 즉 이건 튜닝이 아니라 **계약 복원**이다. 새 슬롯을 추가할 때는 그 엔티티의 **2D 아트 크기**를
 * 그대로 슬롯 해상도로 잡아라 — `SLOT_SIZE` 를 물려받으면 조용히 확대율이 사라진다.
 *
 * ⚠️ 보스(160)는 이 레인에서 **건드리지 않았다**. `boss.png` 는 128px 이라 같은 유형의 부풀림
 * (1.25배)이 남아 있지만, 보스의 `FRAME_MARGIN` 은 그 크기를 보면서 눈으로 맞춘 값이라 지금
 * 고치면 화면의 보스가 20% 작아진다 — 사용자가 요청하지 않은 룩 변경이므로 별도 판단 사항이다.
 */
const SLOT_RES: Record<Slot3D, number> = {
  boss: SLOT_SIZE,
  player: 64,
};

/** 슬롯의 렌더 해상도(px). 뷰어·테스트가 아틀라스에서 그 칸을 잘라낼 때 쓴다. */
export function slotRes(slot: Slot3D): number {
  return SLOT_RES[slot];
}

/**
 * 한 장의 캔버스에 여러 3D 액터를 나눠 그리고 Pixi 텍스처로 넘기는 무대.
 *
 * 액터(모델·연출)는 이 클래스가 모른다 — 슬롯별로 `THREE.Scene` 과 카메라만 쥐고 있고,
 * 무엇을 넣고 어떻게 움직일지는 액터 모듈(`bossActor.ts`)이 정한다.
 */
export class Stage3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly source: CanvasSource;
  private readonly scenes = new Map<Slot3D, { scene: THREE.Scene; camera: THREE.Camera }>();
  private readonly textures = new Map<Slot3D, Texture>();
  /** 이번 프레임에 그릴 슬롯. 매 프레임 비운다 — 화면에 없는 액터는 GPU 비용 0. */
  private readonly activeSlots = new Set<Slot3D>();

  private constructor(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.canvas = canvas;
    // 아틀라스 전체를 한 소스로 올린다. 슬롯 텍스처는 이 소스의 frame 만 다르다.
    //
    // ⚠️ **반드시 `CanvasSource`** 여야 한다. 베이스 클래스 `TextureSource` 로 감싸면 Pixi 가
    // 업로드 방식을 결정하지 못해(uploadMethodId 미지정) GPU 텍스처가 **빈 채로 남는다** —
    // 예외도 경고도 없다. 그러면 three 는 멀쩡히 그리고 캔버스에도 픽셀이 있는데 화면의 보스만
    // 사라진다(사용자 신고 2026-07-30, 두 번째). 캔버스를 재서 검증하면 이 결함을 **못 잡는다** —
    // 반드시 `renderer.extract` 로 **화면에 나간 스프라이트**를 재야 한다.
    this.source = new CanvasSource({ resource: canvas });
    for (const [i, slot] of SLOT_ORDER.entries()) {
      // Pixi frame 은 좌상단 원점(이미지 좌표계)이라 슬롯 열을 그대로 x 로 쓴다. 렌더 해상도가
      // 칸보다 작은 슬롯은 칸의 **좌상단 정사각형**만 차지한다({@link SLOT_RES}).
      const res = SLOT_RES[slot];
      const frame = new Rectangle(i * SLOT_SIZE, 0, res, res);
      this.textures.set(slot, new Texture({ source: this.source, frame }));
    }
  }

  /**
   * 무대를 만든다. WebGL 을 못 얻으면 **null** — 호출자는 조용히 2D 폴백으로 남는다.
   * 게임 메인 컨텍스트와 별개의 컨텍스트라 Pixi 의 상태를 오염시키지 않는다(resetState 불요).
   */
  static create(): Stage3D | null {
    if (typeof document === 'undefined') return null; // 노드(테스트) 환경.
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SLOT_ORDER.length * SLOT_SIZE;
      canvas.height = SLOT_SIZE;
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true, // 배경 투명 — 스프라이트로 합성되어야 한다.
        antialias: false, // 픽셀 크리스프(app.ts 의 antialias:false 규율과 같은 축).
        premultipliedAlpha: false,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(1); // 아틀라스는 논리 픽셀 = 실제 픽셀이어야 frame 이 맞는다.
      renderer.autoClear = false; // 슬롯별 scissor 클리어를 직접 한다.
      renderer.setScissorTest(true);
      return new Stage3D(renderer, canvas);
    } catch {
      return null; // 컨텍스트 소진·미지원 — 2D 폴백.
    }
  }

  /** 슬롯의 Pixi 텍스처. 스프라이트에 그대로 물리면 된다(프레임마다 갱신된다). */
  textureOf(slot: Slot3D): Texture {
    const tex = this.textures.get(slot);
    if (tex === undefined) throw new Error(`unknown 3D slot: ${slot}`);
    return tex;
  }

  /**
   * 슬롯에 씬을 등록한다. 액터 모듈이 모델 로드를 마친 뒤 한 번 호출한다.
   * 카메라는 액터가 정한다 — 보스와 기체는 프레이밍이 다르다.
   */
  mount(slot: Slot3D, scene: THREE.Scene, camera: THREE.Camera): void {
    this.scenes.set(slot, { scene, camera });
  }

  /**
   * 슬롯의 씬을 뗀다. 액터가 회수될 때(행성이 바뀌어 보스 모델을 갈아탈 때) 부른다 —
   * 떼지 않으면 `render()` 가 이미 dispose 된 geometry 를 계속 그리려 든다.
   *
   * 텍스처는 그대로 남는다(무대는 액터보다 오래 산다) — 다음 액터가 같은 슬롯에 mount 하면
   * 스프라이트가 물고 있는 텍스처가 그대로 새 모델을 가리킨다.
   */
  unmount(slot: Slot3D): void {
    this.scenes.delete(slot);
    this.activeSlots.delete(slot);
  }

  /**
   * 슬롯을 **한 번 그려 보고** 불투명 실루엣이 슬롯 경계까지 남긴 여유를 잰다. 단위는 프러스텀
   * 반폭(=슬롯 절반)이라, 액터의 모션 값(같은 단위)과 직접 비교할 수 있다. 빈 슬롯이면 null.
   *
   * ── 왜 바운딩박스로는 안 되는가 ──
   * 액터의 `fitCamera` 는 **바운딩박스 8모서리**로 프레이밍을 잡는데, 그 박스는 실루엣보다 크다
   * (뾰족한 첨탑의 박스 모서리는 첨탑이 없는 허공에도 있다). 그 과대추정으로 여유를 계산하면
   * 실제로는 여유가 넉넉한 모델(카르곤)까지 연출이 깎인다. 그래서 **그려서 실측**한다.
   *
   * 비용은 로드 1회의 렌더 + 160×160 readback 이다(런당 한 번).
   */
  measureSlotHeadroom(
    slot: Slot3D,
  ): { up: number; down: number; left: number; right: number } | null {
    const mounted = this.scenes.get(slot);
    if (mounted === undefined) return null;
    const i = SLOT_ORDER.indexOf(slot);
    const res = SLOT_RES[slot];
    const x = i * SLOT_SIZE;
    this.renderer.setViewport(x, this.canvas.height - res, res, res);
    this.renderer.setScissor(x, this.canvas.height - res, res, res);
    this.renderer.clear(true, true, true);
    this.renderer.render(mounted.scene, mounted.camera);

    const probe = document.createElement('canvas');
    probe.width = res;
    probe.height = res;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.drawImage(this.canvas, x, 0, res, res, 0, 0, res, res);
    const d = ctx.getImageData(0, 0, res, res).data;
    let minX = res;
    let maxX = -1;
    let minY = res;
    let maxY = -1;
    for (let py = 0; py < res; py++) {
      for (let px = 0; px < res; px++) {
        if (d[(py * res + px) * 4 + 3]! <= 8) continue;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
    if (maxX < 0) return null;
    // 슬롯 전체가 2×half 이므로 1px = 2/res (half 단위).
    const k = 2 / res;
    return {
      up: minY * k,
      down: (res - 1 - maxY) * k,
      left: minX * k,
      right: (res - 1 - maxX) * k,
    };
  }

  /** 이 슬롯이 이번 프레임 화면에 있다고 표시한다. 표시되지 않은 슬롯은 그리지 않는다. */
  markActive(slot: Slot3D): void {
    this.activeSlots.add(slot);
  }

  /**
   * 활성 슬롯을 아틀라스에 그리고 Pixi 텍스처를 갱신한다. 활성 슬롯이 없으면
   * **업로드조차 하지 않는다**(보스가 없는 대부분의 런에서 비용 0).
   */
  render(): void {
    if (this.activeSlots.size === 0) return;
    const h = this.canvas.height;
    for (const [i, slot] of SLOT_ORDER.entries()) {
      if (!this.activeSlots.has(slot)) continue;
      const mounted = this.scenes.get(slot);
      if (mounted === undefined) continue;
      // GL viewport 는 좌하단 원점이라, 칸의 **좌상단**(Pixi frame 원점)에 맞추려면 y 를
      // `h - res` 로 올려야 한다. 슬롯이 한 줄이므로 x 는 칸 시작 그대로다.
      const x = i * SLOT_SIZE;
      const res = SLOT_RES[slot];
      this.renderer.setViewport(x, h - res, res, res);
      this.renderer.setScissor(x, h - res, res, res);
      this.renderer.clear(true, true, true);
      this.renderer.render(mounted.scene, mounted.camera);
    }
    this.activeSlots.clear();
    this.source.update(); // 캔버스 → GPU 업로드 1회.
  }

  destroy(): void {
    for (const tex of this.textures.values()) tex.destroy();
    this.textures.clear();
    this.scenes.clear();
    this.source.destroy();
    this.renderer.dispose();
  }
}
