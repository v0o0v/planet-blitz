# 오디오 크레딧 · 라이선스 관리 (BGM: ADR-0029 · SFX 실음원: 2026-08-05)

Planet Blitz 는 원래 SFX 를 전부 절차 합성(`src/render/audio.ts`)하고 **BGM 만 외부 트랙**을
쓰는 하이브리드였다(ADR-0029). 2026-08-05 사용자 판정("현재 소리는 너무 투박하다" → "공개
사운드 중에 괜찮은걸로 찾아보자")으로 **핵심 SFX 8종도 CC0 실음원**이 됐다. 절차 합성은
지우지 않고 **폴백으로 남겼다** — 아래 §SFX 참조. 이 문서는 두 축의 출처·라이선스를 추적한다.

> **현재 상태: 전부 확보 완료(CC0).** 아래 파일명은 `src/render/musicDirector.ts` 의
> `TRACK_MANIFEST` 이 기대하는 basename 이고, 실제 파일이 `assets/audio/` 에 들어 있어 자동
> 재생된다. 모든 트랙은 **CC0(퍼블릭 도메인)** 이라 저작자 표기 의무가 없으나, 예의상 아래에
> 출처·저작자를 명시한다. `?url` 지연 로딩이라 초기 JS 청크에는 포함되지 않는다.

## 라이선스 정책 (반드시 준수)

- **허용:** 로열티프리 / CC0 / 명확한 상업용 라이선스(구매·구독 포함)만. CrazyGames 상업 배포에
  적합해야 한다.
- **금지: AI 생성 음악(Suno · Udio 등).** 학습 데이터 저작권·라이선스 불확실성 때문에 상업
  배포에 부적합하다. **아래 트랙은 전부 사람이 작곡한 CC0 음원이다(AI 생성 아님).**
- **CrazyGames 상업 배포 책임(ADR-0029):** 모든 트랙이 CC0 라 상업 배포·수정·재배포에 제약이
  없다. CC0 는 저작자 표기 의무가 없지만, 아래 출처 링크를 증빙으로 보존한다. 머지 전 라이선스
  하자 검증(R2) 통과.

## 트랙 목록 (4 지속 존 + 정산 스팅어 2변종 = 6 파일쌍)

각 트랙은 **ogg + mp3** 두 포맷을 둔다(ogg 우선, Safari 등 미지원 시 mp3 폴백). 전부 CC0.

| 용도(존) | 파일명(ogg / mp3) | 트랙 · 성격 | 저작자 | 라이선스 | 출처 |
|---|---|---|---|---|---|
| 메뉴(menu) | `bgm_menu.ogg` / `.mp3` | "Title Screen" — 메타 화면 전체(타이틀·기지·격납고·연구소 등). 잔잔한 인트로 루프(11s). | SubspaceAudio (Juhani Junkala) | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/5-chiptunes-action) · [Archive.org](https://archive.org/details/JuhaniJunkalafiveactionchiptunes) |
| PvE 전투(combatPvE) | `bgm_combat_pve.ogg` / `.mp3` | "Level 1" — 일반 PvE 런 전투. 경쾌한 액션 루프(74s). | SubspaceAudio (Juhani Junkala) | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/5-chiptunes-action) |
| 침공(invasion) | `bgm_invasion.ogg` / `.mp3` | "Level 2" — 침공 런 + 관전. 긴장감 있는 루프(73s). | SubspaceAudio (Juhani Junkala) | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/5-chiptunes-action) |
| 보스(boss) | `bgm_boss.ogg` / `.mp3` | "Level 3" — 보스 등장 클라이맥스. 고조된 루프(82s). | SubspaceAudio (Juhani Junkala) | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/5-chiptunes-action) |
| 정산 승리 스팅어(victory) | `stinger_victory.ogg` / `.mp3` | "Glorious Victory Fanfare (NES)" — 런 승리 정산. NES 팡파레 one-shot(11s). | congusbongus | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/glorious-victory-fanfare-nes) |
| 정산 패배 스팅어(defeat) | `stinger_defeat.ogg` / `.mp3` | "Sad Game Over" — 런 패배 정산. 애상적 피아노 one-shot(원곡 19s → 14s 트림 + 2s 페이드아웃). | Emma_MA | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/sad-game-over) |

> 존은 4개(menu·combatPvE·boss·invasion), 스팅어는 2변종(victory·defeat)이라 트랙 파일은 6종이다.
> 계획 문서의 "5 존"은 지속 존 4 + 정산 스팅어 1묶음(2변종)을 뜻한다(AC1).

## 처리 내역 (재현용)

- **존 4종(Junkala)**: `5 Chiptunes (Action)` 팩의 Title Screen / Level 1 / Level 2 / Level 3 을
  Archive.org 미러의 **Ogg Vorbis · VBR MP3 파생본** 그대로 사용(재인코딩 없음). 전부 seamless loop.
- **승리 스팅어(congusbongus)**: 원본 `victory2.ogg`(mono, 11s) 를 ogg 그대로 두고, mp3 는
  `ffmpeg -codec:a libmp3lame -b:a 128k` 로 변환.
- **패배 스팅어(Emma_MA)**: 원본 `sad_game_over.wav`(stereo, 19s) 를 `ffmpeg -t 14
  -af afade=out:st=12:d=2` 로 14s 트림 + 페이드아웃 후 ogg(libvorbis q4)·mp3(128k) 로 변환.
- 저작자·라이선스가 CC0 라 위 트림·변환·재배포에 제약이 없다.

## SFX 실음원 (`assets/audio/sfx/` — 2026-08-05 사용자 선정)

