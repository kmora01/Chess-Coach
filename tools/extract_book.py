#!/usr/bin/env python3
"""Convierte el OCR de un libro de partidas comentadas (formato "My 60 Memorable Games")
en un PGN anotado. Cada jugada se valida con python-chess.

Entrada: carpeta con fix-NNN.json (salida de tools/ocr_pages.py + tools/figurines.py).
Salida: PGN + informe de problemas para revisión manual.

Uso: python3 extract_book.py OCR_DIR SALIDA.pgn [--corrections corrections.json]
"""
import glob, json, re, sys, os
import chess, chess.pgn

GLYPH_GUESS = {}
for chars, piece in [('DdＤ②', 'N'), ('WwY豐赠曾要', 'Q'), ('三兰EIHＩ', 'R'), ('夏真复奥更$皇鲁奠LA↓鱼', 'B'), ('雪中空', 'K')]:
    for c in chars:
        GLYPH_GUESS[c] = piece

PAGE_HEADER_Y = 175
PAGE_OFFSET = 0  # página del PDF = página del libro - 1 + PAGE_OFFSET
MOVE_TOKEN = re.compile(r'^(?P<pre>[^a-hO0o\d]?)(?P<body>(?:[KQRBN])?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?|[O0o]-[O0o](?:-[O0o])?)(?P<suf>[+#]?[!?]{0,2}[+#]?)$')


def box(it):
    b = it['box']
    xs = [p[0] for p in b]; ys = [p[1] for p in b]
    return min(xs), min(ys), max(xs), max(ys)


def clean_prose(t):
    t = t.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    t = re.sub(r'(\d+)\s?\.\.\.?\s?(?=[KQRBNa-hO0])', r'\1...', t)      # 11..Nd7 -> 11...Nd7
    t = re.sub(r"(?<=\s)'(?=[KQRBN][a-h1-8x])", '', t)                  # 'Qe2 -> Qe2
    t = re.sub(r'\b([KQRBN]?x?[a-h][1-8])1(?=[\s,;:)\]]|$)', r'\1!', t)   # g41 -> g4!
    t = re.sub(r'\b([KQRBN]?x?[a-h][1-8])l(?=[\s,;:)\]]|$)', r'\1!', t)
    t = re.sub(r'(?<![\w\-.])(\d{1,3})(?=(?:[KQRBN][a-h1-8x]|[a-h]x[a-h]|[a-h][1-8](?!\d)|O-O|0-0))', r'\1 ', t)  # 6Bg2 -> 6 Bg2
    t = re.sub(r'([a-h][1-8](?:=?[QRBN])?[+#!?]*)(?=[KQRBN][a-h1-8x])', r'\1 ', t)   # Bg2Nge7 -> Bg2 Nge7
    t = re.sub(r'([a-h][1-8])(\d{1,3})(?=[KQRBN][a-h1-8x]|[a-h]x?[a-h]?[1-8])', r'\1 \2 ', t)  # gxf612Qh5 -> gxf6 12 Qh5
    t = re.sub(r'([!?]+)(?=\d{1,3}\s?(?:\.\.\.)?\s?[KQRBNa-hO])', r'\1 ', t)     # Bxf6?12 -> Bxf6? 12
    t = re.sub(r'([a-h][1-8][+#!?]*)(?=[A-Z][a-z]{2,}|[a-z]{3,})', r'\1 ', t)      # Bxb5!Or / a3followed
    t = re.sub(r'([!?]+)(?=[A-Z][a-z])', r'\1 ', t)
    t = re.sub(r'\)(?=\d)', ') ', t)
    t = re.sub(r'\s{2,}', ' ', t)
    return t.strip()


def parse_token(tok):
    """Devuelve (pieza|None|'?', resto_normalizado, sufijo) o None si no parece jugada."""
    tok = tok.strip().replace('—', '-').replace('–', '-')
    tok = re.sub(r'(?<=[KQRBN])X', 'x', tok)
    tok = re.sub(r'=$', '=Q', re.sub(r'=([!?+#]+)$', r'=Q\1', tok))
    tok = re.sub(r'^[kK](?=[a-h]?[1-8]?x?[a-h][1-8])', 'K', tok)
    tok = re.sub(r'\(\?\)$|\(!\)$', '', tok)
    m = MOVE_TOKEN.match(tok)
    if not m:
        return None
    pre, body, suf = m.group('pre'), m.group('body'), m.group('suf')
    if re.match(r'^[O0o]-[O0o]', body):
        return ('castle', 'O-O-O' if body.count('-') == 2 else 'O-O', suf)
    piece = None
    if body[0] in 'KQRBN':
        piece = body[0]; body = body[1:]
    elif pre in ('K', 'Q', 'R', 'B', 'N'):
        piece = pre
    elif pre:
        piece = GLYPH_GUESS.get(pre, '?')
    return (piece, body, suf)


