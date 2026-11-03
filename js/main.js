import { Chess } from '../vendor/chess.js';
import { Board, uciToSanLine } from './board.js';
import { Engine, formatScore, scoreToBar } from './engine.js';
import { splitGames, parseGame, mainline, nagToSymbol, moveNumberLabel } from './pgn.js';
import { renderComment, figurine } from './comments.js';

const app = document.getElementById('app');
const engine = new Engine();
const cache = { library: null, books: {}, games: {} };
let cleanup = null;

// ---------- utilidades ----------
const h = (tag, attrs = {}, ...children) => {
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
const store = {
  get(k, d) { try { const v = localStorage.getItem('cc:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cc:' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadLibrary() {
  if (!cache.library) cache.library = await (await fetch('books/index.json')).json();
  return cache.library;
}
async function loadBook(id) {
  if (cache.books[id]) return cache.books[id];
  const lib = await loadLibrary();
  const entry = lib.books.find((b) => b.id === id);
  if (!entry) throw new Error('Libro no encontrado');
  const meta = await (await fetch(`books/${id}/book.json`)).json();
  const pgnText = await (await fetch(`books/${id}/${meta.pgn || 'games.pgn'}`)).text();
  const games = splitGames(pgnText).map((t, i) => ({ index: i, text: t, headers: parseHeaders(t) }));
  cache.books[id] = { ...entry, ...meta, games };
  return cache.books[id];
}
function parseHeaders(t) {
  const out = {};
  for (const m of t.matchAll(/^\s*\[(\w+)\s+"(.*)"\]\s*$/gm)) out[m[1]] = m[2];
  return out;
}
function getGame(book, n) {
  const key = `${book.id}:${n}`;
  if (!cache.games[key]) cache.games[key] = parseGame(book.games[n].text);
  return cache.games[key];
}

// ---------- router ----------
window.addEventListener('hashchange', route);

function eventLabel(hd) {
  const ev = hd.Event && hd.Event !== '?' ? hd.Event : '';
  const year = (hd.Date || '').slice(0, 4).replace(/\?/g, '');
  return ev && year && ev.includes(year) ? ev : [ev, year].filter(Boolean).join(' ');
}
route();

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  engine.worker && engine.stop();
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + (parts[0] === 'analisis' ? '/analisis' : '/')));
  app.innerHTML = '';
  if (parts[0] === 'libro' && parts[2] === 'partida') return viewGame(parts[1], Number(parts[3]), params);
  if (parts[0] === 'libro') return viewBook(parts[1]);
  if (parts[0] === 'analisis') return viewAnalysis(params);
  return viewLibrary();
}

// ---------- biblioteca ----------
async function viewLibrary() {
  const lib = await loadLibrary();
  app.append(
    h('section', { class: 'hero' },
      h('h1', {}, 'Chess Coach'),
      h('p', {}, 'Estudia partidas comentadas de los grandes libros de ajedrez: revisa cada jugada con las anotaciones del autor, entrena jugando las jugadas del libro y analiza cualquier posición con Stockfish.')),
    h('h2', { class: 'section-title' }, 'Capítulos'),
    h('div', { class: 'cards' }, lib.books.map((b, i) =>
      h('a', { class: 'card', href: `#/libro/${b.id}` },
        h('div', { class: 'card-chapter' }, `Capítulo ${i + 1}`),
        h('div', { class: 'card-title' }, b.title),
        h('div', { class: 'card-sub' }, b.author),
        h('div', { class: 'card-meta' }, b.description || '')))),
  );
}

// ---------- libro ----------
async function viewBook(id) {
  const book = await loadBook(id);
  const progress = store.get(`progress:${id}`, {});
  const filter = h('input', { type: 'search', placeholder: 'Buscar rival, apertura, año…', class: 'search' });
  const list = h('div', { class: 'game-list' });
  const render = () => {
    const q = filter.value.toLowerCase();
    list.innerHTML = '';
    for (const g of book.games) {
      const hd = g.headers;
      const text = `${hd.White} ${hd.Black} ${hd.Opening || ''} ${hd.ECO || ''} ${hd.Event} ${hd.Date}`.toLowerCase();
      if (q && !text.includes(q)) continue;
      const p = progress[g.index];
      list.append(h('a', { class: 'game-row', href: `#/libro/${id}/partida/${g.index}` },
        h('span', { class: 'game-num' }, hd.Round || g.index + 1),
        h('span', { class: 'game-players' }, h('b', {}, hd.White), ' – ', h('b', {}, hd.Black)),
        h('span', { class: 'game-event' }, eventLabel(hd)),
        h('span', { class: 'game-opening' }, hd.Opening || hd.ECO || ''),
        h('span', { class: 'game-result' }, hd.Result || ''),
        h('span', { class: 'game-progress' }, p ? `${p.best}%` : '')));
    }
  };
  filter.addEventListener('input', render);
  render();
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', book.title),
    h('header', { class: 'book-head' }, h('h1', {}, book.title), h('p', {}, book.author), book.note ? h('p', { class: 'muted' }, book.note) : null),
    filter, list);
}

// ---------- panel del motor (compartido) ----------
function enginePanel(getFen, board, { autoStart = false, onLineClick } = {}) {
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
        if (fen !== shownFen) return;
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

function boardShell() {
  const evalbar = h('div', { class: 'evalbar off' }, h('div', { class: 'fill' }), h('div', { class: 'txt' }));
  const boardEl = h('div', { class: 'cg-board-wrap' });
  const shell = h('div', { class: 'board-shell' }, evalbar, h('div', { class: 'board-box' }, boardEl));
  return { shell, boardEl };
}

// ---------- partida (revisión + entrenador) ----------
async function viewGame(bookId, n, params) {
  const book = await loadBook(bookId);
  const game = getGame(book, n);
  const hd = game.headers;
  const moves = mainline(game.root);
  const fensBefore = [game.root.fen, ...moves.map((m) => m.fen)];
  const startPly = game.root.ply;
  const fenAt = (ply) => fensBefore[ply - startPly];
  const fensByPly = {};
  fensBefore.forEach((f, i) => { fensByPly[startPly + i] = f; });

  let mode = params.get('modo') === 'entrenar' ? 'train' : 'review';
  let idx = Number(params.get('j') || 0); // número de jugadas mostradas (0 = posición inicial)
  let preview = null; // id (en commentRegistry) de la jugada de variante que se está viendo
  let explore = null; // { chess, history: [] } exploración libre desde la posición actual

  const { shell, boardEl } = boardShell();
  const board = new Board(boardEl, { onMove: (m) => onBoardMove(m) });
  const commentRegistry = [];

  const currentFen = () => explore ? explore.chess.fen() : preview != null ? commentRegistry[preview].fen : fensBefore[idx];
  const eng = enginePanel(currentFen, board, { onLineClick: null });

  // ---- cabecera
  const title = h('div', { class: 'game-title' },
    h('div', { class: 'gt-players' }, `${hd.White} – ${hd.Black}`, h('span', { class: 'gt-result' }, hd.Result)),
    h('div', { class: 'gt-meta' }, [eventLabel(hd), hd.Site && hd.Site !== '?' ? hd.Site : '', hd.Opening].filter(Boolean).join(' · ')));
  const prevGame = n > 0 ? h('a', { class: 'btn ghost', title: 'Partida anterior', href: `#/libro/${bookId}/partida/${n - 1}` }, '←', h('span', { class: 'lbl-long' }, ' Anterior')) : null;
  const nextGame = n < book.games.length - 1 ? h('a', { class: 'btn ghost', title: 'Partida siguiente', href: `#/libro/${bookId}/partida/${n + 1}` }, h('span', { class: 'lbl-long' }, 'Siguiente '), '→') : null;

  // ---- controles
  const ctrl = h('div', { class: 'controls' },
    h('button', { class: 'btn icon navbtn', title: 'Inicio', onclick: () => nav('start') }, '⏮'),
    h('button', { class: 'btn icon navbtn', title: 'Atrás (←)', onclick: () => nav(-1) }, '◀'),
    h('button', { class: 'btn icon navbtn', title: 'Adelante (→)', onclick: () => nav(1) }, '▶'),
    h('button', { class: 'btn icon navbtn', title: 'Final', onclick: () => nav('end') }, '⏭'),
    h('button', { class: 'btn icon', title: 'Girar tablero (F)', onclick: () => board.flip() }, '⇅'),
    h('button', { class: 'btn analyse-btn', title: 'Mover piezas libremente desde aquí con Stockfish', onclick: () => startExplore() }, h('span', { class: 'long' }, 'Analizar posición'), h('span', { class: 'short' }, 'Analizar')));
  const nowComment = h('div', { class: 'now-comment hidden' });
  const banner = h('div', { class: 'banner hidden' });

  // ---- pestañas
  const tabReview = h('button', { class: 'tab', onclick: () => setMode('review') }, 'Revisión');
  const tabTrain = h('button', { class: 'tab', onclick: () => setMode('train') }, 'Entrenador');
  const panelReview = h('div', { class: 'panel' });
  const panelTrain = h('div', { class: 'panel' });

  // ---- lista de jugadas con comentarios
  const moveList = h('div', { class: 'movelist' });
  const intro = game.root.comment ? h('div', { class: 'comment intro', html: renderComment(game.root.comment, fensByPly, startPly, commentRegistry) }) : null;
  if (intro) moveList.append(intro);
  const moveEls = [];
  const commentEls = [];
  let row = null;
  moves.forEach((m, i) => {
    const white = m.ply % 2 === 1;
    if (white || !row || i === 0) {
      row = h('div', { class: 'mrow' }, h('span', { class: 'mnum' }, moveNumberLabel(m).replace('...', '…')));
      if (!white) row.append(h('span', { class: 'mv empty' }, '…'));
      moveList.append(row);
    }
    const label = figurine(m.san) + m.nags.map(nagToSymbol).join('');
    const el = h('span', { class: 'mv', onclick: () => go(i + 1) }, label);
    moveEls.push(el);
    row.append(el);
    const vars = m.variations || [];
    if (m.comment || vars.length) {
      const c = h('div', { class: 'comment' });
      if (m.comment) c.innerHTML = renderComment(m.comment, fensByPly, m.ply, commentRegistry);
      c.addEventListener('click', (e) => { if (!e.target.closest('.cm-move')) go(i + 1); });
      commentEls[i] = c;
      moveList.append(c);
      row = null;
    }
  });
  const onVarClick = (e) => {
    const t = e.target.closest('.cm-move');
    if (!t) return;
    e.stopPropagation();
    showPreview(Number(t.dataset.var));
  };
  moveList.addEventListener('click', onVarClick);
  nowComment.addEventListener('click', onVarClick);
  panelTrain.addEventListener('click', onVarClick);
  panelReview.append(moveList);

  // ---- entrenador
  const trainer = makeTrainer();
  panelTrain.append(trainer.el);

  const side = h('div', { class: 'side' },
    h('div', { class: 'tabs' }, tabReview, tabTrain),
    panelReview, panelTrain, eng.el);
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', h('a', { href: `#/libro/${bookId}` }, book.title), ' / ', `Partida ${hd.Round || n + 1}`),
    h('div', { class: 'game-top' }, title, h('div', { class: 'game-nav' }, prevGame, nextGame)),
    h('div', { class: 'game-layout' }, h('div', { class: 'main' }, shell, banner, nowComment, ctrl), side));

  // ---- lógica
  function go(i) {
    if (mode === 'train') return;
    i = Math.max(0, Math.min(moves.length, i));
    idx = i;
    explore = null;
    preview = null;
    render();
  }
  // Navegación: dentro de una variante del libro recorre la variante; si no, la partida.
  function nav(d) {
    if (mode === 'train') return;
    if (preview != null && !explore) {
      const seq = commentRegistry[preview].seq;
      const pos = seq.indexOf(preview);
      if (d === 'start' || (d === -1 && pos === 0)) { preview = null; render(); return; }
      if (d === 'end') { preview = seq[seq.length - 1]; render(); return; }
      const np = pos + d;
      if (np >= 0 && np < seq.length) { preview = seq[np]; render(); }
      return;
    }
    if (d === 'start') go(0);
    else if (d === 'end') go(moves.length);
    else go(idx + d);
  }
  function render() {
    banner.classList.add('hidden');
    let fen, lastMove = null;
    if (explore) {
      fen = explore.chess.fen();
      const h0 = explore.chess.history({ verbose: true });
      const lm = h0[h0.length - 1];
      lastMove = lm ? [lm.from, lm.to] : null;
      banner.innerHTML = '';
      banner.append(h('span', {}, 'Análisis libre: ', h('b', {}, explore.chess.history().map(figurine).join(' ') || 'mueve cualquier pieza')),
        h('button', { class: 'btn small', onclick: () => { explore.chess.undo(); render(); } }, 'Deshacer'),
        h('button', { class: 'btn small', onclick: () => { explore = null; if (mode === 'train') { banner.classList.add('hidden'); trainer.resume(); } else render(); } }, mode === 'train' ? 'Volver al entrenamiento' : 'Volver a la partida'));
      banner.classList.remove('hidden');
      board.set(fen, { lastMove, interactive: true, userColor: null });
    } else if (preview != null) {
      const v = commentRegistry[preview];
      fen = v.fen;
      const pos = v.seq.indexOf(preview);
      banner.innerHTML = '';
      const line = h('span', { class: 'var-line' }, 'Variante: ', v.seq.flatMap((id) => [h('span', {
        class: 'var-mv' + (id === preview ? ' current' : ''), onclick: () => { preview = id; render(); },
      }, commentRegistry[id].label), ' ']));
      banner.append(line,
        h('div', { class: 'var-actions' },
          h('button', { class: 'btn small icon', title: 'Jugada anterior de la variante', onclick: () => nav(-1) }, '◀'),
          h('button', { class: 'btn small icon', title: 'Jugada siguiente de la variante', disabled: pos >= v.seq.length - 1 ? 'disabled' : null, onclick: () => nav(1) }, '▶'),
          h('button', { class: 'btn small', onclick: () => { explore = { chess: new Chess(v.fen) }; preview = null; render(); } }, 'Seguir analizando'),
          h('button', { class: 'btn small', onclick: () => { preview = null; render(); } }, 'Volver a la partida')));
      banner.classList.remove('hidden');
      board.set(fen, { lastMove: [v.from, v.to], interactive: false });
      document.querySelectorAll('.cm-move.current').forEach((e) => e.classList.remove('current'));
      document.querySelectorAll(`.cm-move[data-var="${preview}"]`).forEach((e) => e.classList.add('current'));
    } else if (mode === 'review') {
      fen = fensBefore[idx];
      const m = moves[idx - 1];
      board.set(fen, { lastMove: m ? [m.from, m.to] : null, interactive: false });
      document.querySelectorAll('.cm-move.current').forEach((e) => e.classList.remove('current'));
    }
    // comentario de la jugada actual bajo el tablero (útil en el móvil)
    if (mode === 'review' && !explore && preview == null) {
      const c = commentEls[idx - 1] || (idx === 0 ? intro : null);
      nowComment.innerHTML = c ? c.innerHTML : '';
      nowComment.classList.toggle('hidden', !c);
    } else if (mode !== 'review') nowComment.classList.add('hidden');
    moveEls.forEach((el, k) => el.classList.toggle('current', k === idx - 1 && !explore));
    const cur = moveEls[idx - 1];
    if (cur && mode === 'review') {
      const next = cur.closest('.mrow')?.nextElementSibling;
      const target = next && next.classList.contains('comment') ? next : cur;
      scrollIntoViewIfNeeded(moveList, target);
      moveList.querySelectorAll('.comment.active').forEach((e) => e.classList.remove('active'));
      if (next && next.classList.contains('comment')) next.classList.add('active');
    }
    if (mode === 'review' || explore) eng.run();
  }
  function showPreview(id) {
    const v = commentRegistry[id];
    if (!v) return;
    if (mode === 'train') { board.set(v.fen, { lastMove: [v.from, v.to], interactive: false }); trainer.previewing(); return; }
    preview = id;
    explore = null;
    render();
  }
  function startExplore() {
    explore = { chess: new Chess(currentFen()) };
    preview = null;
    if (mode === 'train') trainer.pause();
    render();
  }
  function onBoardMove(m) {
    if (explore) {
      try { explore.chess.move(m); } catch { /* ilegal */ }
      render();
      return;
    }
    if (mode === 'train') trainer.userMove(m);
  }
  function setMode(m) {
    mode = m;
    tabReview.classList.toggle('active', m === 'review');
    tabTrain.classList.toggle('active', m === 'train');
    panelReview.classList.toggle('hidden', m !== 'review');
    panelTrain.classList.toggle('hidden', m !== 'train');
    ctrl.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('hidden', m === 'train'));
    explore = null; preview = null;
    if (m === 'train') trainer.enter(); else { trainer.leave(); render(); }
  }

  function makeTrainer() {
    const defaultColor = /fischer/i.test(hd.White) ? 'white' : /fischer/i.test(hd.Black) ? 'black' : 'white';
    const hero = book.hero || 'Fischer';
    let color = defaultColor;
    let ply = 0; // jugadas ya jugadas en el entrenamiento
    let active = false;
    let stats = { ok: 0, fail: 0, total: 0, attempts: 0, hints: 0 };
    let waiting = false;

    const chooseW = h('button', { class: 'btn choice', onclick: () => pick('white') }, h('span', { class: 'pc w' }, '♔'), ' Blancas', h('small', {}, hd.White));
    const chooseB = h('button', { class: 'btn choice', onclick: () => pick('black') }, h('span', { class: 'pc b' }, '♚'), ' Negras', h('small', {}, hd.Black));
    const fromSel = h('select', {}, h('option', { value: '0' }, 'Desde el inicio'));
    for (let k = 2; k < moves.length; k += 2) fromSel.append(h('option', { value: String(k) }, `Desde la jugada ${k / 2 + 1}`));
    const hideEngine = h('input', { type: 'checkbox' });
    hideEngine.checked = true;
    const setup = h('div', { class: 'train-setup' },
      h('p', {}, '¿Con qué color quieres jugar? Tú harás las jugadas del libro y la aplicación responderá con el otro bando.'),
      h('div', { class: 'choices' }, chooseW, chooseB),
      h('label', { class: 'row' }, 'Empezar: ', fromSel),
      h('label', { class: 'row' }, hideEngine, ' Ocultar Stockfish mientras entreno'),
      h('button', { class: 'btn primary', onclick: () => begin() }, 'Comenzar entrenamiento'));
    const status = h('div', { class: 'train-status' });
    const feedback = h('div', { class: 'train-feedback' });
    const feed = h('div', { class: 'train-feed' });
    const actions = h('div', { class: 'train-actions' },
      h('button', { class: 'btn', onclick: () => hint() }, 'Pista'),
      h('button', { class: 'btn', onclick: () => reveal() }, 'Mostrar jugada'),
      h('button', { class: 'btn ghost', onclick: () => resetSetup() }, 'Reiniciar'));
    const live = h('div', { class: 'train-live hidden' }, status, feedback, actions, h('h4', {}, 'Comentarios del libro'), feed);
    const el = h('div', {}, setup, live);
    function pick(c) { color = c; chooseW.classList.toggle('selected', c === 'white'); chooseB.classList.toggle('selected', c === 'black'); }
    pick(color);

    function begin() {
      active = true;
      stats = { ok: 0, fail: 0, total: 0, attempts: 0, hints: 0 };
      ply = Number(fromSel.value);
      feed.innerHTML = '';
      setup.classList.add('hidden');
      live.classList.remove('hidden');
      board.orient(color);
      if (hideEngine.checked) eng.setEnabled(false);
      feedback.className = 'train-feedback';
      feedback.textContent = '';
      step();
    }
    function resetSetup() {
      active = false;
      setup.classList.remove('hidden');
      live.classList.add('hidden');
      board.set(fensBefore[0], { interactive: false });
    }
    const turnColor = (p) => ((startPly + p) % 2 === 0 ? 'white' : 'black');
    function step() {
      const fen = fensBefore[ply];
      const last = moves[ply - 1];
      if (ply >= moves.length) return finish();
      const userTurn = turnColor(ply) === color;
      board.set(fen, { lastMove: last ? [last.from, last.to] : null, interactive: userTurn, userColor: color });
      updateStatus();
      if (!userTurn) {
        waiting = true;
        setTimeout(() => {
          if (!active || explore || mode !== 'train') { waiting = false; return; }
          waiting = false;
          ply++;
          addFeed(moves[ply - 1], false);
          step();
        }, 650);
      } else {
        stats.attempts = 0;
      }
      if (eng.enabled.v) eng.run();
    }
    function updateStatus() {
      const mvNo = Math.floor((startPly + ply) / 2) + 1;
      const userTurn = turnColor(ply) === color;
      status.innerHTML = '';
      status.append(
        h('div', { class: 'ts-turn' }, userTurn ? `Tu turno (jugada ${mvNo}): ¿qué jugó ${color === defaultColor ? hero : 'el libro'}?` : 'El rival piensa…'),
        h('div', { class: 'ts-score' }, `✔ ${stats.ok}  ✘ ${stats.fail}  · ${stats.total ? Math.round((100 * stats.ok) / stats.total) : 0}% al primer intento`));
    }
    function addFeed(m, mine, extra) {
      const item = h('div', { class: 'feed-item' + (mine ? ' mine' : '') },
        h('div', { class: 'feed-move' }, `${moveNumberLabel(m).replace('...', '…')} ${figurine(m.san)}${m.nags.map(nagToSymbol).join('')}`, extra ? h('span', { class: 'feed-extra' }, extra) : null));
      if (m.comment) item.append(h('div', { class: 'comment', html: renderComment(m.comment, fensByPly, m.ply, commentRegistry) }));
      feed.prepend(item);
    }
    async function userMove({ from, to, promotion }) {
      if (!active || waiting) return;
      const book = moves[ply];
      const ok = book.from === from && book.to === to;
      if (ok) {
        if (stats.attempts === 0) stats.ok++;
        stats.total++;
        feedback.className = 'train-feedback good';
        feedback.textContent = stats.attempts === 0 ? `¡Correcto! ${figurine(book.san)}` : `Correcto: ${figurine(book.san)}`;
        ply++;
        addFeed(book, true, stats.attempts ? ` (${stats.attempts + 1}º intento)` : ' ✔');
        step();
        return;
      }
      // jugada distinta a la del libro
      if (stats.attempts === 0) { stats.fail++; stats.total++; }
      stats.attempts++;
      const fen = fensBefore[ply];
      const c = new Chess(fen);
      let san = `${from}-${to}`;
      try { san = c.move({ from, to, promotion }).san; } catch { /* */ }
      feedback.className = 'train-feedback bad';
      feedback.textContent = `${figurine(san)} no es la jugada del libro. Inténtalo otra vez.`;
      updateStatus();
      board.set(fen, { lastMove: null, interactive: true, userColor: color });
      // comparar con Stockfish
      const yourFen = c.fen();
      const cmp = h('div', { class: 'cmp' }, 'Stockfish compara tu jugada…');
      feedback.append(cmp);
      waiting = true;
      const [a, b] = [await engine.evaluate(yourFen, { depth: 14 }), null];
      waiting = false;
      const bookEval = await engine.evaluate(moves[ply].fen, { depth: 14 });
      const yours = a.lines[0], theirs = bookEval.lines[0];
      if (yours && theirs) {
        const sign = color === 'white' ? 1 : -1;
        const val = (l) => (l.mate != null ? (l.mate > 0 ? 100000 : -100000) : l.cp) * sign;
        const diff = val(theirs) - val(yours);
        cmp.textContent = `Tu jugada: ${formatScore(yours)} · jugada del libro: ${formatScore(theirs)}` +
          (diff > 80 ? ' — la del libro es claramente mejor.' : diff < -30 ? ' — ¡según el motor tu jugada es incluso mejor!' : ' — ambas son similares para el motor.');
      } else cmp.textContent = '';
      if (eng.enabled.v) eng.run();
    }
    function hint() {
      if (!active || ply >= moves.length) return;
      const m = moves[ply];
      stats.hints++;
      board.shapes([{ orig: m.from, brush: 'yellow' }]);
      feedback.className = 'train-feedback';
      feedback.textContent = 'Pista: mueve la pieza marcada.';
    }
    function reveal() {
      if (!active || ply >= moves.length || turnColor(ply) !== color) return;
      const m = moves[ply];
      if (stats.attempts === 0) { stats.fail++; stats.total++; }
      feedback.className = 'train-feedback bad';
      feedback.textContent = `La jugada del libro era ${figurine(m.san)}.`;
      ply++;
      addFeed(m, true, ' (mostrada)');
      step();
    }
    function finish() {
      active = false;
      const pct = stats.total ? Math.round((100 * stats.ok) / stats.total) : 0;
      const progress = store.get(`progress:${bookId}`, {});
      const prev = progress[n]?.best || 0;
      progress[n] = { best: Math.max(prev, pct), last: pct, date: new Date().toISOString().slice(0, 10) };
      store.set(`progress:${bookId}`, progress);
      board.set(fensBefore[moves.length], { lastMove: [moves[moves.length - 1].from, moves[moves.length - 1].to], interactive: false });
      status.innerHTML = '';
      status.append(h('div', { class: 'ts-turn' }, `Fin de la partida (${hd.Result}).`),
        h('div', { class: 'ts-score' }, `Acertaste ${stats.ok} de ${stats.total} jugadas al primer intento (${pct}%). Mejor marca: ${Math.max(prev, pct)}%.`));
    }
    return {
      el, userMove,
      enter() { if (!active) { setup.classList.remove('hidden'); live.classList.add('hidden'); board.set(fensBefore[0], { interactive: false }); board.orient(color); } else step(); },
      leave() { active = false; board.orient('white'); resetSetup(); },
      pause() { },
      resume() { if (active) step(); else board.set(fensBefore[0], { interactive: false }); },
      previewing() { feedback.className = 'train-feedback'; feedback.innerHTML = ''; feedback.append('Mostrando una variante del comentario. ', h('button', { class: 'btn small', onclick: () => step() }, 'Volver al entrenamiento')); },
    };
  }

  // teclado
  const onKey = (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') { nav(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { nav(1); e.preventDefault(); }
    if (e.key === 'Escape' && preview != null) { preview = null; render(); }
    if (e.key === 'Home') nav('start');
    if (e.key === 'End') nav('end');
    if (e.key === 'f') board.flip();
  };
  window.addEventListener('keydown', onKey);
  cleanup = () => { window.removeEventListener('keydown', onKey); board.destroy(); };

  if (/fischer/i.test(hd.Black) && mode === 'review') board.orient('black');
  setMode(mode);
  if (mode === 'review') go(idx);
  if (game.errors.length) console.warn('Errores PGN', game.errors);
}

