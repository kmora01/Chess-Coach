// Clasificación ECO por posición (datos de lichess-org/chess-openings, CC0), en data/eco.json.
let ecoPromise = null;

// clave de posición: colocación + turno + enroques (sin casilla al paso, que cada librería anota distinto)
export function posKey(fen) { return fen.split(' ').slice(0, 3).join(' '); }

export function loadEco() {
  if (!ecoPromise) {
    ecoPromise = fetch('data/eco.json').then((r) => r.json()).then((d) => {
      const byKey = new Map();
      d.rows.forEach((r, i) => { const k = posKey(r[2]); if (!byKey.has(k)) byKey.set(k, i); });
      return { rows: d.rows, byKey };
    }).catch(() => ({ rows: [], byKey: new Map() }));
  }
  return ecoPromise;
}

// fens: posiciones de una partida en orden; devuelve la clasificación más profunda { eco, name, ply } o null
export function classifyLine(eco, fens) {
  let best = null;
  fens.forEach((f, i) => { const k = eco.byKey.get(posKey(f)); if (k != null) best = { eco: eco.rows[k][0], name: eco.rows[k][1], ply: i, row: k }; });
  return best;
}

export function ecoAt(eco, fen) {
  const k = eco.byKey.get(posKey(fen));
  return k == null ? null : { eco: eco.rows[k][0], name: eco.rows[k][1], row: k };
}
