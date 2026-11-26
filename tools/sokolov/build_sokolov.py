"""Genera los datos de *Winning Chess Middlegames* para la web a partir de sokolov.json (parse_sokolov.py).

Uso: python3 -I build_sokolov.py sokolov.json planes.json games.pgn extra.json

* games.pgn: las 45 partidas con los comentarios del libro (inglés), en PGN.
  Cabeceras propias: Round = número de partida, Chapter, Structure (estructura principal),
  Side (bando cuyo plan se estudia: Sokolov si jugó, si no el ganador) y Code (clave NIC).
* extra.json: capítulos y estructuras (diagrama de la estructura, introducción del libro, partidas),
  planes en español (de planes.json) y, en extra.json.diags.json, los diagramas de cada partida
  para tests/verify_sokolov.mjs.
"""
import sys, json, re

OPENINGS = {'NI': 'Nimzo-India', 'QO': 'Gambito de Dama, Ortodoxa', 'TD': 'Defensa Tarrasch', 'SL': 'Eslava / Semieslava',
            'QG': 'Gambito de Dama Aceptado', 'RG': 'Defensa Petrov', 'EO': 'Apertura Inglesa', 'VO': 'Apertura de peón de dama',
            'QI': 'India de Dama', 'GI': 'Grünfeld'}


def esc_comment(t):
    return t.replace('{', '(').replace('}', ')')


def year(ev):
    m = re.search(r'(1[89]\d\d|20\d\d)', ev or '')
    return f'{m.group(1)}.??.??' if m else '????.??.??'


def side_of(g):
    if 'Sokolov' in g['white']:
        return 'White'
    if 'Sokolov' in g['black']:
        return 'Black'
    return 'Black' if g['result'] == '0-1' else 'White'


def pgn_game(g):
    code = g['code'].split()[0]
    hd = [('Event', g['event'] or '?'), ('Site', '?'), ('Date', year(g['event'])), ('Round', g['id']),
          ('White', g['white']), ('Black', g['black']), ('Result', g['result']), ('ECO', g['eco']),
          ('Opening', OPENINGS.get(code, code)), ('Code', g['code']), ('Chapter', str(g['chapter'])),
          ('Structure', g['structure'] or ''), ('Side', side_of(g)), ('Annotator', 'Sokolov')]
    out = [f'[{k} "{v.replace(chr(34), chr(39))}"]' for k, v in hd if v]
    body = []
    if g['pre']:
        body.append('{ ' + esc_comment('\n'.join(g['pre'])) + ' }')
    for k, m in enumerate(g['moves']):
        ply = k + 1
        num = (ply + 1) // 2
        tok = f'{num}. ' if ply % 2 == 1 else (f'{num}... ' if k == 0 or g['moves'][k - 1]['comments'] else '')
        tok += m['san'] + ''.join(f' ${n}' for n in m['nags'])
        body.append(tok)
        if m['comments']:
            body.append('{ ' + esc_comment('\n'.join(m['comments'])) + ' }')
    body.append(g['result'])
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


def main():
    data = json.load(open(sys.argv[1]))
    plans = json.load(open(sys.argv[2]))
    open(sys.argv[3], 'w').write('\n'.join(pgn_game(g) for g in data['games']))
    sp = plans.get('structures', {})
    extra = {
        'intro': data['intro'],
        'plan': plans.get('book'),
        'parts': [{'num': c['num'], 'title': c['title'], 'titleEn': c['titleEn'], 'intro': c['intro'],
                   'structures': c['structures'], 'plan': plans.get('chapters', {}).get(str(c['num']))} for c in data['chapters']],
        'structures': [{'id': s['id'], 'chapter': s['chapter'], 'title': (sp.get(s['id']) or {}).get('title') or s['title'],
                        'titleEn': s['title'], 'diag': s['diagram'], 'intro': s['intro'], 'games': s['games'],
                        'plan': (sp.get(s['id']) or {}).get('text')} for s in data['structures']],
        'games': {g['id']: {'plan': plans.get('games', {}).get(g['id'])} for g in data['games']},
    }
    json.dump(extra, open(sys.argv[4], 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump({g['id']: g['diags'] for g in data['games']}, open(sys.argv[4] + '.diags.json', 'w'))
    miss_g = [g['id'] for g in data['games'] if not plans.get('games', {}).get(g['id'])]
    miss_s = [s['id'] for s in data['structures'] if not (sp.get(s['id']) or {}).get('text')]
    print(f'partidas={len(data["games"])} · sin plan: partidas={miss_g} estructuras={miss_s}')


if __name__ == '__main__':
    main()
