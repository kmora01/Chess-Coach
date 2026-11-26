// Libros de estructuras de peones (Sokolov, Winning Chess Middlegames): capítulos por tipo de estructura,
// cada estructura con su diagrama, los planes explicados en español, la introducción del libro y sus
// partidas modelo.
import { Chess } from '../vendor/chess.js';
import { Board } from './board.js';
import { h, store, boardShell } from './ui.js';
import { renderComment } from './comments.js';
import { miniBoard } from './miniboard.js';
import { renderPlan } from './repertoire.js';

const START = new Chess().fen();
const FIGS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const figText = (t) => (t || '').replace(/(^|[\s(…\/,;.])([KQRBN])(?=x?[a-h][1-8])/g, (m, a, p) => a + FIGS[p]);
const gameIndex = (book) => Object.fromEntries(book.games.map((g) => [g.headers.Round, g.index]));

export function structureOf(book, id) { return book.extra.structures.find((s) => s.id === id); }

export function structGameRow(book, g, progress) {
  const hd = g.headers;
  const p = progress[g.index];
  return h('a', { class: 'game-row rep-row', href: `#/libro/${book.id}/partida/${g.index}` },
    h('span', { class: 'game-num' }, hd.Round),
    h('span', { class: 'game-opening rep-op' }, `${hd.Opening}`, h('span', { class: 'muted small' }, ` · ${hd.ECO || ''}`)),
    h('span', { class: 'game-players' }, h('b', {}, hd.White), ' – ', h('b', {}, hd.Black)),
    h('span', { class: 'game-event' }, hd.Event && hd.Event !== '?' ? hd.Event : ''),
    h('span', { class: 'game-result' }, hd.Result === '*' ? '' : hd.Result.replace('1/2-1/2', '½-½')),
    h('span', { class: 'game-progress' }, p ? `${p.best}%` : ''));
}

export function viewStructBook(app, book) {
  const progress = store.get(`progress:${book.id}`, {});
  const idx = gameIndex(book);
  const filter = h('input', { type: 'search', placeholder: 'Buscar estructura, jugador, apertura, año…', class: 'search' });
  const results = h('div', { class: 'game-list hidden' });
  const parts = h('div', { class: 'rep-parts' });
  if (book.extra.plan) parts.append(h('div', { class: 'plan-box', html: renderPlan(book.extra.plan, { 0: START }, []) }));
  for (const part of book.extra.parts) {
    const sts = part.structures.map((id) => structureOf(book, id)).filter(Boolean);
    const gids = [...new Set(sts.flatMap((s) => s.games))];
    const done = gids.filter((id) => progress[idx[id]]).length;
    parts.append(h('section', { class: 'rep-part' },
      h('h2', { class: 'section-title' }, `Capítulo ${part.num}. ${part.title}`,
        h('span', { class: 'muted small' }, ` · ${sts.length} estructuras · ${gids.length} partidas${done ? ` · ${done} entrenadas` : ''}`)),
      part.plan ? h('details', { class: 'book-intro plan-details' }, h('summary', {}, `Ideas clave: ${part.title.toLowerCase()}`),
        h('div', { class: 'plan-box', html: renderPlan(part.plan, { 0: START }, []) })) : null,
      part.intro.length ? h('details', { class: 'book-intro' }, h('summary', {}, `Introducción del libro: ${part.titleEn} (inglés)`),
        h('div', {}, part.intro.map((p) => h('p', {}, figText(p))))) : null,
      h('div', { class: 'cards struct-cards' }, sts.map((s) => h('a', { class: 'card struct-card', href: `#/libro/${book.id}/est/${s.id}` },
        s.diag ? h('div', { class: 'struct-mini' }, miniBoard(s.diag, { size: '120px' })) : null,
        h('div', {},
          h('div', { class: 'card-chapter' }, `Estructura ${s.id}`),
          h('div', { class: 'card-title' }, figText(s.title)),
          h('div', { class: 'card-meta' }, `${s.games.length} ${s.games.length === 1 ? 'partida' : 'partidas'}` +
            (s.games.some((id) => progress[idx[id]]) ? ` · ${s.games.filter((id) => progress[idx[id]]).length} entrenadas` : ''))))))));
  }
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    results.classList.toggle('hidden', !q);
    parts.classList.toggle('hidden', !!q);
    results.innerHTML = '';
    if (!q) return;
    for (const s of book.extra.structures) {
      if (`${s.id} ${s.title} ${s.titleEn}`.toLowerCase().includes(q)) {
        results.append(h('a', { class: 'game-row rep-row', href: `#/libro/${book.id}/est/${s.id}` },
          h('span', { class: 'game-num' }, s.id), h('span', { class: 'game-opening rep-op' }, 'Estructura: ' + figText(s.title))));
      }
    }
    for (const g of book.games) {
      const hd = g.headers;
      const st = structureOf(book, hd.Structure);
      const text = `${hd.Round} ${hd.White} ${hd.Black} ${hd.Opening} ${hd.ECO} ${hd.Event} ${hd.Date} ${st ? st.title + ' ' + st.titleEn : ''}`.toLowerCase();
      if (text.includes(q)) results.append(structGameRow(book, g, progress));
    }
    if (!results.children.length) results.append(h('p', { class: 'muted' }, 'Nada encontrado.'));
  };
  filter.addEventListener('input', render);
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', book.title),
    h('header', { class: 'book-head' }, h('h1', {}, book.title), h('p', {}, book.author), book.note ? h('p', { class: 'muted' }, book.note) : null),
    filter, results, parts);
}

