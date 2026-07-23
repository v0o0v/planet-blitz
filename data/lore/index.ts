/**
 * 서사(스토리) 데이터 정본 — 오스카 문명 세계관·기체 사연·인트로·기록 파편.
 * 스키마·경계 설명은 {@link ./types.ts}. 산문은 i18n(`src/i18n/catalog.ts`).
 *
 * ## 세계관 요약 (CONTEXT.md "서사" 섹션이 정본)
 * 붕괴한 초고대 **오스카 문명**은 모든 것을 설계 기록으로 남겼고, 그 기록이 붕괴 후 은하의
 * 유일한 가치가 됐다. 6행성은 오스카가 분야별 기록을 봉인한 아카이브 시설이고, 파일럿들은
 * 기록을 모아 기록 보관소의 영구 공적부(래더) 상위에 오르려 침략·침공한다. 침공 약탈은
 * 원본이 아니라 사본을 떠 가는 "기록 복제"라 방어자는 아무것도 잃지 않는다.
 *
 * ## 사연 캐스트 (혼합)
 * 일부 기체는 전속 파일럿 인물이, 유기체형 기체(해츨링·말로우·버블)는 기체 자신이 인격체다.
 * 각 사연의 핵심은 시그니처 패시브의 "왜 이 능력인가"를 풀어내는 것이다.
 */

import type { ShipStory, IntroSlide, RecordShard } from './types.js';

export type {
  ChapterUnlock,
  ChapterReward,
  StoryChapter,
  ShipStory,
  IntroSlide,
  RecordShard,
} from './types.js';

/**
 * 기체별 사연 정본. **순서는 `SHIP_TYPES` 와 동일**(striker..bubble) — `tests/lore.test.ts` 가
 * slug 집합을 기체 레지스트리와 대조한다. 챕터 3 마일스톤 metric·threshold 는 초기값이며 실제
 * 카운터 추적은 Phase E 소관(밸런스 = 출시 전 튜닝).
 */
