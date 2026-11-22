#!/usr/bin/env bash
# Regenera el libro FCO desde el EPUB. Uso:
#   tools/fco/build_all.sh <libro.epub> <usuario> <contraseña>
# Necesita: pip install chess beautifulsoup4 lxml pillow numpy cryptography
# El texto del libro sólo existe en claro en un directorio temporal; al repo va cifrado.
set -euo pipefail
EPUB="$1"; USER_="$2"; PASS="$3"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
unzip -q "$EPUB" -d "$TMP/epub"
python3 -I "$ROOT/tools/fco/dump_epub.py" "$TMP/epub" "$TMP/blocks.json"
python3 -I "$ROOT/tools/fco/parse_fco.py" "$TMP/blocks.json" "$TMP/fco.json" "$TMP/report.txt" "$ROOT/tools/fco/diagrams-read.json"
python3 -I "$ROOT/tools/fco/check_diagrams.py" "$TMP/fco.json" "$TMP/epub/OEBPS/Images" "$TMP/diagrams.txt"
python3 -I "$ROOT/tools/fco/build_fco.py" "$TMP/fco.json" "$ROOT/data/eco.json" "$TMP/fco-book.json"
node "$ROOT/tests/verify_fco.mjs" "$TMP/fco-book.json" "$TMP/fco.json.aux.json"
python3 "$ROOT/tools/crypt_books.py" enc "$USER_" "$PASS" "$TMP/fco-book.json" "$ROOT/books/fco/book.json.enc"
echo "Informes en $TMP (report.txt, diagrams.txt). Bórralo cuando termines: contiene el texto en claro."
