// Tablero: chessground (el tablero de lichess.org) + chess.js para la legalidad.
import { Chessground } from '../vendor/chessground/chessground.min.js';
import { Chess } from '../vendor/chess.js';

export function legalDests(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

export class Board {
  constructor(el, { orientation = 'white', onMove } = {}) {
    this.onMove = onMove;
    this.fen = new Chess().fen();
    this.interactive = false;
    this.userColor = null; // null = ambos colores
    this.cg = Chessground(el, {
      orientation,
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, showDests: true, events: { after: (from, to) => this._after(from, to) } },
      draggable: { showGhost: true },
      premovable: { enabled: false },
      drawable: { enabled: true, visible: true },
    });
  }

  _after(from, to) {
    const chess = new Chess(this.fen);
    const piece = chess.get(from);
    let promotion;
    if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) promotion = this.promotionPiece || 'q';
    this.onMove && this.onMove({ from, to, promotion });
  }

  set(fen, { lastMove = null, interactive = this.interactive, userColor = this.userColor, shapes = [] } = {}) {
    this.fen = fen;
    this.interactive = interactive;
    this.userColor = userColor;
    const chess = new Chess(fen);
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    const canMove = interactive && (!userColor || userColor === turn);
    this.cg.set({
      fen,
      turnColor: turn,
      lastMove: lastMove || undefined,
      check: chess.inCheck() ? turn : false,
      movable: { color: canMove ? turn : undefined, dests: canMove ? legalDests(chess) : new Map() },
    });
    if (!lastMove) this.cg.set({ lastMove: undefined });
    this.cg.setAutoShapes(shapes);
  }

  shapes(list) { this.cg.setAutoShapes(list); }
  orient(color) { this.cg.set({ orientation: color }); }
  flip() { this.cg.toggleOrientation(); }
  get orientation() { return this.cg.state.orientation; }
  redraw() { this.cg.redrawAll(); }
  destroy() { this.cg.destroy(); }
}

export function uciToSanLine(fen, pv, max = 12) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    try {
      const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!mv) break;
      out.push({ san: mv.san, ply: plyOf(mv.before) });
    } catch { break; }
  }
  return out;
}

function plyOf(fen) {
  const p = fen.split(' ');
  return (Number(p[5]) - 1) * 2 + (p[1] === 'b' ? 1 : 0);
}