def resolve(board, tok):
    """Encuentra la jugada legal que mejor encaja con el token OCR."""
    p = parse_token(tok)
    if not p:
        return None, f'token no reconocido "{tok}"'
    piece, body, suf = p
    legal = list(board.legal_moves)
    if piece == 'castle':
        for mv in legal:
            if board.is_castling(mv) and (board.is_queenside_castling(mv) == (body == 'O-O-O')):
                return mv, None
        return None, f'enroque ilegal "{tok}"'
    dest = body[-2:] if not re.search(r'=?[QRBN]$', body) else re.sub(r'=?[QRBN]$', '', body)[-2:]
    promo = re.search(r'=?([QRBN])$', body)
    capture = 'x' in body
    disamb = re.sub(r'x', '', body)[:-2]
    if promo:
        disamb = re.sub(r'x', '', re.sub(r'=?[QRBN]$', '', body))[:-2]
    cands = []
    for mv in legal:
        if chess.square_name(mv.to_square) != dest:
            continue
        pt = board.piece_at(mv.from_square).piece_type
        sym = chess.piece_symbol(pt).upper()
        is_pawn = pt == chess.PAWN
        if piece and piece in 'KQRBN':
            if sym != piece: continue
        elif piece == '?':
            if is_pawn: continue
        else:  # sin pieza: peón, salvo que el OCR haya perdido la figura
            pass
        if capture and not board.is_capture(mv):
            continue
        fs = chess.square_name(mv.from_square)
        if disamb and not all(ch in fs for ch in disamb):
            # en jugadas de peón el "disamb" es la columna de origen
            continue
        if promo and (mv.promotion is None or chess.piece_symbol(mv.promotion).upper() != promo.group(1)):
            continue
        if not promo and mv.promotion and mv.promotion != chess.QUEEN:
            continue
        cands.append((mv, is_pawn))
    if piece is None:
        pawns = [c for c in cands if c[1]]
        # "e1" sin figura y sin peón posible: pieza perdida por el OCR
        if pawns:
            cands = pawns
    if len(cands) == 1:
        return cands[0][0], None
    if not cands:
        return None, f'ninguna jugada legal encaja con "{tok}"'
    return None, f'ambiguo "{tok}": ' + ', '.join(board.san(c[0]) for c in cands)


SUBS = [('1', 'f'), ('l', '1'), ('I', '1'), ('i', '1'), ('|', '1'), ('S', '5'), ('s', '5'), ('O', '0'), ('o', '0'),
        ('g', '9'), ('9', 'g'), ('B', '8'), ('8', 'B'), ('Z', '2'), ('z', '2'), ('t', 'f'), ('G', '6'), ('q', 'g'), ('4', 'h'), ('h', '4'), ('c', 'e'), ('e', 'c')]


_TPL = None
_IMG = {}


def figure_scores(ocr_dir, pn, yc, x):
    """Puntuación de cada figura (K Q R B N) justo a la izquierda/encima del token, a baja exigencia."""
    global _TPL
    import cv2
    if _TPL is None:
        here = os.path.dirname(os.path.abspath(__file__))
        _TPL = [(os.path.basename(f)[0], cv2.imread(f, 0)) for f in sorted(glob.glob(os.path.join(here, 'templates', '*.png')))]
    f = os.path.join(ocr_dir, f'img-{pn:03d}.png')
    if f not in _IMG:
        _IMG.clear(); _IMG[f] = cv2.imread(f, 0)
    im = _IMG[f]
    if im is None or x is None:
        return {}
    y0, y1 = int(max(0, yc - 27)), int(yc + 27)
    x0, x1 = int(max(0, x - 52)), int(x + 50)
    region = im[y0:y1, x0:x1]
    best = {}
    for p, t0 in _TPL:
        for sc in (0.92, 0.96, 1.0, 1.04, 1.08, 1.12):
            t = cv2.resize(t0, None, fx=sc, fy=sc)
            if t.shape[0] > region.shape[0] or t.shape[1] > region.shape[1]:
                continue
            v = float(cv2.matchTemplate(region, t, cv2.TM_CCOEFF_NORMED).max())
            best[p] = max(best.get(p, -1), v)
    return best


