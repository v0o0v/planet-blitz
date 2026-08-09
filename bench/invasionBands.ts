/**
 * 침공 밴드 계측 CLI — **측정값을 찍기만 한다. 단언이 없다**(ADR-0051 갈래 ①).
 *
 * ## 실행
 *   node node_modules/.pnpm/vite-node@<버전>/node_modules/vite-node/vite-node.mjs bench/invasionBands.ts
 * (`<버전>` 은 `ls node_modules/.pnpm | grep '^vite-node'` 로 확인한다. `vite-node` 는 PATH 에 없다.)
 *
 * 축소 실행(배선 확인용, 시드 수를 줄인다):
 *   SEEDS=4 node .../vite-node.mjs bench/invasionBands.ts
 * 기본값은 24시드(ADR-0037 해상도)다. 전량은 수 분~십수 분 걸린다.
 *
 * 출력은 **ASCII 전용**이다 — 사용자가 PowerShell 콘솔에서 돌리는데, 콘솔 코드페이지가
 * UTF-8 이 아니면 한글이 mojibake 로 깨져 판정을 방해한다. 한글은 이 주석에만 쓴다.
 *
 * ## 왜 단언이 없는가
 * 이 계측이 재는 것은 **참조봇의 실력**이다. 봇 클리어율 61.4% 가 사람에게 무엇을 뜻하는지
 * 아무도 모르므로 절대 계약으로 쓸 근거가 없다. 게다가 방침이 "밸런스는 출시 직전 일괄
 * 튜닝" 이라, 중간 상태의 클리어율을 계약으로 못 박으면 밸런스를 만질 때마다 깨진다.
 * 밸런싱 본선은 출시 후 실유저 텔레메트리이고 이 도구는 출시 직전 1회성 보조다(ADR-0051 §3).
 *
 * ## 무엇을 재는가 — ⚠️ **2026-08-10 에 전제가 통째로 바뀌었다**
 *
 * 아래 문단은 **파워업 3택이 있던 시절**의 기록이다. 사용자 지시로 **침공에서 레벨업 카드를
 * 없앴으므로**(`xpToNextInvasion` → `NO_LEVELUP`) 여기서 말하는 분산 원인이 사라졌다:
 *
 *   - 승률은 이제 파워업 추첨 운이 아니라 **장비·계보·배치·봇 조작**으로만 결정된다.
 *     역설적으로 그래서 **이 벤치의 승률이 비로소 배치 난이도를 가리키게 됐다.**
 *   - 반대로 아래 "설계 의도 밴드"(하위 ≥85% 등)는 **그 분산 위에서 잡힌 목표선**이라 근거를
 *     잃었다. 기준선을 사용자가 다시 잡는 중이므로(「기본 수비대 상태를 만렙 기체가 어느 정도
 *     클리어하는가」) 목표선은 그때 다시 쓴다. **그 전까지 이 숫자로 밸런스를 판정하지 마라.**
 *   - 파워업이 없으므로 같은 시드·같은 장비면 결과가 사실상 고정이다 — 시드를 늘려도
 *     해상도가 예전만큼 오르지 않는다.
 *
 * (옛 기록) 런 풀 커브 계수를 1000 으로 올려 레벨업을 0회로 만들면 20기지 전부가 96시드 내내
 * 0% 또는 100% 로 고정된다(2026-07-27 실측). 즉 시드 간 승률 분산은 통째로 `state.powerupRng`
 * 에서 나오고, 적 스폰·드랍 추첨은 승패를 사실상 흔들지 않는다. 읽을 때 쓸 수 있는 것은
 * ⓐ클리어 가능성이 살아 있는가 ⓑ밴드 순서가 뒤집히지 않았는가 둘뿐이었다.
 *
 * ## 설계 의도 밴드(참고선 — 계약이 아니다)
 *   하위(01~07) >= 85%  : 배치전은 PvP 해금 후 필수 5회다. 여기서 막히면 진행이 멈춘다.
 *   중하(08~14) 55~80%  : 절반 이상 이기되 배치를 신경 쓰게 만드는 구간.
 *   중위(15~20) 25~55%  : 재도전 전제의 상위권 문턱. 0% 도 100% 도 아니어야 한다.
 *
 * ## 세대별 이동 이력 — 무엇이 숫자를 옮겼는가 (24시드 기준 하위/중하/중위)
 *   1세대 무제한 조준 센티널 제거(`weapon.range === 0`) — 중하가 양 끝으로 찢어졌다.
 *   2세대 ADR-0034 강제 스크롤 ANCHOR — 창 뒤 경계 고착이 사라져 난이도 재분배, 중하/중위 역전.
 *   3세대 ADR-0036 경험치 이원화(런 풀 커브 10+6L -> 10+13L) — 레벨업이 줄어 **모든 숫자가
 *          함께 이동**. 시드를 12 -> 24 로 올린 것도 이때이며 완화가 아니라 해상도 복원이다
 *          (12시드는 최소 눈금 8.33pp 라 진짜 승률 6.25% 기지가 0/12 로 보일 확률이 46%).
 *          ⚠️ 이후 침공만 10+6L 로 되돌아갔다(`xpToNextInvasion`, PvE 는 10+66L).
 *   4세대 실드 발생기 국면 코어가 아군탄 차폐물이던 sim 결함 제거 — 발생기 보유 기지가 전부
 *          올라갔다(#16 12.5->80.2). 발생기 없는 #01~#04 는 바이트 불변(대조군).
 *          정본 `.omc/research/invasion-core-shot-block-2026-07-27.md`.
 *   5세대 밴드 목표 복원 T4b — 램프 세 줄(등급/승급 임계 + 기물)만 옮겨 100.00/71.43/31.94.
 *          `.omc/research/invasion-band-restore-2026-07-27.md`.
 *   6세대 공간 해시 broad-phase 결함 수정 — `insert` 는 중심 셀 한 칸, `query` 는 탐침 반경만
 *          훑어 **엔티티 반경만큼의 띠가 통째로 빠져 있었다**. 밴드가 목표 아래로(52.38/17.36)
 *          내려가 기물 램프 한 줄로 70.83/40.28 에 재착지.
 *          `.omc/research/spatial-hash-large-radius-broadphase-2026-07-28.md`.
 *   7세대 드론 사출구 전방 사출 재설계 — L2 강제 스크롤 720u/s 가 최고 적 속도 420u/s 보다
 *          빨라 소켓 옆에 태어난 드론이 구조적으로 영영 못 따라붙었다(L2 누적 피해 24시드 12).
 *          100.00/67.86/43.75. `.omc/research/invasion-spawner-redesign-2026-07-28.md`.
 *   8세대 파워업 강화 폭 상한 -10% 뒤처리 — 39.88/11.11 로 내려앉은 것을 램프 두 줄
 *          (rarity 개시 nn12->nn15 · ascension nn>=8 전부 1)로 100.00/63.69/33.33 복원.
 *          정본 `supabase/migrations/20260803020000_invasion_band_restore_2.sql`.
 *   9세대 5레인 통합(파워업 반올림 고정소수점화 포함) — 100.00/71.43/35.42.
 *          ⚠️ **가산성은 성립하지 않았다.** 단독 대조에서 중위 +11.81pp 였던 처방이 램프 위에
 *          얹히자 +2.09pp 였다. 두 처방이 같은 자리(파워업 추첨 운 분포)를 통해 작동해 서로의
 *          여유를 잠식한다 — **밴드 예측을 선형 가산으로 하지 마라.**
 *
 * ## 다음 사람이 알아야 할 것 (레버 선정에서 반복 확인된 사실)
 * - **단일 축으로는 중하가 움직이지 않는다.** 난이도는 보스 x 강화축의 **곱**으로만 내려간다.
 * - **레벨 램프는 밴드를 분리하지 못한다.** 중위가 5배 빠르게 반응해, 중하가 목표에 닿기 전에
 *   중위가 바닥을 친다. 분리 레버는 보통 **기물**이지만 레버의 유효성은 sim 수위에 의존한다
 *   (8세대에서는 기물을 줄이면 #15 혼자 튀어 밴드 안 격차가 오히려 커졌다).
 * - **`#16` 계단의 원인은 램프 값이 아니라 L3 `affixSeed` 다**(2026-07-28 실측). 램프를 통째로
 *   교환해도 승률이 따라오지 않고, L3 salt 만 상대 기지 것으로 바꾸면 4.2% <-> 45.8% 로 뒤집힌다.
 *   바운드 처방 3종(과열 저항 상한 · 피해 배율 합산 상한 · salt 전역 재추첨)은 전부 실측 0이었다.
 *   남은 실효 처방은 **유니크 역할 인지 추첨**이다(`rollUniqueId` 가 기물 역할을 안 봐서
 *   `overclockCore` 가 실드 발생기에 붙으면 완전한 무효과). 정본
 *   `.omc/research/invasion-16-step-2026-07-28.md`.
 * - **기물 `id 5`(mineSwarm)는 `#20` 한 곳에서만 노출된다.** 중위 `props` 를 3 미만으로 내리면
 *   `tests/invasionBalance.test.ts` 의 "풀 카탈로그 노출" 단언이 승률보다 **먼저** 깨진다.
 * - 램프를 실제로 바꾸려면 최신 재시드 마이그레이션이 정본이고, `src/bench/invasionBands.ts` 의
 *   `RAMP` 미러 14줄을 **동시에** 고쳐야 한다(드리프트 가드가 `tests/` 에 남아 있다).
 */

