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
 *   - 하위(순번 01~07): 개활 회랑. 편대 1~3·설비 2~5 로 얕고, 보스는 05번부터 붙는다.
 *   - 중하(순번 08~14): 병목 회랑. 설비 종류가 넓어지고 **코어방 기물이 넷으로** 늘며 중급
 *     보스가 선다. 기물 충전량이 하위 2 → 중하 4 로 뛰는 것이 두 밴드를 가르는 축이다.
 *   - 중위(순번 15~20): 굴곡 회랑. 편대·설비가 만석에 가깝고 기물 종류가 전부 열리며 최난도
 *     보스가 지킨다. 코어방 기물은 **셋**으로 중하(넷)보다 적은데, 등급 3·승급 3 이라 1기당
 *     강도가 훨씬 세고 `propShift` 로 상위 종류가 서기 때문이다(개수가 아니라 질로 어렵다 —
 *     실측 클리어율은 중하 71% > 중위 40% 로 순서가 유지된다).
 *
 * 보스는 **실측 난이도 오름차순**으로 배정한다(2026-07-27 재측정): 05~10 위상 감시자 →
 * 11~16 강철 골리앗 → 17~20 포자 여왕. `DEFENSE_BOSSES` 배열 순서(append-only 계약)와는
 * 무관한 매핑이다.
 *
 * 아래 description 은 **최신 재시드 마이그레이션이 실제로 시드하는 구성**을 서술한다
 * (정본은 그 SQL — 이 파일은 layout 을 이중 정의하지 않는다. 현재 정본은
 * `20260728000000_invasion_props_rebalance.sql`). SQL 램프를 고치면 이 문장들도 함께
 * 고쳐야 한다. 밴드별 실측 클리어율(참조봇·중급 장비·24시드, 2026-07-28 기물 재조정 후)은
 * 하위 100% / 중하 71% / 중위 40% 이고 근거는 `tests/invasionBalance.test.ts` 가 재현한다.
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
  // --- 하위(01~07): 개활 회랑(소켓 12). 편대 1~3 · 설비 2~5 · 기물 0~2 · 보스는 05번부터 ---
  { id: 'training-target-alpha', name: '훈련 표적 알파', description: '사격 연습용 표적 기지. 개활 회랑에 속사포와 관통 레일포 두 문뿐이고, 대기권에는 정찰 드론편대 한 무리만 올라온다. 코어방은 비어 있다.', ship: '훈련용 표적기', level: 4 },
  { id: 'rusty-post', name: '녹슨 초소', description: '오래 방치돼 정비도가 바닥난 초소. 구성은 훈련 표적과 같지만 편대와 설비의 손질 상태가 한 단계 위다.', ship: '고물 순찰기', level: 6 },
  { id: 'outpost-watchtower', name: '전초 감시탑', description: '변경을 살피는 감시탑. 곡사 박격포가 한 문 늘어 개활 회랑을 부채꼴로 덮기 시작한다.', ship: '변경 초계기', level: 8 },
  { id: 'sandwind-barrier', name: '모래바람 방벽', description: '모래에 반쯤 묻힌 개활 회랑. 대기권에 요격 편대가 더해져 좌우 협공이 처음 들어온다.', ship: '사막 순찰기', level: 10 },
  { id: 'twin-emplacement', name: '이중 포좌', description: '회랑 소켓 네 자리에 레이저 격자까지 물렸다. 코어방에는 실드 발생기와 중력 앵커, 그리고 위상 감시자가 처음 등장한다 — 보호막을 먼저 걷어야 코어에 흠집이 난다.', ship: '이중 포좌기', level: 12 },
  { id: 'scrap-fort', name: '고철 요새', description: '고철로 급조한 개활 회랑. 구성은 이중 포좌와 같고 강화 단계만 한 칸 위다. 감시자의 과열 창을 놓치면 시간이 녹는다.', ship: '고철 수거기', level: 13 },
  { id: 'thornbush-position', name: '가시덤불 진지', description: '개활 회랑 다섯 소켓을 채우고 대기권에 강습 돌격편대까지 세웠다. 하위 밴드의 마지막 관문.', ship: '가시덤불 매복기', level: 14 },
  // --- 중하(08~14): 병목 회랑(소켓 8). 설비 종류가 넓어지고 기물 5 · 중급 보스가 선다 ---
  { id: 'frostmist-redoubt', name: '서리안개 보루', description: '여기부터 병목 회랑이다. 소켓은 여덟뿐이지만 통로가 좁고 화염 방사구가 벽 안쪽에 꺼지지 않는 장판을 깐다. 코어방도 여기서부터 다섯 자리가 전부 차, 실드 발생기와 중력 앵커가 겹으로 선다.', ship: '서리안개 보루기', level: 16 },
  { id: 'chain-discharge-station', name: '연쇄 방전소', description: '병목 소켓을 여섯까지 채웠다. 코어방 기물이 다섯이라 감속 장판이 겹치고, 그 위에서 레이저 격자의 주기를 읽어야 한다.', ship: '방전 관제기', level: 18 },
  { id: 'triangle-crossfire', name: '삼각 교차포', description: '드론 사출구가 병목 한복판에서 소형 드론을 계속 찍어내고, 대기권에는 조류형 활공편대가 대각선으로 파고든다.', ship: '삼각 교차기', level: 20 },
  { id: 'coolant-maze', name: '냉각 미로', description: '병목 소켓 일곱이 전부 다른 종류다. 코어방 수문장이 강철 골리앗으로 바뀌어 탄막 밀도로 통로를 눌러 온다.', ship: '냉각 작업기', level: 21 },
  { id: 'thorn-citadel', name: '가시 성채', description: '냉각 미로와 같은 구성을 한 단계 더 벼렸다. 좁은 통로에서 골리앗의 예고 기둥과 설비 화망이 동시에 겹친다.', ship: '가시 성채기', level: 22 },
  { id: 'missile-nest', name: '유도탄 둥지', description: '병목 소켓 여덟이 만석이고 그중 하나가 압축 프레스다. 부술 수 없는 판이 통로를 왕복해 설 자리를 빼앗는다. 대기권에는 기뢰 살포선이 고정 기뢰를 깔아 둔다.', ship: '유도탄 둥지기', level: 24 },
  { id: 'storm-gate', name: '폭풍의 문', description: '유도탄 둥지와 같은 병목 회랑 만석 구성에 강화 단계만 위다. 프레스와 기뢰밭 사이에서 코어방 보스까지 상대해야 하는 중하 밴드의 마지막 문.', ship: '폭풍 관문기', level: 25 },
  // --- 중위(15~20): 굴곡 회랑(소켓 10). 편대·설비 만석 · 기물 5(종류 전부 개방) · 최난도 보스 ---
  { id: 'sniper-corridor', name: '저격 회랑', description: '굴곡 회랑으로 바뀌며 소켓이 열로 늘었다. 견인 자기장이 감속 장판을 세우고 그 위로 관통 레일포의 예고선이 그어진다. 코어방에는 회복 파일런이 처음 서서, 부순 기물이 되살아나기 시작한다.', ship: '저격 회랑기', level: 28 },
  { id: 'missile-cluster', name: '미사일 성단', description: '웨이브 슬롯 여섯이 만석이고 실드 호위편대가 전열을 세운다. 코어방에는 기만 홀로그램까지 더해져 기물 다섯 자리가 전부 다른 종류다.', ship: '미사일 성단기', level: 30 },
  { id: 'coldwave-fortress', name: '한파 요새', description: '굴곡 소켓 열이 전부 찼고 대기권에는 저격 편대가 상단에 눌러앉는다. 수문장은 바닥을 장판으로 계속 빼앗는 포자 여왕이다 — 시드 기지 최난도 수문장이다.', ship: '한파 요새기', level: 32 },
  { id: 'thunderstorm-altar', name: '뇌우 제단', description: '충격파 발생기가 긴 예열 뒤 회랑을 통째로 덮는다. 코어방 기물 순서가 뒤로 밀려 회복 파일런과 기만 홀로그램이 앞자리를 차지하고, 무엇을 먼저 지울지 판단부터 요구한다.', ship: '뇌우 제단기', level: 34 },
  { id: 'steel-gateway', name: '강철 관문', description: '뇌우 제단과 같은 승급 최고 단계 구성을 한 급 더 벼린 복합 관문. 파일런을 남겨 두면 여왕도 기물도 계속 되살아난다.', ship: '강철 관문기', level: 37 },
  { id: 'impregnable-nest', name: '난공불락 둥지', description: '지원 편대가 앞선 편대를 계속 회복시키고, 코어방은 파일런·홀로그램·자폭 지뢰군이 지킨다. 카탈로그 전 종류가 한 판에 모이는 시드 기지의 정점.', ship: '난공불락 근위기', level: 40 },
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
