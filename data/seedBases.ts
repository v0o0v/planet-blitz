/**
 * NPC 시드 기지 표시 메타 — 배치전(AC4) 대상 20개 (M4 Phase E2, 계획 §4/§5, GDD §8).
 *
 * **정본(layout)은 서버 마이그레이션 SQL 단독이다**(리드 판정 2026-07-17). 이 파일은
 * 방어 배치(layout) JSON을 **이중 정의하지 않는다** — 드리프트를 원천 차단하기 위해서다.
 * 클라이언트는 NPC 기지의 실제 배치를 서버 조회(`get_placement_targets()` 반환 `layout`)로만
 * 표시하고, 이 파일은 그 위에 얹는 **표시용 메타**(한글 이름·난이도 밴드·설명·표시용 기체
 * 요약)만 보관한다.
 *
 * 조인 키 = `profileId`(UUID). 서버가 `auth.users`/`profiles`/`defenses`/`ladder`를 여기
 * 정의된 UUID로 정확히 시드한다(worker-e-server 합의 2026-07-17). UUID 스킴:
 * prefix `000000e5-ed00-4000-8000-` + 12자리 zero-padded 순번(01~20).
 * ("e5ed" = seed 표식. 결정론적·사람이 읽기 쉬운 seed 관행.)
 *
 * 순번 = 난이도 오름차순(01 가장 쉬움 … 20 가장 어려움). 서버 초기 rank = 21-순번
 * (#01 → rank 20, #20 → rank 1). 난이도 밴드(계획 §5 "하위~중위 커버", 서버 확정):
 *   - 하위(순번 01~07): 방치·기본 방어.
 *   - 중하(순번 08~14): 혼합 포탑 + 장애물.
 *   - 중위(순번 15~20): 저격·유도 등 고비용 포탑 다수, 예산 상한 복합.
 * 실제 배치 규모·포탑 구성은 서버 SQL의 정본 layout이 결정한다(이 밴드와 정합하도록 서버가
 * 설계). 이 메타의 밴드/순번은 배치전 대상 표시·정렬·연출용이다.
 */

/** 배치전 시드 기지 표시용 기체 요약(정찰/목록 표시 — 서버 layout과 무관한 플레이버). */
export interface SeedBaseShipSummary {
  /** 표시명(관제탑 목록·정찰 뷰). */
  name: string;
  /** 표시 레벨(플레이버 — 난이도 감각 보조). */
  level: number;
}

/** 난이도 밴드(서버 확정 3구간). */
export type DifficultyBand = '하위' | '중하' | '중위';

/**
 * NPC 시드 기지 1개의 표시 메타. **layout 없음**(서버 정본). `profileId`로 서버 타깃과 조인.
 */
export interface SeedBaseMeta {
  /** 코드용 슬러그 식별자(불변 — 로그·테스트 참조). */
  id: string;
  /** 조인 키(서버 profiles.id UUID와 정확히 일치해야 함). */
  profileId: string;
  /** 난이도 오름차순 순번(1~20). */
  order: number;
  /** 서버 초기 rank(= 21 - order). 표시·정렬 참고용(서버 권위). */
  initialRank: number;
  /** 한글 표시명(관제탑·정찰 — 서버 확정 목록). */
  name: string;
  /** 난이도 밴드(하위/중하/중위). */
  difficultyBand: DifficultyBand;
  /** 한글 설명(정찰 뷰 플레이버). */
  description: string;
  /** 표시용 기체 요약(서버 미제공 시 목록에서 사용). */
  shipSummary: SeedBaseShipSummary;
}

/** 배치전 총 횟수(PvP 해금 후 첫 5회 — AC4·GDD §8, 서버 required=5). */
export const PLACEMENT_MATCH_COUNT = 5;

/** 시드 기지 개수(난이도 분포 20개 — 계획 §4 E2/§9). */
export const SEED_BASE_COUNT = 20;

/** canonical UUID prefix(서버 시드가 이 스킴을 따라야 조인 성립). */
export const SEED_BASE_UUID_PREFIX = '000000e5-ed00-4000-8000-';

/** 순번(1~20) → canonical 시드 기지 UUID. */
export function seedBaseUuid(index1: number): string {
  const suffix = String(index1).padStart(12, '0');
  return `${SEED_BASE_UUID_PREFIX}${suffix}`;
}

/** 순번(1~20) → 난이도 밴드(서버 확정: 1~7 하위, 8~14 중하, 15~20 중위). */
export function bandForOrder(order: number): DifficultyBand {
  if (order <= 7) return '하위';
  if (order <= 14) return '중하';
  return '중위';
}

/**
 * 20개 시드 기지 정의(서버 확정 이름·순번). 배열 순서 = 난이도 오름차순 = UUID 순번.
 * layout은 정의하지 않는다(서버 SQL 정본). name/description은 한글 플레이버.
 */
interface RawSeed {
  id: string;
  name: string;
  description: string;
  ship: string;
  level: number;
}

