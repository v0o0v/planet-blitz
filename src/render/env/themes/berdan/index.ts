/**
 * 베르단 — 산성 습지 테마 조합.
 *
 * ## 이 행성의 서사 한 문장
 * **광원은 위다.** 포자로 뿌옇게 빛나는 황록 하늘이 확산광을 내리고, 산성 침출은 고지의 부식된
 * 능선에서 스며 나와 저지의 진창으로 흘러내린다. 카르곤("바닥 용암이 유일한 광원이고 하늘은
 * 검다")의 정확한 반대이며, 아래 다섯 슬라이스가 전부 이 한 문장에서 나온다:
 *
 * | 레이어 | 이 행성에서 무엇인가 |
 * |---|---|
 * | parallax | 화면보다 큰 저주파 명도 골격 — 고인 물이 빛을 삼킨 구역과 포자 산란광 구역 |
 * | decals | 지면의 자국 — 침출 흐름·부식 함몰공·포자 퇴적·이탄 둔덕 |
 * | terrainLight | 고지/저지 경계를 따라 흐르는 **산성 침출**(용암 자리를 대체한다) |
 * | atmosphere | 낮게 눕는 습지 안개 · 떠다니는 포자 · 부식성 증기 · 발광 알갱이 |
 * | grade | 위가 밝고 아래가 무거운 전역 톤. 하이라이트 청록 / 암부 누런 갈색 스플릿 |
 */

import type { EnvTheme } from '../../theme.js';
import { BERDAN_PARALLAX } from './parallax.js';
import { BERDAN_DECALS } from './decals.js';
import { BERDAN_TERRAIN_LIGHT } from './terrainLight.js';
import { BERDAN_ATMOSPHERE } from './atmosphere.js';
import { BERDAN_GRADE } from './grade.js';

export const BERDAN_THEME: EnvTheme = {
  id: 'berdan',
  name: '베르단 — 산성 습지',
  planets: [1],
  /**
   * 화면 좌표는 y 가 아래로 자라므로 **표면 → 광원 벡터의 y 가 음수 = 광원이 위**다.
   * 0.26 rad 만큼 오른쪽으로 기울여 정확한 수직을 피했다(수직이면 데칼 하이라이트가 좌우
   * 대칭이 되어 모서리가 평평해 보인다). 지형광은 이 방향의 수직 성분만 취하므로 −1(위)이고,
   * 데칼은 기울기까지 그대로 써서 둘의 태양이 하나로 합의된다.
   *
   * `shadowBias` 0.62 — 확산광이라 카르곤(0.55)보다 그림자가 광원 반대쪽으로 조금 더 눕는다.
   */
  light: { angle: -Math.PI / 2 + 0.26, shadowBias: 0.62 },
  parallax: BERDAN_PARALLAX,
  decals: BERDAN_DECALS,
  terrainLight: BERDAN_TERRAIN_LIGHT,
  atmosphere: BERDAN_ATMOSPHERE,
  grade: BERDAN_GRADE,
};
