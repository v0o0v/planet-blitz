/**
 * SFX 실음원 존재 검사 — 매니페스트가 가리키는 파일이 실제로 있는가.
 *
 * ## 왜 필요한가 — 파일이 없어도 아무도 안 죽는다
 *
 * `SFX_URLS` 는 `import.meta.glob` 이라 **실재하는 파일만** 잡는다(그래야 파일이 없어도 빌드가
 * 안 깨진다). 그 관대함의 대가가 이것이다: 리네임·오타·자산 누락이 **빌드도 테스트도 통과하고
 * 그 소리만 조용히 사라진다.** 아무 예외도 없고 콘솔에 한 줄도 안 남는다.
 *
 * 대부분의 SFX 는 절차 합성 폴백이 있어 "덜 좋은 소리"로 끝나지만, **일일 보상 개봉음은
 * 폴백이 없다**(`SoundName` 짝을 일부러 안 만들었다 — 이 리포는 절차 합성 SFX 가 전원 거부된
 * 전례가 있어 파일이 없으면 무음이 옳다고 정했다). 그래서 그 축에서는 파일 누락이 곧
 * **기능 소멸**이고, 그것을 잡는 곳이 여기뿐이다.
 *
 * ## 왜 소스를 파싱하나
 *
 * `SFX_MANIFEST` 는 export 되지 않는다(모듈 내부 상수여야 한다). 테스트를 위해 export 를 여는
 * 것보다 **소스를 읽는 쪽**이 이 리포의 계약 테스트 관용구이고(`*Contract.test.ts` 전부가
 * 그렇다), 부수적으로 "매니페스트에 적힌 이름"과 "실제 파일 이름"을 같은 자로 재게 된다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const AUDIO_SRC = fileURLToPath(new URL('../src/render/audio.ts', import.meta.url));
const SFX_DIR = fileURLToPath(new URL('../assets/audio/sfx/', import.meta.url));

/**
 * 폴더에 실재하는 `.ogg` 목록.
 *
 * ⚠️ `existsSync` 를 쓰지 않는다 — 이 저장소의 `node:fs` 타입 shim 에 그 export 가 없어
 * `tsc --noEmit` 이 빨개진다(vitest 는 통과하므로 테스트만 돌리면 못 잡는다).
 */
function presentFiles(): Set<string> {
  return new Set(readdirSync(SFX_DIR).filter((f) => f.endsWith('.ogg')));
}

/** `SFX_MANIFEST` 의 `<key>: { file: '<name>.ogg', ... }` 를 전부 뽑는다. */
function manifestEntries(): { key: string; file: string }[] {
  const src = new TextDecoder().decode(readFileSync(AUDIO_SRC));
  const at = src.indexOf('const SFX_MANIFEST');
  expect(at, 'SFX_MANIFEST 선언을 찾지 못했다 — 이 테스트의 전제가 깨졌다').toBeGreaterThan(-1);
  const end = src.indexOf('\n};', at);
  expect(end, 'SFX_MANIFEST 종결자를 찾지 못했다').toBeGreaterThan(at);
  const block = src.slice(at, end);
  const out: { key: string; file: string }[] = [];
  for (const m of block.matchAll(/(\w+)\s*:\s*\{\s*file:\s*'([^']+)'/g)) {
    const key = m[1];
    const file = m[2];
    if (key !== undefined && file !== undefined) out.push({ key, file });
  }
  return out;
}

describe('SFX 실음원 — 매니페스트와 파일이 일치한다', () => {
  const entries = manifestEntries();

  it('파서가 헛돌지 않았다 — 매니페스트 항목을 실제로 읽었다', () => {
    // 이 앵커가 없으면 정규식이 하나도 못 잡았을 때 아래 루프가 **공집합을 돌며 통과**한다.
    expect(entries.length).toBeGreaterThanOrEqual(8);
    expect(entries.map((e) => e.key)).toContain('dailyReward');
  });

  it('매니페스트가 가리키는 파일이 전부 존재한다', () => {
    // 없으면 `import.meta.glob` 이 그 항목을 조용히 건너뛴다 — 빌드도 통과하고 콘솔도 조용하다.
    const present = presentFiles();
    for (const e of entries) {
      expect(present.has(e.file), `${e.key} → ${e.file} 이 없다`).toBe(true);
    }
  });

  it('개봉음은 절차 합성 폴백이 없으므로 파일 부재가 곧 기능 소멸이다', () => {
    // 다른 키와 달리 이 키에는 `sampleKeyFor` 매핑이 없다(= `play()` 경로가 아니다).
    // 그래서 파일이 사라지면 "덜 좋은 소리"가 아니라 **아무 소리도 없는 상태**가 된다.
    const daily = entries.find((e) => e.key === 'dailyReward');
    expect(daily, '개봉음이 매니페스트에서 사라졌다').toBeDefined();
    expect(presentFiles().has(daily?.file ?? '')).toBe(true);
    const src = new TextDecoder().decode(readFileSync(AUDIO_SRC));
    expect(src, '개봉음에 SoundName 짝이 생겼다 — 절차 합성으로 떨어지는 경로가 열린다').not.toMatch(
      /case 'dailyReward'/,
    );
  });

  it('폴더에 매니페스트가 모르는 고아 파일이 없다', () => {
    // 고아는 그 자체로 해롭지 않지만, 리네임 실수의 잔재이거나 "넣었는데 안 울린다"의
    // 정확한 형상이다. 라이선스 추적(CREDITS.md)도 매니페스트 기준이라 고아는 표에서 샌다.
    const known = new Set(entries.map((e) => e.file));
    const orphans = [...presentFiles()].filter((f) => !known.has(f));
    expect(orphans, `매니페스트에 없는 파일: ${orphans.join(', ')}`).toEqual([]);
  });
});