def resolve_fuzzy(board, tok, alts=(), fig=None):
    mv, err = resolve(board, tok)
    if mv and fig and board.piece_type_at(mv.from_square) == chess.PAWN and not re.match(r'^[a-h]x', tok):
        # ¿se perdió la figura? (p. ej. "f6!" que en realidad es "♖f6!")
        pieces = {chess.piece_symbol(board.piece_type_at(m.from_square)).upper(): m for m in board.legal_moves
                  if m.to_square == mv.to_square and board.piece_type_at(m.from_square) != chess.PAWN}
        if pieces:
            sc = fig()
            best = max(pieces, key=lambda p: sc.get(p, -1)) if sc else None
            if best and sc.get(best, -1) > 0.6:
                tok2 = best + re.sub(r'^[^a-h]*', '', tok)
                m2, _ = resolve(board, tok2)
                if m2:
                    return m2, None
    if mv:
        return mv, None
    if err and err.startswith('ambiguo') and fig:
        cands = []
        for mv2 in board.legal_moves:
            pass
        names = re.findall(r'([KQRBN])[a-h1-8x]', err.split(':', 1)[1])
        sc = fig()
        if sc:
            ranked = sorted(set(names), key=lambda p: -sc.get(p, -1))
            if ranked and sc.get(ranked[0], -1) > 0.45 and (len(ranked) == 1 or sc[ranked[0]] - sc.get(ranked[1], -1) > 0.08):
                p_ = parse_token(tok)
                body = p_[1] if p_ else tok
                m2, _ = resolve(board, ranked[0] + body)
                if m2:
                    return m2, None
    found = {}
    for cand in list(alts):
        m2, _ = resolve(board, cand)
        if m2:
            found[m2] = cand
    if len(found) == 1:
        return next(iter(found)), None
    if not found:
        for i, ch in enumerate(tok):
            for a, b in SUBS:
                if ch == a:
                    m2, _ = resolve(board, tok[:i] + b + tok[i + 1:])
                    if m2:
                        found[m2] = tok
    if len(found) == 1:
        return next(iter(found)), None
    if found:
        return None, err + ' / variantes: ' + ', '.join(board.san(m) for m in found)
    return None, err


_OLD = {}
FIGS = {}


def old_ocr_alts(ocr_dir, pn, yc, x):
    """Lecturas del primer OCR (otro motor) cerca de la misma posición, como segunda opinión."""
    out = []
    for name in (f'fix-{pn:03d}.json', f'ocr-{pn:03d}.json'):
        f = os.path.join(ocr_dir, name)
        if not os.path.exists(f):
            continue
        if f not in _OLD:
            d = json.load(open(f))
            _OLD[f] = d['items'] if isinstance(d, dict) else d
        for it in _OLD[f]:
            x0, y0, x1, y1 = box(it)
            if abs((y0 + y1) / 2 - yc) < 22 and (x is None or abs(x0 - x) < 70):
                out += it['text'].split()
    return out


def drop_duplicate_pages(pages):
    """Algunos escaneos repiten una página: si dos páginas seguidas son casi iguales, se ignora la primera."""
    import difflib
    keys = sorted(pages)
    txt = {k: ' '.join(it['text'] for it in pages[k]) for k in keys}
    for a, b in zip(keys, keys[1:]):
        if txt[a] and txt[b] and difflib.SequenceMatcher(None, txt[a][:3000], txt[b][:3000]).ratio() > 0.8:
            print(f'página {a} duplicada de {b}: se ignora', file=sys.stderr)
            pages.pop(a)
    return pages


def load_pages(ocr_dir):
    pages = {}
    for f in sorted(glob.glob(os.path.join(ocr_dir, 'v6-*.json'))):
        n = int(re.search(r'-(\d+)\.json', os.path.basename(f)).group(1))
        d = json.load(open(f))
        pages[n] = d['items']
        FIGS[n] = d.get('figs', [])
    return pages


