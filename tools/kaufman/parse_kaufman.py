"""Extrae las partidas comentadas de *Kaufman's New Repertoire for Black and White* (EPUB).

Uso: python3 -I parse_kaufman.py <dir_epub_descomprimido> <salida.json> <informe.txt>

El libro está organizado en capítulos con una introducción (resumen de cada línea del repertorio)
y partidas modelo ("Game 1.1 ...") con la línea principal en negrita (clase style2) y los
comentarios y variantes en párrafos normales. Reglas:

* Un párrafo style2 es siempre línea principal y tiene que continuar exactamente la partida.
* Un párrafo normal que sólo contiene jugadas y empieza en la siguiente jugada de la partida
  también es línea principal (el libro a veces no pone la negrita), salvo que el siguiente
  párrafo en negrita demuestre lo contrario (entonces se deshace y pasa a comentario).
* Todo lo demás es comentario de la última jugada de la línea principal. Las variantes del
  comentario se validan con python-chess partiendo de la posición que les corresponde; las que
  no se pueden validar se quedan como texto (nunca se publica una jugada ilegal).
* Cada diagrama sin pie "analysis diagram" se asocia a la posición de la línea principal en ese
  punto, y check_diagrams.py comprueba después que la imagen coincide pieza a pieza.
"""
import sys, os, re, json, warnings
import chess
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
warnings.filterwarnings('ignore', category=XMLParsedAsHTMLWarning)

FIG = {'♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N'}
SAN = r'(?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?(?:[18]=?[QRBN]|[1-8]))[+#]?'
ANN = r'(?:[!?]{1,2})?'
EVAL_SYM = r'(?:\+–|–\+|\+-|-\+|±|∓|⩲|⩱|=|∞|–(?!\w))'
NAGS = {'!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6, '=': 10, '∞': 13, '⩲': 14, '⩱': 15, '±': 16, '∓': 17,
        '+–': 18, '+-': 18, '–+': 19, '-+': 19}
TOK = re.compile(r'\s*(?:(\d{1,3})\s*(\.\.\.|…|\.)\s*)?(' + SAN + r')(' + ANN + r')(' + EVAL_SYM + r')?N?(?![\w])')
EVAL_PAREN = re.compile(r'\s*\(([+\-–]?\d+\.\d+|[+\-–]?#\d+)\)')
RESULTS = [(re.compile(p, re.I), r) for p, r in [
    (r'^black resign', '1-0'), (r'^white resign', '0-1'), (r'^draw', '1/2-1/2'), (r'^1-0', '1-0'), (r'^0-1', '0-1'),
    (r'^½-½', '1/2-1/2'), (r'^1/2-1/2', '1/2-1/2'), (r'^white won', '1-0'), (r'^black won', '0-1'),
    (r'^the game was (?:agreed )?drawn', '1/2-1/2'), (r'^white wins on time|^black lost on time|^black forfeited', '1-0'),
    (r'^black wins on time|^white lost on time|^white forfeited', '0-1')]]


RESULT_TAIL = re.compile(r'^[\s\.,;]*(?:\(([+\-–]?\d+\.\d+)\))?[\s\.,;]*(1-0|0-1|½-½|1/2-1/2)?[\s\.,;]*$')


def letters(s):
    s = s.replace('….', '…').replace('....', '...').replace('½–½', '½-½')
    s = re.sub(r'(?<![\w\-–])0–0–0(?![\w\-–])', '0-0-0', s)
    s = re.sub(r'(?<![\w\-–])0–0(?![\w\-–])', '0-0', s)
    for k, v in FIG.items():
        s = s.replace(k, v)
    s = re.sub(r'(?<![\w\-])0-0-0(?![a-zA-MO-Z0-9\-])', 'O-O-O', s)
    s = re.sub(r'(?<![\w\-])0-0(?![a-zA-MO-Z0-9\-])', 'O-O', s)
    return s


def norm(s):
    return re.sub(r'\s+', ' ', s.replace('\xa0', ' ')).strip()


