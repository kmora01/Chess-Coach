// Convierte el texto de un comentario del libro en HTML con las variantes enlazadas.
// Detecta secuencias como "18...gxh5 19 g4! hxg4 20 fxg4" y las valida con chess.js
// partiendo de la posición correspondiente de la partida (o de una variante anterior del mismo comentario).
import { Chess } from '../vendor/chess.js';

const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const MOVE_RE = /^(O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?[+#]?)([!?]{0,2})/;
const NUM_RE = /^(\d{1,3})(\s*(?:\.\.\.|…)\s*|\.\s*|\s+)(?=[KQRBNO0a-h])/;

export function figurine(san) {
  return san.replace(/^([KQRBN])/, (m) => FIG[m]).replace(/=([QRBN])/, (m, p) => '=' + FIG[p]);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// fensBefore[p] = FEN antes de la jugada número p (ply contado desde 0) en la línea principal
export function renderComment(text, fensBefore, contextPly, registry) {
  let out = '';
  let i = 0;
  let run = null; // { fens: {ply: fenBefore}, chess, ply }
  const runs = [];
  let lastWasWord = false;

  const tryStart = (ply) => {
    const candidates = [];
    for (let k = runs.length - 1; k >= 0; k--) {
      const r = runs[k];
      if (r.fens[ply] && ply > r.start) candidates.push(r.fens[ply]);
    }
    if (fensBefore[ply]) candidates.push(fensBefore[ply]);
    for (let k = runs.length - 1; k >= 0; k--) {
      const r = runs[k];
      if (r.fens[ply] && ply === r.start && !candidates.includes(r.fens[ply])) candidates.push(r.fens[ply]);
    }
    return candidates;
  };

  const playOn = (fen, san) => {
    const c = new Chess(fen);
    try { const mv = c.move(san.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O'), { strict: false }); return mv ? { c, mv, before: fen } : null; } catch { return null; }
  };

  const emitMove = (res, label, ply, suffix) => {
    const id = registry.length;
    registry.push({ fen: res.c.fen(), from: res.mv.from, to: res.mv.to, san: res.mv.san, ply });
    return `<span class="cm-move" data-var="${id}">${label}${escapeHtml(figurine(res.mv.san))}${suffix}</span>`;
  };

  while (i < text.length) {
    const rest = text.slice(i);
    const prevChar = i > 0 ? text[i - 1] : ' ';
    const boundary = !/[A-Za-z0-9\-]/.test(prevChar);
    if (boundary) {
      const nm = NUM_RE.exec(rest);
      if (nm) {
        const n = Number(nm[1]);
        const black = /\.\.\.|…/.test(nm[2]);
        const after = rest.slice(nm[0].length);
        const mm = MOVE_RE.exec(after);
        if (mm && !/[A-Za-z0-9]/.test(after[mm[0].length] || ' ')) {
          const ply = 2 * (n - 1) + (black ? 1 : 0);
          let res = null;
          // continuar la secuencia actual si el número encaja
          if (run && run.ply === ply) res = playOn(run.chess.fen(), mm[1]);
          if (!res) {
            for (const fen of tryStart(ply)) { res = playOn(fen, mm[1]); if (res) break; }
            if (res) {
              run = { start: ply, fens: {}, ply, chess: null };
              runs.push(run);
            }
          }
          if (res) {
            run.fens[ply] = res.before;
            run.chess = res.c; run.ply = ply + 1; run.fens[ply + 1] = res.c.fen();
            const label = `${n}${black ? '…' : '.'}`;
            out += emitMove(res, label, ply, escapeHtml(mm[2] || ''));
            i += nm[0].length + mm[0].length;
            continue;
          }
        }
      }
      const mm = MOVE_RE.exec(rest);
      if (mm && !/[A-Za-z0-9]/.test(rest[mm[0].length] || ' ') && !(mm[1].length === 2 && /[\-–]/.test(prevChar))) {
        let res = null;
        if (run) res = playOn(run.chess.fen(), mm[1]);
        if (res) {
          const ply = run.ply;
          run.fens[ply] = run.chess.fen();
          run.chess = res.c; run.ply = ply + 1; run.fens[ply + 1] = res.c.fen();
          out += emitMove(res, '', ply, escapeHtml(mm[2] || ''));
          i += mm[0].length;
          continue;
        }
        // jugada suelta sin número: alternativa a la jugada comentada o continuación
        if (!run && /[KQRBNx]/.test(mm[1]) || (!run && /^[a-h][1-8]/.test(mm[1]))) {
          for (const ply of [contextPly - 1, contextPly]) {
            if (!fensBefore[ply]) continue;
            res = playOn(fensBefore[ply], mm[1]);
            if (res) {
              run = { start: ply, fens: { [ply]: fensBefore[ply], [ply + 1]: res.c.fen() }, ply: ply + 1, chess: res.c };
              runs.push(run);
              out += emitMove(res, '', ply, escapeHtml(mm[2] || ''));
              i += mm[0].length;
              break;
            }
          }
          if (res) continue;
        }
      }
    }
    // texto normal; un punto, punto y coma o cierre de frase corta la secuencia
    const ch = text[i];
    if (/[;:]/.test(ch) || (ch === '.' && text[i - 1] !== '.' && text[i + 1] !== '.')) {
      run = null;
    }
    out += escapeHtml(ch);
    i++;
  }
  return out;
}
