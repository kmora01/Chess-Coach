import { Chess } from '../vendor/chess.js';
import { Board } from './board.js';
import { formatScore } from './engine.js';
import { h, store, esc, engine, enginePanel, boardShell, scrollIntoViewIfNeeded, scrollParent } from './ui.js';
import { splitGames, parseGame, mainline, nagToSymbol, moveNumberLabel } from './pgn.js';
import { renderComment, figurine } from './comments.js';
import { fetchSecret, isLoggedIn, login, logout, AuthError } from './auth.js';
import { OpeningBook } from './opbook.js';
import { viewOpeningBook, viewChapter, viewExplorer, viewEcoIndex, prepareOpeningBook } from './openings.js';
import { loadEco, classifyLine } from './eco.js';
import { viewRepBook, viewRepChapter, renderPlan } from './repertoire.js';
import { viewStructBook, viewStructPage, structureOf } from './structures.js';

const app = document.getElementById('app');
const cache = { library: null, books: {}, games: {} };
let cleanup = null;

// ---------- utilidades ----------

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
  if (meta.type === 'openings') {
    const data = JSON.parse(await fetchSecret(`books/${id}/${meta.data}`));
    const book = { ...entry, ...meta, chapters: data.chapters, op: new OpeningBook(data) };
    await prepareOpeningBook(book);
    cache.books[id] = book;
    return book;
  }
  const pgnText = await fetchSecret(`books/${id}/${meta.pgn || 'games.pgn'}.enc`);
  const games = splitGames(pgnText).map((t, i) => ({ index: i, text: t, headers: parseHeaders(t) }));
  const extra = meta.extra ? JSON.parse(await fetchSecret(`books/${id}/${meta.extra}.enc`)) : null;
  cache.books[id] = { ...entry, ...meta, games, extra };
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

let routeId = 0;
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  engine.worker && engine.stop();
  const my = ++routeId;
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + (parts[0] === 'analisis' ? '/analisis' : '/')));
  updateNav();
  app.innerHTML = '';
  window.scrollTo(0, 0);
  if (!isLoggedIn()) return viewLogin();
  try {
    let res;
    if (parts[0] === 'libro' && parts[2] === 'partida') res = await viewGame(parts[1], Number(parts[3]), params);
    else if (parts[0] === 'libro' && parts[1]) {
      app.append(h('p', { class: 'muted loading' }, 'Cargando libro…'));
      const book = await loadBook(parts[1]);
      if (my !== routeId) return;
      app.innerHTML = '';
      if (book.type === 'openings') {
        if (parts[2] === 'cap') res = await viewChapter(app, book, Number(parts[3]), params);
        else if (parts[2] === 'explorador') res = await viewExplorer(app, book, params);
        else if (parts[2] === 'eco') res = await viewEcoIndex(app, book);
        else res = await viewOpeningBook(app, book);
      } else if (book.type === 'repertoire') {
        if (parts[2] === 'cap') res = viewRepChapter(app, book, Number(parts[3]));
        else res = viewRepBook(app, book);
      } else if (book.type === 'structures') {
        if (parts[2] === 'est') res = viewStructPage(app, book, parts[3]);
        else res = viewStructBook(app, book);
      } else res = await viewBook(parts[1]);
    } else if (parts[0] === 'analisis') res = await viewAnalysis(params);
    else res = await viewLibrary();
    if (typeof res === 'function') {
      if (my === routeId) cleanup = res; else res();
    }
  } catch (e) {
    if (my !== routeId) return;
    app.innerHTML = '';
    if (e && e.auth) return viewLogin('Tu sesión ha caducado. Vuelve a entrar.');
    console.error(e);
    app.append(h('div', { class: 'error-box' }, h('h2', {}, 'No se pudo cargar'), h('p', {}, String(e.message || e)), h('a', { class: 'btn', href: '#/' }, 'Volver a la biblioteca')));
  }
}

function updateNav() {
  const nav = document.querySelector('.nav');
  let out = nav.querySelector('.logout');
  if (isLoggedIn() && !out) {
    out = h('a', { class: 'logout', href: '#/', onclick: (e) => { e.preventDefault(); logout(); cache.books = {}; cache.games = {}; route(); } }, 'Salir');
    nav.append(out);
  } else if (!isLoggedIn() && out) out.remove();
  nav.querySelectorAll('a:not(.logout)').forEach((a) => a.classList.toggle('hidden', !isLoggedIn()));
}

