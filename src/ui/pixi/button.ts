/**
 * 카툰 hstretch 버튼 (격납고 파일럿, plan §3 · 결정 4).
 *
 * `ui_btn_*.png`(무지 버튼) 을 좌우 캡 30px 로 가로만 늘리고, 텍스트는 코드로 렌더한다.
 * 텍스처가 없으면 둥근 사각 Graphics 로 폴백. hover/press/disabled 시각 상태를 준다.
 * 좌표계는 디자인 스페이스. 위치는 호출자가 `.container.position.set()` 로 잡는다.
 *
 * ── 촉각 피드백(그래픽 이펙트 Phase 5 — AC-5.3) ── 눌림 스쿼시·호버 광택·(옵션)집기 lift 를
 * 더한다. 스쿼시는 **중앙 기준**이어야 자연스러운데 외부 container 는 좌상단 원점(호출자가 위치를
 * 잡음)이라, bg·라벨·광택을 **내부 `inner` Container** 에 담고 inner 에만 center pivot+scale 을
 * 적용한다 — 외부 원점 계약(호출자 position·hitArea·이벤트)은 그대로 유지된다. 스프링 물리는
 * {@link file://./tactile.ts} 순수함수로 분리했다(경계·정착·overshoot 유닛 검증, render-only).
 */

import { Container, Graphics, NineSliceSprite, Rectangle, Text, Ticker, type Texture } from 'pixi.js';
import { UI_FONT, TEXT_SHADOW, COLOR } from './theme.js';
import { playUi, type UiSoundCategory } from '../../render/uiSound.js';
import { graphicsSettings } from '../../render/graphicsSettings.js';
import {
  stepSpring,
  isSpringSettled,
  TACTILE_SPRING,
  SQUASH_SCALE,
  LIFT_SCALE,
  GLOSS_ALPHA,
  type SpringState,
} from './tactile.js';

export interface ButtonOptions {
  texture?: Texture | null | undefined;
  width: number;
  height: number;
  label: string;
  onClick: () => void;
  /** 폴백 Graphics 색(텍스처 없을 때). */
  fallbackColor?: number;
  fontSize?: number;
  /** 캡(좌우 9-slice 폭). 기본 30. */
  cap?: number;
  /**
   * 탭 시 낼 UI 음 의미 범주(AC16 — UI 버스). 기본 `uiNavigate`(탭·이동). 확정/긍정/부정
   * 버튼은 `uiConfirm`/`uiPositive`/`uiNegative` 를 넘겨 팔레트를 재사용한다.
   */
  sound?: UiSoundCategory;
  /**
   * 라벨 색. 기본은 흰색 — 빨강/파랑처럼 어두운 버튼 기준이다. 노란 버튼(ui_btn_yellow)
   * 처럼 밝은 바탕에는 흰 글씨가 묻히므로 진한 갈색 등을 넘겨 대비를 확보한다.
   */
  labelColor?: number;
  /**
   * 카드 집기 lift(AC-5.3, 옵션). true 면 호버 시 살짝 떠오른다(scale↑). 기본 off 라 일반
   * 버튼 거동은 전혀 바뀌지 않는다 — 카드형 UI 처럼 "집어 든다" 느낌이 어울리는 곳만 켠다.
   */
  lift?: boolean;
}

export class PixiButton {
  readonly container = new Container();
  /** bg·라벨·광택을 담는 내부 컨테이너. center pivot+scale 로 중앙 기준 스쿼시를 준다. */
  private readonly inner = new Container();
  private readonly labelText: Text;
  /** 호버 광택 오버레이(bg 와 라벨 사이). 알파만 껐다 켜서 은은히 밝힌다. */
  private readonly gloss: Graphics;
  private readonly onClick: () => void;
  /** 탭 시 낼 UI 음 범주(AC16). 기본 navigate. */
  private readonly sound: UiSoundCategory;
  /** 집기 lift 옵션(호버 시 떠오름). 기본 off. */
  private readonly lift: boolean;
  private enabled = true;

