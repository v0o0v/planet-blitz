#!/usr/bin/env node
/**
 * env-verify 스크린샷 수신 서버.
 *
 * ## 왜 서버인가
 * 배경 검증은 "브라우저가 실제로 합성한 픽셀"을 Node 로 가져와야 성립한다. 그런데
 * 1920×1080 PNG 의 data URL 은 수 MB 라 브라우저 도구의 반환값으로 실어 나르면 컨텍스트가
 * 터진다. 그래서 페이지가 캡처한 PNG 를 **localhost 로 POST** 하게 하고, 이 서버가 디스크에
 * 쓴다. 분석(`analyze.mjs`)은 디스크의 PNG 만 읽는다.
 *
 * 읽기 없음·localhost 바인드·PNG 쓰기만 한다(검증 전용, 프로덕션 무관).
 *
 * 사용법:
 *   node scripts/env-verify/shot-server.mjs [--port 5181] [--out .omc/research/env-shots]
 *
 * 엔드포인트:
 *   GET  /ping                 → `{"ok":true,"out":"<절대경로>"}`
 *   POST /shot?name=<라벨>     → 본문이 `data:image/png;base64,...` 또는 순수 base64.
 *                                `<out>/<라벨>.png` 로 쓰고 `{"ok":true,"bytes":N}` 반환.
 *
 * `name` 은 파일명이 되므로 `[A-Za-z0-9._-]` 만 허용한다(경로 탈출 방지).
 */

import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('--port', '5181'));
const OUT = resolve(arg('--out', '.omc/research/env-shots'));
mkdirSync(OUT, { recursive: true });

/** 파일명 안전 문자만 통과시킨다 — `name` 은 클라이언트가 주는 값이다. */
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

const server = createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, out: OUT }));
    return;
  }
  if (url.pathname === '/shot' && req.method === 'POST') {
    const name = url.searchParams.get('name') ?? '';
    if (!SAFE_NAME.test(name)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `unsafe name: ${name}` }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const b64 = text.startsWith('data:') ? text.slice(text.indexOf(',') + 1) : text;
        const buf = Buffer.from(b64, 'base64');
        // PNG 매직으로 형식을 확인한다 — 빈 캔버스/오류 문자열이 조용히 저장되면
        // 분석이 "차이 0"을 내며 통과한다(검증 도구가 항진하는 전형적 경로).
        if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'not a PNG', bytes: buf.length }));
          return;
        }
        const file = join(OUT, `${name}.png`);
        writeFileSync(file, buf);
        process.stdout.write(`[shot] ${name}.png ${buf.length}B\n`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, bytes: buf.length, file }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`[shot-server] http://127.0.0.1:${PORT} → ${OUT}\n`);
});
