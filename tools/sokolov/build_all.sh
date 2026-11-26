#!/usr/bin/env bash
# Regenera Winning Chess Middlegames (Sokolov) desde el texto extraído del PDF. Uso:
#   tools/sokolov/build_all.sh <libro.txt> <usuario> <contraseña> [planes.md]
# Necesita: pip install chess wordfreq pyphen cryptography
# Las explicaciones en español están en books/sokolov/planes.md.enc (cifradas). Para editarlas:
#   python3 tools/crypt_books.py dec <usuario> <contraseña> books/sokolov/planes.md.enc planes.md
#   … editar … y pasar planes.md como 4º argumento (este script lo vuelve a cifrar).
# El texto del libro sólo existe en claro en un directorio temporal; al repo va cifrado.
set -euo pipefail
TXT="$1"; USER_="$2"; PASS="$3"; PLANES="${4:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
python3 -I "$ROOT/tools/sokolov/parse_sokolov.py" "$TXT" "$TMP/sokolov.json" "$TMP/report.txt"
if [ -n "$PLANES" ]; then
  cp "$PLANES" "$TMP/planes.md"
  python3 "$ROOT/tools/crypt_books.py" enc "$USER_" "$PASS" "$PLANES" "$ROOT/books/sokolov/planes.md.enc"
else
  python3 "$ROOT/tools/crypt_books.py" dec "$USER_" "$PASS" "$ROOT/books/sokolov/planes.md.enc" "$TMP/planes.md"
fi
python3 -I "$ROOT/tools/sokolov/planes.py" "$TMP/planes.md" "$TMP/planes.json"
python3 -I "$ROOT/tools/sokolov/build_sokolov.py" "$TMP/sokolov.json" "$TMP/planes.json" "$TMP/games.pgn" "$TMP/extra.json"
node "$ROOT/tests/verify_sokolov.mjs" "$TMP/games.pgn" "$TMP/extra.json.diags.json" "$TMP/planes.json"
python3 "$ROOT/tools/crypt_books.py" enc "$USER_" "$PASS" "$TMP/games.pgn" "$ROOT/books/sokolov/games.pgn.enc"
python3 "$ROOT/tools/crypt_books.py" enc "$USER_" "$PASS" "$TMP/extra.json" "$ROOT/books/sokolov/extra.json.enc"
echo "Informes en $TMP (report.txt). Bórralo cuando termines: contiene el texto en claro."
