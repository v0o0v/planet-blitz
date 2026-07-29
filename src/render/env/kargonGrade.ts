/**
 * 카르곤 컬러 그레이딩·비네트 레이어 (슬롯 `post` — 최상단, HUD 아래).
 *
 * 담당: 화면 전체 톤 정리 — 가장자리 비네트, 따뜻한 하이라이트·차가운 그림자 분리,
 * 아래쪽 열기 그라디언트. 게임플레이 가독성을 해치지 않는 선에서만 건다.
 * 아직 미구현 스텁이다 — `configure` 가 false 를 반환해 화면에 아무 영향이 없다.
 */

import { Container } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

export class KargonGradeLayer implements EnvLayer {
  readonly name = 'kargon-grade';
  readonly slot = 'post' as const;
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