const RAW_SEEDS: readonly RawSeed[] = [
  // --- 하위(01~07): 방치·기본 방어 ---
  { id: 'training-target-alpha', name: '훈련 표적 알파', description: '사격 연습용 표적 기지. 방어라 부르기도 민망한 최소 포좌뿐이라 배치전 첫 상대로 적당하다.', ship: '훈련용 표적기', level: 4 },
  { id: 'rusty-post', name: '녹슨 초소', description: '오래 방치돼 절반쯤 멈춘 낡은 초소. 느린 포탑 몇 기가 겨우 조준한다.', ship: '고물 순찰기', level: 6 },
  { id: 'outpost-watchtower', name: '전초 감시탑', description: '변경을 살피는 감시탑. 기본 포탑이 접근로를 얕게 경계한다.', ship: '변경 초계기', level: 8 },
  { id: 'sandwind-barrier', name: '모래바람 방벽', description: '모래바람에 반쯤 묻힌 방벽. 벽 뒤 포탑이 근접을 견제한다.', ship: '사막 순찰기', level: 10 },
  { id: 'twin-emplacement', name: '이중 포좌', description: '두 문의 포좌가 교차 사격으로 정면 접근을 막는 소규모 거점.', ship: '이중 포좌기', level: 12 },
  { id: 'scrap-fort', name: '고철 요새', description: '고철을 쌓아 만든 임시 요새. 장애물과 기본 포탑이 얼기설기 얽혀 있다.', ship: '고철 수거기', level: 13 },
  { id: 'thornbush-position', name: '가시덤불 진지', description: '장애물을 촘촘히 세워 진입로를 좁힌 매복형 진지. 서두르면 갇힌다.', ship: '가시덤불 매복기', level: 14 },
  // --- 중하(08~14): 혼합 포탑 + 장애물 ---
  { id: 'frostmist-redoubt', name: '서리안개 보루', description: '냉기장이 필드를 얼려 이동을 늦춘다. 얼어붙은 채 집중포화에 노출되기 쉽다.', ship: '서리안개 보루기', level: 16 },
  { id: 'chain-discharge-station', name: '연쇄 방전소', description: '전격 다발이 사방에서 튀어 회피 공간이 좁다. 근접이 특히 위험하다.', ship: '방전 관제기', level: 18 },
  { id: 'triangle-crossfire', name: '삼각 교차포', description: '세 방향 포좌가 교차 사격망을 짜 코어로 향하는 직선을 봉쇄한다.', ship: '삼각 교차기', level: 20 },
  { id: 'coolant-maze', name: '냉각 미로', description: '냉기장과 장애물 미로가 얽혀 발이 묶인다. 길을 잘못 들면 포화에 갇힌다.', ship: '냉각 작업기', level: 21 },
  { id: 'thorn-citadel', name: '가시 성채', description: '장애물 벽과 산탄·전격이 겹친 근접 지옥. 벽을 끼고 돌파구를 찾아야 한다.', ship: '가시 성채기', level: 22 },
  { id: 'missile-nest', name: '유도탄 둥지', description: '유도탄이 집요하게 추적한다. 선회를 유도해 벽으로 흘려보내는 기술이 필요하다.', ship: '유도탄 둥지기', level: 24 },
  { id: 'storm-gate', name: '폭풍의 문', description: '전격과 냉기가 폭풍처럼 몰아치는 관문. 한 발도 헛디디면 순식간에 무너진다.', ship: '폭풍 관문기', level: 25 },
  // --- 중위(15~20): 고비용 포탑 다수·예산 상한 복합 ---
  { id: 'sniper-corridor', name: '저격 회랑', description: '긴 회랑을 따라 저격 포탑이 늘어서 장거리부터 압박한다. 엄폐 없이 직진은 자살행위.', ship: '저격 회랑기', level: 28 },
  { id: 'missile-cluster', name: '미사일 성단', description: '유도탄 다수가 성단처럼 쏟아진다. 벽과 선회 유도를 총동원해야 살아남는다.', ship: '미사일 성단기', level: 30 },
  { id: 'coldwave-fortress', name: '한파 요새', description: '다중 냉기장과 저격이 얼린 뒤 저격하는 정예 요새. 속도 관리가 승부처.', ship: '한파 요새기', level: 32 },
  { id: 'thunderstorm-altar', name: '뇌우 제단', description: '전격 다발과 저격이 근·원거리를 동시에 봉쇄한다. 사각이 거의 없다.', ship: '뇌우 제단기', level: 34 },
  { id: 'steel-gateway', name: '강철 관문', description: '저격·유도·산탄·전격을 예산 한계까지 채운 복합 관문. 상위권 도전의 문턱.', ship: '강철 관문기', level: 37 },
  { id: 'impregnable-nest', name: '난공불락 둥지', description: '모든 포탑이 완벽히 맞물린 시드 기지의 정점. 배치전 최종 시험대.', ship: '난공불락 근위기', level: 40 },
];

/** 20개 시드 기지 표시 메타(정본 순서 — UUID 순번 = index+1 = 난이도 오름차순). */
export const SEED_BASES: readonly SeedBaseMeta[] = RAW_SEEDS.map((s, i) => {
  const order = i + 1;
  return {
    id: s.id,
    profileId: seedBaseUuid(order),
    order,
    initialRank: SEED_BASE_COUNT + 1 - order,
    name: s.name,
    difficultyBand: bandForOrder(order),
    description: s.description,
    shipSummary: { name: s.ship, level: s.level },
  };
});

/** canonical 시드 기지 UUID 목록(서버 시드가 이 목록과 정확히 일치해야 함). */
export const SEED_BASE_PROFILE_IDS: readonly string[] = SEED_BASES.map((b) => b.profileId);

/** profileId → 시드 기지 메타(NPC가 아니거나 미상이면 null). */
export function seedBaseByProfileId(profileId: string): SeedBaseMeta | null {
  for (const b of SEED_BASES) {
    if (b.profileId === profileId) return b;
  }
  return null;
}

/** 해당 profileId가 배치전 NPC 시드 기지인지. */
export function isSeedBase(profileId: string): boolean {
  return seedBaseByProfileId(profileId) !== null;
}