전부 **Kenney.nl · CC0 1.0(퍼블릭 도메인)** 이다. 상업 배포·수정·재배포에 제약이 없고 저작자
표기 의무도 없으나, 증빙으로 출처를 남긴다. 총 용량 **166KB** — 초기 JS 청크와 무관하다
(`?url` 지연 로딩, `src/render/audio.ts` 의 `SFX_URLS`).

| 용도 | 파일명 | 원본 | 팩 | 사용자 선택 |
|---|---|---|---|---|
| 발사음 · 발칸 | `sfx_shot_vulcan.ogg` | `laserSmall_000.ogg` | Sci-Fi Sounds | L1 |
| 발사음 · 스프레드 | `sfx_shot_spread.ogg` | `laserSmall_003.ogg` | Sci-Fi Sounds | S2 |
| 발사음 · 레일건 | `sfx_shot_railgun.ogg` | `laserLarge_004.ogg` | Sci-Fi Sounds | R3 |
| 발사음 · 미사일 | `sfx_shot_missile.ogg` | `explosionCrunch_002.ogg` | Sci-Fi Sounds | M5 |
| 발사음 · 빔 | `sfx_shot_beam.ogg` | `forceField_003.ogg` | Sci-Fi Sounds | W3 |
| 피격(내 기체) | `sfx_hit.ogg` | `impactMetal_000.ogg` | Sci-Fi Sounds | H1 |
| 렙업 카드 등장 | `sfx_card.ogg` | `confirmation_002.ogg` | Interface Sounds | C3 |
| 보스 예고 루프 | `sfx_boss_warn.ogg` | `forceField_004.ogg` | Sci-Fi Sounds | B3 / P1 |
| 일일 보상 개봉 | `sfx_daily_reward.ogg` | `maximize_004.ogg` | Interface Sounds | M4 |

출처: [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) · [Interface Sounds](https://kenney.nl/assets/interface-sounds) — 둘 다 CC0 1.0.
파일은 **바이트 그대로** 복사했다(리네임만, 재인코딩 없음).

### 일일 보상 개봉음은 연출 길이에 맞춰 골랐다

개봉 연출은 **1.1초**다(`src/ui/pixi/dailyRewardReveal.ts` — 판이 열리고 → 봉인이 깨지고 →
지급물이 올라오고 → 게이지가 찬다). 소리는 연출 **시작 시점에 한 번** 나므로 원본이 그보다
길면 게이지가 다 찬 뒤에도 소리가 남는다. `maximize_004.ogg` 는 **0.418초**(mono 44.1kHz,
실측)라 봉인이 깨지는 구간(120~420ms)과 정확히 겹치고 연출이 끝나기 한참 전에 사라진다.

⚠️ 교체할 때는 **길이를 먼저 재라.** 후보 중 `maximize_005` 가 더 화려했지만 매일 한 번
듣는 소리라 사흘째부터 거슬리는 쪽으로 판단했고, `confirmation_004` 는 렙업 카드음
(`confirmation_002`)과 같은 계열이라 두 사건이 안 구분된다.

⚠️ **`SoundName` 짝을 만들지 않는다.** 호출부(`src/main.ts`)가 `playSample('dailyReward')` 를
직접 부른다 — `play()` 를 쓰면 샘플이 없을 때 절차 합성으로 떨어지는데, 이 리포는 **절차 합성
SFX 가 전원 거부된 전례**가 있다(2026-08-05). 파일이 없으면 무음이 옳다.

### 보스는 "등장음" 이 아니라 "예고 루프" 다

사용자 지시: *"보스 등장 전부터 반복적으로 울리다가 보스가 나오면 사라지는 것으로 하자"*.
그래서 `sfx_boss_warn.ogg` 는 보스 진행도 75% 지점부터 반복되고 다가올수록 간격이 좁혀지며
(2.2s → 0.45s), 보스전이 열리는 순간 **끊긴다**. 그 정적이 곧 등장 신호다 — 별도 등장 스팅어는
**의도적으로 없다**(청취실 X0 선택). 구현은 `src/render/bossWarn.ts`.

### ⚠️ ogg 단일 포맷 — Safari 는 절차 합성으로 떨어진다

BGM 과 달리 SFX 는 **ogg 만** 둔다(원본 팩이 ogg 단일 배포이고, 이 작업 시점 환경에 ffmpeg 가
없었다). Ogg Vorbis 를 디코드하지 못하는 브라우저(주로 Safari)에서는 `decodeAudioData` 가 실패
하고, `GameAudio.play` 가 **기존 절차 합성음으로 조용히 폴백**한다 — 무음이 되지는 않는다.
mp3 를 병행하려면 같은 basename 의 mp3 를 이 폴더에 넣고 `SFX_MANIFEST` 를 BGM 처럼 쌍
(`{ogg, mp3}`)으로 바꾸면 된다.

## 교체·추가 시 체크리스트

1. 로열티프리/CC0/상업 라이선스 트랙을 고른다(AI 생성 음악 금지).
2. ogg + mp3 두 포맷으로 변환해 `assets/audio/` 에 위 basename 으로 저장한다.
3. 위 표의 "저작자"·"라이선스"·"출처" 칸을 갱신한다(라이선스 URL·영수증 링크 포함).
4. 지속 존 트랙은 **seamless loop**(시작/끝 이음매 없음)로 편집한다 — `musicDirector` 가
   `AudioBufferSourceNode.loop=true` 로 반복하므로 루프 포인트가 튀면 그대로 들린다.
5. 용량은 트랙당 약 1~2MB 이내를 권장한다(초기 로딩·번들 영향, R3). 지연 로딩이라 초기 청크에는
   포함되지 않지만 실행 중 fetch 부담을 줄인다.
