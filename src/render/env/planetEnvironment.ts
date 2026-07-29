/**
 * 행성 환경 컴포저 — 배경 레이어 스택의 **유일한 main.ts 배선 지점**.
 *
 * ## 왜 컴포저인가
 * 시차 원경·지형 데칼·용암 발광·대기 입자·컬러 그레이딩은 각각 독립 모듈이지만 stage 붙는
 * 위치가 다 다르다(지형 뒤/지형 위/엔티티 위/최상단). 그걸 레이어마다 main.ts 에서 따로
 * 배선하면 배선 누락이 조용히 생긴다 — 이 리포에서 이미 여러 번 겪은 결함이다
 * (모듈은 만들었는데 아무도 안 쓰는 상태). 그래서 **슬롯 컨테이너 4개만** main.ts 가 붙이고,
 * 레이어 등록은 전부 이 파일의 {@link createEnvLayers} 레지스트리 한 곳에서 한다.
 *
 * ## 결정론(ADR-0005)
 * 렌더 전용. sim 을 읽기만 하고(카메라·틱) 쓰지 않는다. 레이어의 위치 의존 난수는
 * {@link file://./noise.ts} 의 시드 해시로 강제된다.
 */

import { Container } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer, EnvSlot } from './types.js';
import { ParallaxLayer } from './parallax.js';
import { DecalLayer } from './decals.js';
import { TerrainLightLayer } from './terrainLight.js';
import { AtmosphereLayer } from './atmosphere.js';
import { GradeLayer } from './grade.js';

/** 카르곤 행성 인덱스. 레이어들이 자기 담당 행성을 판정할 때 쓴다. */
export const KARGON = 0;

/** 슬롯 순서(뒤 → 앞). main.ts 가 이 순서대로 stage 에 끼워 넣는다. */
export const ENV_SLOTS: readonly EnvSlot[] = ['far', 'floor', 'over', 'post'];

/**
 * 레이어 레지스트리. **새 환경 레이어는 여기에만 추가한다.**
 * 순서는 같은 슬롯 안에서의 앞뒤 순서를 정한다.
 */
export function createEnvLayers(): EnvLayer[] {
  return [
    new ParallaxLayer(),
    new DecalLayer(),
    new TerrainLightLayer(),
    new AtmosphereLayer(),
    new GradeLayer(),
  ];
}

/**
 * 환경 레이어 스택. main.ts 는 {@link slot} 으로 컨테이너 4개를 받아 stage 의 올바른 깊이에
 * 끼우고, 런 시작마다 {@link configure}, 매 프레임 {@link update} 를 부른다.
 */
export class PlanetEnvironment {
  private readonly containers = new Map<EnvSlot, Container>();
  private readonly layers: EnvLayer[];
  /** configure 결과가 true 인 레이어만 담긴다(비활성 레이어는 update 를 아예 안 받는다). */
  private active: EnvLayer[] = [];
  private width = 0;
  private height = 0;

  constructor(layers: EnvLayer[] = createEnvLayers()) {
    this.layers = layers;
    for (const s of ENV_SLOTS) this.containers.set(s, new Container());
    for (const l of this.layers) {
      const c = this.containers.get(l.slot);
      // 알 수 없는 슬롯은 조용히 버리지 않는다 — 레이어가 화면에 안 나오는 결함의 전형적 원인.
      if (c === undefined) throw new Error(`unknown env slot: ${l.slot} (${l.name})`);
      c.addChild(l.view);
    }
  }

  /** 슬롯 컨테이너. main.ts 가 stage 에 붙일 때만 쓴다. */
  slot(s: EnvSlot): Container {
    const c = this.containers.get(s);
    if (c === undefined) throw new Error(`unknown env slot: ${s}`);
    return c;
  }

  /** 진단·테스트용: 현재 활성 레이어 이름들. */
  get activeNames(): readonly string[] {
    return this.active.map((l) => l.name);
  }

  /** 진단·테스트용: 등록된 모든 레이어 이름(활성 여부 무관). */
  get allNames(): readonly string[] {
    return this.layers.map((l) => l.name);
  }

  /**
   * 진단 전용 가시성 토글. 레이어 하나만 켜 놓고 스크린샷을 찍어야 그 레이어의 실제 기여를
   * 분리해 볼 수 있다 — 전부 켠 화면만 보면 "그리는 줄 알았는데 안 그리고 있었다"가 안 잡힌다.
   * `null` 이면 활성 레이어 전부 복원. `update` 는 계속 돌므로 애니메이션 위상이 어긋나지 않는다.
   */
  solo(name: string | null): void {
    for (const l of this.active) l.view.visible = name === null || l.name === name;
  }

  /**
   * 런 시작·행성 교체. 각 레이어가 자기 행성인지 판정해 스스로 켜고 끈다.
   * 지원하지 않는 행성이면 `view.visible = false` 라 기존 화면이 한 픽셀도 바뀌지 않는다.
   */
  configure(ctx: EnvContext): void {
    this.active = [];
    for (const l of this.layers) {
      const on = l.configure(ctx);
      l.view.visible = on;
      if (on) this.active.push(l);
    }
    if (this.width > 0 && this.height > 0) {
      for (const l of this.active) l.resize(this.width, this.height);
    }
  }

  /** 전체 비활성화(타이틀·격납고 등 런이 아닌 화면). */
  disable(): void {
    this.active = [];
    for (const l of this.layers) l.view.visible = false;
  }

  /** 매 프레임. 활성 레이어만 돈다. */
  update(f: EnvFrame): void {
    for (const l of this.active) l.update(f);
  }

  /** 가시 영역 변경. 매 프레임 불러도 무해하도록 변화가 없으면 즉시 반환한다(멱등). */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    for (const l of this.active) l.resize(width, height);
  }

  destroy(): void {
    for (const l of this.layers) l.destroy();
    for (const c of this.containers.values()) c.destroy({ children: true });
  }
}