def read_blocks(root):
    opf = open(os.path.join(root, 'content.opf'), encoding='utf8').read()
    ids = re.findall(r'<itemref idref="([^"]+)"', opf)
    hrefs = {}
    for m in re.finditer(r'<item\b[^>]*>', opf):
        tag = m.group(0)
        i = re.search(r'id="([^"]+)"', tag); h = re.search(r'href="([^"]+)"', tag)
        if i and h: hrefs[i.group(1)] = h.group(1)
    files = []
    for i in ids:
        h = hrefs.get(i)
        if not h or not h.endswith('html') or 'Text/' not in h: continue
        s = BeautifulSoup(open(os.path.join(root, h), encoding='utf8'), 'lxml')
        title = norm(s.title.get_text()) if s.title else ''
        blocks = []
        for el in s.body.find_all(['h1', 'h2', 'h3', 'p', 'img']):
            if el.name == 'img':
                blocks.append({'k': 'img', 'img': el.get('src', '').split('/')[-1]})
                continue
            t = norm(el.get_text())
            if not t: continue
            blocks.append({'k': el.name, 'cls': ' '.join(el.get('class', [])), 't': t})
        files.append({'file': h.split('/')[-1], 'title': title, 'blocks': blocks})
    return files


def parse_seq(board, text, expect_ply=None, unnumbered=False):
    """Lee una secuencia de jugadas al principio de `text` desde `board` (que no se modifica).
    Devuelve (lista de (move, san, nags), resto_del_texto, ply_inicial) o None si no empieza por jugada.
    Exige número en la primera jugada. Se para en la primera jugada ilegal o en texto normal."""
    m = TOK.match(text)
    if not m or (not m.group(1) and not unnumbered):
        return None
    if m.group(1):
        n, dots = int(m.group(1)), m.group(2)
        ply = 2 * (n - 1) + (0 if dots == '.' else 1)
    else:
        ply = board.ply()
    b = board.copy()
    if b.ply() != ply:
        return None
    out = []
    pos = 0
    while True:
        m = TOK.match(text, pos)
        if not m:
            break
        if m.group(1):
            pl = 2 * (int(m.group(1)) - 1) + (0 if m.group(2) == '.' else 1)
            if pl != b.ply():
                break
        try:
            mv = b.parse_san(m.group(3))
        except ValueError:
            break
        nags = []
        if m.group(4): nags.append(NAGS[m.group(4)])
        if m.group(5) == '–' and m.group(3).endswith('+'): nags.append(18)
        elif m.group(5) and m.group(5) in NAGS: nags.append(NAGS[m.group(5)])
        out.append((mv, b.san(mv), nags))
        b.push(mv)
        pos = m.end()
        e = EVAL_PAREN.match(text, pos)
        if e:
            out[-1] = (out[-1][0], out[-1][1], out[-1][2] + [('eval', e.group(1))])
            pos = e.end()
    if not out:
        return None
    return out, text[pos:], ply


class Game:
    def __init__(self, gid, opening, chapter):
        self.id, self.opening, self.chapter = gid, opening, chapter
        self.white = self.black = self.event = ''
        self.white_elo = self.black_elo = ''
        self.board = chess.Board()
        self.moves = []          # dict(san, nags, comments[], diags[], cand)
        self.pre = []            # comentarios antes de la primera jugada
        self.pre_diags = []
        self.result = '*'
        self.log = []

    def ply(self):
        return len(self.moves)

    def comment(self, text):
        (self.moves[-1]['comments'] if self.moves else self.pre).append(text)

    def push_main(self, seq, cand):
        for mv, san, nags in seq:
            ev = [x for x in nags if isinstance(x, tuple)]
            nags = [x for x in nags if not isinstance(x, tuple)]
            self.board.push(mv)
            self.moves.append({'san': san, 'uci': mv.uci(), 'nags': nags, 'comments': [], 'diags': [], 'cand': cand,
                               'eval': ev[0][1] if ev else None, 'fen': self.board.fen()})

    def undo_candidates(self, to_ply):
        """Deshace jugadas 'candidatas' (párrafos sin negrita) hasta dejar la partida en to_ply."""
        undone = []
        while len(self.moves) > to_ply and self.moves[-1]['cand'] is not None:
            undone.append(self.moves.pop())
            self.board.pop()
        if len(self.moves) != to_ply:
            # restaurar
            for m in reversed(undone):
                self.board.push_uci(m['uci']); self.moves.append(m)
            return False
        # el texto del párrafo candidato vuelve a ser comentario de la jugada anterior
        texts = []
        for m in reversed(undone):
            if m['cand'] not in texts: texts.append(m['cand'])
        tail = []
        for m in reversed(undone):
            tail += m['comments']
        for t in texts: self.comment(t)
        for t in tail: self.comment(t)
        self.log.append(f'{self.id}: deshechas {len(undone)} jugadas sin negrita en ply {to_ply}')
        return True


