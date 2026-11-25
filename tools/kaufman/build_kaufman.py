"""Genera los datos del libro de Kaufman para la web a partir de kaufman.json (parse_kaufman.py).

Uso: python3 -I build_kaufman.py kaufman.json diagramas.json planes.json games.pgn extra.json

* games.pgn: las 187 partidas modelo con los comentarios del libro (inglés), en PGN.
  Cabeceras propias: Round = número de partida del libro ("8.6"), Chapter, Repertoire (White/Black).
* extra.json: partes y capítulos (introducción del libro con sus diagramas leídos como FEN),
  planes típicos en español (de planes.json) y diagramas de cada partida para las pruebas.
"""
import sys, json, re
import chess


def esc_comment(t):
    return t.replace('{', '(').replace('}', ')')


def pgn_game(g, ch):
    side = 'White' if ch['side'] == 'white' else 'Black'
    hd = [('Event', g['event'] or '?'), ('Site', '?'), ('Date', year(g['event'])), ('Round', g['id']),
          ('White', g['white']), ('Black', g['black']), ('Result', g['result']),
          ('WhiteElo', g['whiteElo']), ('BlackElo', g['blackElo']),
          ('Opening', g['opening']), ('Chapter', str(g['chapter'])), ('Repertoire', side), ('Annotator', 'Kaufman')]
    out = [f'[{k} "{v.replace(chr(34), chr(39))}"]' for k, v in hd if v]
    body = []
    if g['pre']:
        body.append('{ ' + esc_comment('\n'.join(g['pre'])) + ' }')
    for k, m in enumerate(g['moves']):
        ply = k + 1
        num = (ply + 1) // 2
        tok = f'{num}. ' if ply % 2 == 1 else (f'{num}... ' if k == 0 or g['moves'][k - 1]['comments'] or g['moves'][k - 1]['eval'] else '')
        tok += m['san'] + ''.join(f' ${n}' for n in m['nags'])
        body.append(tok)
        com = list(m['comments'])
        if m['eval']:
            com.insert(0, f'({m["eval"]})')
        if com:
            body.append('{ ' + esc_comment('\n'.join(com)) + ' }')
    body.append(g['result'])
    # líneas de longitud razonable
    lines, cur = [], ''
    for t in body:
        if t.startswith('{'):
            if cur: lines.append(cur); cur = ''
            lines.append(t)
        else:
            cur = (cur + ' ' + t).strip()
            if len(cur) > 90: lines.append(cur); cur = ''
    if cur: lines.append(cur)
    return '\n'.join(out) + '\n\n' + '\n'.join(lines) + '\n'


def year(ev):
    m = re.search(r'(1[89]\d\d|20\d\d)', ev or '')
    return f'{m.group(1)}.??.??' if m else '????.??.??'


def main():
    data = json.load(open(sys.argv[1]))
    reads = json.load(open(sys.argv[2]))
    plans = json.load(open(sys.argv[3]))
    chs = {c['num']: c for c in data['chapters']}
    pgn = '\n'.join(pgn_game(g, chs[g['chapter']]) for g in data['games'])
    open(sys.argv[4], 'w').write(pgn)

    def intro(items, side):
        out = []
        for x in items:
            if isinstance(x, dict):
                placement = reads.get(x['img'])
                if placement:
                    out.append({'diag': placement, 'flip': side == 'black'})
            else:
                out.append({'p': x})
        return out
    extra = {
        'parts': [{'side': p['side'], 'title': p['title'], 'intro': intro(p['intro'], p['side']),
                   'plan': plans.get('parts', {}).get(p['side'])} for p in data['parts']],
        'chapters': [{'num': c['num'], 'title': c['title'], 'side': c['side'], 'games': c['games'],
                      'intro': intro(c['intro'], c['side']),
                      'plan': plans.get('chapters', {}).get(str(c['num']))} for c in data['chapters']],
        'games': {g['id']: {'plan': plans.get('games', {}).get(g['id'])} for g in data['games']},
    }
    json.dump(extra, open(sys.argv[5], 'w'), ensure_ascii=False, separators=(',', ':'))
    # diagramas por partida, para tests/verify_kaufman.mjs
    diags = {}
    for g in data['games']:
        lst = [{'ply': 0, **d} for d in g['preDiags']]
        for k, m in enumerate(g['moves']):
            lst += [{'ply': k + 1, **d} for d in m['diags']]
        for d in lst:
            d['read'] = reads.get(d['img'])
        diags[g['id']] = lst
    json.dump(diags, open(sys.argv[5] + '.diags.json', 'w'))
    missing = [g['id'] for g in data['games'] if not plans.get('games', {}).get(g['id'])]
    missing_ch = [c['num'] for c in data['chapters'] if not plans.get('chapters', {}).get(str(c['num']))]
    print(f'partidas={len(data["games"])} · sin plan: partidas={len(missing)} capítulos={len(missing_ch)}')


if __name__ == '__main__':
    main()