// Página de una estructura: tablero con el esqueleto de peones (las jugadas que pulses en los planes o
// en la introducción se ven en él) y, a la derecha, planes en español, partidas e introducción del libro.
export function viewStructPage(app, book, id) {
  const st = structureOf(book, id);
  if (!st) throw new Error('Estructura no encontrada');
  const all = book.extra.structures;
  const k = all.indexOf(st);
  const prev = all[k - 1];
  const next = all[k + 1];
  const progress = store.get(`progress:${book.id}`, {});
  const idx = gameIndex(book);
  const { shell, boardEl } = boardShell();
  const board = new Board(boardEl, { orientation: 'white' });
  const showStruct = () => { if (st.diag) board.setStatic(st.diag); };
  board.set(START, { interactive: false });
  showStruct();
  const registry = [];
  const caption = h('div', { class: 'rep-caption muted' }, 'Esqueleto de peones de la estructura. Pulsa cualquier jugada del texto para verla en el tablero.');
  let current = null;
  const show = (vid) => {
    const v = registry[vid];
    if (!v) return;
    current = vid;
    board.set(v.fen, { lastMove: [v.from, v.to], interactive: false });
    app.querySelectorAll('.cm-move.current').forEach((e) => e.classList.remove('current'));
    app.querySelectorAll(`.cm-move[data-var="${vid}"]`).forEach((e) => e.classList.add('current'));
    caption.textContent = 'Variante: ' + v.seq.map((x) => registry[x].label).join(' ');
  };
  const step = (d) => {
    if (current == null) return;
    const seq = registry[current].seq;
    const j = seq.indexOf(current) + d;
    if (j >= 0 && j < seq.length) show(seq[j]);
  };
  const ctrl = h('div', { class: 'controls' },
    h('button', { class: 'btn icon', title: 'Jugada anterior (←)', onclick: () => step(-1) }, '◀'),
    h('button', { class: 'btn icon', title: 'Jugada siguiente (→)', onclick: () => step(1) }, '▶'),
    h('button', { class: 'btn', title: 'Volver al esqueleto de peones', onclick: () => { current = null; showStruct(); caption.textContent = 'Esqueleto de peones de la estructura.'; app.querySelectorAll('.cm-move.current').forEach((e) => e.classList.remove('current')); } }, 'Estructura'),
    h('button', { class: 'btn icon', title: 'Girar tablero', onclick: () => board.flip() }, '⇅'));

  const content = h('div', { class: 'rep-content' });
  content.append(h('h2', {}, `Estructura ${st.id}. ${figText(st.title)}`),
    h('p', { class: 'muted' }, `Capítulo ${st.chapter}: ${book.extra.parts.find((p) => p.num === st.chapter)?.title || ''}` + (st.titleEn ? ` · En el libro: “${figText(st.titleEn)}”` : '')));
  if (st.plan) content.append(h('div', { class: 'plan-box' }, h('h3', {}, 'Planes típicos'), h('div', { html: renderPlan(st.plan, { 0: START }, registry) })));
  if (st.games.length) {
    content.append(h('h3', {}, 'Partidas modelo'),
      h('div', { class: 'game-list' }, st.games.map((gid) => structGameRow(book, book.games[idx[gid]], progress))));
  }
  if (st.intro.length) {
    const intro = h('div', { class: 'book-intro-body' });
    for (const p of st.intro) intro.append(h('div', { class: 'comment intro', html: renderComment(p, { 0: START }, 0, registry, { numberedOnly: true }) }));
    content.append(h('details', { class: 'book-intro', open: st.plan ? null : 'open' }, h('summary', {}, 'Texto del libro sobre esta estructura (inglés)'), intro));
  }
  content.addEventListener('click', (e) => {
    const t = e.target.closest('.cm-move');
    if (t) { e.preventDefault(); show(Number(t.dataset.var)); }
  });
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', h('a', { href: `#/libro/${book.id}` }, book.title), ' / ', `Estructura ${st.id}`),
    h('div', { class: 'game-top' }, h('div', { class: 'game-title' }, h('div', { class: 'gt-players' }, figText(st.title)), h('div', { class: 'gt-meta' }, `Estructura ${st.id}`)),
      h('div', { class: 'game-nav' },
        prev ? h('a', { class: 'btn ghost', href: `#/libro/${book.id}/est/${prev.id}` }, '←', h('span', { class: 'lbl-long' }, ' Anterior')) : null,
        next ? h('a', { class: 'btn ghost', href: `#/libro/${book.id}/est/${next.id}` }, h('span', { class: 'lbl-long' }, 'Siguiente '), '→') : null)),
    h('div', { class: 'game-layout rep-layout' }, h('div', { class: 'main sticky' }, shell, caption, ctrl), h('div', { class: 'side rep-side' }, content)));
  const onKey = (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  return () => { window.removeEventListener('keydown', onKey); board.destroy(); };
}
