// Utilidades compartidas por todas las vistas: creación de elementos, almacenamiento local,
// panel de Stockfish y caja del tablero.
import { Chess } from '../vendor/chess.js';
import { uciToSanLine } from './board.js';
import { Engine, formatScore, scoreToBar } from './engine.js';
import { figurine } from './comments.js';

export const engine = new Engine();

export const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
export const store = {
  get(k, d) { try { const v = localStorage.getItem('cc:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cc:' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- panel del motor (compartido) ----------
export function enginePanel(getFen, board, { autoStart = false, onLineClick } = {}) {
  const enabled = { v: store.get('engineOn', autoStart) };
  const toggle = h('input', { type: 'checkbox', id: 'engine-toggle' });
  toggle.checked = enabled.v;
  const depthSel = h('select', { class: 'mini' }, [16, 20, 24, 30].map((d) => h('option', { value: d }, `prof. ${d}`)));
  depthSel.value = String(store.get('engineDepth', 20));
  const status = h('span', { class: 'engine-status' }, '');
  const lines = h('div', { class: 'engine-lines' });
  const bar = document.querySelector('.evalbar .fill');
  const barText = document.querySelector('.evalbar .txt');
  let shownFen = null;

  const run = () => {
    if (!enabled.v) { lines.innerHTML = ''; status.textContent = 'apagado'; board.shapes([]); setBar(null); return; }
    const fen = getFen();
    if (!fen) return;
    shownFen = fen;
    const c = new Chess(fen);
    if (c.isGameOver()) {
      lines.innerHTML = '';
      status.textContent = c.isCheckmate() ? 'jaque mate' : 'tablas';
      setBar(c.isCheckmate() ? { mate: c.turn() === 'w' ? -0 : 0, cp: c.turn() === 'w' ? -10000 : 10000 } : { cp: 0 });
      return;
    }
    status.textContent = engine.ready ? 'analizando…' : 'cargando motor…';
    engine.analyse(fen, {
      depth: Number(depthSel.value),
      onInfo: ({ depth, lines: ls }) => {
        if (fen !== shownFen || !el.isConnected) return;
        status.textContent = `Stockfish 17.1 · profundidad ${depth}`;
        lines.innerHTML = '';
        for (const l of ls) {
          const san = uciToSanLine(fen, l.pv, 10);
          const row = h('div', { class: 'eline' },
            h('span', { class: 'escore ' + ((l.mate ?? l.cp) >= 0 ? 'pos' : 'neg') }, formatScore(l)),
            h('span', { class: 'epv' }, san.map((m, k) => (m.ply % 2 === 0 ? `${m.ply / 2 + 1}.` : (k === 0 ? `${(m.ply + 1) / 2}…` : '')) + figurine(m.san)).join(' ')));
          if (onLineClick) row.addEventListener('click', () => onLineClick(fen, l.pv));
          lines.append(row);
        }
        if (ls[0]) {
          setBar(ls[0]);
          const best = ls[0].pv[0];
          if (best) board.shapes([{ orig: best.slice(0, 2), dest: best.slice(2, 4), brush: 'paleBlue' }]);
        }
      },
      onBest: (best) => { if (best && fen === shownFen) status.textContent = status.textContent.replace('profundidad', 'terminado · prof.'); },
      onError: () => {
        if (fen !== shownFen) return;
        status.innerHTML = '';
        status.append('No se pudo cargar el motor. ', h('button', { class: 'btn small', onclick: () => run() }, 'Reintentar'));
      },
    });
  };
  function setBar(line) {
    const evb = document.querySelector('.evalbar');
    if (!evb) return;
    evb.classList.toggle('off', !line);
    const fill = evb.querySelector('.fill');
    const txt = evb.querySelector('.txt');
    if (!line) { fill.style.height = '50%'; txt.textContent = ''; return; }
    fill.style.height = scoreToBar(line) + '%';
    txt.textContent = formatScore(line).replace('+', '');
  }
  toggle.addEventListener('change', () => { enabled.v = toggle.checked; store.set('engineOn', enabled.v); if (!enabled.v) engine.stop(); run(); });
  depthSel.addEventListener('change', () => { store.set('engineDepth', Number(depthSel.value)); run(); });
  const el = h('div', { class: 'engine' },
    h('div', { class: 'engine-head' },
      h('label', { class: 'switch' }, toggle, h('span', {}, 'Stockfish')), depthSel, status),
    lines);
  return { el, run, enabled, setEnabled(v) { toggle.checked = v; enabled.v = v; run(); } };
}

export function boardShell() {
  const evalbar = h('div', { class: 'evalbar off' }, h('div', { class: 'fill' }), h('div', { class: 'txt' }));
  const boardEl = h('div', { class: 'cg-board-wrap' });
  const shell = h('div', { class: 'board-shell' }, evalbar, h('div', { class: 'board-box' }, boardEl));
  return { shell, boardEl };
}

export function scrollIntoViewIfNeeded(container, el) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top + 10 || r.bottom > c.bottom - 10) container.scrollTop += r.top - c.top - c.height / 3;
}
