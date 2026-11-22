// Diagrama estático pequeño (para los diagramas del libro dentro del texto). Usa las piezas de chessground.
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function miniBoard(fen, { flip = false, lastMove = null, size = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'cg-wrap mini-board brown';
  if (size) wrap.style.width = size;
  const sq = document.createElement('div');
  sq.className = 'mini-squares';
  wrap.append(sq);
  const rows = fen.split(' ')[0].split('/');
  const lm = lastMove ? new Set(lastMove) : null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const name = 'abcdefgh'[c] + (8 - r);
      if (lm && lm.has(name)) {
        const hl = document.createElement('i');
        hl.className = 'mini-hl';
        const [x, y] = flip ? [7 - c, 7 - r] : [c, r];
        hl.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
        sq.append(hl);
      }
    }
  }
  rows.forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { c += Number(ch); continue; }
      const p = document.createElement('piece');
      p.className = `${NAMES[ch.toLowerCase()]} ${ch === ch.toUpperCase() ? 'white' : 'black'}`;
      const [x, y] = flip ? [7 - c, 7 - r] : [c, r];
      p.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
      wrap.append(p);
      c++;
    }
  });
  return wrap;
}
