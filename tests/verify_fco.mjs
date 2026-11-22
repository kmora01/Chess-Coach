// Verificación completa de los datos de FCO con el mismo código que usa la web (chess.js + opbook.js).
// Uso: node tests/verify_fco.mjs <book.json descifrado> [fens.aux.json de python-chess]
//   python3 tools/crypt_books.py dec <usuario> <contraseña> books/fco/book.json.enc /tmp/fco.json
import fs from 'node:fs';
import { Chess } from '../vendor/chess.js';
import { OpeningBook } from '../js/opbook.js';

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const aux = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
const op = new OpeningBook(data);
let fails = 0;
const fail = (m) => { if (fails++ < 20) console.error('FALLO:', m); };

// 1) cada jugada del árbol es legal desde su posición y da la posición esperada
for (let n = 1; n < op.size; n++) {
  const parentFen = op.fen(op.parent[n]);
  if (op.isIdea(n)) {
    // jugada de plan: legal con el mismo bando moviendo otra vez
    const f = parentFen.split(' ');
    f[1] = f[1] === 'w' ? 'b' : 'w'; f[3] = '-';
    const c = new Chess(f.join(' '));
    const mv = c.move(op.san[n].slice(2), { strict: false });
    if (!mv) fail(`idea ilegal ${n} ${op.san[n]}`);
    continue;
  }
  const c = new Chess(parentFen);
  let mv = null;
  try { mv = c.move(op.san[n]); } catch { mv = null; }
  if (!mv) { fail(`jugada ilegal en nodo ${n}: ${op.san[n]} en ${parentFen}`); continue; }
  if (mv.from + mv.to + (mv.promotion || '') !== op.uci[n]) fail(`uci distinto en ${n}: ${op.uci[n]} vs ${mv.from}${mv.to}`);
  if (aux) {
    const a = aux.fen[n].split(' '), b = op.fen(n).split(' ');
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[4] !== b[4] || a[5] !== b[5]) fail(`FEN distinta en ${n}: ${aux.fen[n]} / ${op.fen(n)}`);
  }
}
// 2) todas las referencias del texto apuntan a nodos existentes
let textMoves = 0, mainMoves = 0, diags = 0;
for (const ch of data.chapters) for (const s of ch.sections) {
  for (const n of s.nodes || []) if (!(n >= 0 && n < op.size)) fail('título con nodo inválido');
  for (const b of s.blocks) {
    if (b.k === 'main') for (const [n] of b.nodes) { mainMoves++; if (!(n > 0 && n < op.size)) fail('línea principal con nodo inválido'); }
    if (b.k === 'p') for (const sg of b.segs) if (typeof sg === 'object') { textMoves++; if (!(sg.m > 0 && sg.m < op.size)) fail('jugada de texto con nodo inválido'); }
    if (b.k === 'diag') { diags++; if (b.node == null) fail('diagrama sin posición'); else if (b.turn && op.fen(b.node).split(' ')[1] !== b.turn) fail(`turno del diagrama distinto en nodo ${b.node}`); }
  }
}
// 3) la etiqueta de cada jugada del texto coincide con la jugada enlazada (mismo SAN salvo jaque/anotación)
let labelMismatch = 0;
const norm = (s) => s.replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O').replace(/[+#!?]/g, '');
for (const ch of data.chapters) for (const s of ch.sections) for (const b of s.blocks) if (b.k === 'p') for (const sg of b.segs) {
  if (typeof sg !== 'object') continue;
  const san = norm(op.label(sg.m));
  const lab = norm(sg.t.replace(/^\d+(\s*(\.\.\.|…)\s*|\.\s*|\s+)/, '').replace(/^(\.\.\.|…)/, ''));
  if (san !== lab) { labelMismatch++; fail(`etiqueta "${sg.t}" enlazada a ${op.san[sg.m]}`); }
}
console.log(`nodos ${op.size} · línea principal ${mainMoves} · jugadas en el texto ${textMoves} · diagramas ${diags} · etiquetas distintas ${labelMismatch}`);
console.log(fails ? `${fails} FALLOS` : 'OK: todas las jugadas son legales y coinciden con python-chess');
process.exit(fails ? 1 : 0);
