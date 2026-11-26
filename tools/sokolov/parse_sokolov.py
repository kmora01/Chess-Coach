"""Extrae las 45 partidas comentadas y las 33 estructuras de *Winning Chess Middlegames* (Sokolov).

Uso: python3 -I parse_sokolov.py <libro.txt> <salida.json> <informe.txt>

El libro llega como texto extraído del PDF (New In Chess). Características de ese texto:

* Las figuras de las piezas vienen con la fuente de diagramas de NIC: À = caballo, Ã = alfil,
  Õ = torre, © = dama, ® = rey.
* La línea principal está en notación larga, una jugada por línea: "13. Õa1-b1?!", "13. ... h7-h5!".
  Cada jugada se valida con python-chess (casilla de origen, destino y pieza tienen que cuadrar);
  si una línea no continúa la partida, el análisis se detiene con error (nunca se publica una
  jugada ilegal ni se salta una).
* Los diagramas vienen como 8 líneas de 8 caracteres (fuente de diagramas: t/s/l/d/m/j = piezas
  negras, r/n/b/q/k/i = blancas, '.' y '_' = casilla vacía; mayúscula/minúscula sólo indica el
  color de la casilla). Cada diagrama suele salir dos veces seguidas. Un diagrama seguido de
  "analysis diagram" es de una variante; los demás tienen que coincidir con la línea principal
  (lo comprueba tests/verify_sokolov.mjs).
* La composición del PDF mete espacios en los cortes de sílaba ("po si ti o n", "ad van tage");
  se reconstruyen las palabras con la lista de frecuencias de wordfreq y con las palabras que el
  propio libro escribe enteras.
"""
import sys, re, json, collections
import chess
from wordfreq import zipf_frequency
import pyphen

HYPH = [pyphen.Pyphen(lang='en_US'), pyphen.Pyphen(lang='en_GB')]

