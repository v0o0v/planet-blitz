/**
 * 카르곤 원경 시차 레이어 (슬롯 `far` — 지형 바닥 뒤).
 *
 * 담당: 먼 칼데라 발광·화산 실루엣·저속 연무처럼 **카메라보다 느리게 흐르는** 깊이 레이어.
 * 아직 미구현 스텁이다 — `configure` 가 false 를 반환해 화면에 아무 영향이 없다.
 */

import { Container } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

export class KargonParallaxLayer implements EnvLayer {
  readonly name = 'kargon-parallax';
  readonly slot = 'far' as const;
  readonly view = new Container();

  configure(_ctx: EnvContext): boolean {
    return false;
  }

  update(_f: EnvFrame): void {}

  resize(_width: number, _height: number): void {}

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
