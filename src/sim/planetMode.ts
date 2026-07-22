/**
 * 행성 모드 selector (ADR-0021). 공통 아레나 서바이벌 코어 위에 얹히는 행성별
 * 게임플레이 규칙 집합의 **식별자**다. 값은 리플레이 wire/hash 값이므로 **재번호 금지**
 * (append-only). 미지정 = vampire(0) = 현행 뱀서류 경로.
 *
 * enum 을 쓰지 않는 이유: 이 저장소는 isolatedModules+verbatimModuleSyntax 라
 * KIND_CODE 처럼 const 객체 + 파생 타입으로 표현한다.
 */
export const PLANET_MODE = {
  vampire: 0,
  blockBreak: 1,
  racing: 2,
  chase: 3,
  shrink: 4,
  contamination: 5,
} as const;

export type PlanetMode = (typeof PLANET_MODE)[keyof typeof PLANET_MODE];
