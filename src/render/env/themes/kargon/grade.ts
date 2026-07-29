/**
 * 카르곤 그레이딩 테마 데이터.
 *
 * ⚠️ 지금은 골격이다. 그레이딩 레인이 `src/render/env/kargon*.ts` 의 현재 값을 **그대로** 옮긴다.
 * 카르곤 화면이 한 픽셀도 바뀌면 안 된다(`.omc/research/env-shots/BASELINE.md` 회귀 게이트).
 *
 * 여기 남길 주석은 **카르곤 실측 근거**뿐이다. 메커니즘 근거는 레이어 구현에 남긴다 —
 * 그대로 복사하면 카르곤 4차 회고가 니플헤임 파일에 붙는다.
 */

import type { GradeTheme } from '../../contracts/grade.js';

export const KARGON_GRADE: GradeTheme = {
  themeId: 'kargon',
};
