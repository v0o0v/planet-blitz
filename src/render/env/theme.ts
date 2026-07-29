/**
 * 행성 환경 **테마 계약** — 배경 레이어 5장이 읽는 행성별 데이터의 유일한 조립 지점.
 *
 * ## 왜 테마인가
 * 카르곤 배경(PR#192)의 레이어 5장은 메커니즘이 이미 행성 무관이다. `KARGON` 판정은 각 파일
 * `configure()` 한 곳씩 총 5곳뿐이고, 마칭 스퀘어즈 등고선·데칼 기하 12종·파티클 필드·아핀
 * 그레이딩은 어느 행성에서나 성립한다. 행성마다 다른 것은 **데이터**(색·폭·알파·주기·밀도)다.
 * 그래서 데이터를 코드에서 분리해 `themes/<planet>/` 로 옮기고, 레이어는 주입받은 테마만 읽는다.
 *
 * ## 이 계약의 진짜 임무는 "관계 불변식"이다
 * 카르곤은 4라운드에 걸쳐 값 사이의 관계로만 존재하는 불변식들을 발견했다 — AO 띠가 코어를
 * 먹으면 안 되고, 데칼 격자 셀은 타일 크기 및 서로끼리 서로소여야 하며, 그레이딩 알파 6개는
 * 독립 슬라이더가 아니라 공동 예산의 배분이다. 이걸 문서로만 남기면 **6개 레인이 각자 같은
 * 함정을 다시 밟는다.** 그래서 각 레이어 계약은 자기 `validate*Theme` 를 함께 제공하고,
 * {@link validateTheme} 이 그걸 모아 돌린다. 전 테마에 대해 도는 테스트가 이것을 강제한다.
 *
 * ## 파생값을 필드로 만들지 마라
 * 안전 색상 구간(카르곤의 `[10°, 18.4°]`)은 `FOREGROUND_SIGNAL_COLORS` 의 함수다. 테마 필드로
 * 만들면 행성마다 사람이 손으로 다시 적다가 갈라진다 — 이 리포가 `UPPER_THRESHOLD` 0.5 vs 0.57
 * 로 이미 겪은 실패의 정확한 재현이다. {@link file://./color.ts} 의
 * `computeSafeHueWindows` 로 **계산**하고 테마는 **검증만** 받는다.
 *
 * ## 알파는 곱하지 말고 치환해라
 * 레이어의 알파 사슬은 이미 `cap × strength × pulse × tierScale × gateScale` 다. 카르곤 1차
 * 실패가 바로 "개별로는 합리적인 보수적 판단이 곱해져 화면 기여가 0 이 된 것"이었다. 흔한
 * 설계인 `themeIntensity` 전역 배율을 여기 곱하면 그 실패가 그대로 재현된다. 테마는 `cap`
 * **자체를 치환**한다.
 *
 * ## 결정론(ADR-0005)
 * 테마는 전부 렌더 전용 데이터다. `src/sim/` 를 import 하지 않고 해시에 기여하지 않는다.
 */

import type { ParallaxTheme } from './contracts/parallax.js';
import type { DecalTheme } from './contracts/decals.js';
import type { TerrainLightTheme } from './contracts/terrainLight.js';
import type { AtmosphereTheme } from './contracts/atmosphere.js';
import type { GradeTheme } from './contracts/grade.js';
import { validateParallaxTheme } from './contracts/parallax.js';
import { validateDecalTheme } from './contracts/decals.js';
import { validateTerrainLightTheme } from './contracts/terrainLight.js';
import { validateAtmosphereTheme } from './contracts/atmosphere.js';
import { validateGradeTheme } from './contracts/grade.js';

/**
 * 광원 방향 — **데칼과 지형광이 반드시 같은 값을 읽어야 한다.**
 *
 * 두 레이어가 같은 물리("광원이 어디 있는가")를 각각 구현하고 있고, 한쪽만 옮기면 화면에
 * 태양이 둘이 된다. 카르곤은 "바닥 용암이 유일한 광원이고 하늘은 검다"라서 아래에서 조명되는데,
 * 이건 행성 서사에서 나온 것이지 보편 상수가 아니다 — 고지에서 흘러내리는 산성 침출이라면
 * 뒤집힌다. 그래서 테마 필드이되 **공유 필드**다.
 */
