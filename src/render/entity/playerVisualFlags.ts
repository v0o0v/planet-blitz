/**
 * 플레이어 비주얼 **항목별 on/off 스위치**.
 *
 * ## 왜 있는가
 * 기체 AAA 비주얼 레인(PR#205)이 플레이어에 10여 개 표현을 한꺼번에 넣었고, 사용자 첫 판정은
 * "결과가 마음에 안 든다 — 뒷부분 불꽃만 남기고 나머지는 원래대로"였다(2026-07-30). 다만 어떤
 * 항목이 어떤 인상을 만드는지는 **하나씩 켜고 끄며 눈으로 봐야** 갈린다. 그래서 항목을 지우는
 * 대신 스위치로 만들고 치트 패널에 '기체' 탭을 두었다.
 *
 * **그 비교가 판정을 바꿨다.** 실제로 나란히 놓고 보니 끄기로 한 것은 셋뿐이었다 — 뱅킹/롤,
 * 그리고 신고의 실체였던 헤일로 2종. 나머지는 전부 살아남았다. "전부 지우자"에서 출발해
 * "셋만 끄자"로 좁혀진 것이 이 도구의 값어치다.
 *
 * ## 기본값 = 사용자가 확정한 조합
 * 프로덕션은 {@link DEFAULT_PLAYER_VISUAL_FLAGS} 로 돌므로 **이 파일이 곧 "무엇이 살아
 * 있는가"의 정본**이다. 판정이 뒤집히면 그 표의 값 하나만 바꾸면 된다.
 *
 * ## 헤일로는 이 레인 것이 아니다
 * `halo` 는 발광체 헤일로(`effects/glow.ts`, ADR-0031 그래픽 이펙트 프로젝트)이고 레인 이전부터
 * 플레이어에 있었다. 레인이 더한 것은 `haloAniso`(기수 축으로 늘이기)뿐이다. 사용자가 "플레이어
 * 헤일로만 끄기"를 택해 `halo` 기본값이 false 다 — 젬·전리품·보스 헤일로는 건드리지 않는다.
 *
 * 하네스 실측(기체 주변 280×280 박스, 시간 평균 16프레임): 헤일로만 토글했을 때 평균 광도 변화
 * **7.51** · 변한 화소 **25,426** 로 잡음 바닥(1.79)을 압도했다. "기체 주위에 둥그렇게 파랗게"가
 * 눈에 걸린 것이 계측으로도 설명된다 — 기체 주변에서 화면을 가장 크게 바꾸던 항목이다.
 *
 * ## 계약
 * - 순수 데이터 모듈. Pixi·sim 무접촉이라 어디서든 import 해도 순환이 안 생긴다.
 * - **렌더 전용**(ADR-0005). 이 값들은 hashWorld/리플레이에 닿지 않는다 — 전부 표시 객체의
 *   가시성과 스프라이트 변환에만 쓰인다.
 * - 읽기는 매 프레임 {@link playerVisualFlags} 로 한다(스냅샷 캐시 금지 — 하네스가 런 도중
 *   토글하면 다음 프레임에 반영돼야 한다).
 */

/** 플레이어 비주얼 항목 스위치. 키 하나가 화면의 표현 하나에 대응한다. */
export interface PlayerVisualFlags {
  /** ② 엔진 불꽃(3노즐·3층·열기 요동). 사용자가 남기기로 한 항목. */
  flame: boolean;
  /** 2b 대시 심 — 대시 중 불꽃 안쪽에 밝은 시안 코어가 뜬다. */
  dashCore: boolean;
  /** ⑤ 대시 잔상 고스트. */
  dashGhosts: boolean;
  /** 5b 대시 개시 충격파 링(0.28초). */
  dashRing: boolean;
  /** 대시 시 카메라 트라우마(화면 흔들림). */
  dashTrauma: boolean;
  /** ⓪ 실루엣 감산 컨투어 — 기체 둘레의 어두운 띠. */
  contour: boolean;
  /** ① 뱅킹/롤 — 선회 시 기울고 횡폭이 눌린다. */
  banking: boolean;
  /** ③ 림라이트 — 광원 쪽 가장자리 밝힘. */
  rim: boolean;
  /** ④ 피격 반동 — 맞으면 기수 반대로 튄다. */
  hitKick: boolean;
  /** ④ 무적 실드 셸 — 피격 후 0.67초간 조여드는 육각 시안 링. */
  shield: boolean;
  /** ⑥ 아이들 부유 — 정지 시 위아래로 천천히 흔들린다. */
  idleBob: boolean;
  /** ⑦ 손상 그을림 — HP 가 낮을수록 선체가 어둡고 난색으로 탄다. */
  damageScorch: boolean;
  /** ⑩ 판면 방향광 + 스페큘러 스윕 — 선체 표면 음영. */
  surface: boolean;
  /** 발광체 헤일로(플레이어 한정). **레인 이전부터 있던 표현**이다. */
  halo: boolean;
  /** ⑨ 헤일로 이방성 — 헤일로를 기수 축으로 늘여 물방울 모양으로 만든다. */
  haloAniso: boolean;
}

