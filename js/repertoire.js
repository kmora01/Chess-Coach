// Libros de repertorio (Kaufman): partidas modelo agrupadas en partes (blancas / negras) y capítulos,
// con la introducción del libro y los planes típicos de cada apertura explicados en español.
import { Chess } from '../vendor/chess.js';
import { Board } from './board.js';
import { h, store, boardShell } from './ui.js';
import { renderComment, figurine } from './comments.js';
import { miniBoard } from './miniboard.js';

const START = new Chess().fen();

// Texto de planes (markdown sencillo: ### títulos, - listas, **negrita**, *cursiva*) → HTML.
// Las jugadas numeradas se enlazan con renderComment (desde fensByPly, p. ej. la partida o la posición
// inicial) y las jugadas sueltas (…Bg7, Nf3) se muestran con figuras.
export function renderPlan(md, fensByPly, registry, contextPly = 0) {
  const inline = (t) => {
    let html = renderComment(t, fensByPly, contextPly, registry, { numberedOnly: true });
    html = html.replace(/(^|[\s(…\/,;])([KQRBN])(?=x?[a-h][1-8])/g, (m, a, p) => a + figurine(p));
    return html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  };
  const out = [];
  let list = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) { if (list) { out.push(list + '</ul>'); list = null; } continue; }
    const li = /^[-•]\s+(.*)$/.exec(line);
    if (li) { list = (list || '<ul>') + `<li>${inline(li[1])}</li>`; continue; }
    if (list) { out.push(list + '</ul>'); list = null; }
    const hd = /^(#{2,4})\s+(.*)$/.exec(line);
    if (hd) out.push(`<h${hd[1].length + 1}>${inline(hd[2])}</h${hd[1].length + 1}>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(list + '</ul>');
  return out.join('');
}

const sideLabel = (s) => (s === 'white' ? 'Repertorio con blancas' : 'Repertorio con negras');
const gameIndex = (book) => Object.fromEntries(book.games.map((g) => [g.headers.Round, g.index]));

export function viewRepBook(app, book) {
  const progress = store.get(`progress:${book.id}`, {});
  const idx = gameIndex(book);
  const filter = h('input', { type: 'search', placeholder: 'Buscar apertura, jugador, año…', class: 'search' });
  const results = h('div', { class: 'game-list hidden' });
  const parts = h('div', { class: 'rep-parts' });
  for (const part of book.extra.parts) {
    const chs = book.extra.chapters.filter((c) => c.side === part.side);
    const ng = chs.reduce((a, c) => a + c.games.length, 0);
    const done = chs.reduce((a, c) => a + c.games.filter((id) => progress[idx[id]]).length, 0);
    parts.append(h('section', { class: 'rep-part' },
      h('h2', { class: 'section-title' }, `${part.side === 'white' ? '♔' : '♚'} ${sideLabel(part.side)}`,
        h('span', { class: 'muted small' }, ` · ${chs.length} capítulos · ${ng} partidas${done ? ` · ${done} entrenadas` : ''}`)),
      part.plan ? h('div', { class: 'plan-box', html: renderPlan(part.plan, { 0: START }, []) }) : null,
      part.intro.length ? h('details', { class: 'book-intro' }, h('summary', {}, `Introducción del libro: ${part.title} (inglés)`),
        h('div', {}, part.intro.map((x) => (x.p ? h('p', {}, figText(x.p)) : null)))) : null,
      h('div', { class: 'cards' }, chs.map((c) => h('a', { class: 'card', href: `#/libro/${book.id}/cap/${c.num}` },
        h('div', { class: 'card-chapter' }, `Capítulo ${c.num}`),
        h('div', { class: 'card-title' }, figText(c.title)),
        h('div', { class: 'card-meta' }, `${c.games.length} partidas modelo` + (c.games.some((id) => progress[idx[id]]) ? ` · ${c.games.filter((id) => progress[idx[id]]).length} entrenadas` : '')))))));
  }
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    results.classList.toggle('hidden', !q);
    parts.classList.toggle('hidden', !!q);
    results.innerHTML = '';
    if (!q) return;
    for (const g of book.games) {
      const hd = g.headers;
      const ch = book.extra.chapters.find((c) => String(c.num) === hd.Chapter);
      const text = `${hd.Round} ${hd.White} ${hd.Black} ${hd.Opening} ${hd.Event} ${hd.Date} ${ch ? ch.title : ''}`.toLowerCase();
      if (!text.includes(q)) continue;
      results.append(gameRow(book, g, progress));
    }
    if (!results.children.length) results.append(h('p', { class: 'muted' }, 'Nada encontrado.'));
  };
  filter.addEventListener('input', render);
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', book.title),
    h('header', { class: 'book-head' }, h('h1', {}, book.title), h('p', {}, book.author), book.note ? h('p', { class: 'muted' }, book.note) : null),
    filter, results, parts);
}

