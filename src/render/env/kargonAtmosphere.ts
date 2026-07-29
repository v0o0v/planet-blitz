/**
 * 카르곤 전경 대기 레이어 (슬롯 `over` — 엔티티 위).
 *
 * 담당: 떠오르는 잔불·낙하하는 화산재·흘러가는 연기 결·열 아지랑이 같은 **전경 공기감**.
 * 아직 미구현 스텁이다 — `configure` 가 false 를 반환해 화면에 아무 영향이 없다.
 */

import { Container } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

export class KargonAtmosphereLayer implements EnvLayer {
  readonly name = 'kargon-atmosphere';
  readonly slot = 'over' as const;
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