function scrollIntoViewIfNeeded(container, el) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top + 10 || r.bottom > c.bottom - 10) container.scrollTop += r.top - c.top - c.height / 3;
}

// ---------- análisis libre ----------
function viewAnalysis(params) {
  const chess = new Chess();
  const startFen = params.get('fen');
  if (startFen) { try { chess.load(startFen); } catch { /* FEN inválida */ } }
  let base = chess.fen();
  const { shell, boardEl } = boardShell();
  const board = new Board(boardEl, { onMove: (m) => { try { chess.move(m); } catch { } render(); } });
  const eng = enginePanel(() => chess.fen(), board, { autoStart: true });
  const fenInput = h('input', { class: 'fen', value: chess.fen(), spellcheck: 'false' });
  const hist = h('div', { class: 'hist' });
  const promo = h('select', { class: 'mini', onchange: () => { board.promotionPiece = promo.value; } },
    h('option', { value: 'q' }, 'Coronar: Dama'), h('option', { value: 'r' }, 'Torre'), h('option', { value: 'b' }, 'Alfil'), h('option', { value: 'n' }, 'Caballo'));
  function render() {
    const hv = chess.history({ verbose: true });
    const lm = hv[hv.length - 1];
    board.set(chess.fen(), { lastMove: lm ? [lm.from, lm.to] : null, interactive: true, userColor: null });
    fenInput.value = chess.fen();
    hist.textContent = chess.history().map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + figurine(s)).join(' ') || 'Mueve las piezas para analizar.';
    eng.run();
  }
  if (!eng.enabled.v) eng.setEnabled(true);
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / Análisis libre'),
    h('div', { class: 'game-layout' },
      h('div', { class: 'main' }, shell, h('div', { class: 'controls' },
        h('button', { class: 'btn', onclick: () => { chess.undo(); render(); } }, 'Deshacer'),
        h('button', { class: 'btn', onclick: () => { chess.load(base); render(); } }, 'Reiniciar'),
        h('button', { class: 'btn', onclick: () => { chess.reset(); base = chess.fen(); render(); } }, 'Posición inicial'),
        h('button', { class: 'btn icon', onclick: () => board.flip() }, '⇅'), promo)),
      h('div', { class: 'side' },
        h('h3', {}, 'Análisis con Stockfish'),
        h('label', { class: 'lbl' }, 'FEN'),
        h('div', { class: 'fen-row' }, fenInput, h('button', { class: 'btn', onclick: () => { try { chess.load(fenInput.value.trim()); base = chess.fen(); render(); } catch { alert('FEN no válida'); } } }, 'Cargar')),
        h('label', { class: 'lbl' }, 'Jugadas'), hist, eng.el)));
  cleanup = () => board.destroy();
  render();
}