def page_rows(items):
    els = []
    slopes = []
    for it in items:
        b = it['box']
        if b[1][0] - b[0][0] > 700:
            slopes.append((b[1][1] - b[0][1]) / (b[1][0] - b[0][0]))
    slope = sorted(slopes)[len(slopes) // 2] if slopes else 0.0
    for it in items:
        x0, y0, x1, y1 = box(it)
        yc = (y0 + y1) / 2 - slope * ((x0 + x1) / 2 - 800)  # corrige la inclinación del escaneo
        els.append({'t': it['text'], 'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'yc': yc, 'h': y1 - y0})
    els = [e for e in els if e['y1'] > PAGE_HEADER_Y]
    # diagramas: se localizan por el pie "Position after ..." y se ignora su franja
    captions = [e for e in els if len(e['t']) < 40 and re.match(r'\s*(Position\s*(after|before)|Final\s*[Pp]osition)', e['t'])]
    out_caps = []
    for c in captions:
        out_caps.append(c)
    def in_diagram(e):
        for c in captions:
            if abs(e['yc'] - c['yc']) < 235 and e is not c:
                return True
        return False
    rows = []
    for e in sorted([e for e in els if not in_diagram(e) and e not in captions], key=lambda e: e['yc']):
        if rows and abs(rows[-1][-1]['yc'] - e['yc']) < 20:
            rows[-1].append(e)
        else:
            rows.append([e])
    rows = [sorted(r, key=lambda e: e['x0']) for r in rows]
    long_lines = [r[0]['x0'] for r in rows if sum(len(e['t']) for e in r) > 40]
    margin = min(long_lines) if long_lines else 300
    return rows, margin, out_caps


TITLE_RE = re.compile(r'^(?P<w>[A-Z][\w\'\. ]+?)\s*(?:\[(?P<wc>[^\]]*)\]?)?\s*[-–—]\s*(?P<b>[A-Z][\w\'\. ]+?)\s*(?:\[(?P<bc>[^\]]*)\]?)?\s*$')


def is_title_page(rows):
    if not rows:
        return None
    first = ' '.join(e['t'] for e in rows[0])
    if rows[0][0]['y0'] < 400 and 'ischer' in first and re.search(r'[-–—]', first):
        m = TITLE_RE.match(first.replace('l. ', 'J. '))
        return first
    return None


def caption_ply(text):
    m = re.search(r'after\s*(\d+)\s*(\.\.\.|…|\.\.|\.)?\s*([^\s]+)', text)
    if not m:
        return None
    n = int(m.group(1)); black = bool(m.group(2) and m.group(2).startswith('..'))
    return (2 * (n - 1) + (1 if black else 0) + 1, m.group(3))


def extract(ocr_dir, corrections=None, contents=None):
    corrections = corrections or {}
    pages = drop_duplicate_pages(load_pages(ocr_dir))
    games = []
    g = None
    issues = []
    starts = {}
    import difflib
    for c in (contents or []):
        exp = c['book_page'] - 1 + PAGE_OFFSET
        best = None
        for pn in range(exp - 2, exp + 5):
            if pn not in pages:
                continue
            rows_, _, _ = page_rows(pages[pn])
            top = [' '.join(e['t'] for e in r) for r in rows_[:6]]
            sc = max([difflib.SequenceMatcher(None, t.lower(), c['title'].lower()).ratio() for t in top] or [0])
            if sc > 0.75 and (best is None or sc > best[0] + 0.05):
                best = (sc, pn)
        if best:
            starts[best[1]] = c
        else:
            starts[exp] = c
            issues.append((c['n'], exp, 'no encuentro la página de título; uso la del índice'))
    for pn in sorted(pages):
        rows, margin, caps = page_rows(pages[pn])
        title = is_title_page(rows) if not contents else None
        if pn in starts or title:
            c = starts.get(pn, {})
            g = {'ocr_dir': ocr_dir, 'title_line': title or '', 'contents': c, 'page': pn, 'head': [], 'intro': [], 'moves': [], 'events': [], 'issues': []}
            games.append(g)
            hdr = []
            k = 0
            while k < len(rows) and k < 6:
                t = ' '.join(e['t'] for e in rows[k])
                if 'ischer' in t and re.search(r'[-–—]', t) and len(t) < 60:
                    g['title_line'] = t; k += 1; continue
                letters = re.sub(r'[^A-Za-z]', '', t)
                if letters and letters.isupper() or (c and t.strip().lower().rstrip('.') == c.get('title', '').lower()):
                    hdr.append(t); k += 1
                    if c and t.strip().lower().rstrip('.') == c.get('title', '').lower():
                        break
                    continue
                if c and len(hdr) >= 2 and len(t) < 50 and k <= 4:
                    hdr.append(t); k += 1; break
                break
            g['head'] = hdr
            rows = rows[k:]
        if g is None:
            continue
        evs = [('caption', pn, c['yc'], c['t']) for c in caps]
        moverows = []
        for r in rows:
            text = ' '.join(e['t'] for e in r)
            for e_ in r:
                e_['t'] = re.sub(r'(?<=[a-h])[lI|](?=[+#!?]*$)', '1', e_['t'])
            text = ' '.join(e['t'] for e in r)
            toks_ = text.split()
            core = re.sub(r'(?i)\b(and\s+)?(black|white)\s+resigns?\b|\bdrawn?\b|\bmate\b|\bdis\.|\bch\.', '', text)
            ctoks = core.split()
            looks_moves = (all(len(t_) <= 9 for t_ in ctoks) and
                           any(re.search(r'[a-h][1-8]|^[O0o]-[O0o]', t_) for t_ in ctoks + ['resigns' if 'esign' in text else '']) or
                           (re.search(r'(?i)resign|drawn', text) and len(text) < 40)) and \
                          sum(1 for t_ in ctoks if re.fullmatch(r'["\']?[A-Za-z\']{4,}[.,;:!?"]*', t_)) == 0
            if r[0]['x0'] < margin + 110 or len(text) > 45 or not looks_moves:
                evs.append(('prose', pn, r[0]['yc'], text, r[0]['x0'] - margin))
            else:
                moverows.append(r)
        for r, cells in zip(moverows, rows_from_det(moverows)):
            evs.append(('row', pn, r[0]['yc'], cells))
        evs.sort(key=lambda e: e[2])
        g['events'] += evs
    pgns = []
    for gi, g in enumerate(games, 1):
        game, gissues = build_game(gi, g, corrections.get(str(gi), {}))
        issues += [(gi, *x) for x in gissues]
        pgns.append(game)
    return pgns, issues


_ENG = None


def rows_from_det(rows):
    """Asigna cada token de una fila de jugadas a su columna (número / blancas / negras)."""
    ws, bs = [], []
    parsed = []
    for r in rows:
        toks = []
        for e in r:
            parts = e['t'].split()
            # estimación de x de cada palabra dentro de la caja
            step = (e['x1'] - e['x0']) / max(1, len(e['t']))
            pos = 0
            for part in parts:
                i = e['t'].find(part, pos)
                toks.append((part, e['x0'] + i * step))
                pos = i + len(part)
        # separar número pegado: "10d4" -> "10", "d4"
        fixed = []
        for k, (t, x) in enumerate(toks):
            m = re.fullmatch(r'(\d{1,3})(\.*)([KQRBNa-hO0].*)', t)
            if m and k == 0 and x < 880:
                fixed += [(m.group(1), x), (m.group(3), x + 40)]
            else:
                fixed.append((t, x))
        fixed = [('...', x) if re.fullmatch(r'[.…·•●,:]{1,3}[1l|0]*', t) else (t, x) for t, x in fixed]
        # descartar basura del OCR (lo que no es número, puntos ni jugada)
        fixed = [(t, x) for t, x in fixed if re.fullmatch(r'\d{1,3}\.?|\.{2,3}|…', t) or re.search(r'[a-h][1-8]|^[O0o]-[O0o]|^[KQRBNk][a-h1-8x]', t)]
        moves = [(t, x) for t, x in fixed if not re.fullmatch(r'\d{1,3}\.?|\.{2,3}|…|-{1,3}', t)]
        alltxt = ' '.join(t for t, _ in toks)
        end_txt = alltxt if re.search(r'(?i)resign|drawn|draw', alltxt) else ''
        if len(moves) == 2:
            ws.append(moves[0][1]); bs.append(moves[1][1])
        parsed.append((fixed, moves, end_txt))
    W = sorted(ws)[len(ws) // 2] if ws else None
    B = sorted(bs)[len(bs) // 2] if bs else None
    split = (W + B) / 2 if W and B else 880
    out = []
    for fixed, moves, end_txt in parsed:
        cells = {'num': '', 'white': '', 'black': '', 'det': [t for t, _ in fixed], 'end': end_txt}
        dots = any(re.fullmatch(r'\.{2,3}|…', t) and (not moves or x < moves[0][1]) for t, x in fixed)
        nums = [t for t, _ in fixed if re.fullmatch(r'\d{1,3}\.?', t)]
        if nums: cells['num'] = nums[0].rstrip('.')
        if len(moves) >= 2:
            cells['white'], cells['black'] = moves[0][0], ' '.join(t for t, _ in moves[1:])
            cells['wx'], cells['bx'] = moves[0][1], moves[1][1]
        elif len(moves) == 1:
            side = 'black' if (dots or moves[0][1] > split) else 'white'
            cells[side] = moves[0][0]
            cells['wx' if side == 'white' else 'bx'] = moves[0][1]
        out.append(cells)
    return out


def reocr_rows(ocr_dir, pn, rows):
    """Relee cada fila de jugadas por columnas (número / blancas / negras) sobre la imagen
    con las figuras ya sustituidas por letras. El detector de texto a veces omite jugadas cortas."""
    global _ENG
    if not rows:
        return []
    cache_file = os.path.join(ocr_dir, f'rows-{pn:03d}.json')
    cache = json.load(open(cache_file)) if os.path.exists(cache_file) else {}
    ws, bs = [], []
    for r in rows:
        for e in r:
            if re.fullmatch(r'\d{1,3}', e['t']) or re.fullmatch(r'\.{2,3}|…', e['t']):
                continue
            (bs if e['x0'] > 880 else ws).append(e['x0'])
    W = int(sorted(ws)[len(ws) // 2]) if ws else (643 if pn % 2 == 0 else 722)
    B = int(sorted(bs)[len(bs) // 2]) if bs else W + 393
    out = []
    img = None
    changed = False
    for r in rows:
        y0 = int(min(e['y0'] for e in r)); y1 = int(max(e['y1'] for e in r))
        key = f'{y0}:{y1}:{W}:{B}'
        if key not in cache:
            if img is None:
                import cv2
                img = cv2.imread(os.path.join(ocr_dir, f'fixed-{pn:03d}.png'))
            if _ENG is None:
                from rapidocr_onnxruntime import RapidOCR
                _ENG = RapidOCR()
            res = {}
            for name, (a, b) in {'num': (W - 175, W - 25), 'white': (W - 25, B - 70), 'black': (B - 25, B + 290)}.items():
                region = img[max(0, y0 - 8):y1 + 8, max(0, a):b]
                ink = (region.min(axis=2) < 120)
                txt, sc = '', 0.0
                rr = None
                if ink.sum() > 30:
                    colc = (ink.sum(axis=0) >= 2).nonzero()[0]
                    if len(colc) == 0:
                        res[name] = ['', 0.0]; continue
                    # primer bloque de tinta (separación > 60 px = otra cosa)
                    cx0 = cx1 = colc[0]
                    for c_ in colc[1:]:
                        if c_ - cx1 > 60: break
                        cx1 = c_
                    rowc = (ink[:, cx0:cx1 + 1].sum(axis=1) >= 1).nonzero()[0]
                    cy0, cy1 = rowc[0], rowc[-1]
                    import cv2
                    variants = []
                    for py, px, bd in [(10, 12, 6), (10, 12, 10), (6, 8, 6), (14, 16, 4), (8, 10, 12)]:
                        crop = region[max(0, cy0 - py):cy1 + py + 1, max(0, cx0 - px):cx1 + px + 1]
                        variants.append(cv2.copyMakeBorder(crop, bd, bd, bd, bd, cv2.BORDER_CONSTANT, value=(255, 255, 255)))
                    outs = _ENG.text_recognizer(variants)[0]
                    votes = {}
                    for t_, sc_ in outs:
                        if t_.strip():
                            votes.setdefault(t_.strip(), []).append(float(sc_))
                    if votes:
                        best = max(votes.items(), key=lambda kv: (len(kv[1]), max(kv[1])))
                        rr = [(best[0], max(best[1]))]
                if rr:
                    txt, sc = rr[0][0], float(rr[0][1])
                res[name] = [txt.strip(), sc]
            cache[key] = res
            changed = True
        res = cache[key]
        cells = {k: (v[0] if v[1] > 0.2 else '') for k, v in res.items()}
        cells['det'] = [e['t'] for e in r]
        out.append(cells)
    if changed:
        json.dump(cache, open(cache_file, 'w'), ensure_ascii=False)
    return out


def split_row_tokens(cells):
    """cells: [(texto, x)] -> lista de (tipo, valor, x)"""
    toks = []
    for t, x in cells:
        parts = t.split()
        for i, p in enumerate(parts):
            toks.append((p, x + i * 40))
    out = []
    for p, x in toks:
        if re.fullmatch(r'\d{1,3}', p):
            out.append(('num', int(p), x))
        elif re.fullmatch(r'\.{2,3}|…|-{1,3}', p):
            out.append(('dots', p, x))
        elif re.search(r'(?i)resign|drawn|draw', p):
            out.append(('end', p, x))
        else:
            out.append(('move', p, x))
    return out


def build_game(gi, g, corr):
    board = chess.Board()
    game = chess.pgn.Game()
    c = g.get('contents') or {}
    head = g['head']
    if c:
        hero = HERO
        w, b = (hero, c['opponent']) if c['opp_color'] == 'black' else (c['opponent'], hero)
        event = c['event']
    else:
        w, b = parse_players(g['title_line'])
        event = titlecase(head[0]) if head else '?'
    up = [h_ for h_ in head if re.sub(r'[^A-Za-z]', '', h_).isupper()]
    opening = next((h_ for h_ in up if not re.search(r'\d{4}', h_)), '')
    game.headers['Event'] = event
    yr = re.search(r'(19\d\d)', event)
    game.headers['Site'] = '?'
    game.headers['Date'] = f'{yr.group(1)}.??.??' if yr else '????.??.??'
    game.headers['Round'] = str(gi)
    game.headers['White'] = w
    game.headers['Black'] = b
    game.headers['Result'] = '*'
    if opening: game.headers['Opening'] = fix_opening(opening)
    game.headers['Title'] = c.get('title') or (head[2] if len(head) > 2 else '')
    game.headers['Annotator'] = 'Fischer'
    game.headers['BookPage'] = str(g['page'] + 1)
    issues = []
    node = game
    comment_buf = []
    intro = []
    ended = None
    pending_ply_tokens = []
    last_y = None
    overrides = {int(k): (v if isinstance(v, dict) else {'san': v}) for k, v in corr.get('moves', {}).items()}
    for k, v in corr.get('insert', {}).items():
        overrides[int(k)] = {'san': v, 'insert': True}
    skips = set(int(k) for k in corr.get('skip', []))
    used = set()

    def flush_comment():
        nonlocal comment_buf
        if not comment_buf:
            return
        txt = join_paragraphs(comment_buf)
        comment_buf = []
        if node is game:
            intro.append(txt)
        else:
            node.comment = (node.comment + '\n' if node.comment else '') + txt

    stopped = False
    tok_index = 0
    for ev in g['events']:
        kind = ev[0]
        if kind == 'prose':
            comment_buf.append((ev[1], ev[2], clean_prose(ev[3]), ev[4]))
            continue
        if kind == 'caption':
            cp = caption_ply(ev[3])
            if cp and not stopped:
                ply = board.ply()
                if cp[0] != ply:
                    issues.append((ev[1], f'diagrama "{ev[3]}" pero vamos en el ply {ply}'))
            continue
        # fila de jugadas
        flush_comment()
        cells = ev[3]
        if cells.get('num') and not stopped and cells['num'].isdigit() and int(cells['num']) != board.fullmove_number and int(cells['num']) * 10 != board.fullmove_number:
            issues.append((ev[1], f'aviso: fila numerada {cells["num"]} pero vamos en la jugada {board.fullmove_number} det={cells.get("det")}'))
        if cells.get('end'):
            ended = cells['end']
        for side in ('white', 'black'):
            if stopped:
                break
            raw = cells.get(side, '')
            t = re.sub(r'\s+', '', raw)
            t = re.sub(r'^\d{1,3}\.?(?=[KQRBNa-hO0])', '', t)
            ply = board.ply() + 1
            expect = 'white' if board.turn == chess.WHITE else 'black'
            if re.search(r'(?i)resign|drawn|draw', raw):
                ended = raw; continue
            if not t or re.fullmatch(r'[.…\-]+', t):
                continue
            # correcciones manuales: insertar jugadas que faltan o sustituir la leída
            while ply in overrides and ply not in used:
                used.add(ply)
                o = overrides[ply]
                if side == expect and not o.get('insert'):
                    t = o['san']; break
                mvo = board.parse_san(o['san'])
                node = node.add_main_variation(mvo); board.push(mvo)
                ply = board.ply() + 1
                expect = 'white' if board.turn == chess.WHITE else 'black'
            if ply in skips and ply not in used and side == expect:
                used.add(ply); continue
            if side != expect and not (cells.get('white', '') == '' or cells.get('black', '') == '') :
                pass
            elif side != expect:
                mtest, _ = resolve(board, t)
                if mtest:
                    issues.append((ev[1], f'revisar ply {ply}: "{t}" estaba en la columna de {side}; lo acepto para el bando al que le toca'))
                    side = expect
            if side != expect:
                issues.append((ev[1], f'ply {ply}: aparece "{t}" en la columna de {side} pero juegan las {"blancas" if expect == "white" else "negras"} (falta una jugada) det={cells.get("det")}'))
                stopped = True
                break
            alts = old_ocr_alts(g.get('ocr_dir', ''), ev[1], ev[2], cells.get('wx' if side == 'white' else 'bx'))
            xx = cells.get('wx' if side == 'white' else 'bx')
            if xx is not None and re.match(r'^[KQRBN][a-h1-8x]', t):
                near = [f_ for f_ in FIGS.get(ev[1], []) if abs(f_['y'] + f_['h'] / 2 - ev[2]) < 26 and xx - 20 <= f_['x'] <= xx + 45]
                if not near:
                    # la letra la "adivinó" el OCR leyendo la figura: verificar con las plantillas
                    alt_t = '?' + t[1:]
                    cands = {}
                    for pc in 'KQRBN':
                        m_, _ = resolve(board, pc + t[1:])
                        if m_: cands[pc] = m_
                    if len(cands) > 1 or (cands and t[0] not in cands):
                        sc = figure_scores(g['ocr_dir'], ev[1], ev[2], xx)
                        bestp = max(cands, key=lambda p_: sc.get(p_, -1)) if sc else None
                        if bestp and bestp != t[0] and sc.get(bestp, 0) > 0.55 and sc.get(bestp, 0) - sc.get(t[0], 0) > 0.15:
                            issues.append((ev[1], f'revisar ply {ply}: OCR "{t}" pero la figura parece {bestp} ({sc.get(bestp):.2f} vs {sc.get(t[0], 0):.2f})'))
                            t = bestp + t[1:]
            mv, err = resolve_fuzzy(board, t, alts, fig=lambda: figure_scores(g['ocr_dir'], ev[1], ev[2], xx))
            if os.environ.get('DEBUG_GAME') == str(gi):
                print('DBG', ev[1], ply, side, repr(t), mv and board.san(mv), err, file=sys.stderr)
            if mv and alts:
                other = set()
                for a in alts:
                    m3, _ = resolve(board, a)
                    if m3: other.add(m3)
                if other and mv not in other:
                    issues.append((ev[1], f'revisar ply {ply}: v6 leyó "{t}" ({board.san(mv)}) y el otro OCR {alts} -> ' + ', '.join(board.san(m) for m in other)))
            if err:
                issues.append((ev[1], f'ply {ply} ({"blancas" if board.turn else "negras"}): {err} det={cells.get("det")}'))
                stopped = True
                break
            nags = []
            sm = re.search(r'([!?]{1,2})$', t)
            if sm:
                nags = [{'!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6}.get(sm.group(1), 0)]
            node = node.add_main_variation(mv)
            for n_ in nags:
                if n_: node.nags.add(n_)
            board.push(mv)
    flush_comment()
    game.comment = '\n'.join(intro)
    # resultado
    res = '*'
    if board.is_checkmate():
        res = '1-0' if board.turn == chess.BLACK else '0-1'
    elif ended and re.search(r'(?i)black\s+resigns', ended):
        res = '1-0'
    elif ended and re.search(r'(?i)white\s+resigns', ended):
        res = '0-1'
    elif ended and re.search(r'(?i)draw', ended):
        res = '1/2-1/2'
    elif ended and re.search(r'(?i)resign', ended):
        res = '1-0' if board.turn == chess.BLACK else '0-1'
    if corr.get('result'):
        res = corr['result']
    game.headers['Result'] = res
    if stopped:
        game.headers['Incomplete'] = 'true'
    return game, issues


def join_paragraphs(lines):
    paras = []
    cur = ''
    last_y = None
    last_ind = 0
    for pn, y, t, indent in lines:
        newpara = last_y is None or indent > last_ind + 15 or (y - last_y) > 75 or y < last_y and indent > 15
        last_ind = indent
        if newpara and cur:
            paras.append(cur); cur = ''
        if cur.endswith('-') and t[:1].islower() and not re.search(r'[A-Z]-$', cur):
            cur = cur[:-1] + t
        elif cur:
            cur += ('' if cur.endswith('-') else ' ') + t
        else:
            cur = t
        last_y = y
    if cur:
        paras.append(cur)
    return '\n'.join(paras)


def parse_players(line):
    line = re.sub(r'\[[^\]]*\]?', '', line)
    line = re.sub(r'^\s*\d{1,2}\s+', '', line)
    parts = re.split(r'\s+[-–—]\s+|\s*[-–—]\s*', line.strip(), maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return line.strip(), '?'


HERO = 'Fischer'
OPENING_FIX = {'SICILIANDEFENSE': 'Sicilian Defense', 'RUYLOPEZ': 'Ruy Lopez', 'CARO-KANNDEFENSE': 'Caro-Kann Defense',
               "KING'SINDIANDEFENSE": "King's Indian Defense"}


def fix_opening(s):
    key = s.replace(' ', '').upper()
    for k, v in OPENING_FIX.items():
        if k.replace(' ', '') == key:
            return v
    words = re.findall(r"[A-Z][A-Z'\-]*|\S+", s)
    t = titlecase(s)
    t = re.sub(r'(?i)(Defense|Gambit|Opening|Attack|Game|Variation)', lambda m: ' ' + m.group(1).capitalize(), t)
    t = re.sub(r"(?i)(Sicilian|French|Indian|Queen's|King's|English|Nimzo|Grunfeld|Gruenfeld|Petroff|Slav|Benoni|Two Knights|Bishop's|Pirc|Alekhine's|Caro-kann|Evans)", lambda m: ' ' + m.group(1).capitalize() + ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t.replace('Caro-kann', 'Caro-Kann')


SMALL = {'of', 'the', 'and', 'in', 'at', 'vs', 'de'}


def titlecase(s):
    words = s.split()
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if i and lw in SMALL:
            out.append(lw)
        elif re.fullmatch(r'[IVX]+', w) or re.fullmatch(r'U\.?S\.?A?\.?', w):
            out.append(w)
        else:
            out.append(lw[:1].upper() + lw[1:])
    return ' '.join(out)


if __name__ == '__main__':
    ocr_dir, out = sys.argv[1], sys.argv[2]
    corr = {}
    if '--corrections' in sys.argv:
        corr = json.load(open(sys.argv[sys.argv.index('--corrections') + 1]))
    contents = None
    if '--contents' in sys.argv:
        contents = json.load(open(sys.argv[sys.argv.index('--contents') + 1]))['games']
    games, issues = extract(ocr_dir, corr.get('games', {}), contents)
    with open(out, 'w') as f:
        for gm in games:
            exp = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
            f.write(gm.accept(exp) + '\n\n')
    for i in issues:
        print('Partida %d, pág. %s: %s' % (i[0], i[1], i[2]))
    print(f'{len(games)} partidas, {len(issues)} problemas', file=sys.stderr)
