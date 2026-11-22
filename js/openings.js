// Vistas del libro de aperturas (FCO): índice de capítulos, estudio con texto + árbol de variantes,
// explorador de aperturas por posición, índice ECO y entrenador de repertorio.
import { Chess } from '../vendor/chess.js';
import { Board } from './board.js';
import { h, store, engine, enginePanel, boardShell, scrollIntoViewIfNeeded } from './ui.js';
import { fig } from './opbook.js';
import { loadEco, ecoAt, posKey } from './eco.js';
import { miniBoard } from './miniboard.js';

const base = (book) => `#/libro/${book.id}`;

function ecoLabel(eco, op, n) {
  const k = op.eco[n];
  if (k == null || k < 0 || !eco.rows[k]) return '';
  return `${eco.rows[k][0]} · ${eco.rows[k][1]}`;
}

// ---------------------------------------------------------------- índice del libro
export async function viewOpeningBook(app, book) {
  const op = book.op;
  const eco = await loadEco();
  const progress = store.get(`progress:${book.id}`, {});
  const q = h('input', { type: 'search', class: 'search', placeholder: 'Buscar apertura, variante o jugadas (p. ej. "Najdorf", "Catalan", "1 d4 Nf6 2 c4 e6")…' });
  const results = h('div', { class: 'search-results hidden' });
  const chapters = h('div', { class: 'fco-chapters' });
  let part = null;
  book.chapters.forEach((ch, ci) => {
    if (ch.part || ci === 0) {
      part = h('div', { class: 'fco-part' }, h('h2', { class: 'section-title' }, ch.title));
      chapters.append(part);
      if (ch.part || ci === 0) {
        const intro = h('a', { class: 'fco-intro', href: `${base(book)}/cap/${ci}` }, ci === 0 ? 'Leer: El primer movimiento' : `Introducción: ${ch.title}`);
        part.append(intro);
      }
      if (ci === 0) return;
      if (ch.part) { part.append(h('div', { class: 'cards fco-cards' })); return; }
    }
    const grid = part.querySelector('.fco-cards') || part.appendChild(h('div', { class: 'cards fco-cards' }));
    const first = chapterStart(ch);
    const secs = ch.sections.filter((s) => s.title);
    const p = progress[ci];
    grid.append(h('a', { class: 'card fco-card', href: `${base(book)}/cap/${ci}` },
      h('div', { class: 'card-chapter' }, first ? op.path(first).map((n) => op.numLabel(n, false) + fig(op.san[n])).join(' ') : ''),
      h('div', { class: 'card-title' }, ch.title),
      h('div', { class: 'card-meta' }, first ? ecoLabel(eco, op, first) : ''),
      h('div', { class: 'card-meta' }, `${secs.length} secciones`, p ? h('span', { class: 'game-progress' }, ` · entrenado ${p.best}%`) : null)));
  });
  const doSearch = () => {
    const term = q.value.trim().toLowerCase();
    results.innerHTML = '';
    results.classList.toggle('hidden', term.length < 3);
    if (term.length < 3) return;
    const hits = [];
    // ¿una secuencia de jugadas?
    const moves = term.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
    let n = 0;
    let okMoves = moves.length > 0;
    for (const m of moves) {
      const c = op.children[n].find((x) => !op.isIdea(x) && op.san[x].toLowerCase().replace(/[+#]/g, '') === m.replace(/[+#]/g, '').replace(/^0-0-0$/, 'o-o-o').replace(/^0-0$/, 'o-o'));
      if (c == null) { okMoves = false; break; }
      n = c;
    }
    if (okMoves && n > 0) hits.push(h('a', { class: 'sr', href: `${base(book)}/explorador?n=${n}` }, h('b', {}, 'Explorador: '), op.path(n).map((x) => op.numLabel(x, false) + fig(op.san[x])).join(' ')));
    book.chapters.forEach((ch, ci) => ch.sections.forEach((s, si) => {
      if (s.title && s.title.toLowerCase().includes(term)) hits.push(h('a', { class: 'sr', href: `${base(book)}/cap/${ci}?s=${si}` }, h('b', {}, ch.title), ' › ', s.title));
    }));
    const seen = new Set();
    for (const r of eco.rows) {
      if (hits.length > 60) break;
      if (!r[1].toLowerCase().includes(term) || seen.has(r[1])) continue;
      const node = book.ecoNodes.get(posKey(r[2]));
      if (node == null) continue;
      seen.add(r[1]);
      hits.push(h('a', { class: 'sr', href: `${base(book)}/explorador?n=${node}` }, h('span', { class: 'eco-code' }, r[0]), ' ', r[1]));
    }
    if (!hits.length) hits.push(h('div', { class: 'muted sr' }, 'Sin resultados.'));
    results.append(...hits);
  };
  q.addEventListener('input', doSearch);
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', book.title),
    h('header', { class: 'book-head' }, h('h1', {}, book.title), h('p', {}, book.author), book.note ? h('p', { class: 'muted' }, book.note) : null),
    h('div', { class: 'fco-actions' },
      h('a', { class: 'btn primary', href: `${base(book)}/explorador` }, '🔎 Explorador de aperturas'),
      h('a', { class: 'btn', href: `${base(book)}/eco` }, '📚 Índice ECO'),
      h('a', { class: 'btn', href: `${base(book)}/cap/1?modo=entrenar` }, '🎯 Entrenar repertorio')),
    q, results, chapters);
}

function chapterStart(ch) {
  for (const s of ch.sections) for (const b of s.blocks) if (b.k === 'diag' && b.node != null) return b.node;
  return firstMainNode(ch);
}

function firstMainNode(ch) {
  for (const s of ch.sections) for (const b of s.blocks) if (b.k === 'main' && b.nodes.length) return b.nodes[b.nodes.length - 1][0];
  return null;
}

// ---------------------------------------------------------------- capítulo (estudio)
export async function viewChapter(app, book, ci, params) {
  const op = book.op;
  const eco = await loadEco();
  const ch = book.chapters[ci];
  if (!ch) { app.append(h('p', {}, 'Capítulo no encontrado.')); return () => {}; }

  // nodos que pertenecen a este capítulo (citados en él, más sus antecesores)
  const inCh = new Uint8Array(op.size);
  const mark = (n) => { while (n > 0 && !inCh[n]) { inCh[n] = 1; n = op.parent[n]; } };
  ch.sections.forEach((s) => {
    (s.nodes || []).forEach(mark);
    s.blocks.forEach((b) => {
      if (b.k === 'main') b.nodes.forEach(([n]) => mark(n));
      else if (b.k === 'p') b.segs.forEach((x) => typeof x === 'object' && mark(x.m));
      else if (b.k === 'diag' && b.node != null) mark(b.node);
    });
  });
  inCh[0] = 1;
  const kids = (n) => op.children[n].filter((c) => inCh[c]);
  // raíz del capítulo: la primera posición donde el árbol del capítulo se ramifica o empieza el texto
  let root = 0;
  const firstMain = firstMainNode(ch);
  if (firstMain) {
    const pth = op.path(firstMain);
    root = pth.length > 1 ? pth[pth.length - 2] : 0;
    // subir mientras el antecesor sólo tenga este hijo en el capítulo
    while (root > 0 && kids(op.parent[root]).length === 1 && !op.isMain[root]) root = op.parent[root];
  }
  if (root > 0) {
    // si el capítulo cita variantes que salen antes de la raíz, subir hasta su ancestro común
    let r = root;
    for (let i = 1; i < op.size; i++) if (inCh[i] && op.depth[i] <= op.depth[r] && !isAnc(op, r, i) && !isAnc(op, i, r)) { r = common(op, r, i); }
    root = r;
  }

  // posición de partida: la del primer diagrama del capítulo (la que define la apertura)
  let firstDiag = null;
  for (const s of ch.sections) { for (const b of s.blocks) if (b.k === 'diag' && b.node != null) { firstDiag = b.node; break; } if (firstDiag != null) break; }
  let cur = Number(params.get('n')) || (firstDiag ?? firstMain ?? root);
  let explore = null; // análisis libre desde la posición actual
  const mode = { v: params.get('modo') === 'entrenar' ? 'train' : 'text' };

  const { shell, boardEl } = boardShell();
  const board = new Board(boardEl, { onMove: (m) => onBoardMove(m) });
  const getFen = () => (explore ? explore.fen() : op.fen(cur));
  const eng = enginePanel(getFen, board);
  const showArrows = { v: store.get('fcoArrows', true) };

  // ---- cabecera e información de la posición
  const posInfo = h('div', { class: 'pos-info' });
  const lineStrip = h('div', { class: 'line-strip' });
  const contBox = h('div', { class: 'cont-box' });
  const banner = h('div', { class: 'banner hidden' });
  const arrowsToggle = h('input', { type: 'checkbox' });
  arrowsToggle.checked = showArrows.v;
  arrowsToggle.addEventListener('change', () => { showArrows.v = arrowsToggle.checked; store.set('fcoArrows', showArrows.v); render(false); });

  const ctrl = h('div', { class: 'controls' },
    h('button', { class: 'btn icon navbtn', title: 'Inicio del capítulo (Inicio)', onclick: () => go(root) }, '⏮'),
    h('button', { class: 'btn icon navbtn', title: 'Atrás (←)', onclick: () => back() }, '◀'),
    h('button', { class: 'btn icon navbtn', title: 'Adelante: jugada principal (→)', onclick: () => fwd() }, '▶'),
    h('button', { class: 'btn icon navbtn', title: 'Variante siguiente (↓)', onclick: () => sib(1) }, '⤵'),
    h('button', { class: 'btn icon', title: 'Girar tablero (F)', onclick: () => board.flip() }, '⇅'),
    h('button', { class: 'btn analyse-btn', title: 'Mover piezas libremente desde aquí con Stockfish', onclick: () => startExplore() }, h('span', { class: 'long' }, 'Analizar posición'), h('span', { class: 'short' }, 'Analizar')));

  // ---- texto del capítulo
  const textPane = h('div', { class: 'fco-text movelist' });
  const toc = h('select', { class: 'mini toc' }, h('option', { value: '' }, 'Ir a la sección…'));
  const spansByNode = new Map();
  const secEls = [];
  const addSpan = (n, el) => { if (!spansByNode.has(n)) spansByNode.set(n, []); spansByNode.get(n).push(el); };
  ch.sections.forEach((s, si) => {
    const secEl = h('section', { class: 'fco-sec', 'data-sec': si });
    secEls[si] = secEl;
    if (s.title) {
      const hd = h(si === 0 ? 'h2' : 'h3', { class: 'fco-h' }, s.title);
      if (s.nodes && s.nodes.length) {
        const last = s.nodes[s.nodes.length - 1];
        hd.classList.add('linked');
        hd.addEventListener('click', () => go(last, { scroll: false }));
        addSpan(last, hd);
      }
      secEl.append(hd);
      toc.append(h('option', { value: String(si) }, s.title));
    } else if (si === 0) {
      secEl.append(h('h2', { class: 'fco-h' }, ch.title));
    }
    for (const b of s.blocks) {
      if (b.k === 'main') {
        if (!b.nodes.length) continue;
        const row = h('div', { class: 'fco-main' });
        b.nodes.forEach(([n, ann], k) => {
          const el = h('span', { class: 'mv fco-mv', 'data-n': n }, (k === 0 ? op.numLabel(n, true) + ' ' : '') + fig(op.san[n]) + (ann || ''));
          addSpan(n, el);
          row.append(el, ' ');
        });
        secEl.append(row);
      } else if (b.k === 'p') {
        const p = h('p', { class: 'fco-p' });
        for (const sg of b.segs) {
          if (typeof sg === 'string') p.append(sg);
          else {
            const el = h('span', { class: 'cm-move' + (sg.b ? ' bold' : '') + (sg.idea ? ' idea' : ''), 'data-n': sg.m, title: sg.idea ? 'Idea / plan (el rival no mueve)' : null }, figText(sg.t));
            addSpan(sg.m, el);
            p.append(el);
          }
        }
        secEl.append(p);
      } else if (b.k === 'diag' && b.node != null) {
        const d = h('figure', { class: 'fco-diag', 'data-n': b.node, title: 'Ver esta posición en el tablero' },
          miniBoard(op.fen(b.node), { lastMove: op.lastMove(b.node) }),
          h('figcaption', {}, (b.turn || op.fen(b.node).split(' ')[1]) === 'w' ? 'Juegan blancas' : 'Juegan negras'));
        addSpan(b.node, d);
        secEl.append(d);
      }
    }
    textPane.append(secEl);
  });
  toc.addEventListener('change', () => {
    const si = Number(toc.value);
    if (toc.value === '') return;
    const s = ch.sections[si];
    const target = s.nodes?.length ? s.nodes[s.nodes.length - 1] : null;
    secEls[si].scrollIntoView({ block: 'start' });
    textPane.scrollTop = secEls[si].offsetTop - textPane.offsetTop;
    if (target != null) go(target, { scroll: false });
    toc.value = '';
  });
  textPane.addEventListener('click', (e) => {
    const t = e.target.closest('[data-n]');
    if (!t) return;
    go(Number(t.dataset.n), { scroll: false, from: t });
  });

  // ---- árbol de variantes
  const treePane = h('div', { class: 'fco-tree movelist' });
  const treeSpans = new Map();
  let treeBuilt = false;
  const buildTree = () => {
    if (treeBuilt) return;
    treeBuilt = true;
    treePane.innerHTML = '';
    treePane.append(h('div', { class: 'muted tree-help' }, 'Árbol de variantes del capítulo. ← → recorren la línea, ↑ ↓ cambian de variante. Las jugadas en negrita son la línea principal del libro.'));
    // el árbol principal parte de la posición que define el capítulo (su primer diagrama)
    const top = firstDiag ?? firstMain ?? root;
    const pre = (n) => op.path(n).map((x, i) => op.numLabel(x, i === 0) + fig(op.label(x))).join(' ');
    const rootLine = h('div', { class: 'tline lvl0' });
    if (top > 0) rootLine.append(h('span', { class: 'tpre' }, pre(top) + ' '));
    renderLine(top, rootLine, 0, true);
    treePane.append(rootLine);
    // líneas citadas que no salen de esa posición (alternativas previas y transposiciones)
    const anc = new Set([0, ...op.path(top)]);
    const others = [];
    for (const a of anc) if (a !== top) for (const k of kids(a)) if (!anc.has(k)) others.push(k);
    if (others.length) {
      treePane.append(h('h4', { class: 'tree-sub' }, 'Alternativas anteriores y transposiciones citadas en el capítulo'));
      for (const k of others) {
        const blk = h('div', { class: 'tline lvl0 other' });
        if (op.parent[k] > 0) blk.append(h('span', { class: 'tpre' }, pre(op.parent[k]) + ' '));
        blk.append(tmove(k, true), ' ');
        renderLine(k, blk, 1, false);
        treePane.append(blk);
      }
    }
  };
  const tmove = (n, forceNum) => {
    const el = h('span', { class: 'tmv' + (op.isMain[n] ? ' is-main' : '') + (op.isIdea(n) ? ' idea' : ''), 'data-n': n }, (op.numLabel(n, forceNum) ? op.numLabel(n, forceNum) + ' ' : '') + (op.isIdea(n) ? '(…)' : '') + fig(op.label(n)));
    treeSpans.set(n, el);
    return el;
  };
  // pinta la línea que empieza en los hijos de n; las alternativas van entre paréntesis (sangradas en los primeros niveles)
  function renderLine(n, container, level, forceNum) {
    let x = n;
    let force = forceNum;
    let guard = 0;
    while (guard++ < 500) {
      const ks = kids(x);
      if (!ks.length) break;
      const [mainK, ...alts] = ks;
      container.append(tmove(mainK, force), ' ');
      force = false;
      if (alts.length) {
        for (const a of alts) {
          const block = level < 2 ? h('div', { class: `tline lvl${level + 1}` }) : h('span', { class: 'tvar' });
          block.append(level < 2 ? '' : '( ', tmove(a, true), ' ');
          renderLine(a, block, level + 1, false);
          if (level >= 2) block.append(') ');
          container.append(block);
        }
        force = true;
        if (level < 2) {
          const cont = h('div', { class: `tline lvl${level}` });
          container.append(cont);
          container = cont;
        }
      }
      x = mainK;
    }
  }
  treePane.addEventListener('click', (e) => { const t = e.target.closest('[data-n]'); if (t) go(Number(t.dataset.n), { scroll: false }); });

  // ---- entrenador
  const trainer = makeTrainer();

  // ---- pestañas
  const panes = { text: h('div', { class: 'panel' }, h('div', { class: 'pane-tools' }, toc), textPane), tree: h('div', { class: 'panel hidden' }, treePane), train: h('div', { class: 'panel hidden' }, trainer.el) };
  const tabs = {
    text: h('button', { class: 'tab', onclick: () => setMode('text') }, 'Texto'),
    tree: h('button', { class: 'tab', onclick: () => setMode('tree') }, 'Árbol'),
    train: h('button', { class: 'tab', onclick: () => setMode('train') }, 'Entrenar'),
  };
  const side = h('div', { class: 'side' }, h('div', { class: 'tabs' }, tabs.text, tabs.tree, tabs.train), panes.text, panes.tree, panes.train, eng.el);
  const prevCh = ci > 0 ? h('a', { class: 'btn ghost', href: `${base(book)}/cap/${ci - 1}`, title: book.chapters[ci - 1].title }, '←', h('span', { class: 'lbl-long' }, ' Anterior')) : null;
  const nextCh = ci < book.chapters.length - 1 ? h('a', { class: 'btn ghost', href: `${base(book)}/cap/${ci + 1}`, title: book.chapters[ci + 1].title }, h('span', { class: 'lbl-long' }, 'Siguiente '), '→') : null;
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', h('a', { href: base(book) }, book.title), ' / ', ch.title),
    h('div', { class: 'game-top' }, h('div', { class: 'game-title' }, h('div', { class: 'gt-players' }, ch.title), posInfo), h('div', { class: 'game-nav' }, prevCh, nextCh)),
    h('div', { class: 'game-layout' },
      h('div', { class: 'main' }, shell, banner, ctrl, lineStrip,
        h('div', { class: 'cont-head' }, h('b', {}, 'Continuaciones del libro'), h('label', { class: 'switch small' }, arrowsToggle, h('span', {}, 'flechas'))), contBox),
      side));
  board.redraw(); // el tablero se creó fuera del documento: recalcular medidas antes de dibujar flechas

  // ---- lógica
  function go(n, { scroll = true, from = null } = {}) {
    if (n == null || n < 0) return;
    if (mode.v === 'train') return;
    cur = n;
    explore = null;
    render(scroll, from);
    history.replaceState(null, '', `${base(book)}/cap/${ci}?n=${cur}`);
  }
  function fwd() { const ks = kids(cur); const all = ks.length ? ks : op.children[cur]; if (all.length) go(all[0]); }
  function back() { if (explore) { explore = null; render(false); return; } if (cur > 0) go(op.parent[cur]); }
  function sib(d) {
    if (cur === 0) return;
    const ks = kids(op.parent[cur]);
    const i = ks.indexOf(cur);
    if (ks.length > 1) go(ks[(i + d + ks.length) % ks.length]);
  }
  function startExplore() { explore = new Chess(op.fen(cur)); render(false); }
  function onBoardMove(m) {
    if (mode.v === 'train') return trainer.userMove(m);
    if (explore) { try { explore.move(m); } catch { /* ilegal */ } render(false); return; }
    // jugada en el tablero: si es del libro, se sigue el árbol; si no, análisis libre
    const c = op.childByMove(cur, m.from, m.to, m.promotion);
    if (c != null) { go(c); return; }
    explore = new Chess(op.fen(cur));
    try { explore.move(m); } catch { explore = null; }
    render(false);
  }
  function arrows(n) {
    if (!showArrows.v) return [];
    const conts = op.continuations(n);
    return conts.slice(0, 8).map((c, i) => {
      const u = op.uci[c.nodes[0]];
      return { orig: u.slice(0, 2), dest: u.slice(2, 4), brush: c.main ? 'green' : i < 3 ? 'blue' : 'paleBlue' };
    });
  }
  function render(scroll = true, from = null) {
    banner.classList.add('hidden');
    if (explore) {
      const hv = explore.history({ verbose: true });
      const lm = hv[hv.length - 1];
      board.set(explore.fen(), { lastMove: lm ? [lm.from, lm.to] : null, interactive: true, userColor: null });
      const e = ecoAt(eco, explore.fen());
      banner.innerHTML = '';
      banner.append(h('span', {}, 'Fuera del libro: ', h('b', {}, explore.history().map(fig).join(' ') || 'mueve cualquier pieza'), e ? h('span', { class: 'muted' }, ` · ${e.eco} ${e.name}`) : ''),
        h('button', { class: 'btn small', onclick: () => { explore.undo(); if (!explore.history().length) explore = null; render(false); } }, 'Deshacer'),
        h('button', { class: 'btn small', onclick: () => { explore = null; render(false); } }, 'Volver al libro'));
      banner.classList.remove('hidden');
      eng.run();
      return;
    }
    const fen = op.fen(cur);
    board.set(fen, { lastMove: op.lastMove(cur), interactive: mode.v !== 'train', userColor: null, shapes: arrows(cur) });
    // información de la posición
    posInfo.innerHTML = '';
    const el = ecoLabel(eco, op, cur);
    posInfo.append(h('div', { class: 'gt-meta' }, el || 'Posición inicial'));
    // línea actual
    lineStrip.innerHTML = '';
    const pth = op.path(cur);
    pth.forEach((n, i) => {
      lineStrip.append(h('span', { class: 'ls-mv' + (n === cur ? ' current' : '') + (op.isIdea(n) ? ' idea' : ''), onclick: () => go(n) }, (op.numLabel(n, i === 0 || op.isIdea(n)) ? op.numLabel(n, i === 0) + ' ' : '') + (op.isIdea(n) ? '(…)' : '') + fig(op.label(n))), ' ');
    });
    if (!pth.length) lineStrip.append(h('span', { class: 'muted' }, 'Posición inicial'));
    // continuaciones
    contBox.innerHTML = '';
    const conts = op.continuations(cur);
    if (!conts.length) contBox.append(h('div', { class: 'muted' }, 'El libro no sigue desde aquí.'));
    for (const c of conts.slice(0, 12)) {
      const target = c.nodes.find((x) => inCh[x]) ?? c.nodes[0];
      contBox.append(h('div', { class: 'cont-row' + (c.main ? ' is-main' : ''), onclick: () => go(target) },
        h('span', { class: 'cont-mv' }, op.numLabel(target, true) + ' ' + fig(c.san)),
        h('span', { class: 'cont-name' }, ecoLabel(eco, op, target).replace(/^[A-E]\d\d · /, '')),
        h('span', { class: 'cont-refs', title: 'Veces que el libro menciona esta línea' }, String(c.refs))));
    }
    // resaltar en texto y árbol
    textPane.querySelectorAll('.current').forEach((e) => e.classList.remove('current'));
    const spans = spansByNode.get(cur) || [];
    spans.forEach((e) => e.classList.add('current'));
    if (scroll && spans.length && mode.v === 'text') scrollIntoViewIfNeeded(textPane, spans.find((s) => s.classList.contains('fco-mv')) || spans[0]);
    if (treeBuilt) {
      treePane.querySelectorAll('.tmv.current').forEach((e) => e.classList.remove('current'));
      const t = treeSpans.get(cur);
      if (t) { t.classList.add('current'); if (mode.v === 'tree') scrollIntoViewIfNeeded(treePane, t); }
    }
    eng.run();
  }
  function setMode(m) {
    mode.v = m;
    for (const k of Object.keys(tabs)) { tabs[k].classList.toggle('active', k === m); panes[k].classList.toggle('hidden', k !== m); }
    ctrl.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('hidden', m === 'train'));
    if (m === 'tree') buildTree();
    if (m === 'train') trainer.enter(); else { trainer.leave(); render(m === 'text' || m === 'tree'); }
  }

  // ---- entrenador de repertorio: el usuario juega un bando, la app el otro, siempre dentro del libro
  function makeTrainer() {
    let color = 'white';
    let depthMode = 'all';
    let node = 0;
    let active = false;
    let attempts = 0;
    let stats = { ok: 0, fail: 0, lines: 0 };
    const trainStart = firstDiag ?? firstMain ?? root;
    const chooseW = h('button', { class: 'btn choice', onclick: () => pick('white') }, h('span', { class: 'pc w' }, '♔'), ' Blancas');
    const chooseB = h('button', { class: 'btn choice', onclick: () => pick('black') }, h('span', { class: 'pc b' }, '♚'), ' Negras');
    const depthSel = h('select', {}, h('option', { value: 'all' }, 'Todas las variantes del libro'), h('option', { value: 'main' }, 'Sólo la línea principal'));
    const status = h('div', { class: 'train-status' });
    const feedback = h('div', { class: 'train-feedback' });
    const feed = h('div', { class: 'train-feed' });
    const setup = h('div', { class: 'train-setup' },
      h('p', {}, 'Practica las líneas de este capítulo: eliges color, haces tú las jugadas del libro y la aplicación responde con jugadas del libro (a veces la principal, a veces otra variante). Cuando una línea se acaba empieza otra.'),
      h('div', { class: 'choices' }, chooseW, chooseB),
      h('label', { class: 'row' }, 'Líneas: ', depthSel),
      h('button', { class: 'btn primary', onclick: () => begin() }, 'Comenzar'));
    const live = h('div', { class: 'train-live hidden' }, status, feedback,
      h('div', { class: 'train-actions' },
        h('button', { class: 'btn', onclick: () => hint() }, 'Pista'),
        h('button', { class: 'btn', onclick: () => reveal() }, 'Mostrar jugada'),
        h('button', { class: 'btn ghost', onclick: () => newLine() }, 'Otra línea'),
        h('button', { class: 'btn ghost', onclick: () => stop() }, 'Terminar')),
      h('h4', {}, 'Explicación del libro'), feed);
    const el = h('div', {}, setup, live);
    function pick(c) { color = c; chooseW.classList.toggle('selected', c === 'white'); chooseB.classList.toggle('selected', c === 'black'); }
    pick('white');
    const turnOf = (n) => (op.fen(n).split(' ')[1] === 'w' ? 'white' : 'black');
    const options = (n) => {
      let ks = kids(n).filter((c) => !op.isIdea(c));
      if (depthMode === 'main') { const m = ks.filter((c) => op.isMain[c]); ks = m.length ? m : []; }
      // antes de la posición de partida sólo se sigue el camino hacia ella
      if (op.depth[n] < op.depth[trainStart]) { const p = op.path(trainStart); return [p[op.depth[n]]]; }
      return ks;
    };
    function begin() { depthMode = depthSel.value; stats = { ok: 0, fail: 0, lines: 0 }; active = true; setup.classList.add('hidden'); live.classList.remove('hidden'); board.orient(color); eng.setEnabled(false); newLine(); }
    function stop() {
      active = false;
      const total = stats.ok + stats.fail;
      if (total) {
        const pct = Math.round((100 * stats.ok) / total);
        const pr = store.get(`progress:${book.id}`, {});
        pr[ci] = { best: Math.max(pr[ci]?.best || 0, pct), last: pct, date: new Date().toISOString().slice(0, 10) };
        store.set(`progress:${book.id}`, pr);
      }
      setup.classList.remove('hidden'); live.classList.add('hidden');
    }
    function newLine() { node = trainStart; attempts = 0; feed.innerHTML = ''; feedback.textContent = ''; feedback.className = 'train-feedback'; step(); }
    function explain(n) {
      // primer párrafo del capítulo que menciona la jugada
      const locs = (op.locs.get(n) || []).filter((l) => l.ch === ci && l.blk >= 0);
      for (const l of locs) {
        const b = ch.sections[l.sec].blocks[l.blk];
        if (b.k === 'p') return b.segs.map((s) => (typeof s === 'string' ? s : figText(s.t))).join('');
      }
      return '';
    }
    function addFeed(n, mine, extra) {
      const txt = explain(n);
      feed.prepend(h('div', { class: 'feed-item' + (mine ? ' mine' : '') },
        h('div', { class: 'feed-move' }, `${op.numLabel(n, true)} ${fig(op.san[n])}`, extra ? h('span', { class: 'feed-extra' }, extra) : null),
        txt ? h('div', { class: 'comment' }, txt.length > 600 ? txt.slice(0, 600) + '…' : txt) : null));
    }
    function updateStatus(msg) {
      const total = stats.ok + stats.fail;
      status.innerHTML = '';
      status.append(h('div', { class: 'ts-turn' }, msg), h('div', { class: 'ts-score' }, `✔ ${stats.ok}  ✘ ${stats.fail} · ${total ? Math.round((100 * stats.ok) / total) : 0}% al primer intento · líneas completadas: ${stats.lines}`));
    }
    function step() {
      if (!active) return;
      const opts = options(node);
      board.set(op.fen(node), { lastMove: op.lastMove(node), interactive: true, userColor: color, shapes: [] });
      if (!opts.length) {
        stats.lines++;
        updateStatus('Fin de la línea del libro. Pulsa «Otra línea» o espera…');
        setTimeout(() => { if (active && !options(node).length) newLine(); }, 2500);
        return;
      }
      if (turnOf(node) !== color) {
        updateStatus('El libro responde…');
        setTimeout(() => {
          if (!active || mode.v !== 'train') return;
          // la principal con más probabilidad; las demás según lo que el libro las trata
          const ws = opts.map((c, i) => (i === 0 ? 2 : 1) * (1 + Math.log1p(op.subtreeRefs(c))));
          let r = Math.random() * ws.reduce((a, b) => a + b, 0);
          let pickN = opts[0];
          for (let i = 0; i < opts.length; i++) { r -= ws[i]; if (r <= 0) { pickN = opts[i]; break; } }
          node = pickN;
          addFeed(node, false);
          step();
        }, 600);
      } else {
        attempts = 0;
        updateStatus(`Tu turno (${op.numLabel(opts[0], true)}) tras ${op.path(node).map((x) => op.numLabel(x, false) + fig(op.label(x))).join(' ') || 'la posición inicial'}: ¿qué recomienda el libro?`);
      }
    }
    function userMove({ from, to, promotion }) {
      if (!active || turnOf(node) !== color) return;
      const opts = options(node);
      const hit = opts.find((c) => op.uci[c].slice(0, 4) === from + to);
      if (hit != null) {
        if (attempts === 0) stats.ok++;
        feedback.className = 'train-feedback good';
        feedback.textContent = hit === opts[0] ? `¡Correcto! ${fig(op.san[hit])}` : `Correcto: ${fig(op.san[hit])} también está en el libro (la principal es ${fig(op.san[opts[0]])}).`;
        node = hit;
        addFeed(node, true, attempts ? ` (${attempts + 1}º intento)` : ' ✔');
        step();
        return;
      }
      if (attempts === 0) stats.fail++;
      attempts++;
      const c = new Chess(op.fen(node));
      let san = `${from}-${to}`;
      try { san = c.move({ from, to, promotion }).san; } catch { /* */ }
      feedback.className = 'train-feedback bad';
      feedback.textContent = `${fig(san)} no es lo que recomienda el libro aquí. Inténtalo otra vez.`;
      board.set(op.fen(node), { lastMove: op.lastMove(node), interactive: true, userColor: color });
      updateStatus('Tu turno: prueba otra jugada.');
    }
    function hint() { const o = options(node); if (!active || !o.length || turnOf(node) !== color) return; const u = op.uci[o[0]]; board.shapes([{ orig: u.slice(0, 2), brush: 'yellow' }]); feedback.className = 'train-feedback'; feedback.textContent = 'Pista: mueve la pieza marcada.'; }
    function reveal() {
      const o = options(node);
      if (!active || !o.length || turnOf(node) !== color) return;
      if (attempts === 0) stats.fail++;
      feedback.className = 'train-feedback bad';
      feedback.textContent = `El libro juega ${fig(op.san[o[0]])}.`;
      node = o[0];
      addFeed(node, true, ' (mostrada)');
      step();
    }
    return {
      el, userMove,
      enter() { if (!active) { setup.classList.remove('hidden'); live.classList.add('hidden'); board.set(op.fen(trainStart), { lastMove: op.lastMove(trainStart), interactive: false, shapes: [] }); } else step(); },
      leave() { if (active) stop(); board.orient('white'); },
    };
  }

  const onKey = (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (mode.v === 'train') return;
    if (e.key === 'ArrowRight') { fwd(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { back(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { sib(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sib(-1); e.preventDefault(); }
    else if (e.key === 'Home') go(root);
    else if (e.key === 'End') { let x = cur; while (kids(x).length) x = kids(x)[0]; go(x); }
    else if (e.key === 'f') board.flip();
    else if (e.key === 'Escape' && explore) { explore = null; render(false); }
  };
  window.addEventListener('keydown', onKey);

  const startSec = params.get('s');
  setMode(mode.v);
  if (mode.v !== 'train') {
    render(true);
    if (startSec != null && secEls[Number(startSec)]) {
      const s = ch.sections[Number(startSec)];
      if (s.nodes?.length) { cur = s.nodes[s.nodes.length - 1]; render(false); }
      textPane.scrollTop = secEls[Number(startSec)].offsetTop - textPane.offsetTop;
    }
  }
  return () => { window.removeEventListener('keydown', onKey); board.destroy(); };
}

function isAnc(op, a, b) { while (b > 0 && op.depth[b] > op.depth[a]) b = op.parent[b]; return a === b; }
function common(op, a, b) {
  while (op.depth[a] > op.depth[b]) a = op.parent[a];
  while (op.depth[b] > op.depth[a]) b = op.parent[b];
  while (a !== b) { a = op.parent[a]; b = op.parent[b]; }
  return a;
}
// figurinas dentro de una etiqueta de texto del libro ("12 Nf3" → "12 ♘f3")
function figText(t) { return t.replace(/(^|[\s.…])([KQRBN])(?=[a-h1-8x])/g, (m, a, p) => a + fig(p)); }

// ---------------------------------------------------------------- explorador
export async function viewExplorer(app, book, params) {
  const op = book.op;
  const eco = await loadEco();
  let cur = Number(params.get('n')) || 0;
  let free = null; // posición fuera del libro (chess.js)
  const { shell, boardEl } = boardShell();
  const board = new Board(boardEl, { onMove: (m) => onMove(m) });
  const eng = enginePanel(() => (free ? free.fen() : op.fen(cur)), board);
  const title = h('div', { class: 'gt-meta' });
  const strip = h('div', { class: 'line-strip' });
  const table = h('div', { class: 'explorer-table' });
  const where = h('div', { class: 'explorer-where' });
  const banner = h('div', { class: 'banner hidden' });
  const fenIn = h('input', { class: 'fen', placeholder: 'Pega un FEN para buscar la posición en el libro', spellcheck: 'false' });
  const ctrl = h('div', { class: 'controls' },
    h('button', { class: 'btn icon navbtn', title: 'Posición inicial', onclick: () => go(0) }, '⏮'),
    h('button', { class: 'btn icon navbtn', title: 'Atrás (←)', onclick: () => back() }, '◀'),
    h('button', { class: 'btn icon navbtn', title: 'Jugada principal (→)', onclick: () => { const c = op.continuations(cur)[0]; if (c) go(c.nodes[0]); } }, '▶'),
    h('button', { class: 'btn icon', title: 'Girar tablero', onclick: () => board.flip() }, '⇅'));
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', h('a', { href: base(book) }, book.title), ' / Explorador'),
    h('div', { class: 'game-top' }, h('div', { class: 'game-title' }, h('div', { class: 'gt-players' }, 'Explorador de aperturas'), title)),
    h('div', { class: 'game-layout' },
      h('div', { class: 'main' }, shell, banner, ctrl, strip),
      h('div', { class: 'side' },
        h('h3', {}, 'Jugadas del libro en esta posición'),
        h('div', { class: 'explorer-head muted' }, 'Incluye transposiciones: se juntan todas las líneas del libro que llegan a esta misma posición.'),
        table,
        h('h3', {}, 'Dónde lo explica el libro'), where,
        h('div', { class: 'fen-row explorer-fen' }, fenIn, h('button', { class: 'btn', onclick: () => searchFen() }, 'Buscar')),
        eng.el)));
  board.redraw();

  function go(n) { cur = n; free = null; render(); history.replaceState(null, '', `${base(book)}/explorador?n=${cur}`); }
  function back() { if (free) { free.undo(); if (!free.history().length) free = null; render(); return; } if (cur > 0) go(op.parent[cur]); }
  function onMove(m) {
    if (free) { try { free.move(m); } catch { /* */ } render(); return; }
    const c = op.childByMove(cur, m.from, m.to, m.promotion);
    if (c != null) return go(c);
    free = new Chess(op.fen(cur));
    try { free.move(m); } catch { free = null; }
    render();
  }
  function searchFen() {
    const v = fenIn.value.trim();
    if (!v) return;
    let c;
    try { c = new Chess(v); } catch { banner.textContent = 'FEN no válido.'; banner.classList.remove('hidden'); return; }
    const n = op.findFen(c.fen());
    if (n >= 0) go(n);
    else { free = c; cur = 0; render(); }
  }
  function render() {
    banner.classList.add('hidden');
    const fen = free ? free.fen() : op.fen(cur);
    if (free) {
      const hv = free.history({ verbose: true });
      const lm = hv[hv.length - 1];
      board.set(fen, { lastMove: lm ? [lm.from, lm.to] : null, interactive: true, userColor: null });
      const e = ecoAt(eco, fen);
      title.textContent = e ? `${e.eco} · ${e.name}` : '';
      banner.innerHTML = '';
      banner.append(h('span', {}, 'Esta posición no aparece en el libro. ', free.history().length ? h('b', {}, free.history().map(fig).join(' ')) : ''),
        h('button', { class: 'btn small', onclick: () => back() }, 'Deshacer'), h('button', { class: 'btn small', onclick: () => go(cur) }, 'Volver al libro'));
      banner.classList.remove('hidden');
      table.innerHTML = ''; where.innerHTML = '';
      eng.run();
      return;
    }
    const conts = op.continuations(cur);
    board.set(fen, {
      lastMove: op.lastMove(cur), interactive: true, userColor: null,
      shapes: conts.slice(0, 8).map((c, i) => { const u = op.uci[c.nodes[0]]; return { orig: u.slice(0, 2), dest: u.slice(2, 4), brush: c.main ? 'green' : i < 3 ? 'blue' : 'paleBlue' }; }),
    });
    title.textContent = ecoLabel(eco, op, cur) || 'Posición inicial';
    strip.innerHTML = '';
    op.path(cur).forEach((n, i) => strip.append(h('span', { class: 'ls-mv' + (n === cur ? ' current' : ''), onclick: () => go(n) }, (op.numLabel(n, i === 0) ? op.numLabel(n, i === 0) + ' ' : '') + fig(op.san[n])), ' '));
    table.innerHTML = '';
    const total = conts.reduce((a, c) => a + c.refs, 0) || 1;
    if (!conts.length) table.append(h('div', { class: 'muted pad' }, 'El libro no continúa desde aquí.'));
    for (const c of conts) {
      const n = c.nodes[0];
      const e = ecoLabel(eco, op, n);
      table.append(h('div', { class: 'ex-row' + (c.main ? ' is-main' : ''), onclick: () => go(n) },
        h('span', { class: 'ex-mv' }, `${op.numLabel(n, true)} ${fig(c.san)}`),
        h('span', { class: 'ex-name' }, e),
        h('span', { class: 'ex-bar' }, h('i', { style: `width:${Math.max(4, Math.round((100 * c.refs) / total))}%` })),
        h('span', { class: 'ex-refs', title: 'Menciones en el libro de esta jugada y sus variantes' }, String(c.refs))));
    }
    where.innerHTML = '';
    const locs = op.locationsOfPos(cur).slice(0, 30);
    if (!locs.length) where.append(h('div', { class: 'muted pad' }, cur === 0 ? 'Elige una primera jugada.' : 'El libro sólo menciona esta posición de paso.'));
    for (const l of locs) {
      const chp = book.chapters[l.ch];
      const sec = chp.sections[l.sec];
      where.append(h('a', { class: 'where-row', href: `${base(book)}/cap/${l.ch}?n=${l.node}` }, h('b', {}, chp.title), sec.title ? ` › ${sec.title}` : ''));
    }
    eng.run();
  }
  const onKey = (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') { back(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { const c = op.continuations(cur)[0]; if (c && !free) go(c.nodes[0]); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  render();
  return () => { window.removeEventListener('keydown', onKey); board.destroy(); };
}

// ---------------------------------------------------------------- índice ECO
export async function viewEcoIndex(app, book) {
  const op = book.op;
  const eco = await loadEco();
  const filter = h('input', { type: 'search', class: 'search', placeholder: 'Filtrar por código (B90) o nombre (Najdorf)…' });
  const list = h('div', { class: 'eco-list' });
  // entradas ECO cuya posición exacta aparece en el libro
  const entries = [];
  for (const [key, n] of book.ecoNodes) {
    const k = eco.byKey.get(key);
    if (k == null) continue;
    entries.push({ code: eco.rows[k][0], name: eco.rows[k][1], moves: eco.rows[k][3], n, refs: op.subtreeRefs(n) });
  }
  entries.sort((a, b) => a.code.localeCompare(b.code) || a.moves.length - b.moves.length);
  const groups = { A: 'Aperturas de flanco y 1 d4 irregulares', B: 'Aperturas semiabiertas (1 e4 sin 1…e5)', C: '1 e4 e5 y Francesa', D: 'Gambito de dama y 1 d4 d5', E: 'Defensas indias (1 d4 Nf6)' };
  const render = () => {
    const t = filter.value.trim().toLowerCase();
    list.innerHTML = '';
    let letter = null; let box = null; let shown = 0;
    for (const e of entries) {
      if (t && !e.code.toLowerCase().startsWith(t) && !e.name.toLowerCase().includes(t)) continue;
      if (e.code[0] !== letter) {
        letter = e.code[0];
        list.append(h('h2', { class: 'section-title' }, `${letter} — ${groups[letter]}`));
        box = h('div', { class: 'game-list' });
        list.append(box);
      }
      shown++;
      box.append(h('a', { class: 'eco-row', href: `${base(book)}/explorador?n=${e.n}` },
        h('span', { class: 'eco-code' }, e.code), h('span', { class: 'eco-name' }, e.name), h('span', { class: 'eco-moves muted' }, e.moves), h('span', { class: 'eco-refs muted', title: 'Menciones en el libro' }, String(e.refs))));
    }
    if (!shown) list.append(h('p', { class: 'muted' }, 'Sin resultados.'));
  };
  filter.addEventListener('input', render);
  render();
  app.append(
    h('nav', { class: 'crumbs' }, h('a', { href: '#/' }, 'Biblioteca'), ' / ', h('a', { href: base(book) }, book.title), ' / Índice ECO'),
    h('header', { class: 'book-head' }, h('h1', {}, 'Índice ECO'), h('p', {}, `${entries.length} aperturas y variantes con código ECO que aparecen en el libro. Pulsa una para abrirla en el explorador.`)),
    filter, list);
  return () => {};
}

// prepara el índice posición→nodo para las posiciones ECO del libro
export async function prepareOpeningBook(book) {
  const op = book.op;
  const eco = await loadEco();
  const ecoNodes = new Map();
  for (let n = 1; n < op.size; n++) {
    if (op.isIdea(n)) continue;
    const k = op.eco[n];
    // la clasificación sólo cambia en el nodo cuya posición es la de la entrada ECO
    if (k == null || k < 0 || k === op.eco[op.parent[n]]) continue;
    const key = posKey(eco.rows[k][2]);
    // el nodo cuya posición es exactamente la de la entrada ECO
    if (op.pos[n] !== undefined && !ecoNodes.has(key) && posKey(op.fen(n)) === key) ecoNodes.set(key, n);
  }
  book.ecoNodes = ecoNodes;
}