function gameRow(book, g, progress) {
  const hd = g.headers;
  const p = progress[g.index];
  const side = hd.Repertoire === 'Black' ? 'black' : 'white';
  return h('a', { class: 'game-row rep-row', href: `#/libro/${book.id}/partida/${g.index}` },
    h('span', { class: 'game-num' }, hd.Round),
    h('span', { class: 'game-opening rep-op' }, h('span', { class: 'pc ' + (side === 'white' ? 'w' : 'b') }, side === 'white' ? '♔' : '♚'), ' ', hd.Opening.replace(/^Various Openings – /, '')),
    h('span', { class: 'game-players' }, h('b', {}, hd.White), ' – ', h('b', {}, hd.Black)),
    h('span', { class: 'game-event' }, hd.Event && hd.Event !== '?' ? hd.Event : ''),
    h('span', { class: 'game-result' }, hd.Result === '*' ? '' : hd.Result.replace('1/2-1/2', '½-½')),
    h('span', { class: 'game-progress' }, p ? `${p.best}%` : ''));
}

const FIGS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
function figText(t) { return t.replace(/(^|[\s(…\/,;.])([KQRBN])(?=x?[a-h][1-8])/g, (m, a, p) => a + FIGS[p]); }

// Página de un capítulo: tablero a la izquierda (muestra cualquier jugada que pulses en los planes o
// en la introducción) y, a la derecha, planes típicos, introducción del libro y partidas.
export function viewRepChapter(app, book, num) {
  const ch = book.extra.chapters.find((c) => c.num === num);
  if (!ch) throw new Error('Capítulo no encontrado');
  const progress = store.get(`progress:${book.id}`, {});
  const idx = gameIndex(book);
  const { shell, boardEl } = boardShell();
  const board = new Board(boardEl, { orientation: ch.side });
  board.set(START, { interactive: false });
  const registry = [];
  const caption = h('div', { class: 'rep-caption muted' }, 'Pulsa cualquier jugada de los planes o de la introducción para verla en el tablero.');
  let current = null;
  const show = (id) => {
    const v = registry[id];
    if (!v) return;
    current = id;
    board.set(v.fen, { lastMove: [v.from, v.to], interactive: false });
    app.querySelectorAll('.cm-move.current').forEach((e) => e.classList.remove('current'));
    app.querySelectorAll(`.cm-move[data-var="${id}"]`).forEach((e) => e.classList.add('current'));
    caption.textContent = 'Variante: ' + v.seq.map((k) => registry[k].label).join(' ');
  };
  const step = (d) => {
    if (current == null) return;
    const seq = registry[current].seq;
    const k = seq.indexOf(current) + d;
    if (k >= 0 && k < seq.length) show(seq[k]);
  };
  const ctrl = h('div', { class: 'controls' },
    h('button', { class: 'btn icon', title: 'Jugada anterior (←)', onclick: () => step(-1) }, '◀'),
    h('button', { class: 'btn icon', title: 'Jugada siguiente (→)', onclick: () => step(1) }, '▶'),
    h('button', { class: 'btn icon', title: 'Girar tablero', onclick: () => board.flip() }, '⇅'),
    h('button', { class: 'btn', onclick: () => { location.hash = `#/analisis?fen=${encodeURIComponent(board.fen)}`; } }, 'Analizar posición'));

  const content = h('div', { class: 'rep-content' });
  content.append(h('h2', {}, `Capítulo ${ch.num}. ${figText(ch.title)}`), h('p', { class: 'muted' }, sideLabel(ch.side)));
  if (ch.plan) content.append(h('div', { class: 'plan-box' }, h('h3', {}, 'Planes típicos'), h('div', { html: renderPlan(ch.plan, { 0: START }, registry) })));
  content.append(h('h3', {}, 'Partidas modelo'),
    h('div', { class: 'game-list' }, ch.games.map((id) => gameRow(book, book.games[idx[id]], progress))));
  const intro = h('div', { class: 'book-intro-body' });
  for (const x of ch.intro) {
    if (x.p) intro.append(h('div', { class: 'comment intro', html: renderComment(x.p, { 0: START }, 0, registry, { numberedOnly: true }) }));
    else if (x.diag) intro.append(h('div', { class: 'diagram' }, miniBoard(x.diag, { flip: x.flip, size: '220px' })));
  }
  content.append(h('details', { class: 'book-intro', open: ch.plan ? null : 'open' }, h('summary', {}, 'Introducción del capítulo en el libro (inglés)'), intro));
  content.addEventListener('click', (e) => {
    const t = e.target.closest('.cm-move');
    if (t) { e.preventDefault(); show(Number(t.dataset.var)); }
  });
  const prev = book.extra.chapters.find((c) => c.num === num - 1);
  const next = book.extra.chapters.find((c) => c.num === num + 1);
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', h('a', { href: `#/libro/${book.id}` }, book.title), ' / ', `Capítulo ${ch.num}`),
    h('div', { class: 'game-top' }, h('div', { class: 'game-title' }, h('div', { class: 'gt-players' }, figText(ch.title)), h('div', { class: 'gt-meta' }, sideLabel(ch.side))),
      h('div', { class: 'game-nav' },
        prev ? h('a', { class: 'btn ghost', href: `#/libro/${book.id}/cap/${prev.num}` }, '←', h('span', { class: 'lbl-long' }, ' Anterior')) : null,
        next ? h('a', { class: 'btn ghost', href: `#/libro/${book.id}/cap/${next.num}` }, h('span', { class: 'lbl-long' }, 'Siguiente '), '→') : null)),
    h('div', { class: 'game-layout rep-layout' }, h('div', { class: 'main sticky' }, shell, caption, ctrl), h('div', { class: 'side rep-side' }, content)));
  const onKey = (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  return () => { window.removeEventListener('keydown', onKey); board.destroy(); };
}
