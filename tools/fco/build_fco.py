"""Prepara los datos finales del libro FCO para la aplicación (antes de cifrarlos).
Uso: python3 -I tools/fco/build_fco.py fco.json data/eco.json salida.json"""
import sys, json
import chess

src = json.load(open(sys.argv[1]))
aux = json.load(open(sys.argv[1] + '.aux.json'))
eco = json.load(open(sys.argv[2]))
fens = aux['fen']
parent, san, uci = src['nodes']['parent'], src['nodes']['san'], src['nodes']['uci']

def epd(fen):
    return ' '.join(fen.split(' ')[:4])

eco_by_epd = {}
for i, r in enumerate(eco['rows']):
    eco_by_epd.setdefault(r[2], i)   # primera entrada (la más general) para cada posición

pos_ids, pos = {}, []
eco_of = []
for n in range(len(parent)):
    k = epd(fens[n])
    pos.append(pos_ids.setdefault(k, len(pos_ids)))
    e = eco_by_epd.get(k, -1) if not san[n] or not san[n].startswith('--') else -1
    if e < 0 and n > 0:
        e = eco_of[parent[n]]
    eco_of.append(e)

# limpiar bloques: quitar campos internos
for ch in src['chapters']:
    for sec in ch['sections']:
        for b in sec['blocks']:
            b.pop('img', None)
            if b['k'] == 'p':
                b.pop('cls', None)
                for s in b['segs']:
                    if isinstance(s, dict) and not s.get('b'):
                        s.pop('b', None)

# un FEN explícito sólo para las jugadas 'de plan' (el rival no mueve), que chess.js no puede reproducir
idea_fen = {n: fens[n] for n in range(len(parent)) if san[n] and san[n].startswith('--')}

out = {
    'title': 'Fundamental Chess Openings',
    'author': 'Paul van der Sterren',
    'chapters': src['chapters'],
    'nodes': {'parent': parent, 'san': san, 'uci': uci, 'pos': pos, 'eco': eco_of},
    'ideaFen': idea_fen,
    'stats': src['stats'],
}
json.dump(out, open(sys.argv[3], 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(parent), 'nodos', len(pos_ids), 'posiciones', sum(1 for e in eco_of if e >= 0), 'con ECO')