export interface EnvLightSpec {
  /** 표면에서 광원을 향하는 방향의 각도(라디안). 화면 좌표계라 +y 가 아래다. */
  readonly angle: number;
  /**
   * 드롭 섀도가 광원 반대쪽으로 얼마나 편향되는가 [0,1]. 0 이면 방향성 없음(순수 접지),
   * 1 이면 완전히 광원 반대편.
   */
  readonly shadowBias: number;
}

/** 광원 방향의 단위 벡터 x 성분(파생값 — 저장하지 마라). */
export function lightX(l: EnvLightSpec): number {
  return Math.cos(l.angle);
}
/** 광원 방향의 단위 벡터 y 성분(파생값 — 저장하지 마라). */
export function lightY(l: EnvLightSpec): number {
  return Math.sin(l.angle);
}

/** 테마 식별·배정. */
export interface EnvThemeMeta {
  /** 파일명과 일치하는 소문자 슬러그. 텍스처 캐시 키의 접두로도 쓴다. */
  readonly id: string;
  /** 진단 표시용 이름. */
  readonly name: string;
  /**
   * 이 테마가 담당하는 행성 인덱스들. 한 테마가 여러 행성을 담당할 수 있다
   * (침공 3레이어처럼 같은 계열을 공유하는 경우).
   */
  readonly planets: readonly number[];
}

/** 행성 하나의 배경 테마 전체. */
export interface EnvTheme extends EnvThemeMeta {
  readonly light: EnvLightSpec;
  readonly parallax: ParallaxTheme;
  readonly decals: DecalTheme;
  readonly terrainLight: TerrainLightTheme;
  readonly atmosphere: AtmosphereTheme;
  readonly grade: GradeTheme;
}

/** 계약 위반 하나. `where` 는 `'grade.coolMaxAlpha'` 처럼 고칠 자리를 가리킨다. */
export interface ThemeViolation {
  readonly where: string;
  readonly message: string;
}

/** 위반 목록을 만들 때 쓰는 작은 헬퍼(각 계약 파일이 공유한다). */
export function violate(out: ThemeViolation[], cond: boolean, where: string, message: string): void {
  if (!cond) out.push({ where, message });
}

/**
 * 테마 전체 검증. **빈 배열이면 통과**다.
 *
 * 값의 "좋음"을 판정하지 않는다 — 그건 눈과 지표의 몫이다. 여기서 잡는 것은 **구조적으로
 * 화면을 깨는 조합**뿐이며, 전부 카르곤이 실제로 밟았던 것이다.
 */
export function validateTheme(t: EnvTheme): ThemeViolation[] {
  const out: ThemeViolation[] = [];
  violate(out, t.id.length > 0 && /^[a-z0-9_]+$/.test(t.id), 'id', `슬러그는 소문자·숫자·밑줄만: ${t.id}`);
  violate(out, t.planets.length > 0, 'planets', '담당 행성이 없는 테마는 영원히 켜지지 않는다');
  violate(out, Number.isFinite(t.light.angle), 'light.angle', '광원 각도가 유한값이 아니다');
  violate(
    out,
    t.light.shadowBias >= 0 && t.light.shadowBias <= 1,
    'light.shadowBias',
    `[0,1] 밖: ${t.light.shadowBias}`,
  );
  for (const v of validateParallaxTheme(t.parallax)) out.push({ ...v, where: `parallax.${v.where}` });
  for (const v of validateDecalTheme(t.decals)) out.push({ ...v, where: `decals.${v.where}` });
  for (const v of validateTerrainLightTheme(t.terrainLight)) out.push({ ...v, where: `terrainLight.${v.where}` });
  for (const v of validateAtmosphereTheme(t.atmosphere)) out.push({ ...v, where: `atmosphere.${v.where}` });
  for (const v of validateGradeTheme(t.grade)) out.push({ ...v, where: `grade.${v.where}` });
  return out;
}