  // ── 촉각 스프링 상태(render-only) ─────────────────────────────────────────
  /** inner.scale 을 구동하는 스프링 상태(값=현재 배율). */
  private spring: SpringState = { value: 1, velocity: 0 };
  /** 스프링 목표 배율(눌림/lift/중립에서 파생). */
  private targetScale = 1;
  private pressed = false;
  private hovered = false;
  /** Ticker.shared 구독 중 여부(애니 중에만 구독, 정착 시 해제 → idle 비용 0). */
  private ticking = false;

  constructor(opts: ButtonOptions) {
    const { width: w, height: h, cap = 30 } = opts;
    this.onClick = opts.onClick;
    this.sound = opts.sound ?? 'uiNavigate';
    this.lift = opts.lift ?? false;

    // inner 를 중앙 기준으로: pivot·position 을 둘 다 (w/2,h/2) 로 두면 서로 상쇄돼 inner 의 로컬
    // 원점이 container 의 (0,0) 과 일치한다 → 자식은 기존 좌표 그대로, scale 만 중앙에서 먹는다.
    this.inner.pivot.set(w / 2, h / 2);
    this.inner.position.set(w / 2, h / 2);
    this.container.addChild(this.inner);

    if (opts.texture) {
      const bg = new NineSliceSprite({
        texture: opts.texture,
        leftWidth: cap,
        topHeight: 0,
        rightWidth: cap,
        bottomHeight: 0,
      });
      bg.width = w;
      bg.height = h;
      this.inner.addChild(bg);
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, w, h, 10)
        .fill({ color: opts.fallbackColor ?? 0x3a4a6a })
        .stroke({ color: 0x000000, width: 2, alpha: 0.5 });
      this.inner.addChild(g);
    }

    // 호버 광택: bg 위·라벨 아래에 은은한 크림 오버레이. tint 곱연산은 어둡히므로(밝힘엔 부적합)
    // 반투명 밝은 색을 얹어 밝힌다. 알파 0 으로 시작해 호버 시에만 GLOSS_ALPHA 로 올린다.
    this.gloss = new Graphics();
    this.gloss.roundRect(0, 0, w, h, 10).fill({ color: COLOR.cream });
    this.gloss.alpha = 0;
    this.inner.addChild(this.gloss);

    this.labelText = new Text({ resolution: 2,
      text: opts.label,
      style: {
        fontFamily: UI_FONT,
        fontSize: opts.fontSize ?? 22,
        fontWeight: '700',
        fill: opts.labelColor ?? 0xffffff,
        align: 'center',
        // 어두운 라벨(밝은 버튼)에는 다크 섀도를 끈다 — 획이 촘촘한 한글(예: "출")이
        // 그림자와 뭉쳐 덩어리로 보인다. 흰 라벨(어두운 버튼)에서만 섀도가 필요하다.
        dropShadow: opts.labelColor === undefined ? TEXT_SHADOW : false,
      },
    });
    this.labelText.anchor.set(0.5);
    this.labelText.position.set(w / 2, h / 2);
    this.inner.addChild(this.labelText);

    // hitArea 를 외부 container 에 고정(w×h) — inner 가 스쿼시/lift 로 스케일돼도 클릭 판정이
    // 흔들리지 않는다(자식 bounds 기반 판정이 아니라 고정 사각 판정).
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = new Rectangle(0, 0, w, h);

    this.container.on('pointertap', () => {
      if (!this.enabled) return;
      playUi(this.sound); // AC16: UI 버스 피드백음(음소거·미주입이면 no-op).
      this.onClick();
    });
    // 눌림 스쿼시: down 에서 눌리고, 떼는 모든 경로(up·tap·바깥에서 뗌)에서 스프링 복귀.
    this.container.on('pointerdown', () => {
      if (this.enabled) this.setPressed(true);
    });
    this.container.on('pointerup', () => this.setPressed(false));
    this.container.on('pointerupoutside', () => this.setPressed(false));
    this.container.on('pointerover', () => {
      if (this.enabled) {
        this.container.alpha = 0.85; // 기존 거동 보존.
        this.setHovered(true);
      }
    });
    this.container.on('pointerout', () => {
      if (this.enabled) {
        this.container.alpha = 1; // 기존 거동 보존.
        this.setHovered(false);
        this.setPressed(false); // 눌린 채 벗어나면 눌림 해제(pointerupoutside 미발생 대비).
      }
    });

