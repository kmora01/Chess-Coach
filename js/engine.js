import { Chess } from '../vendor/chess.js';

// Envoltorio de Stockfish 17.1 (WASM, versión lite de un hilo: funciona en GitHub Pages sin cabeceras especiales).
const ENGINE_URL = new URL('../vendor/stockfish/stockfish-17.1-lite-single-03e3232.js', import.meta.url).href;

export class Engine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.listeners = new Set();
    this.current = null; // { fen, resolve }
    this.multipv = 3;
  }

  start() {
    if (this.ready) return this.ready;
    this.worker = new Worker(ENGINE_URL);
    this.ready = new Promise((resolve) => {
      const onReady = (line) => { if (line === 'readyok') { this.off(onReady); resolve(); } };
      this.on(onReady);
    });
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const l of this.listeners) l(line);
    };
    this.send('uci');
    this.send('setoption name Hash value 32');
    this.send(`setoption name MultiPV value ${this.multipv}`);
    this.send('isready');
    return this.ready;
  }

  on(fn) { this.listeners.add(fn); }
  off(fn) { this.listeners.delete(fn); }
  send(cmd) { this.worker && this.worker.postMessage(cmd); }

  stop() { this.send('stop'); }

  setMultiPV(n) {
    this.multipv = n;
    if (this.worker) this.send(`setoption name MultiPV value ${n}`);
  }

  // Análisis continuo. onInfo recibe { depth, lines: [{ multipv, cp, mate, pv: [uci...] }] }
  async analyse(fen, { depth = 22, movetime = null, onInfo, onBest } = {}) {
    await this.start();
    const token = this._seq = (this._seq || 0) + 1;
    if (this._handler) { this.off(this._handler); this._cancel && this._cancel(); this._handler = null; }
    this.stop();
    const turn = fen.split(' ')[1];
    const probe = new Chess(fen);
    const legal = new Set(probe.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')));
    const isLegal = (u) => legal.has(u) || legal.has(u.slice(0, 4));
    const lines = [];
    let lastDepth = 0;
    const handler = (line) => {
      if (line.startsWith('info') && line.includes(' pv ')) {
        const d = Number(/ depth (\d+)/.exec(line)?.[1] || 0);
        const mpv = Number(/ multipv (\d+)/.exec(line)?.[1] || 1);
        const cpM = / score cp (-?\d+)/.exec(line);
        const mateM = / score mate (-?\d+)/.exec(line);
        const pv = line.split(' pv ')[1].trim().split(/\s+/);
        if (!isLegal(pv[0])) return; // salida residual de una búsqueda anterior
        // normalizamos a la perspectiva de las blancas
        const sign = turn === 'w' ? 1 : -1;
        const entry = { multipv: mpv, depth: d, pv,
          cp: cpM ? sign * Number(cpM[1]) : null,
          mate: mateM ? sign * Number(mateM[1]) : null };
        if (d < lastDepth && mpv === 1) lines.length = 0;
        lastDepth = Math.max(lastDepth, d);
        lines[mpv - 1] = entry;
        onInfo && onInfo({ depth: d, fen, lines: lines.filter(Boolean) });
      } else if (line.startsWith('bestmove') && (isLegal(line.split(' ')[1] || '') || legal.size === 0)) {
        this.off(handler);
        if (this._handler === handler) { this._handler = null; this._cancel = null; }
        onBest && onBest(line.split(' ')[1], lines.filter(Boolean));
      }
    };
    // esperar a que termine la búsqueda anterior
    this.send('isready');
    await new Promise((r) => { const h = (l) => { if (l === 'readyok') { this.off(h); r(); } }; this.on(h); });
    if (token !== this._seq) { onBest && onBest(null, []); return; }
    this._handler = handler;
    this._cancel = () => onBest && onBest(null, lines.filter(Boolean));
    this.on(handler);
    this.send(`position fen ${fen}`);
    this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
  }

  // Evaluación puntual (promesa) — usada para comparar jugadas del entrenador.
  evaluate(fen, { depth = 14 } = {}) {
    return new Promise((resolve) => {
      this.analyse(fen, { depth, onBest: (best, lines) => resolve({ best, lines }) });
    });
  }
}

export function formatScore(line) {
  if (!line) return '';
  if (line.mate !== null && line.mate !== undefined) return (line.mate > 0 ? '+' : '−') + 'M' + Math.abs(line.mate);
  const v = line.cp / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}

export function scoreToBar(line) {
  // porcentaje para la barra de evaluación (blancas abajo)
  if (!line) return 50;
  if (line.mate !== null && line.mate !== undefined) return line.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, line.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
}