// ---------- acceso privado ----------
function viewLogin(msg) {
  const user = h('input', { class: 'search', name: 'username', autocomplete: 'username', placeholder: 'Usuario', required: 'required' });
  const pass = h('input', { class: 'search', type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Contraseña', required: 'required' });
  const remember = h('input', { type: 'checkbox' });
  const err = h('p', { class: 'login-err' }, msg || '');
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'login-box', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Comprobando…'; err.textContent = '';
    let ok = false;
    try { ok = await login(user.value, pass.value, remember.checked); } catch (e2) { err.textContent = 'Error: ' + e2.message; }
    btn.disabled = false; btn.textContent = 'Entrar';
    if (ok) route();
    else if (!err.textContent) { err.textContent = 'Usuario o contraseña incorrectos.'; pass.select(); }
  } },
  h('div', { class: 'logo big' }, '♞'),
  h('h1', {}, 'Chess Coach'),
  h('p', { class: 'muted' }, 'Contenido privado. Los libros están cifrados y sólo se abren con tu usuario y contraseña.'),
  user, pass,
  h('label', { class: 'row' }, remember, ' Recordarme en este dispositivo'),
  btn, err);
  app.append(form);
  user.focus();
}

// ---------- biblioteca ----------
async function viewLibrary() {
  const lib = await loadLibrary();
  app.append(
    h('section', { class: 'hero' },
      h('h1', {}, 'Chess Coach'),
      h('p', {}, 'Estudia los grandes libros de ajedrez: partidas comentadas jugada a jugada, aperturas con su árbol de variantes y explicaciones, explorador por posición, entrenador y análisis con Stockfish.')),
    h('h2', { class: 'section-title' }, 'Capítulos'),
    h('div', { class: 'cards' }, lib.books.map((b, i) =>
      h('a', { class: 'card', href: `#/libro/${b.id}` },
        h('div', { class: 'card-chapter' }, `Capítulo ${i + 1}`),
        h('div', { class: 'card-title' }, b.title),
        h('div', { class: 'card-sub' }, b.author),
        h('div', { class: 'card-meta' }, b.description || '')))),
    h('div', { class: 'fco-actions lib-tools' }, h('a', { class: 'btn', href: '#/libro/fco/explorador' }, '🔎 Explorador de aperturas (FCO)'), h('a', { class: 'btn', href: '#/analisis' }, '♟ Análisis libre')),
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


// ---------- partida (revisión + entrenador) ----------
async function viewGame(bookId, n, params) {
  const book = await loadBook(bookId);
  const game = getGame(book, n);
  const hd = game.headers;
  // Libros con planes en español: repertorio (Kaufman) o estructuras de peones (Sokolov). rep = color
  // cuyo plan se estudia (orientación del tablero y color por defecto del entrenador).
  const isStruct = book.type === 'structures';
  const rep = book.type === 'repertoire' ? (hd.Repertoire === 'Black' ? 'black' : 'white') : isStruct ? (hd.Side === 'Black' ? 'black' : 'white') : null;
  const repCh = book.type === 'repertoire' ? book.extra.chapters.find((c) => String(c.num) === hd.Chapter) : null;
  const gSt = isStruct ? structureOf(book, hd.Structure) : null;
  const copts = { numberedOnly: !!book.numberedOnly };
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
  let fast = false; // true mientras se navega con una tecla mantenida (sin animaciones)

  const { shell, boardEl } = boardShell();
  const board = new Board(boardEl, { onMove: (m) => onBoardMove(m) });
  const commentRegistry = [];

  const currentFen = () => explore ? explore.chess.fen() : preview != null ? commentRegistry[preview].fen : fensBefore[idx];
  const eng = enginePanel(currentFen, board, { onLineClick: null });

  // ---- cabecera
  const title = h('div', { class: 'game-title' },
    h('div', { class: 'gt-players' }, `${hd.White} – ${hd.Black}`, h('span', { class: 'gt-result' }, hd.Result)),
    h('div', { class: 'gt-meta' }, [eventLabel(hd), hd.Site && hd.Site !== '?' ? hd.Site : '', hd.Opening].filter(Boolean).join(' · ')),
    h('div', { class: 'gt-meta eco-line' }));
  loadEco().then((eco) => {
    const c = classifyLine(eco, fensBefore);
    if (c) title.querySelector('.eco-line').textContent = `ECO ${c.eco} · ${c.name}`;
  });
  const prevGame = n > 0 ? h('a', { class: 'btn ghost', title: 'Partida anterior', href: `#/libro/${bookId}/partida/${n - 1}` }, '←', h('span', { class: 'lbl-long' }, ' Anterior')) : null;
  const nextGame = n < book.games.length - 1 ? h('a', { class: 'btn ghost', title: 'Partida siguiente', href: `#/libro/${bookId}/partida/${n + 1}` }, h('span', { class: 'lbl-long' }, 'Siguiente '), '→') : null;

  // ---- controles
  const ctrl = h('div', { class: 'controls' },
    h('button', { class: 'btn icon navbtn', title: 'Inicio', onclick: () => nav('start') }, '⏮'),
    h('button', { class: 'btn icon navbtn', title: 'Atrás (←)', onclick: () => nav(-1) }, '◀'),
    h('button', { class: 'btn icon navbtn', title: 'Adelante (→)', onclick: () => nav(1) }, '▶'),
    h('button', { class: 'btn icon navbtn', title: 'Final', onclick: () => nav('end') }, '⏭'),
    h('button', { class: 'btn icon', title: 'Girar tablero (F)', onclick: () => board.flip() }, '⇅'),
    h('button', { class: 'btn analyse-btn', title: 'Mover piezas libremente desde aquí con Stockfish', onclick: () => startExplore() }, h('span', { class: 'long' }, 'Analizar posición'), h('span', { class: 'short' }, 'Analizar')),
    h('button', { class: 'btn fco-btn', title: 'Buscar esta posición en Fundamental Chess Openings', onclick: () => openInFco(currentFen()) }, 'FCO'));
  const nowComment = h('div', { class: 'now-comment hidden' });
  const banner = h('div', { class: 'banner hidden' });

  // ---- pestañas
  const tabReview = h('button', { class: 'tab', onclick: () => setMode('review') }, 'Revisión');
  const tabTrain = h('button', { class: 'tab', onclick: () => setMode('train') }, 'Entrenador');
  const tabPlan = rep ? h('button', { class: 'tab', onclick: () => setMode('plan') }, 'Planes') : null;
  const panelReview = h('div', { class: 'panel' });
  const panelTrain = h('div', { class: 'panel' });
  const panelPlan = h('div', { class: 'panel plan-panel' });

  // ---- lista de jugadas con comentarios
  const moveList = h('div', { class: 'movelist' });
  // varAnchor[id] = jugada de la partida (idx) a cuyo comentario pertenece la variante: al salir de
  // ella (o al llegar a su final) se vuelve ahí y no a la posición inicial.
  const varAnchor = [];
  const anchorFrom = (from, a) => { for (let k = from; k < commentRegistry.length; k++) varAnchor[k] = a; };
  const intro = game.root.comment ? h('div', { class: 'comment intro', html: renderComment(game.root.comment, fensByPly, startPly, commentRegistry, copts) }) : null;
  anchorFrom(0, 0);
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
      const r0 = commentRegistry.length;
      if (m.comment) c.innerHTML = renderComment(m.comment, fensByPly, m.ply, commentRegistry, copts);
      anchorFrom(r0, i + 1);
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

  // ---- planes típicos (libros de repertorio): plan de esta línea + enlace a los del capítulo
  if (rep) {
    const gp = book.extra.games[hd.Round]?.plan;
    if (isStruct) {
      const others = book.extra.structures.filter((s) => s !== gSt && s.games.includes(hd.Round));
      panelPlan.append(
        h('div', { class: 'plan-head' }, h('b', {}, 'Estructura'),
          gSt ? h('span', {}, ' · ', h('a', { href: `#/libro/${bookId}/est/${gSt.id}` }, `${gSt.id}: ${gSt.title}`)) : null,
          others.length ? h('span', { class: 'muted' }, ' · también: ', ...others.flatMap((s, i) => [i ? ', ' : '', h('a', { href: `#/libro/${bookId}/est/${s.id}` }, s.id)])) : null),
        gp ? h('div', { class: 'plan-box', html: renderPlan(gp, fensByPly, commentRegistry, startPly) })
          : h('p', { class: 'muted' }, 'Los planes de esta partida están en la página de la estructura.'),
        h('p', { class: 'muted small' }, 'Pulsa las jugadas para verlas en el tablero. Los planes generales de la estructura están en su página.'));
    } else panelPlan.append(
      h('div', { class: 'plan-head' }, h('b', {}, `${rep === 'white' ? '♔ Repertorio con blancas' : '♚ Repertorio con negras'}`),
        repCh ? h('span', {}, ' · ', h('a', { href: `#/libro/${bookId}/cap/${repCh.num}` }, `Capítulo ${repCh.num}: ${repCh.title}`)) : null),
      gp ? h('div', { class: 'plan-box', html: renderPlan(gp, fensByPly, commentRegistry, startPly) })
        : h('p', { class: 'muted' }, 'Los planes de esta línea están en la página del capítulo.'),
      h('p', { class: 'muted small' }, 'Pulsa las jugadas para verlas en el tablero. Los planes de todas las líneas del capítulo están en la página del capítulo.'));
    panelPlan.addEventListener('click', (e) => {
      const t = e.target.closest('.cm-move');
      if (!t) return;
      e.stopPropagation();
      planShow(Number(t.dataset.var));
    });
  }

  // variantes de los planes: se anclan a la jugada de la partida desde la que salen (si salen de ella)
  for (let k = 0; k < commentRegistry.length; k++) {
    if (varAnchor[k] != null) continue;
    const first = commentRegistry[commentRegistry[k].seq[0]];
    const j = fensBefore.indexOf(first.before);
    varAnchor[k] = j >= 0 ? j : null;
  }

  const side = h('div', { class: 'side' },
    h('div', { class: 'tabs' }, tabReview, tabTrain, tabPlan),
    panelReview, panelTrain, panelPlan, eng.el);
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', h('a', { href: `#/libro/${bookId}` }, book.title), ' / ',
      repCh ? h('a', { href: `#/libro/${bookId}/cap/${repCh.num}` }, `Capítulo ${repCh.num}`) : null, repCh ? ' / ' : null,
      gSt ? h('a', { href: `#/libro/${bookId}/est/${gSt.id}` }, `Estructura ${gSt.id}`) : null, gSt ? ' / ' : null, `Partida ${hd.Round || n + 1}`),
    h('div', { class: 'game-top' }, title, h('div', { class: 'game-nav' }, prevGame, nextGame)),
    h('div', { class: 'game-layout' }, h('div', { class: 'main' }, shell, banner, nowComment, ctrl), side));

  // ---- lógica
  function go(i) {
    if (mode !== 'review') return;
    i = Math.max(0, Math.min(moves.length, i));
    idx = i;
    explore = null;
    preview = null;
    render();
  }
  // Sale de la variante del libro y vuelve a la jugada de la partida en cuyo comentario está
  // (desde ahí → sigue con la partida).
  function exitVar() {
    if (preview == null) return;
    const a = varAnchor[preview];
    preview = null;
    if (a != null) idx = a;
    render();
  }
  // Navegación: dentro de una variante del libro recorre la variante (al pasar de su principio o de
  // su final vuelve a la partida); si no, la partida.
  function nav(d) {
    if (mode === 'plan') { planNav(d); return; }
    if (mode !== 'review') return;
    if (preview != null && !explore) {
      const seq = commentRegistry[preview].seq;
      const pos = seq.indexOf(preview);
      if (d === 'start') { if (pos === 0) exitVar(); else { preview = seq[0]; render(); } return; }
      if (d === 'end') { preview = seq[seq.length - 1]; render(); return; }
      const np = pos + d;
      if (np < 0 || np >= seq.length) exitVar();
      else { preview = seq[np]; render(); }
      return;
    }
    if (d === 'start') go(0);
    else if (d === 'end') go(moves.length);
    else go(idx + d);
  }
  // Pestaña Planes: ← → recorren la variante pulsada; al salir de ella se vuelve a la partida.
  let planCur = null;
  function planShow(id) {
    const v = commentRegistry[id];
    if (!v) return;
    planCur = id;
    board.set(v.fen, { lastMove: [v.from, v.to], interactive: false, animate: !fast });
    panelPlan.querySelectorAll('.cm-move.current').forEach((x) => x.classList.remove('current'));
    const el = panelPlan.querySelector(`.cm-move[data-var="${id}"]`);
    if (el) { el.classList.add('current'); scrollIntoViewIfNeeded(scrollParent(el), el); }
  }
  function planBack() {
    const a = planCur != null ? varAnchor[planCur] : null;
    planCur = null;
    panelPlan.querySelectorAll('.cm-move.current').forEach((x) => x.classList.remove('current'));
    if (a != null) idx = a;
    board.set(fensBefore[idx], { lastMove: moves[idx - 1] ? [moves[idx - 1].from, moves[idx - 1].to] : null, interactive: false, animate: !fast });
  }
  function planNav(d) {
    if (planCur == null) {
      if (d === 'start') idx = 0; else if (d === 'end') idx = moves.length; else idx = Math.max(0, Math.min(moves.length, idx + d));
      planBack();
      return;
    }
    const seq = commentRegistry[planCur].seq;
    const pos = seq.indexOf(planCur);
    const np = d === 'start' ? 0 : d === 'end' ? seq.length - 1 : pos + d;
    if (np < 0 || np >= seq.length || (d === 'start' && pos === 0)) planBack();
    else planShow(seq[np]);
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
          h('button', { class: 'btn small icon', title: pos >= v.seq.length - 1 ? 'Fin de la variante: volver a la partida (→)' : 'Jugada siguiente de la variante (→)', onclick: () => nav(1) }, pos >= v.seq.length - 1 ? '↩' : '▶'),
          h('button', { class: 'btn small', onclick: () => { explore = { chess: new Chess(v.fen) }; preview = null; render(); } }, 'Seguir analizando'),
          h('button', { class: 'btn small', title: 'Volver a la partida (Esc)', onclick: () => exitVar() }, 'Volver a la partida')));
      banner.classList.remove('hidden');
      board.set(fen, { lastMove: [v.from, v.to], interactive: false, animate: !fast });
      document.querySelectorAll('.cm-move.current').forEach((e) => e.classList.remove('current'));
      document.querySelectorAll(`.cm-move[data-var="${preview}"]`).forEach((e) => e.classList.add('current'));
    } else if (mode === 'review') {
      fen = fensBefore[idx];
      const m = moves[idx - 1];
      board.set(fen, { lastMove: m ? [m.from, m.to] : null, interactive: false, animate: !fast });
      document.querySelectorAll('.cm-move.current').forEach((e) => e.classList.remove('current'));
    }
    // comentario de la jugada actual bajo el tablero (útil en el móvil); se mantiene mientras se
    // recorre una variante suya para poder saltar a las demás variantes del mismo comentario.
    if (mode === 'review' && !explore) {
      const c = commentEls[idx - 1] || (idx === 0 ? intro : null);
      if (nowComment._src !== c) {
        nowComment._src = c;
        nowComment.innerHTML = c ? c.innerHTML : '';
        nowComment.querySelectorAll('.cm-move.current').forEach((e) => e.classList.remove('current'));
        if (preview != null) nowComment.querySelectorAll(`.cm-move[data-var="${preview}"]`).forEach((e) => e.classList.add('current'));
      }
      nowComment.classList.toggle('hidden', !c);
    } else if (mode !== 'review' || explore) nowComment.classList.add('hidden');
    moveEls.forEach((el, k) => el.classList.toggle('current', k === idx - 1 && !explore));
    const cur = moveEls[idx - 1];
    if (cur && mode === 'review') {
      const next = cur.closest('.mrow')?.nextElementSibling;
      const pv = preview != null ? moveList.querySelector(`.cm-move[data-var="${preview}"]`) : null;
      const target = pv || (next && next.classList.contains('comment') ? next : cur);
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
    if (varAnchor[id] != null) idx = varAnchor[id];
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
    const wasTrain = mode === 'train';
    mode = m;
    tabReview.classList.toggle('active', m === 'review');
    tabTrain.classList.toggle('active', m === 'train');
    if (tabPlan) tabPlan.classList.toggle('active', m === 'plan');
    panelReview.classList.toggle('hidden', m !== 'review');
    panelTrain.classList.toggle('hidden', m !== 'train');
    panelPlan.classList.toggle('hidden', m !== 'plan');
    ctrl.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('hidden', m !== 'review'));
    explore = null; preview = null;
    if (m === 'train') trainer.enter();
    else if (m === 'plan') { if (wasTrain) trainer.leave(); if (rep) board.orient(rep); planCur = null; planBack(); nowComment.classList.add('hidden'); }
    else { trainer.leave(); if (rep) board.orient(rep); render(); }
  }

  function makeTrainer() {
    const defaultColor = rep || (/fischer/i.test(hd.White) ? 'white' : /fischer/i.test(hd.Black) ? 'black' : 'white');
    const hero = isStruct ? (/sokolov/i.test(defaultColor === 'white' ? hd.White : hd.Black) ? 'Sokolov' : (defaultColor === 'white' ? hd.White : hd.Black).split(' ').pop()) : rep ? 'el repertorio' : book.hero || 'Fischer';
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
        h('div', { class: 'ts-turn' }, userTurn ? `Tu turno (jugada ${mvNo}): ¿qué ${rep && !isStruct && color === defaultColor ? 'recomienda' : 'jugó'} ${color === defaultColor ? hero : 'el libro'}?` : 'El rival piensa…'),
        h('div', { class: 'ts-score' }, `✔ ${stats.ok}  ✘ ${stats.fail}  · ${stats.total ? Math.round((100 * stats.ok) / stats.total) : 0}% al primer intento`));
    }
    function addFeed(m, mine, extra) {
      const item = h('div', { class: 'feed-item' + (mine ? ' mine' : '') },
        h('div', { class: 'feed-move' }, `${moveNumberLabel(m).replace('...', '…')} ${figurine(m.san)}${m.nags.map(nagToSymbol).join('')}`, extra ? h('span', { class: 'feed-extra' }, extra) : null));
      if (m.comment) item.append(h('div', { class: 'comment', html: renderComment(m.comment, fensByPly, m.ply, commentRegistry, copts) }));
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
      leave() { active = false; board.orient(rep || 'white'); resetSetup(); },
      pause() { },
      resume() { if (active) step(); else board.set(fensBefore[0], { interactive: false }); },
      previewing() { feedback.className = 'train-feedback'; feedback.innerHTML = ''; feedback.append('Mostrando una variante del comentario. ', h('button', { class: 'btn small', onclick: () => step() }, 'Volver al entrenamiento')); },
    };
  }

  // teclado
  // Con la tecla mantenida pulsada (autorrepetición) se quitan las animaciones para que el tablero
  // siga al ritmo de las pulsaciones.
  const onKey = (e) => {
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    fast = e.repeat;
    if (e.key === 'ArrowLeft') { nav(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { nav(1); e.preventDefault(); }
    else if ((e.key === 'Escape' || e.key === 'ArrowUp') && preview != null && !explore) { exitVar(); e.preventDefault(); }
    else if (e.key === 'Escape' && mode === 'plan' && planCur != null) planBack();
    else if (e.key === 'Escape' && explore && mode === 'review') { explore = null; render(); }
    else if (e.key === 'Home') { nav('start'); e.preventDefault(); }
    else if (e.key === 'End') { nav('end'); e.preventDefault(); }
    else if (e.key === 'f') board.flip();
    fast = false;
  };
  window.addEventListener('keydown', onKey);
  cleanup = () => { window.removeEventListener('keydown', onKey); board.destroy(); };

  if ((rep === 'black' || (!rep && /fischer/i.test(hd.Black))) && mode === 'review') board.orient('black');
  setMode(mode);
  if (mode === 'review') go(idx);
  if (game.errors.length) console.warn('Errores PGN', game.errors);
}


// Busca una posición en el libro de aperturas y abre el explorador allí.
async function openInFco(fen) {
  const note = h('div', { class: 'toast' }, 'Buscando la posición en FCO…');
  document.body.append(note);
  try {
    const book = await loadBook('fco');
    const n = book.op.findFen(fen);
    if (n >= 0) { location.hash = `#/libro/fco/explorador?n=${n}`; note.remove(); return; }
    note.textContent = 'Esta posición no aparece en Fundamental Chess Openings.';
  } catch (e) {
    note.textContent = e.auth ? 'Inicia sesión de nuevo.' : 'No se pudo abrir FCO.';
  }
  setTimeout(() => note.remove(), 3500);
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
        h('button', { class: 'btn icon', onclick: () => board.flip() }, '⇅'), promo,
        h('button', { class: 'btn fco-btn', title: 'Buscar esta posición en Fundamental Chess Openings', onclick: () => openInFco(chess.fen()) }, 'FCO'))),
      h('div', { class: 'side' },
        h('h3', {}, 'Análisis con Stockfish'),
        h('label', { class: 'lbl' }, 'FEN'),
        h('div', { class: 'fen-row' }, fenInput, h('button', { class: 'btn', onclick: () => { try { chess.load(fenInput.value.trim()); base = chess.fen(); render(); } catch { alert('FEN no válida'); } } }, 'Cargar')),
        h('label', { class: 'lbl' }, 'Jugadas'), hist, eng.el)));
  cleanup = () => board.destroy();
  render();
}

route();
