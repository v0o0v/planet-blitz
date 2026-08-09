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
img { max-width: 100%; border: 1px solid #d0d7e2; border-radius: 4px; display: block;
      margin: 12px auto 2px; page-break-inside: avoid; }
img + em, p > em:only-child { display: block; text-align: center; color: #555;
      font-size: 9.3pt; margin: 2px 0 12px; }
ul, ol { margin: 6px 0; padding-left: 22px; }
li { margin: 3px 0; }
hr { border: none; border-top: 1px solid #ccc; margin: 18px 0; }
"""

DOCS = ["nan2026-game-intro.md", "nan2026-ai-usage.md"]

for name in DOCS:
    src = (HERE / name).read_text(encoding="utf-8")
    body = markdown.markdown(src, extensions=["tables", "fenced_code"])
    html = (
        "<!doctype html><html lang='ko'><head><meta charset='utf-8'>"
        f"<style>{CSS}</style></head><body>{body}</body></html>"
    )
    out = HERE / (name.replace(".md", ".html"))
    out.write_text(html, encoding="utf-8")
    print("wrote", out)
