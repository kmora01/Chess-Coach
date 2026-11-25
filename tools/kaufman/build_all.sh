#!/usr/bin/env bash
# Regenera el libro de Kaufman desde el EPUB. Uso:
#   tools/kaufman/build_all.sh <libro.epub> <usuario> <contraseña>
# Necesita: pip install chess beautifulsoup4 lxml pillow numpy cryptography
# Los planes en español están en books/kaufman/planes.md.enc (cifrados; para editarlos:
#   python3 tools/crypt_books.py dec <usuario> <contraseña> books/kaufman/planes.md.enc planes.md
#   … editar … y volver a cifrar con "enc" antes de ejecutar este script).
# El texto del libro sólo existe en claro en un directorio temporal; al repo va cifrado.
set -euo pipefail
EPUB="$1"; USER_="$2"; PASS="$3"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
unzip -q "$EPUB" -d "$TMP/epub"
python3 -I "$ROOT/tools/kaufman/parse_kaufman.py" "$TMP/epub" "$TMP/kaufman.json" "$TMP/report.txt"
python3 -I "$ROOT/tools/kaufman/check_diagrams.py" "$TMP/kaufman.json" "$TMP/epub/OEBPS/Images" "$TMP/diagrams.txt"
python3 "$ROOT/tools/crypt_books.py" dec "$USER_" "$PASS" "$ROOT/books/kaufman/planes.md.enc" "$TMP/planes.md"
python3 -I "$ROOT/tools/kaufman/planes.py" "$TMP/planes.md" "$TMP/planes.json"
python3 -I "$ROOT/tools/kaufman/build_kaufman.py" "$TMP/kaufman.json" "$TMP/diagrams.txt.json" "$TMP/planes.json" "$TMP/games.pgn" "$TMP/extra.json"
node "$ROOT/tests/verify_kaufman.mjs" "$TMP/games.pgn" "$TMP/extra.json.diags.json" "$TMP/planes.json"
python3 "$ROOT/tools/crypt_books.py" enc "$USER_" "$PASS" "$TMP/games.pgn" "$ROOT/books/kaufman/games.pgn.enc"
python3 "$ROOT/tools/crypt_books.py" enc "$USER_" "$PASS" "$TMP/extra.json" "$ROOT/books/kaufman/extra.json.enc"
echo "Informes en $TMP (report.txt, diagrams.txt). Bórralo cuando termines: contiene el texto en claro."
