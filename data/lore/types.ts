/**
 * 서사(스토리) 데이터 스키마 — 오스카 문명 세계관과 기체 사연 (스토리 시스템, ADR-0023).
 *
 * ## 왜 별도 레이어인가 (ADR-0005 결정론 경계)
 * 사연·인트로·기록 파편은 **순수 메타/UI 콘텐츠**다. sim(`src/sim/**`)은 이 파일을 절대
 * import 하지 않으며(해시·리플레이 무관), 데이터는 순수 상수 + 순수 조회 헬퍼만 둔다
 * (무작위·시계 없음 — eslint 가 `data/**` 에도 강제). 산문 자체는 여기 두지 않고 i18n
 * 카탈로그(`src/i18n/catalog.ts`)에 EN/KO 로 두며, 이 모듈은 **구조와 키 유도 규칙**만 갖는다.
 *
 * ## 키는 데이터 파생이다 (`ship.<slug>.*`·`def3.*` 선례)
 * 하드코딩 목록을 만들면 사연/슬라이드를 늘렸을 때 목록이 모르고 문구가 조용히 빈칸이 된다.
 * i18n 키는 전부 이 모듈의 정본 배열에서 유도하고(`src/ui/pixi/loreLabels.ts`), 완전성은
 * `tests/lore.test.ts` 가 배열 파생으로 검사한다 — 항목을 append 하면 문구를 채우기 전까지
 * 빨간불로 남는다.
 */

/**
 * 사연 챕터 해금 조건. 챕터 1은 항상 공개, 챕터 2는 인연 행성 클리어, 챕터 3은 기체별
 * 시그니처 마일스톤이다. 판정·추적은 Phase E(save/progress)가 소비한다 — 이 모듈은 선언만 한다.
 */
export type ChapterUnlock =
  /** 기본 공개(챕터 1). */
  | { readonly kind: 'default' }
  /** 이 기체의 인연 행성을 최소 1회 클리어(챕터 2). */
  | { readonly kind: 'bondPlanetClear' }
  /**
   * 기체별 시그니처 관련 누적 마일스톤(챕터 3). `metric` 은 Phase E 가 추적하는 카운터 축의
   * 안정적 식별자, `threshold` 는 초기값(밸런스 = 출시 전 일괄 튜닝).
   */
  | { readonly kind: 'milestone'; readonly metric: string; readonly threshold: number };

/** 사연 과제 해금 보상. 코스메틱(도감 배지 등)은 Phase E 가 붙인다 — 여기선 크레딧만 선언. */
export interface ChapterReward {
  /** 소액 크레딧(런 중 수치 불개입 — 메타 재화만). */
  readonly credits: number;
}

/** 사연 한 챕터. `index` 0·1·2 는 표시 순서이자 i18n 키(`ch1`/`ch2`/`ch3`)의 축이다. */
export interface StoryChapter {
  /** 0 = 챕터 1(기본), 1 = 챕터 2, 2 = 챕터 3. */
  readonly index: 0 | 1 | 2;
  /** 해금 조건. */
  readonly unlock: ChapterUnlock;
  /** 해금 보상(챕터 1은 없음 — 기본 공개라 해금 이벤트가 없다). */
  readonly reward?: ChapterReward;
}

/** 기체 타입 1종의 사연. `slug` 은 `ShipTypeDef.slug` 와 1:1(같은 축이라 아트·키가 정합). */
export interface ShipStory {
  /** 기체 slug — `data/ships` 의 slug 와 반드시 일치(테스트가 대조). */
  readonly slug: string;
  /**
   * 인연 행성의 `PlanetContent.index`(wire 값). 챕터 2 해금의 무대다. 여러 기체가 같은 행성을
   * 인연으로 가질 수 있다(스트라이커·버블 = 카르곤).
   */
  readonly bondPlanet: number;
  /**
   * 초상 파일 basename(`ship_portrait_<slug>.png`). 아트는 코드보다 늦게 오며 로더가 폴백을
   * 흡수한다(쇼케이스 선례). basename 은 slug 파생이라 여기 두고 로더 목록이 이걸 소비한다.
   */
  readonly portrait: string;
  /** 정확히 3챕터, index 0·1·2 순서. */
  readonly chapters: readonly [StoryChapter, StoryChapter, StoryChapter];
}

/** 인트로 슬라이드 1컷. 배열 위치 = 표시 순서, `id` = i18n 키(`intro.<id>.*`)의 축. */
export interface IntroSlide {
  readonly id: string;
}

/**
 * 기록 파편 도감 항목 1개. 에코 신호 안정화로 수집되며(Phase D), 기록 보관소 도감에 쌓여
 * 오스카 문명의 로어를 조각조각 드러낸다. `id` = i18n 키(`shard.<id>.*`)의 축.
 */
export interface RecordShard {
  readonly id: string;
}
