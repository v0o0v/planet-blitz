# BGM 트랙 크레딧 · 라이선스 관리 (사운드 풍성화 Phase 3, ADR-0029)

Planet Blitz 는 SFX 를 절차 합성(`src/render/audio.ts`)하지만 **BGM 만 외부 트랙**을 쓰는
하이브리드 정책이다(ADR-0029). 이 문서는 그 외부 트랙의 출처·라이선스·확보 상태를 추적한다.

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

## 교체·추가 시 체크리스트

1. 로열티프리/CC0/상업 라이선스 트랙을 고른다(AI 생성 음악 금지).
2. ogg + mp3 두 포맷으로 변환해 `assets/audio/` 에 위 basename 으로 저장한다.
3. 위 표의 "저작자"·"라이선스"·"출처" 칸을 갱신한다(라이선스 URL·영수증 링크 포함).
4. 지속 존 트랙은 **seamless loop**(시작/끝 이음매 없음)로 편집한다 — `musicDirector` 가
   `AudioBufferSourceNode.loop=true` 로 반복하므로 루프 포인트가 튀면 그대로 들린다.
5. 용량은 트랙당 약 1~2MB 이내를 권장한다(초기 로딩·번들 영향, R3). 지연 로딩이라 초기 청크에는
   포함되지 않지만 실행 중 fetch 부담을 줄인다.
