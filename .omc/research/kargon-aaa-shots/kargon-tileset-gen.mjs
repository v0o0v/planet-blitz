#!/usr/bin/env node
/**
 * ⛔ 이 파일은 **더 이상 정본이 아니다.** 카르곤 4차 생성기는 리포 도구로 승격됐다:
 *
 *   메커니즘 : scripts/tileset-gen.mjs
 *   카르곤 값 : scripts/tileset-profiles/kargon.mjs
 *   쓰는 법   : scripts/tileset-profiles/README.md
 *
 *   node scripts/tileset-gen.mjs --planet kargon --out .tmp && \
 *     cmp .tmp/kargon.png assets/tilesets/kargon.png     # 바이트 동일이 회귀 게이트다
 *
 * 승격한 이유: ①앞으로 6~9번 더 돌릴 자산 재생성의 정본이라 `scripts/` 가 맞는 자리다
 * (`scripts/asset-prep.mjs` 와 같은 층). ②`.omc/research/` 판본은 **메인 체크아웃 절대경로**
 * (`D:/ClaudeCowork/shooting/...`)를 하드코딩해 워크트리에서 돌리면 **다른 체크아웃의 자산을
 * 덮어썼다** — 병렬 레인이 도는 지금 그대로 두면 사고가 난다. ③행성별 확산은 팔레트 교체가
 * 본질이라 메커니즘/테마 분리가 필요했다.
 *
 * 여기서 실행하면 아무 일도 하지 않고 위 안내만 출력한다(4차 원본 코드는 git 이력에 있다:
 * `git show bea9f32 -- .omc/research/kargon-aaa-shots/kargon-tileset-gen.mjs`).
 */
console.error(
  '이 생성기는 scripts/tileset-gen.mjs 로 승격됐다.\n' +
    '  node scripts/tileset-gen.mjs --planet kargon [--out <dir>] [--dry-run]\n' +
    '  프로파일: scripts/tileset-profiles/<planet>.mjs (README 참조)',
);
process.exitCode = 1;
