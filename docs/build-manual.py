"""Renders docs/manual-usuario.<lang>.md to manager/static/help/manual.<lang>.html, the page the Studio
shows in its Ayuda (Help) section. Run it after editing the manual:  python3 docs/build-manual.py
Needs the markdown package on this machine (pip install markdown); the Studio image doesn't."""
import glob
import os
import re

import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "manager", "static", "help")

for src in sorted(glob.glob(os.path.join(ROOT, "docs", "manual-usuario.*.md"))):
    lang = re.match(r"manual-usuario\.(.+)\.md$", os.path.basename(src)).group(1)
    with open(src, encoding="utf-8") as f:
        text = f.read().replace("[TOC]\n", "")
    md = markdown.Markdown(extensions=["tables", "toc", "sane_lists"],
                           extension_configs={"toc": {"toc_depth": "2-2", "slugify": lambda value, sep: "manual-" + markdown.extensions.toc.slugify(value, sep)}})
    body = md.convert(text)
    # Bare web addresses become links that open in a new tab
    body = re.sub(r'(?<![">])(https?://[^\s<]+[^\s<.,;:)])', r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>', body)
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"manual.{lang}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"<!-- Generated from docs/manual-usuario.{lang}.md by docs/build-manual.py: edit the .md, not this file -->\n")
        f.write(f'<nav class="manual-toc" data-manual-toc>{md.toc}</nav>\n<article class="manual" data-manual-body>\n{body}\n</article>\n')
    print("written", os.path.relpath(out, ROOT))
