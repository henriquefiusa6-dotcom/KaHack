#!/usr/bin/env bash
# Gera o clipa-standalone.html: um único arquivo com CSS + JS embutidos,
# que funciona aberto direto do disco (file://), sem servidor.
#
# Uso: ./build-standalone.sh   (requer Node.js 18+ e acesso ao npm)
set -euo pipefail
cd "$(dirname "$0")"

BUNDLE="$(mktemp -t clipa-bundle-XXXXXX.js)"
trap 'rm -f "$BUNDLE"' EXIT

echo "→ empacotando js/app.js…"
npx --yes esbuild js/app.js --bundle --format=iife --target=es2020 --outfile="$BUNDLE" --log-level=warning

echo "→ embutindo CSS e JS no HTML…"
BUNDLE="$BUNDLE" python3 - <<'PY'
import os
html = open('index.html').read()
css = open('css/styles.css').read()
js = open(os.environ['BUNDLE']).read()

out = html.replace(
    '  <link rel="stylesheet" href="css/styles.css" />',
    '  <style>\n' + css + '\n  </style>',
).replace(
    '  <script type="module" src="js/app.js"></script>',
    '  <script>\n' + js + '\n  </script>',
).replace(
    '<title>Clipa — editor de vídeo no navegador</title>',
    '<title>Clipa — editor de vídeo (arquivo único)</title>',
)

assert 'css/styles.css' not in out, 'CSS não foi embutido'
assert 'src="js/app.js"' not in out, 'JS não foi embutido'
open('clipa-standalone.html', 'w').write(out)
print(f'   {len(out):,} bytes'.replace(',', '.'))
PY

echo "✔ clipa-standalone.html atualizado"