def parse(root):
    files = read_blocks(root)
    parts, chapters, games = [], [], []
    report = []
    side = None
    cur_ch = None
    g = None
    caption_next = False
    for f in files:
        title = f['title']
        if title.startswith('Part I:'):
            side = 'white'; continue
        if title.startswith('Part II:'):
            side = 'black'; continue
        if title.startswith('White Introduction') or title.startswith('Black Introduction'):
            parts.append({'side': side, 'title': title, 'intro': [letters(b['t']) if b['k'] != 'img' else {'img': b['img']}
                                                                    for b in f['blocks'] if b['k'] in ('p', 'img') and b.get('cls') != 'calibre3']})
            continue
        m = re.match(r'Chapter (\d+)\. (.+)', title)
        if not m:
            continue
        cur_ch = {'num': int(m.group(1)), 'title': m.group(2), 'side': side, 'intro': [], 'games': []}
        chapters.append(cur_ch)
        g = None
        bl = f['blocks']
        i = 0
        while i < len(bl):
            b = bl[i]
            k, t, cls = b['k'], b.get('t', ''), b.get('cls', '')
            nxt = next((x for x in bl[i + 1:] if x['k'] != 'img'), None)
            gm = re.match(r'^Game (\d+\.\d+) (.{3,80})$', t) if k == 'p' else None
            if gm and nxt and nxt.get('cls') == 'style2' and not TOK.match(letters(nxt['t'])):
                if g: finish(g, report)
                g = Game(gm.group(1), gm.group(2).strip(), cur_ch['num'])
                games.append(g); cur_ch['games'].append(g.id)
                # cabecera: blancas, negras, evento
                hdr = [x for x in bl[i + 1:i + 8] if x['k'] == 'p' and x.get('cls') != 'calibre3' and x.get('cls') != 'calibre7']
                def name_elo(s):
                    mm = re.match(r'^(.*?)\s+(\d{4})$', s)
                    return (mm.group(1), mm.group(2)) if mm else (s, '')
                g.white, g.white_elo = name_elo(hdr[0]['t'])
                g.black, g.black_elo = name_elo(hdr[1]['t'])
                g.event = hdr[2]['t'] if hdr[2].get('cls') == 'calibre6' and not TOK.match(letters(hdr[2]['t'])) else ''
                # avanzar hasta pasar el evento
                j = bl.index(hdr[2], i) + (1 if g.event else 0)
                i = j
                continue
            if k in ('h2', 'h3') or cls == 'calibre3' or cls == 'calibre7' or cls == 'calibre15':
                i += 1; continue
            if g is None:
                # introducción del capítulo
                if k == 'img': cur_ch['intro'].append({'img': b['img']})
                elif cls == 'calibre5' and t == 'analysis diagram': pass
                elif t.upper() == f'CHAPTER {cur_ch["num"]}': pass
                else: cur_ch['intro'].append(letters(t))
                i += 1; continue
            if k == 'img':
                cap = nxt if nxt and nxt.get('cls') == 'calibre5' else None
                if cap and 'analysis' in cap['t']:
                    (g.moves[-1]['diags'] if g.moves else g.pre_diags).append({'img': b['img'], 'analysis': True,
                                                                               'ci': len(g.moves[-1]['comments']) if g.moves else len(g.pre)})
                else:
                    (g.moves[-1]['diags'] if g.moves else g.pre_diags).append({'img': b['img'], 'fen': g.board.fen(),
                                                                               'ci': len(g.moves[-1]['comments']) if g.moves else len(g.pre)})
                i += 1; continue
            if cls == 'calibre5':
                i += 1; continue
            text = letters(t)
            for rx, res in RESULTS:
                if rx.match(text):
                    g.result = res
            if cls == 'style2':
                ps = parse_seq(g.board, text)
                if ps is None:
                    # ¿los candidatos sin negrita se pasaron? intentar deshacer
                    m2 = TOK.match(text)
                    if m2 and m2.group(1):
                        pl = 2 * (int(m2.group(1)) - 1) + (0 if m2.group(2) == '.' else 1)
                        if pl < g.ply() and g.undo_candidates(pl):
                            ps = parse_seq(g.board, text)
                if ps is None and g.moves:
                    ps = parse_seq(g.board, text, unnumbered=True)
                if ps is None and g.moves and promote_comment(g, text):
                    ps = parse_seq(g.board, text)
                if ps is None and RESULT_TAIL.match(text):
                    rt = RESULT_TAIL.match(text)
                    if rt.group(2): g.result = rt.group(2).replace('½-½', '1/2-1/2')
                    i += 1; continue
                if ps is None:
                    report.append(f'ERROR {g.id}: negrita que no continúa la partida en ply {g.ply()}: {t[:80]}')
                    g.comment(text)
                else:
                    seq, rest, _ = ps
                    g.push_main(seq, None)
                    rest = rest.strip()
                    rt = RESULT_TAIL.match(rest)
                    if rt and rt.group(2): g.result = rt.group(2).replace('½-½', '1/2-1/2')
                    if rest:
                        if rt: pass
                        else:
                            report.append(f'AVISO {g.id}: texto tras jugadas en negrita: {rest[:60]}')
                            g.comment(rest)
                i += 1; continue
            # párrafo normal: ¿continuación de la línea principal sin negrita?
            ps = parse_seq(g.board, text)
            if ps is not None:
                seq, rest, _ = ps
                rt = RESULT_TAIL.match(rest)
                if rt:
                    if rt.group(2): g.result = rt.group(2).replace('½-½', '1/2-1/2')
                    g.push_main(seq, t)
                    i += 1; continue
            g.comment(text)
            i += 1
        if g: finish(g, report); g = None
    return parts, chapters, games, report


