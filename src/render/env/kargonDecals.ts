/**
 * 카르곤 지형 데칼 산포 레이어 (슬롯 `floor` — 지형 바닥 위·엔티티 아래).
 *
 * 담당: 균열·식은 용암 흐름·현무암 파편·화산재 무더기 등 **타일 반복감을 깨는** 결정적 산포물.
 * 아직 미구현 스텁이다 — `configure` 가 false 를 반환해 화면에 아무 영향이 없다.
 */

import { Container } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

export class KargonDecalLayer implements EnvLayer {
  readonly name = 'kargon-decals';
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