/**
 * 기본값 — **사용자가 하네스에서 항목을 하나씩 켜 보고 확정한 조합**(2026-07-30).
 *
 * 처음 판정은 "불꽃만 남기고 원래대로"였지만, 치트 패널 '기체' 탭으로 항목별 비교를 거친 뒤
 * **끄기로 한 것은 셋뿐**이었다:
 *
 * | 끈 항목 | 사용자 판정 근거 |
 * |---|---|
 * | `banking` (① 뱅킹/롤) | 선회할 때 기체가 기울고 눌리는 것이 원치 않는 거동 |
 * | `halo` (기체 주위 파란 발광) | 신고의 실체 — 기체 주변 화면 변화를 지배하던 항목 |
 * | `haloAniso` (⑨ 헤일로 늘이기) | 헤일로 자체를 껐으므로 함께 무의미 |
 *
 * `halo` 는 레인 이전부터 있던 표현이고(`effects/glow.ts`, ADR-0031), 여기서 끄는 것은
 * **플레이어 한정**이다 — 젬·전리품·보스 헤일로는 한 픽셀도 안 바뀐다. `true` 로 되돌리면
 * 레인 이전과 같은 정원(正圓) 헤일로가 돌아온다.
 *
 * 나머지 항목은 코드를 지우지 않고 **스위치로 남겨 둔다** — 판정이 뒤집히면 이 표의 값 하나만
 * 바꾸면 되고, 하네스에서 언제든 다시 나란히 놓고 볼 수 있다.
 */
export const DEFAULT_PLAYER_VISUAL_FLAGS: PlayerVisualFlags = {
  flame: true,
  dashCore: true,
  dashGhosts: true,
  dashRing: true,
  dashTrauma: true,
  contour: true,
  /** ⛔ 사용자 판정으로 끔 — 선회 시 기울기·횡폭 압축이 원치 않는 거동이었다. */
  banking: false,
  rim: true,
  hitKick: true,
  shield: true,
  idleBob: true,
  damageScorch: true,
  surface: true,
  /** ⛔ 사용자 판정으로 끔 — "기체 주위에 둥그렇게 파랗게" 신고의 실체(플레이어 한정). */
  halo: false,
  /** ⛔ 헤일로를 껐으므로 늘이기도 무의미. */
  haloAniso: false,
};

/** 레인이 넣은 것을 **전부 켠** 상태(PR#205 머지 직후 화면). 하네스 비교의 반대쪽 극이다. */
export const ALL_ON_PLAYER_VISUAL_FLAGS: PlayerVisualFlags = {
  flame: true,
  dashCore: true,
  dashGhosts: true,
  dashRing: true,
  dashTrauma: true,
  contour: true,
  banking: true,
  rim: true,
  hitKick: true,
  shield: true,
  idleBob: true,
  damageScorch: true,
  surface: true,
  halo: true,
  haloAniso: true,
};

const flags: PlayerVisualFlags = { ...DEFAULT_PLAYER_VISUAL_FLAGS };

/** 현재 스위치 상태(라이브 객체가 아니라 읽기용 참조 — 쓰기는 {@link setPlayerVisualFlags}). */
export function playerVisualFlags(): Readonly<PlayerVisualFlags> {
  return flags;
}

/**
 * 일부 항목만 갈아 끼운다. 다음 프레임부터 반영된다(장식자가 매 프레임 다시 읽는다).
 * 하네스 치트 패널이 유일한 호출자다 — 프로덕션 코드는 기본값만 쓴다.
 */
export function setPlayerVisualFlags(patch: Partial<PlayerVisualFlags>): void {
  Object.assign(flags, patch);
}

/** 기본값으로 되돌린다. */
export function resetPlayerVisualFlags(): void {
  Object.assign(flags, DEFAULT_PLAYER_VISUAL_FLAGS);
}
