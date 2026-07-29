/**
 * 그레이딩 레이어 **테마 계약** — 이 파일은 그레이딩 레인이 소유한다.
 *
 * 여기 있어야 하는 것은 행성마다 달라지는 **데이터의 모양**과, 그 데이터가 지켜야 하는
 * **관계 불변식**이다. 메커니즘(기하·합성 순서·해시)은 레이어 구현에 남긴다.
 *
 * ## 이 파일을 채울 때의 규율
 * - 파생값을 필드로 만들지 마라. 다른 필드에서 계산되는 값은 함수로 노출한다.
 * - 알파 상한은 **치환**되는 값이다. 전역 배율 필드를 만들지 마라(곱하면 카르곤 1차 실패가
 *   재현된다 — 보수적 판단이 곱해져 화면 기여가 0 이 된다).
 * - 값 사이의 관계는 주석이 아니라 {@link validateGradeTheme} 에 넣어라. 주석은 다음 레인이 안 읽는다.
 *
 * 렌더 전용(ADR-0005).
 */

import type { ThemeViolation } from '../theme.js';

/**
 * 그레이딩 레이어의 행성별 데이터.
 *
 * ⚠️ 지금은 골격이다. 그레이딩 레인이 `src/render/env/kargon*.ts` 의 module-level 상수 중
 * **테마 데이터로 분류된 것**을 여기 필드로 옮기고, `themes/kargon/grade.ts` 에 현재 카르곤
 * 값을 그대로 채운다. 카르곤 화면이 한 픽셀도 바뀌면 안 된다.
 */
export interface GradeTheme {
  /** 소속 테마 슬러그. 텍스처 캐시 키 접두로 쓴다(테마마다 다른 텍스처를 구우므로 필수). */
  readonly themeId: string;
}

/**
 * 그레이딩 테마 검증. 빈 배열이면 통과.
 *
 * 값의 "좋음"이 아니라 **구조적으로 화면을 깨는 조합**만 잡는다.
 */
export function validateGradeTheme(t: GradeTheme): ThemeViolation[] {
  const out: ThemeViolation[] = [];
  if (t.themeId.length === 0) out.push({ where: 'themeId', message: '테마 슬러그가 비었다' });
  return out;
}
