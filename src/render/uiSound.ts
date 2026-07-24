/**
 * 메타 UI 사운드 훅 (사운드 풍성화 Phase 2 — AC16).
 *
 * 메타 화면의 상호작용(버튼 탭·네비게이션·확인/취소·축하)에 의미 범주 소수(4~5종)의 UI 음을
 * 낸다. 모든 UI 음은 `ui` 버스로 라우팅된다(audio.ts busFor). 절차 합성 SFX 와 동일하게
 * 순수 render 레이어다 — sim 은 이 모듈을 모른다(ADR-0005).
 *
 * ── 왜 싱글턴 훅인가 ── 공유 컴포넌트({@link PixiButton})와 수십 개 화면이 UI 음을 내야 하는데,
 * 각 생성부에 {@link GameAudio} 를 실어 나르면 배선 표면이 폭발한다(회귀 위험). UI 피드백 사운드는
 * 앱당 단일 사운드 보드로 흐르는 전형적 크로스컷 관심사라, main.ts 가 {@link setUiAudio} 로 한 번
 * 주입하고 UI 코드는 {@link playUi} 만 부른다(오디오 소유권은 여전히 GameAudio, 여기는 얇은 라우터).
 * 미주입(테스트/부팅 전)이면 조용히 no-op.
 */

import type { GameAudio } from './audio.js';

/** 메타 UI 음 의미 범주(AC16 — navigate·confirm·positive·negative·celebrate). */
export type UiSoundCategory = 'uiNavigate' | 'uiConfirm' | 'uiPositive' | 'uiNegative' | 'uiCelebrate';

/** 주입된 사운드 보드(main.ts 부팅 시 1회 세팅). 미주입이면 UI 음은 no-op. */
let audioRef: GameAudio | null = null;

/** main.ts 부팅에서 1회 호출 — UI 음이 흐를 사운드 보드를 등록한다. */
export function setUiAudio(audio: GameAudio): void {
  audioRef = audio;
}

/**
 * 메타 UI 음 재생(기본 navigate). 미주입(테스트)·음소거·ctx 미준비면 조용히 no-op
 * (GameAudio.play 내부 가드 + VoiceAllocator 스로틀로 연타 폭주 방지, AC18).
 */
export function playUi(category: UiSoundCategory = 'uiNavigate'): void {
  audioRef?.play(category);
}
