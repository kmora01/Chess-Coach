"""Comprueba cada posición del libro contra su diagrama impreso (las 1.600+ imágenes del EPUB).

Uso: python3 -I check_diagrams.py fco.json <dir Images> informe.txt

1. Aprende el aspecto de cada pieza (en casilla clara y oscura) a partir de los diagramas
   de la línea principal.
2. Lee todas las imágenes casilla a casilla (vecino más cercano).
3. Compara la colocación de piezas leída con la posición que ha reconstruido el parser
   y el turno con el pie del diagrama ("White/Black to play").
"""
import sys, json
import numpy as np
from PIL import Image
import chess

X0, Y0, SQ = 131, 23, 32


def squares(path):
    a = np.asarray(Image.open(path).convert('L'), dtype=np.float32) / 255.0
    out = []
    for r in range(8):          # fila 0 = rank 8
        for c in range(8):
            out.append(a[Y0 + r * SQ + 2:Y0 + (r + 1) * SQ - 2, X0 + c * SQ + 2:X0 + (c + 1) * SQ - 2].ravel())
    return out


def labels(fen):
    b = chess.Board(fen)
    out = []
    for r in range(8):
        for c in range(8):
            p = b.piece_at(chess.square(c, 7 - r))
            out.append(p.symbol() if p else '.')
    return out


def main():
    data = json.load(open(sys.argv[1]))
    aux = json.load(open(sys.argv[1] + '.aux.json'))
    fens = aux['fen']
    imgdir = sys.argv[2]
    diags = []
    for ch in data['chapters']:
        for si, sec in enumerate(ch['sections']):
            for blk in sec['blocks']:
                if blk['k'] == 'diag':
                    diags.append((ch['id'], sec.get('title'), blk))
    # entrenamiento: diagramas de la línea principal (marcados en el parser) — usamos todos con nodo
    feats = {}
    for _, _, blk in diags:
        if blk.get('node') is None:
            continue
        sq = squares(f'{imgdir}/{blk["img"]}')
        lb = labels(fens[blk['node']])
        for k in range(64):
            key = (lb[k], (k // 8 + k % 8) % 2)
            feats.setdefault(key, []).append(sq[k])
    # plantilla = mediana (robusta frente a algunos diagramas mal asignados)
    tmpl_keys = list(feats)
    tmpl = np.stack([np.median(np.stack(feats[k][:400]), axis=0) for k in tmpl_keys])
    rep = open(sys.argv[3], 'w')
    bad = 0; ok = 0; noref = 0; turn_bad = 0
    results = {}
    for chid, title, blk in diags:
        sq = squares(f'{imgdir}/{blk["img"]}')
        read = []
        for k in range(64):
            shade = (k // 8 + k % 8) % 2
            best, bd = '?', 1e9
            for ti, key in enumerate(tmpl_keys):
                if key[1] != shade:
                    continue
                d = float(np.sum((tmpl[ti] - sq[k]) ** 2))
                if d < bd:
                    bd, best = d, key[0]
            read.append(best)
        board = chess.Board(None)
        for k, s in enumerate(read):
            if s != '.':
                board.set_piece_at(chess.square(k % 8, 7 - k // 8), chess.Piece.from_symbol(s))
        placement = board.board_fen()
        results[blk['img']] = {'placement': placement, 'turn': blk.get('turn')}
        if blk.get('node') is None:
            noref += 1
            print(f'SIN POSICIÓN {chid} [{title}] {blk["img"]}: diagrama leído {placement}', file=rep)
            continue
        fen = fens[blk['node']]
        exp = fen.split(' ')[0]
        tturn = fen.split(' ')[1]
        if exp != placement:
            bad += 1
            diff = [chess.square_name(chess.square(k % 8, 7 - k // 8)) for k in range(64) if read[k] != labels(fen)[k]]
            print(f'DISTINTO {chid} [{title}] {blk["img"]} nodo {blk["node"]}: libro {placement} / parser {exp} casillas {diff}', file=rep)
        elif blk.get('turn') and blk['turn'] != tturn:
            turn_bad += 1
            print(f'TURNO {chid} [{title}] {blk["img"]} nodo {blk["node"]}: pie {blk["turn"]} / parser {tturn}', file=rep)
        else:
            ok += 1
    summary = f'diagramas={len(diags)} coinciden={ok} distintos={bad} turno_distinto={turn_bad} sin_posicion={noref}'
    print(summary, file=rep)
    print(summary)
    json.dump(results, open(sys.argv[3] + '.json', 'w'))


if __name__ == '__main__':
    main()
