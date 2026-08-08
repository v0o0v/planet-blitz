/**
 * 촉매 통지의 **렌더 쪽 해석**(ADR-0052 헌장 §가시성 규율 · §귀속 규율).
 *
 * sim 은 "어느 촉매가 무슨 종류의 사건을 어디서 냈다"까지만 말한다(`src/sim/catalyst/fx.ts`).
 * 그 종류를 **소리·색**으로 옮기는 것이 이 파일이고, 순수 함수라 GL 없이 테스트가 매핑을
 * 직접 못 박는다(`render/audio.ts` 의 `sampleKeyFor` 와 같은 규율).
 *
 * ⚠️ 이 파일은 `src/sim/` 을 값으로 import 하지 않는다 — 종류 코드는 **숫자**라 리터럴로 적는다
 * (`soundScape.ts` 가 `BK_NONE` 을 리터럴로 두는 것과 같은 형태). 코드값 정본은 sim 쪽
 * `CATALYST_FX` 이고, 아래 상수가 그것과 어긋나면 `tests/catalystFx.test.ts` 가 빨개진다.
 */

import type { SoundName } from './audio.js';

/** `CATALYST_FX.trigger` — 카드 발동. */
export const FX_TRIGGER = 0;
/** `CATALYST_FX.selfHarm` — 촉매가 플레이어를 다치게 했다. */
export const FX_SELF_HARM = 1;
/** `CATALYST_FX.credit` — 조건을 만족해 벌었다. */
export const FX_CREDIT = 2;
/** `CATALYST_FX.miss` — 조건 미달로 놓쳤다. */
export const FX_MISS = 3;

/**
 * 통지 종류 → 사운드 이름. **자해가 발동과 갈리는 것이 이 함수의 핵심**이다
 * (헌장 §귀속 규율 3 — *"촉매 유래 자해는 적 피해와 다른 색·다른 사운드"*).
 *
 * `credit`/`miss` 는 **소리를 내지 않는다**(`null`). 적립은 이미 자원 픽업음이 울리는 축이라
 * 겹치면 뭉개지고, 놓침은 매 틱 날 수 있어 소리로 알리면 소음이 된다 — 그 둘의 신호는 정산
 * 명세와 HUD 가 진다.
 */
export function catalystFxSound(kind: number): SoundName | null {
  if (kind === FX_TRIGGER) return 'catalystFire';
  if (kind === FX_SELF_HARM) return 'catalystSelfHarm';
  return null;
}

/**
 * 이 통지가 **HUD 슬롯을 번쩍여야** 하는가(헌장 §귀속 규율 1 — *"이펙트가 무엇이든 어느
 * 카드인지가 화면 한 곳에서 항상 읽힌다"*).
 *
 * 넷 다 참이다 — 귀속의 요점이 "지금 화면에 벌어진 일의 주인이 누구인가"라, 놓침조차 어느
 * 카드가 놓쳤는지 보여야 다음 판에 그 조건을 추구한다. 그런데도 함수로 두는 이유는 종류가
 * 늘었을 때(예: 순수 내부 계측) 여기 한 곳만 고치면 되기 때문이다.
 */
export function catalystFxFlashesSlot(kind: number): boolean {
  return kind === FX_TRIGGER || kind === FX_SELF_HARM || kind === FX_CREDIT || kind === FX_MISS;
}
