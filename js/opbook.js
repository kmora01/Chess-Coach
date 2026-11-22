// Modelo de un libro de aperturas (FCO): árbol global de jugadas + texto por capítulos.
import { Chess } from '../vendor/chess.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
export const fig = (san) => san.replace(/^([KQRBN])/, (m) => FIG[m]).replace(/=([QRBN])/, (m, p) => '=' + FIG[p]);

export class OpeningBook {
  constructor(data) {
    this.data = data;
    const N = data.nodes;
    this.parent = N.parent; this.san = N.san; this.uci = N.uci; this.pos = N.pos; this.eco = N.eco;
    this.ideaFen = data.ideaFen || {};
    const n = this.parent.length;
    this.size = n;
    this.fens = new Array(n); this.fens[0] = START;
    this.depth = new Int16Array(n);
    this.isMain = new Uint8Array(n);
    this.refCount = new Uint16Array(n);
    this.locs = new Map(); // nodo -> [{ch, sec, blk}]
    this.byPos = new Map();
    for (let i = 0; i < n; i++) {
      if (i > 0) this.depth[i] = this.depth[this.parent[i]] + 1;
      const p = this.pos[i];
      if (!this.byPos.has(p)) this.byPos.set(p, []);
      this.byPos.get(p).push(i);
    }
    const addLoc = (node, loc) => {
      if (node == null) return;
      this.refCount[node]++;
      if (!this.locs.has(node)) this.locs.set(node, []);
      const l = this.locs.get(node);
      if (!l.some((x) => x.ch === loc.ch && x.sec === loc.sec)) l.push(loc);
    };
    data.chapters.forEach((ch, ci) => ch.sections.forEach((sec, si) => {
      (sec.nodes || []).forEach((nd) => addLoc(nd, { ch: ci, sec: si, blk: -1 }));
      sec.blocks.forEach((b, bi) => {
        if (b.k === 'main') b.nodes.forEach(([nd]) => { this.isMain[nd] = 1; addLoc(nd, { ch: ci, sec: si, blk: bi }); });
        else if (b.k === 'p') b.segs.forEach((s) => { if (typeof s === 'object') addLoc(s.m, { ch: ci, sec: si, blk: bi }); });
        else if (b.k === 'diag') addLoc(b.node, { ch: ci, sec: si, blk: bi });
      });
    }));
    // hijos: primero los de la línea principal, luego los más citados
    this.children = Array.from({ length: n }, () => []);
    for (let i = 1; i < n; i++) this.children[this.parent[i]].push(i);
    const weight = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      weight[i] += this.refCount[i] + (this.isMain[i] ? 1000 : 0);
      if (i > 0) weight[this.parent[i]] += weight[i] * 0.5;
    }
    this.weight = weight;
    for (const c of this.children) c.sort((a, b) => (this.isMain[b] - this.isMain[a]) || (weight[b] - weight[a]));
  }

  isIdea(n) { return n > 0 && this.san[n].startsWith('--'); }
  label(n) { return this.isIdea(n) ? this.san[n].slice(2) : this.san[n]; }

  fen(n) {
    if (this.fens[n]) return this.fens[n];
    const stack = [];
    let x = n;
    while (!this.fens[x]) { stack.push(x); x = this.parent[x]; }
    while (stack.length) {
      const y = stack.pop();
      if (this.ideaFen[y]) { this.fens[y] = this.ideaFen[y]; continue; }
      const c = new Chess(this.fens[this.parent[y]]);
      const u = this.uci[y];
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      this.fens[y] = c.fen();
    }
    return this.fens[n];
  }

  path(n) { const out = []; while (n > 0) { out.push(n); n = this.parent[n]; } return out.reverse(); }
  lastMove(n) { if (n <= 0) return null; const u = this.uci[n]; return [u.slice(0, 2), u.slice(2, 4)]; }

  // número de jugada para mostrar: "12." o "12…"
  numLabel(n, force) {
    const ply = this.depth[n];
    const num = Math.floor((ply - 1) / 2) + 1;
    if (ply % 2 === 1) return `${num}.`;
    return force ? `${num}…` : '';
  }

  // todas las continuaciones del libro desde la posición de n (incluye transposiciones)
  continuations(n) {
    const seen = new Map();
    for (const m of this.byPos.get(this.pos[n]) || []) {
      for (const c of this.children[m]) {
        if (this.isIdea(c)) continue;
        const key = this.san[c];
        const cur = seen.get(key);
        if (!cur) seen.set(key, { san: key, nodes: [c], main: !!this.isMain[c], weight: this.weight[c], refs: this.subtreeRefs(c) });
        else { cur.nodes.push(c); cur.main = cur.main || !!this.isMain[c]; cur.weight += this.weight[c]; cur.refs += this.subtreeRefs(c); }
      }
    }
    return [...seen.values()].sort((a, b) => (b.main - a.main) || (b.weight - a.weight));
  }

  subtreeRefs(n) {
    if (!this._sub) {
      this._sub = new Uint32Array(this.size);
      for (let i = this.size - 1; i >= 0; i--) { this._sub[i] += this.refCount[i]; if (i > 0) this._sub[this.parent[i]] += this._sub[i]; }
    }
    return this._sub[n];
  }

  // lugares del libro donde se trata la posición de n (por posición, así aparecen las transposiciones)
  locationsOfPos(n) {
    const out = [];
    const seen = new Set();
    for (const m of this.byPos.get(this.pos[n]) || []) {
      for (const l of this.locs.get(m) || []) {
        const k = `${l.ch}:${l.sec}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ ...l, node: m });
      }
    }
    return out;
  }

  findFen(fen) {
    const key = fen.split(' ').slice(0, 3).join(' ');
    for (let i = 0; i < this.size; i++) {
      if (this.depth[i] > 40) continue;
      if (this.fen(i).split(' ').slice(0, 3).join(' ') === key) return i;
    }
    return -1;
  }

  // jugada desde n que corresponde a from/to (si está en el libro)
  childByMove(n, from, to, promotion) {
    const u = from + to + (promotion && promotion !== 'q' ? promotion : '');
    const cands = this.children[n].filter((c) => !this.isIdea(c));
    for (const m of this.byPos.get(this.pos[n]) || []) if (m !== n) for (const c of this.children[m]) if (!this.isIdea(c)) cands.push(c);
    return cands.find((c) => this.uci[c] === u || this.uci[c] === from + to + (promotion || '')) ?? null;
  }
}