    // 파괴 시 Ticker 구독 해제(누수 0). 호출자가 기존 경로 `container.destroy()` 를 직접 불러도
    // Pixi 가 'destroyed' 를 emit 하므로 여기서 반드시 구독이 끊긴다.
    this.container.once('destroyed', () => this.stopSpring());
  }

  setLabel(text: string): void {
    this.labelText.text = text;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.container.alpha = enabled ? 1 : 0.4;
    this.container.cursor = enabled ? 'pointer' : 'default';
    this.container.eventMode = enabled ? 'static' : 'none';
    if (!enabled) {
      // 비활성화 시 촉각 상태를 중립으로 되돌린다(눌린 채·호버 채 잠기지 않게).
      this.hovered = false;
      this.pressed = false;
      this.gloss.alpha = 0;
      this.recomputeTarget();
    }
  }

  /**
   * 촉각 리소스 정리 + container 파괴. 기존 파괴 경로(`container.destroy()`)와 호환된다 —
   * 어느 쪽을 부르든 'destroyed' 훅이 Ticker 구독을 끊는다.
   */
  destroy(): void {
    this.container.destroy({ children: true });
  }

  // ── 촉각 내부 ─────────────────────────────────────────────────────────────

  private setPressed(pressed: boolean): void {
    if (this.pressed === pressed) return;
    this.pressed = pressed;
    this.recomputeTarget();
  }

  private setHovered(hovered: boolean): void {
    if (this.hovered === hovered) {
      return;
    }
    this.hovered = hovered;
    // 광택은 모션이 아니라 밝기 변화라 reducedMotion 과 무관하게 즉시 켜고 끈다(기존 alpha 호버 동형).
    this.gloss.alpha = hovered ? GLOSS_ALPHA : 0;
    this.recomputeTarget();
  }

  /** 눌림/lift/중립 상태에서 목표 배율을 파생하고 애니를 (재)시작한다. */
  private recomputeTarget(): void {
    this.targetScale = this.pressed
      ? SQUASH_SCALE
      : this.hovered && this.lift
        ? LIFT_SCALE
        : 1;
    this.animateToTarget();
  }

  private animateToTarget(): void {
    if (graphicsSettings.getSettings().reducedMotion) {
      // 광과민 대응: 스프링 모션(프레임 보간)을 끄고 목표 상태만 즉시 적용한다.
      this.spring = { value: this.targetScale, velocity: 0 };
      this.inner.scale.set(this.targetScale);
      this.stopSpring();
      return;
    }
    if (isSpringSettled(this.spring, this.targetScale)) {
      // 이미 목표에 정착(호버 무-lift·중립 재-지정 등) — ticker 를 돌리지 않는다(idle 0 유지).
      this.spring = { value: this.targetScale, velocity: 0 };
      this.inner.scale.set(this.targetScale);
      this.stopSpring();
      return;
    }
    this.startSpring();
  }

  private startSpring(): void {
    if (this.ticking) return;
    // 애니 프레임 루프가 없는 환경(node/SSR/테스트)에선 모션을 건너뛴다 — 렌더러도 없어 무의미하고,
    // Ticker.shared 는 autoStart 라 첫 add 에서 requestAnimationFrame 을 요구한다(브라우저엔 항상 존재).
    if (typeof requestAnimationFrame !== 'function') return;
    this.ticking = true;
    Ticker.shared.add(this.onFrame);
  }

  private stopSpring(): void {
    if (!this.ticking) return;
    this.ticking = false;
    Ticker.shared.remove(this.onFrame);
  }

  /**
   * 매 프레임 스프링 1스텝(애니 중에만 구독). 정착하면 목표로 스냅하고 구독을 끊어 idle 0.
   * 화살표 필드라 `this` 가 고정돼 Ticker add/remove 가 동일 참조로 동작한다.
   */
  private readonly onFrame = (ticker: Ticker): void => {
    if (!this.ticking) return;
    this.spring = stepSpring(this.spring, this.targetScale, TACTILE_SPRING, ticker.deltaMS / 1000);
    if (isSpringSettled(this.spring, this.targetScale)) {
      this.spring = { value: this.targetScale, velocity: 0 };
      this.inner.scale.set(this.targetScale);
      this.stopSpring();
      return;
    }
    this.inner.scale.set(this.spring.value);
  };
}
