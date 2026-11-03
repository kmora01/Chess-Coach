// Parser PGN mínimo con soporte de comentarios {}, variantes () y NAGs.
// Devuelve partidas como árboles: cada nodo = { san, fen, ply, comment, nags, variations, next, parent }.
import { Chess } from '../vendor/chess.js';

const NAG_SYMBOLS = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+' };
const SYMBOL_NAGS = Object.fromEntries(Object.entries(NAG_SYMBOLS).map(([k, v]) => [v, Number(k)]));

export function nagToSymbol(n) { return NAG_SYMBOLS[n] || ''; }

export function splitGames(text) {
  const games = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let cur = [];
  let inMoves = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line) && inMoves) {
      games.push(cur.join('\n'));
      cur = [];
      inMoves = false;
    }
    if (!/^\s*\[/.test(line) && line.trim()) inMoves = true;
    cur.push(line);
  }
  if (cur.join('').trim()) games.push(cur.join('\n'));
  return games;
}

function tokenize(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') {
      const j = s.indexOf('}', i);
      const end = j === -1 ? s.length : j;
      tokens.push({ t: 'comment', v: s.slice(i + 1, end).trim() });
      i = end + 1; continue;
    }
    if (c === ';') {
      const j = s.indexOf('\n', i);
      const end = j === -1 ? s.length : j;
      tokens.push({ t: 'comment', v: s.slice(i + 1, end).trim() });
      i = end; continue;
    }
    if (c === '(' || c === ')') { tokens.push({ t: c }); i++; continue; }
    if (c === '$') {
      const m = /^\$(\d+)/.exec(s.slice(i));
      tokens.push({ t: 'nag', v: Number(m[1]) }); i += m[0].length; continue;
    }
    const m = /^[^\s{}();]+/.exec(s.slice(i));
    const w = m[0];
    i += w.length;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(w)) { tokens.push({ t: 'result', v: w }); continue; }
    const mm = /^(\d+)(\.+)?(.*)$/.exec(w);
    if (mm && (mm[2] || !mm[3])) { if (mm[3]) pushMove(tokens, mm[3]); continue; }
    pushMove(tokens, w);
  }
  return tokens;
}

function pushMove(tokens, w) {
  const m = /^(.*?)([!?]{1,2})?$/.exec(w);
  if (SYMBOL_NAGS[w]) { tokens.push({ t: 'nag', v: SYMBOL_NAGS[w] }); return; }
  tokens.push({ t: 'move', v: m[1] });
  if (m[2]) tokens.push({ t: 'nag', v: SYMBOL_NAGS[m[2]] || 0 });
}

export function parseGame(text) {
  const headers = {};
  const body = [];
  for (const line of text.split('\n')) {
    const h = /^\s*\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
    if (h) headers[h[1]] = h[2].replace(/\\"/g, '"');
    else body.push(line);
  }
  const startFen = headers.FEN || new Chess().fen();
  const root = { san: null, fen: startFen, ply: plyFromFen(startFen), comment: '', nags: [], variations: [], next: null, parent: null };
  const tokens = tokenize(body.join('\n'));
  // pila de contextos: { prev: nodo anterior (desde donde se juega), last: último nodo creado }
  const stack = [];
  let prev = root;      // nodo sobre el cual se aplicará la siguiente jugada
  let last = root;      // último nodo creado (recibe comentarios y NAGs)
  let errors = [];
  for (const tok of tokens) {
    if (tok.t === 'comment') {
      last.comment = (last.comment ? last.comment + ' ' : '') + tok.v;
    } else if (tok.t === 'nag') {
      if (last !== root && tok.v) last.nags.push(tok.v);
    } else if (tok.t === '(') {
      stack.push({ prev, last });
      // la variante sustituye a la última jugada: parte del padre de 'last'
      prev = last.parent || root;
      last = { variationStart: true, parent: prev, comment: '', nags: [] };
      last._pending = true;
    } else if (tok.t === ')') {
      const ctx = stack.pop();
      if (ctx) { prev = ctx.prev; last = ctx.last; }
    } else if (tok.t === 'move') {
      const chess = new Chess(prev.fen);
      let mv = null;
      try { mv = chess.move(tok.v, { strict: false }); } catch (e) { mv = null; }
      if (!mv) { errors.push(`Jugada ilegal "${tok.v}" en ${prev.fen}`); continue; }
      const node = { san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), from: mv.from, to: mv.to, fen: chess.fen(), ply: prev.ply + 1, comment: '', nags: [], variations: [], next: null, parent: prev };
      // comentario previo a la primera jugada de una variante
      if (last._pending && last.comment) node.preComment = last.comment;
      const isVariationStart = last._pending;
      if (isVariationStart) prev.variations.push(node);
      else if (prev.next) prev.variations.push(node); // seguridad
      else prev.next = node;
      prev = node; last = node;
    }
  }
  return { headers, root, errors };
}

function plyFromFen(fen) {
  const parts = fen.split(' ');
  const full = Number(parts[5] || 1);
  return (full - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
}

export function mainline(root) {
  const out = [];
  let n = root.next;
  while (n) { out.push(n); n = n.next; }
  return out;
}

export function moveNumberLabel(node) {
  const n = Math.floor((node.ply - 1) / 2) + 1;
  return node.ply % 2 === 1 ? `${n}.` : `${n}...`;
}
