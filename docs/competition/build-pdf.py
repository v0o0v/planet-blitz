# -*- coding: utf-8 -*-
"""nan2026 제출 md 2건 → 스타일 HTML → (chrome headless 로) PDF.

사용: python build-pdf.py  →  같은 폴더에 .html 생성 후 chrome --print-to-pdf 는 별도 호출.
"""
import io
import pathlib

import markdown

HERE = pathlib.Path(__file__).parent

CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; color: #1a1a1a;
       font-size: 10.5pt; line-height: 1.62; margin: 0; }
h1 { font-size: 19pt; margin: 0 0 4px; line-height: 1.3; }
h1 + p strong { color: #444; font-weight: 600; }
h2 { font-size: 13.5pt; margin: 22px 0 8px; border-bottom: 2px solid #2b6cb0;
     padding-bottom: 3px; color: #17365d; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 16px 0 6px; color: #2b6cb0; page-break-after: avoid; }
p { margin: 6px 0; }
blockquote { margin: 10px 0; padding: 8px 14px; background: #f2f6fb;
             border-left: 4px solid #2b6cb0; }
blockquote p { margin: 4px 0; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.8pt;
        page-break-inside: avoid; }
th, td { border: 1px solid #c9d4e0; padding: 5px 8px; text-align: left;
         vertical-align: top; word-break: keep-all; }
th { background: #eef3f9; }
code { font-family: Consolas, monospace; font-size: 9.3pt; background: #f4f4f4;
       padding: 1px 4px; border-radius: 3px; }
pre { background: #f4f4f4; padding: 10px 12px; border-radius: 5px; overflow: hidden;
      page-break-inside: avoid; }
pre code { background: none; padding: 0; }
img { max-width: 62%; border: 1px solid #d0d7e2; border-radius: 4px; display: block;
      margin: 10px auto 2px; page-break-inside: avoid; }
img + em, p > em:only-child { display: block; text-align: center; color: #555;
      font-size: 8.8pt; margin: 2px 0 10px; max-width: 76%; margin-left: auto;
      margin-right: auto; line-height: 1.45; }
ul, ol { margin: 6px 0; padding-left: 22px; }
li { margin: 3px 0; }
hr { border: none; border-top: 1px solid #ccc; margin: 18px 0; }

/* 차례 — `[TOC]` 가 만드는 `div.toc` 를 꾸민다.
   제목을 마크다운 헤딩으로 두면 그 헤딩이 차례 자신에 들어가므로 ::before 로 붙인다. */
.toc { page-break-after: always; margin: 0 0 4px; }
.toc::before { content: '차례'; display: block; font-size: 13.5pt; font-weight: 700;
      color: #17365d; border-bottom: 2px solid #2b6cb0; padding-bottom: 3px; margin-bottom: 10px; }
.toc ul { list-style: none; margin: 0; padding-left: 0; }
/* 2단. AI 활용 문서는 항목이 39개라 1단이면 딱 한 줄이 넘쳐 다음 쪽을 통째로 잡아먹었다.
   2단이면 두 문서 모두 여유가 남아 절이 몇 개 늘어도 다시 안 넘친다.
   `break-inside: avoid` 로 한 절의 하위 항목이 단 경계에서 갈라지지 않게 묶는다. */
.toc > ul { column-count: 2; column-gap: 26px; }
.toc > ul > li { margin: 7px 0 0; font-size: 10.5pt; font-weight: 700;
      break-inside: avoid; -webkit-column-break-inside: avoid; word-break: keep-all; }
.toc > ul > li > ul { margin: 2px 0 0; }
/* 긴 항목은 접힌다. `keep-all` 로 한글을 단어 경계에서 끊고(본문 표와 같은 규칙),
   내어쓰기로 접힌 줄이 항목 번호보다 안쪽에서 시작하게 한다. */
.toc > ul > li > ul > li { margin: 1px 0; font-size: 9.6pt; font-weight: 400;
      padding-left: 28px; text-indent: -14px; color: #333; word-break: keep-all; }
.toc a { color: inherit; text-decoration: none; }
"""

DOCS = ["nan2026-game-intro.md", "nan2026-ai-usage.md"]

for name in DOCS:
    src = (HERE / name).read_text(encoding="utf-8")
    # `toc` 는 헤딩에 id 를 달고 `[TOC]` 자리에 목차를 심는다. 깊이는 2~3 — h1 은 문서 제목
    # 이라 넣을 이유가 없고, h4 이하는 없다.
    body = markdown.markdown(
        src,
        extensions=["tables", "fenced_code", "toc"],
        extension_configs={"toc": {"toc_depth": "2-3"}},
    )
    html = (
        "<!doctype html><html lang='ko'><head><meta charset='utf-8'>"
        f"<style>{CSS}</style></head><body>{body}</body></html>"
    )
    out = HERE / (name.replace(".md", ".html"))
    out.write_text(html, encoding="utf-8")
    print("wrote", out)
