// Verificación de Winning Chess Middlegames (Sokolov) con el mismo código que usa la web.
// Uso: node tests/verify_sokolov.mjs <games.pgn descifrado> [extra.json.diags.json] [planes.json]
//   python3 tools/crypt_books.py dec <usuario> <contraseña> books/sokolov/games.pgn.enc /tmp/s.pgn
// Comprueba: 1) todas las jugadas de las partidas son legales; 2) cuántas jugadas numeradas de los
// comentarios quedan enlazadas al tablero; 3) cada diagrama del libro coincide con la línea principal
// o con alguna posición de las variantes enlazadas del comentario en ese punto.
import fs from 'node:fs';
import { splitGames, parseGame, mainline } from '../js/pgn.js';
import { renderComment } from '../js/comments.js';

const pgn = fs.readFileSync(process.argv[2], 'utf8');
const diags = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
const plans = process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8')) : null;
const NUMMOVE = /(?<![\w.\-])(\d{1,3})(?:\s*(?:\.\.\.|…)\s*|\.\s*)(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?(?:[18]=?[QRBN]|[1-8]))/g;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// 4) los planes en español: toda jugada numerada tiene que ser legal (desde la partida o desde la
//    posición inicial) y quedar enlazada; si no, es un error de redacción y la prueba falla.
let planMoves = 0, planBad = 0;
function checkPlan(where, text, fensByPly, ply) {
  for (const para of text.split('\n')) {
    const nums = [...para.matchAll(NUMMOVE)];
    if (!nums.length) continue;
    const html = renderComment(para, fensByPly, ply, [], { numberedOnly: true });
    const starts = (html.match(/class="cm-move" data-var="\d+">\d+[.…]/g) || []).length;
    planMoves += nums.length;
    if (starts < nums.length) { planBad += nums.length - starts; console.error(`PLAN ${where}: ${nums.length - starts} jugada(s) sin validar · ${para.slice(0, 200)}`); }
  }
}
if (plans) {
  if (plans.book) checkPlan('libro', plans.book, { 0: START }, 0);
  for (const [k, t] of Object.entries(plans.chapters || {})) checkPlan('capítulo ' + k, t, { 0: START }, 0);
  for (const [k, t] of Object.entries(plans.structures || {})) checkPlan('estructura ' + k, t.text || '', { 0: START }, 0);
}
let fails = 0, games = 0, moves = 0, numbered = 0, linkedStarts = 0, linkedMoves = 0;
const unlinked = [];
let dOk = 0, dVar = 0, dBad = 0;
const badDiags = [];
const place = (fen) => fen.split(' ')[0];

for (const text of splitGames(pgn)) {
  const g = parseGame(text);
  games++;
  const id = g.headers.Round;
  if (g.errors.length) { fails++; console.error('FALLO', id, g.errors.slice(0, 3)); }
  const ml = mainline(g.root);
  moves += ml.length;
  const fensBefore = [g.root.fen, ...ml.map((m) => m.fen)];
  const fensByPly = {};
  fensBefore.forEach((f, i) => { fensByPly[g.root.ply + i] = f; });
  const regByPly = {};
  const nodes = [g.root, ...ml];
  nodes.forEach((m, k) => {
    if (!m.comment) return;
    const reg = [];
    const html = renderComment(m.comment, fensByPly, m.ply, reg, { numberedOnly: true });
    regByPly[k] = reg;
    linkedMoves += reg.length;
    const nums = [...m.comment.matchAll(NUMMOVE)];
    numbered += nums.length;
    const starts = (html.match(/class="cm-move" data-var="\d+">\d+[.…]/g) || []).length;
    linkedStarts += starts;
    if (starts < nums.length && unlinked.length < 400) unlinked.push(`${id} ply ${k}: ${nums.length - starts} sin enlazar · ${m.comment.slice(0, 160).replace(/\n/g, ' ¶ ')}`);
  });
  if (plans && plans.games && plans.games[id]) checkPlan('partida ' + id, plans.games[id], fensByPly, g.root.ply);
  if (diags && diags[id]) {
    for (const d of diags[id]) {
      const read = d.fen;
      if (place(fensBefore[d.ply]) === read && !d.analysis) { dOk++; continue; }
      // un diagrama de análisis enseña una posición de las variantes del comentario en ese punto
      // (o de la jugada anterior, cuando el diagrama va justo antes de la jugada comentada)
      const reg = [...(regByPly[d.ply] || []), ...(regByPly[d.ply - 1] || []), ...(regByPly[d.ply + 1] || [])];
      if (reg.some((r) => place(r.fen) === read) || fensBefore.some((f) => place(f) === read)) { dVar++; continue; }
      dBad++;
      badDiags.push(`${id} ply ${d.ply}${d.analysis ? ' (análisis)' : ''}: ${read}`);
    }
  }
}
console.log(`partidas=${games} jugadas=${moves} errores=${fails}`);
console.log(`comentarios: jugadas numeradas=${numbered} enlazadas=${linkedStarts} (${(100 * linkedStarts / numbered).toFixed(1)}%), jugadas enlazadas en total=${linkedMoves}`);
if (diags) console.log(`diagramas: línea principal=${dOk} variante=${dVar} sin explicar=${dBad}`);
if (plans) console.log(`planes: jugadas numeradas=${planMoves} sin validar=${planBad}`);
if (planBad) fails++;
if (process.env.VERBOSE) { console.log(unlinked.join('\n')); console.log(badDiags.join('\n')); }
process.exit(fails ? 1 : 0);
