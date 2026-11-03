# Chess Coach ♞

Entrenador de ajedrez interactivo basado en libros de partidas comentadas. Es un sitio estático
(HTML + JavaScript, sin servidor) pensado para GitHub Pages.

## Qué hace

- **Biblioteca por capítulos**: cada libro es un capítulo con su lista de partidas.
- **Revisión**: recorre la partida jugada a jugada (botones o flechas ← →) con los comentarios del
  libro junto a cada jugada. Las variantes que aparecen dentro de los comentarios son clicables y
  se muestran en el tablero.
- **Entrenador**: eliges color, haces tú las jugadas del libro y la aplicación responde con el otro
  bando. Si fallas, te deja reintentar, pedir una pista o ver la jugada, y Stockfish compara tu
  jugada con la del libro. Guarda tu mejor porcentaje por partida (en tu navegador).
- **Análisis con Stockfish 17.1**: en cualquier momento puedes activar el motor (barra de
  evaluación, 3 mejores líneas y flecha con la mejor jugada) o pulsar *Analizar posición* para
  mover piezas libremente desde la posición actual. También hay una página de *Análisis libre*
  donde puedes pegar cualquier FEN.

## Componentes (todos incluidos en `vendor/`, sin CDN)

| Pieza | Proyecto | Licencia |
|---|---|---|
| Tablero | [chessground](https://github.com/lichess-org/chessground) 10.0.2 (el tablero de lichess.org) | GPL-3.0 |
| Reglas / legalidad | [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 | BSD-2 |
| Motor | [Stockfish 17.1 WASM](https://github.com/nmrugg/stockfish.js), versión *lite single-thread* | GPL-3.0 |

La versión de un solo hilo de Stockfish funciona en GitHub Pages sin cabeceras especiales.

## Probarlo en local

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

(Hace falta un servidor; abrir `index.html` directamente con `file://` no carga los módulos.)

## Publicar en GitHub Pages

Settings → Pages → *Source*: **GitHub Actions**. El flujo `.github/workflows/pages.yml` publica el sitio en cada push a `main`.

Dirección: https://kmora01.github.io/Chess-Coach/

## Añadir un libro nuevo (capítulo)

1. Crea `books/<id>/book.json` (título, autor, `hero` = jugador protagonista, `pgn`).
2. Pon las partidas en `books/<id>/games.pgn` (PGN estándar; comentarios entre `{ }`,
   variantes entre `( )`, cabecera opcional `[Title "..."]` con el lema de la partida).
3. Añade el libro a `books/index.json`.

Para libros escaneados en PDF, `tools/` contiene el proceso usado con *My 60 Memorable Games*:

```bash
pip install rapidocr onnxruntime opencv-python-headless pillow chess
# 1) OCR página a página (sustituye las figuras ♔♕♖♗♘ por letras antes de leer)
python3 tools/ocr_pages.py libro.pdf ocr/ 1 385
# 2) Reconstruye las partidas validando cada jugada con python-chess
python3 tools/extract_book.py ocr/ books/<id>/games.pgn --corrections tools/corrections-<id>.json
```

El extractor informa de cada jugada que no puede validar (página y motivo). Esas se corrigen
a mano en el archivo `corrections-<id>.json` y se vuelve a ejecutar.

## Aviso sobre los textos

Las jugadas de las partidas son de dominio público, pero los comentarios de los libros tienen
derechos de autor. Si el repositorio es público, los comentarios quedan publicados.
