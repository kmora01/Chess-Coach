"""Comprueba las posiciones de la línea principal contra los diagramas impresos del libro.

Uso: python3 -I check_diagrams.py kaufman.json <dir Images> informe.txt

1. Aprende el aspecto de cada pieza (en casilla clara y oscura) a partir de los diagramas
   de la línea principal (mediana, robusta frente a algún diagrama mal asignado).
2. Lee cada imagen casilla a casilla (vecino más cercano).
3. Compara la colocación de piezas con la posición reconstruida por el parser.
   Los "analysis diagram" (posiciones de variantes) se leen y se guardan para la introducción
   de los capítulos, pero no se comparan.
Escribe también <informe>.json con la colocación leída de cada imagen (para los diagramas de las
introducciones de capítulo).
"""
import sys, json
import numpy as np
from PIL import Image
import chess

N = 20  # cada casilla se reescala a N×N


def squares(path):
    im = Image.open(path).convert('L')
    w, hgt = im.size
    a = np.asarray(im, dtype=np.float32) / 255.0
    x0, x1, y0, y1 = 1, w - 1, 1, hgt - 1
    cw, ch = (x1 - x0) / 8, (y1 - y0) / 8
    out = []
    for r in range(8):
        for c in range(8):
            l, t = int(round(x0 + c * cw + 3)), int(round(y0 + r * ch + 3))
            rgt, b = int(round(x0 + (c + 1) * cw - 3)), int(round(y0 + (r + 1) * ch - 3))
            cell = Image.fromarray((a[t:b, l:rgt] * 255).astype(np.uint8)).resize((N, N))
            out.append(np.asarray(cell, dtype=np.float32).ravel() / 255.0)
    return out


def labels(fen):
    b = chess.Board(fen)
    return [(b.piece_at(chess.square(c, 7 - r)).symbol() if b.piece_at(chess.square(c, 7 - r)) else '.')
            for r in range(8) for c in range(8)]


def main():
    data = json.load(open(sys.argv[1]))
    imgdir = sys.argv[2]
    diags = []  # (gid, ply, diag)
    for g in data['games']:
        for d in g['preDiags']:
            diags.append((g['id'], 0, d))
        for k, m in enumerate(g['moves']):
            for d in m['diags']:
                diags.append((g['id'], k + 1, d))
    intro_imgs = [x['img'] for ch in data['chapters'] for x in ch['intro'] if isinstance(x, dict)]
    feats = {}
    for _, _, d in diags:
        if 'fen' not in d:
            continue
        sq = squares(f'{imgdir}/{d["img"]}')
        for k, lb in enumerate(labels(d['fen'])):
            feats.setdefault((lb, (k // 8 + k % 8) % 2), []).append(sq[k])
    keys = list(feats)
    tmpl = np.stack([np.median(np.stack(feats[k][:600]), axis=0) for k in keys])

    def read(img):
        sq = squares(f'{imgdir}/{img}')
        out = []
        for k in range(64):
            shade = (k // 8 + k % 8) % 2
            best, bd = '?', 1e9
            for ti, key in enumerate(keys):
                if key[1] != shade: continue
                dd = float(np.sum((tmpl[ti] - sq[k]) ** 2))
                if dd < bd: bd, best = dd, key[0]
            out.append(best)
        b = chess.Board(None)
        for k, s in enumerate(out):
            if s != '.': b.set_piece_at(chess.square(k % 8, 7 - k // 8), chess.Piece.from_symbol(s))
        return b.board_fen(), out

    rep = open(sys.argv[3], 'w')
    ok = bad = ana = 0
    results = {}
    for gid, ply, d in diags:
        placement, rd = read(d['img'])
        results[d['img']] = placement
        if 'fen' not in d:
            ana += 1
            continue
        exp = d['fen'].split(' ')[0]
        if exp == placement:
            ok += 1
        else:
            bad += 1
            lb = labels(d['fen'])
            diff = [chess.square_name(chess.square(k % 8, 7 - k // 8)) for k in range(64) if rd[k] != lb[k]]
            print(f'DISTINTO partida {gid} ply {ply} {d["img"]}: libro {placement} / parser {exp} casillas {diff}', file=rep)
    for img in intro_imgs:
        results[img] = read(img)[0]
    summary = f'diagramas línea principal={ok + bad} coinciden={ok} distintos={bad} · diagramas de análisis={ana} · introducciones={len(intro_imgs)}'
    print(summary, file=rep)
    print(summary)
    json.dump(results, open(sys.argv[3] + '.json', 'w'))


if __name__ == '__main__':
    main()
