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
 *   - 하위(순번 01~07): 웨이브 슬롯·설치 소켓이 대부분 비어 기본 수비대가 대신 서는 기지.
 *   - 중하(순번 08~14): 편대·설비를 고르게 채우고 코어방 기물이 붙기 시작.
 *   - 중위(순번 15~20): 3레이어 전 슬롯을 채우고 기물·수호 기체·방어 보스까지 갖춘 기지.
 * 실제 배치 규모·구성은 서버 SQL의 정본 layout(3레이어 jsonb)이 결정한다(이 밴드와 정합하도록
 * 서버가 설계). 이 메타의 밴드/순번은 배치전 대상 표시·정렬·연출용이다.
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
  // --- 하위(01~07): 웨이브 슬롯·소켓이 거의 비어 기본 수비대로 채워진 기지 ---
  { id: 'training-target-alpha', name: '훈련 표적 알파', description: '사격 연습용 표적 기지. 웨이브 슬롯도 회랑 소켓도 대부분 비어 기본 수비대가 대신 서 있다. 배치전 첫 상대로 적당하다.', ship: '훈련용 표적기', level: 4 },
  { id: 'rusty-post', name: '녹슨 초소', description: '오래 방치돼 정비도가 바닥난 초소. 편대도 설비도 반응이 한 박자 느리다.', ship: '고물 순찰기', level: 6 },
  { id: 'outpost-watchtower', name: '전초 감시탑', description: '변경을 살피는 감시탑. 대기권 초입에 정찰 드론편대만 얕게 깔려 있다.', ship: '변경 초계기', level: 8 },
  { id: 'sandwind-barrier', name: '모래바람 방벽', description: '모래에 반쯤 묻힌 개활 회랑. 벽 소켓 몇 자리에만 속사포가 붙어 있다.', ship: '사막 순찰기', level: 10 },
  { id: 'twin-emplacement', name: '이중 포좌', description: '회랑 위아래 소켓이 짝을 지어 교차 화망을 만든다. 가운데로 곧장 지나가면 양쪽에서 맞는다.', ship: '이중 포좌기', level: 12 },
  { id: 'scrap-fort', name: '고철 요새', description: '고철로 급조한 회랑. 설비 배치가 성기지만 코어방에 고정 주포 한 문이 버티고 있다.', ship: '고철 수거기', level: 13 },
  { id: 'thornbush-position', name: '가시덤불 진지', description: '병목 회랑에 매복 설비를 몰아넣었다. 좁은 구간에서 서두르면 빠져나갈 자리가 없다.', ship: '가시덤불 매복기', level: 14 },
  // --- 중하(08~14): 편대·설비를 고르게 채우고 기물이 붙기 시작 ---
  { id: 'frostmist-redoubt', name: '서리안개 보루', description: '코어방에 중력 앵커가 깔려 이동이 무겁다. 느려진 채 회랑 설비의 화력에 노출되기 쉽다.', ship: '서리안개 보루기', level: 16 },
  { id: 'chain-discharge-station', name: '연쇄 방전소', description: '회랑 소켓마다 레이저 격자를 물려 짧은 주기로 켜졌다 꺼진다. 켜지는 순간을 못 읽으면 한복판에서 갈린다.', ship: '방전 관제기', level: 18 },
  { id: 'triangle-crossfire', name: '삼각 교차포', description: '굴곡 회랑의 세 구간마다 사계가 겹치도록 설비를 배치했다. 코어로 향하는 직선이 없다.', ship: '삼각 교차기', level: 20 },
  { id: 'coolant-maze', name: '냉각 미로', description: '굴곡 회랑의 사각지대마다 화염 방사구가 숨어 있다. 길을 잘못 들면 장판 위에서 발이 묶인다.', ship: '냉각 작업기', level: 21 },
  { id: 'thorn-citadel', name: '가시 성채', description: '병목 회랑 구간에 곡사 박격포를 몰아 면 제압을 건다. 벽을 끼고 돌파 타이밍을 재야 한다.', ship: '가시 성채기', level: 22 },
  { id: 'missile-nest', name: '유도탄 둥지', description: '드론 사출구가 회랑 내내 소형 드론을 찍어낸다. 근원을 먼저 부수지 않으면 끝이 없다.', ship: '유도탄 둥지기', level: 24 },
  { id: 'storm-gate', name: '폭풍의 문', description: '요격 편대와 회랑 설비가 쉴 틈 없이 이어진다. 웨이브 사이 정리를 못 하면 그대로 밀린다.', ship: '폭풍 관문기', level: 25 },
  // --- 중위(15~20): 전 슬롯을 채우고 코어방 기물·수호·보스까지 갖춘 기지 ---
  { id: 'sniper-corridor', name: '저격 회랑', description: '개활 회랑 12소켓을 관통 레일포로 채웠다. 예고선이 그어질 때마다 자리를 옮겨야 한다.', ship: '저격 회랑기', level: 28 },
  { id: 'missile-cluster', name: '미사일 성단', description: '강습 돌격편대가 연달아 들어오는 사이 회랑 설비가 뒤를 받친다. 화력을 어디에 쓸지가 승부처.', ship: '미사일 성단기', level: 30 },
  { id: 'coldwave-fortress', name: '한파 요새', description: '코어방에 중력 앵커와 고정 주포가 함께 선다. 느려진 상태로 직사 화력을 받아내야 한다.', ship: '한파 요새기', level: 32 },
  { id: 'thunderstorm-altar', name: '뇌우 제단', description: '실드 발생기가 코어를 감싸고 그 뒤에서 방어 보스가 버틴다. 부수는 순서를 틀리면 시간이 녹는다.', ship: '뇌우 제단기', level: 34 },
  { id: 'steel-gateway', name: '강철 관문', description: '세 레이어를 빈틈없이 채운 복합 관문. 수호 기체 둘이 코어방 입구를 지킨다. 상위권 도전의 문턱.', ship: '강철 관문기', level: 37 },
  { id: 'impregnable-nest', name: '난공불락 둥지', description: '편대·설비·기물·수호·보스가 완벽히 맞물린 시드 기지의 정점. 배치전 최종 시험대.', ship: '난공불락 근위기', level: 40 },
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