FIG = {'À': 'N', 'Ã': 'B', 'Õ': 'R', '©': 'Q', '®': 'K'}
DROW = re.compile(r'^[tsldmjrnbqkiTSLDMJRNBQKI._]{8}$')
PIECE = {'t': 'r', 's': 'n', 'l': 'b', 'd': 'q', 'm': 'k', 'j': 'p', 'r': 'R', 'n': 'N', 'b': 'B', 'q': 'Q', 'k': 'K', 'i': 'P'}
LAN = re.compile(r'^([ÀÃÕ©®]?)([a-h][1-8])([-x])([a-h][1-8])([ÀÃÕ©]?)([+#]?)([!?]{0,2})[íê]?$')
CASTLE = re.compile(r'^(0-0-0|0-0)([+#]?)([!?]{0,2})[íê]?$')
MOVELINE = re.compile(r'^(\d{1,3})\.\s*(\.\.\.\s*)?(\S+)(?:\s+(?!1-0|0-1)(\S+))?(?:\s+(1-0|0-1|½-½))?$')
GAMEHDR = re.compile(r'^([A-Z]{2})\s*(\d+\.\d+)\s*\(([A-E]\d\d)\)\s*GAME\s+(\d+)$')
STRUCT = re.compile(r'^Struc ?ture (\d)\.(\d{1,2})$')
NAGS = {'!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6}
FOOTER = [re.compile(p) for p in [r'^Win ?ning Chess Middlegames$', r'^Chap ?ter \d: .*$', r'^\d{1,3}$', r'^:$']]
CHAPTERS = {1: 'Peones doblados', 2: 'Peón aislado', 3: 'Peones colgantes', 4: 'Mayoría de peones en el centro'}
CHAPTERS_EN = {1: 'Doubled Pawns', 2: 'Isolated Pawns', 3: 'Parallel Hanging Pawns in the Centre', 4: 'Pawn Majority in the Centre'}


FIXES = {'Da vid': 'David', 'Tu rin': 'Turin', 'Niel sen': 'Nielsen', 'Olym piad': 'Olympiad', 'Bu da pest': 'Budapest',
         'Lon don': 'London', 'Le nin grad': 'Leningrad', 'Mos cow': 'Moscow', 'Reyk ja vik': 'Reykjavik', 'Kar pov': 'Karpov',
         'Cor doba': 'Cordoba', 'Ice land': 'Iceland', 'Den mark': 'Denmark', 'Chi cago': 'Chicago', 'Mo naco': 'Monaco'}


def letters(s):
    # signos de valoración de New In Chess (leyenda al final del libro)
    for k, v in {'Ç': '⩲', 'â': '⩱', 'å': '±', 'ç': '∓', 'ê': '+-', 'î': '-+', 'ì': '=', 'º': '∞', '¤': ' (compensación)'}.items():
        s = re.sub(r'(?<=[1-8+#!?O)])' + k, ' ' + v, s)
    s = re.sub(r'(?<=[1-8+#!?O])í', '', s)
    for k, v in FIG.items():
        s = s.replace(k, v)
    return s


def placement(rows):
    out = []
    for r in rows:
        s, e = '', 0
        for ch in r:
            if ch in '._':
                e += 1
            else:
                if e: s += str(e); e = 0
                s += PIECE[ch.lower()] if ch.lower() in PIECE else '?'
        if e: s += str(e)
        out.append(s)
    return '/'.join(out)


# ------------------------------------------------------------------ texto: sílabas y guiones
class Dehyph:
    def __init__(self, raw):
        words = re.findall(r"[A-Za-zÀ-ÿ’']+", raw)
        self.whole = collections.Counter(w.lower() for w in words)

    def z(self, w):
        return zipf_frequency(w.lower().replace('’', "'"), 'en')

    BLOCK = {('in', 'to'), ('may', 'be'), ('for', 'ever'), ('on', 'to'), ('in', 'deed'), ('on', 'to'), ('a', 'gain'), ('a', 'way'), ('a', 'part'), ('may', 'be'), ('every', 'one'),
             ('any', 'one'), ('some', 'one'), ('a', 'head'), ('a', 'long'), ('a', 'round'), ('a', 'side'), ('a', 'cross'),
             ('a', 'live'), ('a', 'like'), ('a', 'muse'), ('a', 'mount'), ('a', 'part'), ('for', 'ever'), ('some', 'times'),
             ('an', 'other'), ('no', 'thing'), ('with', 'out'), ('be', 'came'), ('be', 'fore'), ('a', 'lot'), ('to', 'day')}
    OKPAIR = {('an', 'other'), ('with', 'out'), ('be', 'came'), ('be', 'fore'), ('no', 'thing'), ('to', 'day')}

    def points(self, w):
        pts = set()
        for d in HYPH:
            k = 0
            for piece in d.inserted(w.lower()).split('-')[:-1]:
                k += len(piece); pts.add(k)
        return pts

    def cost(self, parts):
        """Coste de escribir estas piezas como una sola palabra (None = no se puede). Se juntan cuando
        los cortes coinciden con puntos de división silábica del inglés (pyphen) y la palabra existe."""
        lw = ''.join(parts).lower()
        low = tuple(p.lower() for p in parts)
        if len(parts) == 2 and low in self.BLOCK:
            return None
        zc = self.z(lw)
        cuts, k = set(), 0
        for p in parts[:-1]:
            k += len(p); cuts.add(k)
        real = zc >= 2.0 or self.whole[lw] >= 1
        if len(parts) == 2 and min(self.z(x) for x in parts) >= 3.0 and zc < 4.0:
            return None   # "of the", "it is", "main line": dos palabras de verdad
        if real and cuts <= self.points(lw):
            return -(len(parts) - 1)
        if len(parts) >= 3 and (zc >= 1.8 or self.whole[lw] >= 1):
            return -(len(parts) - 1)
        zp = [self.z(x) for x in parts]
        if len(parts) == 2 and ((zc >= 3.0 and min(zp) < 2.8) or (zc >= 1.0 and max(zp) < 3.0)):
            return -1
        return None

    def fix(self, text):
        text = re.sub(r'([A-Za-zÀ-ÿ])([/-])(?=[A-Za-zÀ-ÿ])', lambda m: m.group(1) + ' \x01' + m.group(2) + ' ', text)
        return self._fix(text).replace(' \x01/ ', '/').replace(' \x01- ', '-').replace('\x01', '')

    def _fix(self, text):
        toks = text.split(' ')
        n = len(toks)
        # piezas: (prefijo, letras, sufijo) o None si el token no es una palabra
        info = []
        for t in toks:
            m = re.match(r'^([(‘“\[]*)([A-Za-zÀ-ÿ’\']+?)([.,;:!?)’”\]]*)$', t)
            info.append(m.groups() if m and re.fullmatch(r'[A-Za-zÀ-ÿ]+(?:[’\'][a-z]+)?', m.group(2)) else None)
        INF = float('inf')
        best = [INF] * (n + 1)
        choice = [1] * (n + 1)
        best[n] = 0.0
        for i in range(n - 1, -1, -1):
            # token suelto
            c1 = best[i + 1]
            best[i], choice[i] = c1, 1
            if not info[i] or info[i][2]:
                continue
            for k in range(2, 7):
                j = i + k
                if j > n or not info[j - 1]:
                    break
                mids = info[i + 1:j]
                if any(x[0] for x in mids) or any(x[2] for x in mids[:-1]) or not all(re.fullmatch(r'[a-zà-ÿ]+(?:[’\'][a-z]+)?', x[1]) for x in mids):
                    break
                c = self.cost([info[i][1]] + [x[1] for x in mids])
                if c is not None and c + best[j] < best[i]:
                    best[i], choice[i] = c + best[j], k
        out = []
        i = 0
        while i < n:
            k = choice[i]
            if k == 1:
                out.append(toks[i])
            else:
                grp = info[i:i + k]
                out.append(grp[0][0] + ''.join(x[1] for x in grp) + grp[-1][2])
            i += k
        return ' '.join(out)


def join_lines(lines, dh):
    """Une las líneas de un bloque de texto en párrafos (corte de párrafo: línea corta acabada en punto)."""
    paras, cur = [], ''
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        if cur.endswith(' -'):
            cur = cur[:-2] + ' ' + ln
        elif cur.endswith('-') and not cur.endswith(' -'):
            cur = cur + ln
        else:
            cur = (cur + ' ' + ln).strip()
        if len(ln) < 32 and re.search(r'[.!?][’”)]?$', ln) and not re.search(r'\d\.$', ln):
            paras.append(cur); cur = ''
    if cur:
        paras.append(cur)
    out = []
    for p in paras:
        p = re.sub(r'\s+', ' ', p.replace('po si ti o n', 'position').replace('ope ning', 'opening').replace('Ope ning', 'Opening').replace('cas tling', 'castling').replace('Cas tling', 'Castling'))
        for x, y in FIXES.items():
            p = p.replace(x, y)
        p = dh.fix(p)
        p = letters(p)
        p = re.sub(r'(?<![\w\-])0-0-0(?![\w\-])', 'O-O-O', p)
        p = re.sub(r'(?<![\w\-])0-0(?![\w\-])', 'O-O', p)
        out.append(p)
    return out


# ------------------------------------------------------------------ lectura
def clean_lines(raw):
    out = []
    for ln in raw.split('\n'):
        # \x02 = corte de línea con guion del PDF: guion de verdad entre nombres ("Kotov\x02Keres"),
        # si no, corte de sílaba ("How\x02ever"); a veces arrastra la cabecera de página
        s = re.sub(r'\x02(?=[A-Z])(?!Win ning)', '-', ln)
        s = s.replace('\x02Win ning Chess Middlegames', ' ').replace('\x02', ' ')
        s = re.sub(r'[\x00-\x08\x0b-\x1f]', '', s).strip()
        if any(f.match(s) for f in FOOTER):
            continue
        out.append(s)
    return out


def tokenize(lines):
    """Convierte las líneas en elementos: diag, move, game, struct, chapter, text."""
    items = []
    i = 0
    n = len(lines)
    while i < n:
        s = lines[i]
        if i + 8 <= n and all(DROW.match(lines[i + k]) for k in range(8)):
            rows = lines[i:i + 8]
            i += 8
            if i + 8 <= n and lines[i:i + 8] == rows:
                i += 8
            analysis = False
            j = i
            while j < n and not lines[j]:
                j += 1
            if j < n and re.sub(' ', '', lines[j]).lower() == 'analysisdiagram':
                analysis = True; i = j + 1
            items.append(('diag', placement(rows), analysis))
            continue
        i += 1
        if not s:
            continue
        if re.sub(' ', '', s).lower() == 'analysisdiagram':
            items.append(('text', '')); continue
        m = re.match(r'^Chap ?ter (\d)$', s)
        if m:
            items.append(('chapter', int(m.group(1)))); continue
        m = STRUCT.match(s)
        if m:
            items.append(('struct', f'{m.group(1)}.{m.group(2)}')); continue
        m = re.match(r'^(\d)\.(\d{1,2})$', s)
        if m:  # etiqueta de diagrama de estructura (resúmenes de capítulo)
            items.append(('slabel', s)); continue
        m = GAMEHDR.match(s)
        if m:
            items.append(('game', {'code': f'{m.group(1)} {m.group(2)}', 'eco': m.group(3), 'num': int(m.group(4))})); continue
        m = MOVELINE.match(s)
        if m and (LAN.match(m.group(3)) or CASTLE.match(m.group(3))) and (not m.group(4) or LAN.match(m.group(4)) or CASTLE.match(m.group(4))):
            items.append(('move', int(m.group(1)), bool(m.group(2)), m.group(3), m.group(4)))
            if m.group(5):
                items.append(('result', m.group(5).replace('½-½', '1/2-1/2')))
            continue
        items.append(('text', s))
    return items


def play_lan(board, tok):
    m = CASTLE.match(tok)
    if m:
        long_ = m.group(1) == '0-0-0'
        k = board.king(board.turn)
        mv = chess.Move(k, k - 2 if long_ else k + 2)
        nag = m.group(3)
    else:
        m = LAN.match(tok)
        if not m:
            raise ValueError(f'jugada ilegible {tok}')
        pc, fr, sep, to, promo, chk, nag = m.groups()
        prom = {'À': chess.KNIGHT, 'Ã': chess.BISHOP, 'Õ': chess.ROOK, '©': chess.QUEEN}.get(promo)
        mv = chess.Move(chess.parse_square(fr), chess.parse_square(to))
        p = board.piece_at(mv.from_square)
        if p and p.piece_type == chess.PAWN and chess.square_rank(mv.to_square) in (0, 7):
            mv.promotion = prom or chess.QUEEN
        want = {'': chess.PAWN, 'À': chess.KNIGHT, 'Ã': chess.BISHOP, 'Õ': chess.ROOK, '©': chess.QUEEN, '®': chess.KING}[pc]
        if not p or p.piece_type != want or p.color != board.turn:
            raise ValueError(f'pieza no cuadra en {tok}')
        if (sep == 'x') != board.is_capture(mv):
            raise ValueError(f'captura no cuadra en {tok}')
    if mv not in board.legal_moves:
        raise ValueError(f'jugada ilegal {tok}')
    san = board.san(mv)
    board.push(mv)
    return san, ([NAGS[nag]] if nag else [])


SHORT = re.compile(r'(\d{1,3})\.(\.\.)?\s*((?:[ÀÃÕ©®]?[a-h]?[1-8]?x?[a-h][1-8](?:[ÀÃÕ©])?|0-0-0|0-0)[+#]?)([!?]{0,2})(?:\s+((?:[ÀÃÕ©®]?[a-h]?[1-8]?x?[a-h][1-8](?:[ÀÃÕ©])?|0-0-0|0-0)[+#]?)([!?]{0,2}))?')


def short_main(g, board, textbuf, want_ply):
    for k in range(len(textbuf) - 1, -1, -1):
        line = textbuf[k].strip()
        toks = []
        pos = 0
        while pos < len(line):
            m = SHORT.match(line, pos)
            if not m:
                break
            num, dots = int(m.group(1)), bool(m.group(2))
            toks.append((2 * (num - 1) + (1 if dots else 0), m.group(3), m.group(4)))
            if m.group(5):
                toks.append((2 * (num - 1) + (1 if dots else 0) + 1, m.group(5), m.group(6)))
            pos = m.end()
            while pos < len(line) and line[pos] == ' ':
                pos += 1
        if not toks or pos < len(line) or toks[0][0] != len(g['moves']):
            continue
        b = board.copy()
        new = []
        try:
            for ply, san, nag in toks:
                if ply != len(g['moves']) + len(new):
                    raise ValueError
                mv = b.parse_san(letters(san).replace('0-0-0', 'O-O-O').replace('0-0', 'O-O'))
                new.append({'san': b.san(mv), 'nags': [NAGS[nag]] if nag else [], 'comments': []})
                b.push(mv)
        except ValueError:
            continue
        if len(g['moves']) + len(new) != want_ply:
            continue
        del textbuf[k]
        for m in new:
            board.push_san(m['san'])
            g['moves'].append(m)
        return


EXTRA_LINKS = {'3.1': ['36'], '4.1': ['41', '42', '43', '44', '45'], '4.2': ['41'], '4.3': ['41', '42', '43', '45'],
               '4.4': ['41'], '4.5': ['43'], '4.6': ['44', '42'], '4.7': ['45']}
PRIMARY = {'36': '3.2', '41': '4.4', '42': '4.6', '43': '4.5', '44': '4.6', '45': '4.7'}

RESULT_PATTERNS = [(r'white re ?signed|white resigned', '0-1'), (r'black re ?signed|black resigned', '1-0'),
                   (r'\bdraw\b|drawn', '1/2-1/2'), (r'\b1-0\b', '1-0'), (r'\b0-1\b', '0-1')]


def main():
    raw = open(sys.argv[1], encoding='utf8').read()
    dh = Dehyph(raw)
    lines = clean_lines(raw)
    # cuerpo: desde "Chap ter 1" (tras la introducción) hasta el índice de jugadores
    start = next(k for k, s in enumerate(lines) if s == 'Chap ter 1' and k > 150)
    end = next(k for k, s in enumerate(lines) if (re.sub(' ', '', s) == 'IndexofPlayers' or 'Code Sys' in s) and k > start)
    intro_lines = lines[next(k for k, s in enumerate(lines) if re.sub(' ', '', s) == 'Introduction'):start]
    items = tokenize(lines[start:end])
    report = []

    chapters, structs, games = [], [], []
    ch = st = g = None
    board = None
    textbuf = []
    gstate = None  # 'hdr' (cabecera: jugadores y torneo), 'moves'
    pending_diags = []

    def target():
        if g is not None and gstate == 'moves' and g['moves']:
            return g['moves'][-1]
        if g is not None:
            return g
        if st is not None:
            return st
        return ch

    def flush():
        nonlocal textbuf
        if not textbuf:
            return
        t = target()
        paras = join_lines(textbuf, dh)
        textbuf = []
        if t is None:
            return
        key = 'comments' if 'san' in t else ('pre' if 'white' in t else 'intro')
        t.setdefault(key, []).extend(paras)

    for it in items:
        kind = it[0]
        if kind == 'chapter':
            flush()
            g = None; st = None
            ch = {'num': it[1], 'title': CHAPTERS[it[1]], 'titleEn': CHAPTERS_EN[it[1]], 'intro': [], 'structures': [], 'overview': []}
            chapters.append(ch)
            skip_title = 2
            continue
        if kind == 'struct':
            flush()
            sid = it[1]
            if any(s['id'] == sid for s in structs):
                continue
            g = None
            st = {'id': sid, 'chapter': ch['num'], 'diagram': None, 'title': None, 'intro': [], 'games': []}
            structs.append(st); ch['structures'].append(sid)
            continue
        if kind == 'slabel':
            flush()
            if ch is not None:
                ch['overview'].append({'label': it[1], 'diag': None})
            continue
        if kind == 'game':
            flush()
            g = {**it[1], 'id': str(it[1]['num']), 'white': None, 'black': None, 'event': None, 'pre': [],
                 'moves': [], 'diags': [], 'structure': st['id'] if st else None, 'chapter': ch['num']}
            games.append(g)
            if st: st['games'].append(g['id'])
            board = chess.Board()
            gstate = 'hdr'
            continue
        if kind == 'diag':
            flush()
            pl, analysis = it[1], it[2]
            if st is not None and st['diagram'] is None and g is None:
                st['diagram'] = pl
            elif ch is not None and ch['overview'] and ch['overview'][-1]['diag'] is None and g is None:
                ch['overview'][-1]['diag'] = pl
            elif g is not None:
                g['diags'].append({'ply': len(g['moves']), 'fen': pl, 'analysis': analysis})
            continue
        if kind == 'text':
            s = it[1]
            if g is not None and gstate == 'hdr':
                if g['white'] is None: g['white'] = s; continue
                if g['black'] is None: g['black'] = s; continue
                if g['event'] is None: g['event'] = s; continue
            if st is not None and st['title'] is None and g is None and st['diagram'] is not None:
                if len(s) < 110 and not s.endswith(',') and not GAMEHDR.match(s) and not re.match(r'^(We|In|The|This|Here) ', s):
                    st['title'] = s; continue
                st['title'] = ''
            if ch is not None and skip_title and g is None and st is None:
                skip_title -= 1
                if skip_title == 1: continue   # título del capítulo
                if re.sub(' ', '', s) == 'Introduction': continue
            if s:
                textbuf.append(s)
            continue
        if kind == 'result':
            g['explicit'] = it[1]
            continue
        if kind == 'move':
            _, num, dots, a, b = it
            if g is None:
                raise SystemExit(f'jugada fuera de partida: {it}')
            ply = len(g['moves'])
            want_ply = 2 * (num - 1) + (1 if dots else 0)
            if want_ply > ply:
                # a veces el libro da jugadas de la línea principal en notación corta, como pie de un
                # diagrama ("33...Õe5! 34.Àxf7"): se buscan en el texto pendiente y se aplican.
                short_main(g, board, textbuf, want_ply)
                ply = len(g['moves'])
            if want_ply != ply:
                raise SystemExit(f'partida {g["id"]}: se esperaba la media jugada {ply}, llega {it}')
            flush()
            gstate = 'moves'
            for tok in [a, b] if b else [a]:
                try:
                    san, nags = play_lan(board, tok)
                except Exception as e:
                    raise SystemExit(f'partida {g["id"]} jugada {num}: {e}')
                g['moves'].append({'san': san, 'nags': nags, 'comments': []})
            continue
    flush()

    # Capítulo 4: las 7 estructuras sólo aparecen como diagramas del resumen inicial ("4.1" … "4.7")
    # y cada partida ilustra varias. Capítulo 3: la estructura 3.1 comparte partida con la 3.2.
    ch4 = next(c for c in chapters if c['num'] == 4)
    for o in ch4['overview']:
        sid = o['label']
        if not any(x['id'] == sid for x in structs):
            structs.append({'id': sid, 'chapter': 4, 'diagram': o['diag'], 'title': '', 'intro': [], 'games': []})
            ch4['structures'].append(sid)
    by = {x['id']: x for x in structs}
    for sid, ids in EXTRA_LINKS.items():
        by[sid]['games'] = ids
    for g in games:
        if g['id'] in PRIMARY:
            g['structure'] = PRIMARY[g['id']]

    # resultados
    for g in games:
        b = chess.Board()
        for m in g['moves']:
            b.push_san(m['san'])
        res = g.pop('explicit', '*')
        if res != '*':
            pass
        elif b.is_checkmate():
            res = '0-1' if b.turn == chess.WHITE else '1-0'
        else:
            tail = ' '.join(g['moves'][-1]['comments'][:3]).lower() if g['moves'] else ''
            for p, r in RESULT_PATTERNS:
                if re.search(p, tail):
                    res = r; break
        g['result'] = res
        g['event'] = join_lines([g['event'] or ''], dh)[0]
        g['white'] = join_lines([g['white'] or ''], dh)[0]
        g['black'] = join_lines([g['black'] or ''], dh)[0]
        report.append(f'{g["id"]:>3} {g["code"]:<9} {g["eco"]} {g["white"]} – {g["black"]} · {g["event"]} · {len(g["moves"])} medias · {res} · diags {len(g["diags"])}')
    for s in structs:
        s['title'] = letters(dh.fix(s['title'] or ''))
        report.append(f'E{s["id"]:<5} {s["title"]} · partidas {s["games"]} · diagrama {"sí" if s["diagram"] else "NO"}')
    book_intro = join_lines(intro_lines, dh)
    json.dump({'intro': book_intro, 'chapters': chapters, 'structures': structs, 'games': games},
              open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
    open(sys.argv[3], 'w').write('\n'.join(report) + '\n')
    print(f'capítulos={len(chapters)} estructuras={len(structs)} partidas={len(games)} medias jugadas={sum(len(g["moves"]) for g in games)}')


if __name__ == '__main__':
    main()