def promote_comment(g, text):
    """La negrita no continúa la partida: busca entre los comentarios de la última jugada un párrafo
    que empiece en la jugada siguiente y llegue justo hasta donde empieza la negrita (el libro olvidó
    la negrita en ese tramo, a veces con texto detrás). Si lo encuentra, lo pasa a línea principal."""
    m = TOK.match(text)
    if not m or not m.group(1):
        return False
    target = 2 * (int(m.group(1)) - 1) + (0 if m.group(2) == '.' else 1)
    last = g.moves[-1]
    for ci, c in enumerate(last['comments']):
        ps = parse_seq(g.board, c)
        if ps and g.ply() + len(ps[0]) == target:
            after = last['comments'][ci + 1:]
            del last['comments'][ci:]
            moved = [d for d in last['diags'] if d['ci'] > ci]
            last['diags'] = [d for d in last['diags'] if d['ci'] <= ci]
            rest = ps[1].strip(' .,')
            g.push_main(ps[0], c)
            base = 1 if rest and not RESULT_TAIL.match(rest) else 0
            for d in moved:
                d['ci'] = d['ci'] - ci - 1 + base
                if 'fen' in d: d['fen'] = g.board.fen()
                g.moves[-1]['diags'].append(d)
            if rest and not RESULT_TAIL.match(rest): g.comment(rest)
            for t in after: g.comment(t)
            g.log.append(f'{g.id}: párrafo sin negrita pasado a línea principal en ply {target - len(ps[0])}')
            return True
    return False


def finish(g, report):
    report.extend(g.log)
    if g.result == '*':
        # sin texto de resultado: la partida termina en mate o se deja abierta
        if g.board.is_checkmate():
            g.result = '1-0' if g.board.turn == chess.BLACK else '0-1'
    cands = sum(1 for m in g.moves if m['cand'] is not None)
    report.append(f'OK {g.id} {g.white} - {g.black}: {len(g.moves)} jugadas ({cands} sin negrita), resultado {g.result}')


def to_json(parts, chapters, games):
    return {
        'parts': parts, 'chapters': chapters,
        'games': [{'id': g.id, 'opening': g.opening, 'chapter': g.chapter, 'white': g.white, 'black': g.black,
                   'whiteElo': g.white_elo, 'blackElo': g.black_elo, 'event': g.event, 'result': g.result,
                   'pre': g.pre, 'preDiags': g.pre_diags,
                   'moves': [{k: m[k] for k in ('san', 'uci', 'nags', 'comments', 'diags', 'eval', 'fen')} for m in g.moves]}
                  for g in games]}


if __name__ == '__main__':
    parts, chapters, games, report = parse(sys.argv[1])
    json.dump(to_json(parts, chapters, games), open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
    open(sys.argv[3], 'w').write('\n'.join(report) + '\n')
    errs = sum(1 for r in report if r.startswith('ERROR'))
    print(f'capítulos={len(chapters)} partidas={len(games)} jugadas={sum(len(g.moves) for g in games)} errores={errs}')
