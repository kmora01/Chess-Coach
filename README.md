# Chess Coach ♞

Entrenador de ajedrez interactivo basado en libros de partidas comentadas. Es un sitio estático
(HTML + JavaScript, sin servidor) pensado para GitHub Pages.

## Acceso privado

Los libros están **cifrados** (AES-256-GCM) dentro del repositorio y del sitio: sólo se pueden leer
entrando con usuario y contraseña. La clave se deriva en el navegador (PBKDF2-SHA256, 310.000
iteraciones) y nunca se envía a ningún sitio; sin la contraseña los archivos `*.enc` son ilegibles.
`books/auth.json` sólo contiene la sal y un bloque de comprobación.

- Cambiar usuario/contraseña: `python3 tools/crypt_books.py init <usuario> <contraseña>` y volver a
  cifrar cada libro con `tools/crypt_books.py enc …` (necesitas las fuentes en claro, que se obtienen
  con `tools/crypt_books.py dec …` usando la contraseña anterior).
- Las fuentes en claro nunca se suben (ver `.gitignore`).

## Qué hace

- **Biblioteca por capítulos**: cada libro es un capítulo con su lista de partidas.
- **Revisión**: recorre la partida jugada a jugada (botones o flechas ← →) con los comentarios del
  libro junto a cada jugada. Las variantes que aparecen dentro de los comentarios son clicables y
  se muestran en el tablero.
- **Entrenador**: eliges color, haces tú las jugadas del libro y la aplicación responde con el otro
  bando. Si fallas, te deja reintentar, pedir una pista o ver la jugada, y Stockfish compara tu
  jugada con la del libro. Guarda tu mejor porcentaje por partida (en tu navegador).
- **Libros de aperturas** (*Fundamental Chess Openings*): el texto completo de cada capítulo con
  todas las jugadas enlazadas al tablero, diagramas del libro, **árbol de variantes** navegable
  (← → recorren la línea, ↑ ↓ cambian de variante), flechas con las continuaciones del libro,
  **explorador por posición** (reúne transposiciones y dice en qué capítulos se trata cada posición),
  **índice ECO**, buscador por nombre o jugadas y **entrenador de repertorio** (juegas un bando y la
  aplicación responde con líneas del libro).
- **Botón FCO**: desde cualquier partida o desde el análisis libre abre esa posición en el libro de aperturas.
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

## Cómo se preparó *Fundamental Chess Openings*

El EPUB trae el texto real (sin OCR). `tools/fco/build_all.sh <epub> <usuario> <contraseña>` hace todo:

1. `dump_epub.py` extrae los párrafos en orden (línea principal, texto, diagramas, títulos).
2. `parse_fco.py` reconstruye el árbol: cada jugada se valida con python-chess y además tiene que
   estar escrita exactamente como la notación correcta en esa posición (capturas, desambiguación).
   Para cada variante del texto se elige la posición de partida (línea principal o variante citada
   antes) que valida toda la secuencia; si hay un diagrama, la que lo reproduce exactamente.
   Lo que no se puede validar se queda como texto normal: nunca se publica una jugada ilegal.
3. `check_diagrams.py` lee las 1.621 imágenes de diagramas del libro casilla a casilla y comprueba
   que la posición reconstruida coincide pieza a pieza y en el turno (1.621 de 1.621).
4. `build_fco.py` añade la clasificación ECO (lichess-org/chess-openings, CC0, en `data/eco.json`).
5. `tests/verify_fco.mjs` repite la validación con el mismo código de la web (chess.js).

`overrides-fco.json` guarda las pocas correcciones manuales, todas comprobadas contra su diagrama.

## Añadir un libro nuevo (capítulo)

1. Crea `books/<id>/book.json` (título, autor, `hero` = jugador protagonista, `pgn`).
2. Pon las partidas en `books/<id>/games.pgn` y cífralo a `games.pgn.enc` con `tools/crypt_books.py enc` (PGN estándar; comentarios entre `{ }`,
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