export const SHIP_STORIES: readonly ShipStory[] = [
  {
    // 스트라이커 — 아무 기록도 남기지 못한 무명 문명 출신의 신출내기. 시그니처가 없다는 것이
    // 곧 "아직 자기 이야기가 없다"는 서사다. 챕터 3은 시그니처가 없으므로 '이겨서 이름을 남긴다'.
    slug: 'striker',
    bondPlanet: 0, // 카르곤
    portrait: 'ship_portrait_striker.png',
    chapters: [
      { index: 0, unlock: { kind: 'default' } },
      { index: 1, unlock: { kind: 'bondPlanetClear' }, reward: { credits: 400 } },
      {
        index: 2,
        unlock: { kind: 'milestone', metric: 'runsWon', threshold: 12 },
        reward: { credits: 800 },
      },
    ],
  },
  {
    // 브루저 — 지키지 못한 수송선단 사람들의 이름을 장갑판마다 새긴 은퇴 호위함 노병.
    // 시그니처(맞을수록 장갑) = 한 대 맞을 때마다 그 이름을 떠올린다. 마일스톤 = 피격 누적.
    slug: 'bruiser',
    bondPlanet: 5, // 크라스
    portrait: 'ship_portrait_bruiser.png',
    chapters: [
      { index: 0, unlock: { kind: 'default' } },
      { index: 1, unlock: { kind: 'bondPlanetClear' }, reward: { credits: 400 } },
      {
        index: 2,
        unlock: { kind: 'milestone', metric: 'hitsTaken', threshold: 1500 },
        reward: { credits: 800 },
      },
    ],
  },
  {
    // 아크 캐스터 — "멈춰서 쏘는 게 예술"이라는 괴짜 광선 조각가. 오스카의 걸작 기록을 노린다.
    // 시그니처(정지 과충전) = 정지 사격이 곧 조각. 마일스톤 = 과충전 상태 처치.
    slug: 'arccaster',
    bondPlanet: 3, // 아르케
    portrait: 'ship_portrait_arccaster.png',
    chapters: [
      { index: 0, unlock: { kind: 'default' } },
      { index: 1, unlock: { kind: 'bondPlanetClear' }, reward: { credits: 400 } },
      {
        index: 2,
        unlock: { kind: 'milestone', metric: 'overchargeKills', threshold: 400 },
        reward: { credits: 800 },
      },
    ],
  },
  {
    // 팬텀 — 붕괴 때 존재 기록이 통째로 삭제된 자. 아무도 그를 기억하지 못한다.
    // 시그니처(은신 후 일격) = 지워진 자만이 완전히 숨는다. 마일스톤 = 은신 해제 일격.
    slug: 'phantom',
    bondPlanet: 2, // 니플헤임
    portrait: 'ship_portrait_phantom.png',
    chapters: [
      { index: 0, unlock: { kind: 'default' } },
      { index: 1, unlock: { kind: 'bondPlanetClear' }, reward: { credits: 400 } },
      {
        index: 2,
        unlock: { kind: 'milestone', metric: 'cloakBreaks', threshold: 150 },
        reward: { credits: 800 },
      },
    ],
  },
  {
    // 해츨링 — 마지막 부화장에서 살아남은 어미 생체함선. 아이들이 돌아갈 고향의 좌표를 찾는다.
    // 시그니처(처치 누적 → 병아리 출격) = 아이를 계속 낳는다. 마일스톤 = 병아리 출격 누적.
    slug: 'hatchling',
    bondPlanet: 1, // 베르단
    portrait: 'ship_portrait_hatchling.png',
    chapters: [
      { index: 0, unlock: { kind: 'default' } },
      { index: 1, unlock: { kind: 'bondPlanetClear' }, reward: { credits: 400 } },
      {
        index: 2,
        unlock: { kind: 'milestone', metric: 'broodLaunches', threshold: 250 },
        reward: { credits: 800 },
      },
    ],
  },
  {
    // 말로우 — 충격을 삼켜 단맛으로 바꾸는 먹보 생체함선. 봉인된 "최고의 디저트 레시피"를 노린다.
    // 시그니처(피해 적립 후 회복) = 삼킨 충격을 되돌린다. 마일스톤 = 적립분 회복 누적.
    slug: 'mallow',
    bondPlanet: 4, // 톡사르
    portrait: 'ship_portrait_mallow.png',
    chapters: [
      { index: 0, unlock: { kind: 'default' } },
      { index: 1, unlock: { kind: 'bondPlanetClear' }, reward: { credits: 400 } },
      {
        index: 2,
        unlock: { kind: 'milestone', metric: 'cushionHealed', threshold: 40000 },
        reward: { credits: 800 },
      },
    ],
  },
  {
    // 버블 — 터지는 게 무서웠던 겁쟁이 비눗방울. 터질 때마다 누군가를 지킬 수 있음을 알게 된다.
    // 시그니처(보호막 파열로 밀어내기) = 터짐이 곧 방패. 마일스톤 = 보호막 파열 누적.
    slug: 'bubble',
    bondPlanet: 0, // 카르곤
    portrait: 'ship_portrait_bubble.png',
    chapters: [
      { index: 0, unlock: { kind: 'default' } },
      { index: 1, unlock: { kind: 'bondPlanetClear' }, reward: { credits: 400 } },
      {
        index: 2,
        unlock: { kind: 'milestone', metric: 'filmPops', threshold: 300 },
        reward: { credits: 800 },
      },
    ],
  },
];

/**
 * 첫 실행 1회 노출되는 세계관 인트로 슬라이드(배열 순서 = 표시 순서). 4컷 — 붕괴 → 기록이
 * 화폐가 된 은하 → 아카이브 행성과 침공 → "당신도 떠난다". 기록 보관소에서 다시 볼 수 있다.
 */
export const INTRO_SLIDES: readonly IntroSlide[] = [
  { id: 'collapse' },
  { id: 'records' },
  { id: 'archives' },
  { id: 'launch' },
];

/**
 * 기록 파편 도감 정본. 에코 신호 안정화(Phase D)로 하나씩 수집되며, 모으면 오스카 문명 붕괴의
 * 전말이 드러난다. 순서 = 도감 표시 순서(서사 순). append-only 권장(수집 진행과 무관하나
 * 도감 자리 안정성).
 */
export const RECORD_SHARDS: readonly RecordShard[] = [
  { id: 'first-archive' },
  { id: 'the-curators' },
  { id: 'overflow' },
  { id: 'the-silence' },
  { id: 'copy-of-a-copy' },
  { id: 'the-last-curator' },
  { id: 'echoes' },
  { id: 'your-name-here' },
];

/** slug → 사연. 없으면 undefined(호출부가 방어) — 순수 조회. */
export function shipStory(slug: string): ShipStory | undefined {
  return SHIP_STORIES.find((s) => s.slug === slug);
}
