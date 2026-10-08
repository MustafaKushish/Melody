#!/usr/bin/env bash
# Builds a self-contained demo (no server needed): accounts and payments are simulated in the browser.
# Usage: tools/build-demo.sh [output-dir]   (default: dist/demo) – then host the folder on any static host.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist/demo}"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -r css js icons catalog podcasts legal vendor manifest.webmanifest sw.js "$OUT/"
sed 's/<html lang="de">/<html lang="de" data-demo="1">/' index.html > "$OUT/index.html"
# Variant without the document skeleton, for hosts that wrap the page themselves.
python3 - "$OUT" <<'PY'
import re, sys
out = sys.argv[1]
html = open('index.html').read()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
head = re.sub(r'\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>|\s*<link rel="manifest"[^>]*>', '', head)
open(f'{out}/embed.html', 'w').write('<script>document.documentElement.dataset.demo="1";document.documentElement.lang="de";</script>\n' + head.strip() + '\n' + body.strip() + '\n')
PY
echo "Demo gebaut: $OUT"