import {
  BANDS,
  BALANCE_SEEDS,
  NON_STRIKER_SHIP_TYPES,
  ROSTER_GATE_RANGE_ADD,
  escalatedWinRate,
  measureBand,
  rosterGateRate,
  stdev,
} from '../src/bench/invasionBands.js';
import type { BandName } from '../src/bench/invasionBands.js';

/** `SEEDS=n` 으로 시드 수를 줄인다(배선 확인용). 미지정이면 24시드 전량. */
function resolveSeeds(): readonly number[] {
  const raw = process.env.SEEDS;
  if (raw === undefined || raw === '') return BALANCE_SEEDS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return BALANCE_SEEDS;
  return BALANCE_SEEDS.slice(0, Math.min(n, BALANCE_SEEDS.length));
}

function pct(x: number): string {
  return x.toFixed(1).padStart(6);
}

function main(): void {
  const seeds = resolveSeeds();
  // 24시드에서 관측된 0 은 **진짜 클리어 불가와 표본에 승리가 없음을 구분하지 못한다.**
  // `ESCALATE=1` 이면 0 인 기지만 96시드로 승격해 재판정한다(첫 승리에서 끊으므로 이길 수
  // 있는 기지는 싸고, 정말 못 이기는 기지만 72런을 다 돈다).
  const escalate = process.env.ESCALATE === '1';
  console.log('=== invasion band measurement (ADR-0051 tool, no assertions) ===');
  console.log(`seeds: ${seeds.length} (of ${BALANCE_SEEDS.length}) -> [${seeds.join(', ')}]`);
  console.log(`escalate zero-clear bases to 96 seeds: ${escalate ? 'yes' : 'no (ESCALATE=1)'}`);
  console.log('');

  console.log('--- band clear rates ---');
  console.log('band | rate%  | design band | per-base rates');
  const design: Record<BandName, string> = {
    하위: '>=85       ',
    중하: '55..80     ',
    중위: '25..55     ',
  };
  const labels: Record<BandName, string> = { 하위: 'LOW ', 중하: 'MID-', 중위: 'MID+' };
  const bandNames = Object.keys(BANDS) as BandName[];
  for (const band of bandNames) {
    const orders: readonly number[] = BANDS[band];
    const stat = measureBand(orders, seeds);
    const per = stat.perBaseRates.map((r, i) => `#${orders[i]}=${r.toFixed(1)}`).join(' ');
    console.log(`${labels[band]} | ${pct(stat.winRate)} | ${design[band]} | ${per}`);
    console.log(
      `     | per-base winrate sd ${stdev(stat.perBaseRates).toFixed(2)}pp` +
        ` | per-base clear-tick sd ${Math.round(stdev(stat.perBaseMeanTicks))}`,
    );
    // "클리어 불가 기지"는 밴드 평균이 목표 안이어도 성립할 수 있는 별도 신호다 — 그래서
    // 평균과 따로 찍는다. 24시드 0 은 **진짜 클리어 불가와 표본에 승리가 없음을 구분하지
    // 못한다**(승률 6.25% 기지가 0 으로 보일 확률 약 21%). 판정하려면 그 기지만 96시드로
    // 승격해 재판정하라 — `escalatedWinRate`(src/bench/invasionBands.ts).
    const zero = orders.filter((_, i) => stat.perBaseRates[i] === 0);
    if (zero.length > 0) {
      console.log(`     | WARNING zero-clear bases: ${zero.map((nn) => `#${nn}`).join(' ')}`);
      if (escalate) {
        for (const nn of zero) {
          const w = escalatedWinRate(nn);
          console.log(
            `     |   #${nn} escalated to 96 seeds: ${w > 0 ? 'WINNABLE' : 'NO WIN FOUND'}`,
          );
        }
      } else {
        console.log('     |   (set ESCALATE=1 to re-judge these at 96 seeds)');
      }
    }
  }
  console.log('');

  console.log(`--- roster interference (non-striker ships, rangeAdd ${ROSTER_GATE_RANGE_ADD}) ---`);
  console.log('contract to eyeball: neither 0% nor 100% for any ship on any base');
  const gateBases = BANDS.중위;
  console.log(`base | ${NON_STRIKER_SHIP_TYPES.map((s) => `ship${s}`.padStart(6)).join(' ')}`);
  for (const nn of gateBases) {
    const rates = NON_STRIKER_SHIP_TYPES.map((s) => rosterGateRate(s, nn, seeds));
    const lo = Math.min(...rates);
    const hi = Math.max(...rates);
    console.log(
      `#${String(nn).padStart(3)} | ${rates.map(pct).join(' ')}` +
        `   (${lo.toFixed(1)}~${hi.toFixed(1)}, width ${(hi - lo).toFixed(1)}pp)`,
    );
  }
  console.log('');
  console.log('done.');
}

main();
