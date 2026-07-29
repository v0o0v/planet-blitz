/**
 * 카르곤 용암 발광·지형 음영 레이어 (슬롯 `floor` — 지형 바닥 위·엔티티 아래).
 *
 * 담당: 용암 지대의 가산 발광 맥동, 지형 경계 앰비언트 오클루전, 아래에서 올라오는 열광.
 * 아직 미구현 스텁이다 — `configure` 가 false 를 반환해 화면에 아무 영향이 없다.
 */

import { Container } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

export class KargonLavaLightLayer implements EnvLayer {
  readonly name = 'kargon-lava-light';
  readonly slot = 'floor' as const;
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
