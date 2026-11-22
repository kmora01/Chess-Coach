"""Genera data/eco.json (clasificación ECO por posición) a partir de lichess-org/chess-openings (CC0).
Uso: python3 -I tools/eco/build_eco.py tools/eco data/eco.json"""
import sys, json, glob, os, io
import chess, chess.pgn

def epd(b):
    return ' '.join(b.fen().split(' ')[:4])

out = []
for f in sorted(glob.glob(os.path.join(sys.argv[1], '?.tsv'))):
    for line in open(f, encoding='utf8').read().splitlines()[1:]:
        eco, name, pgn = line.split('\t')
        g = chess.pgn.read_game(io.StringIO(pgn))
        b = g.board()
        sans = []
        for mv in g.mainline_moves():
            sans.append(b.san(mv)); b.push(mv)
        out.append([eco, name, epd(b), ' '.join(sans)])
json.dump({'source': 'https://github.com/lichess-org/chess-openings (CC0)', 'cols': ['eco', 'name', 'epd', 'moves'], 'rows': out},
          open(sys.argv[2], 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out))
