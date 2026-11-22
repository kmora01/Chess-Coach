"""Reconstruye el árbol de aperturas de *Fundamental Chess Openings* a partir de los bloques del EPUB.

Uso: python3 -I parse_fco.py blocks.json salida.json [informe.txt]

Cada jugada (línea principal o dentro del texto) se valida con python-chess partiendo de la
posición que le corresponde. Una jugada que no se puede validar se deja como texto normal y se
anota en el informe: nunca se publica una jugada ilegal.
"""
import sys, json, re
import chess

SAN = r'(?:O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?)[+#]?'
ANN = r'[!?]{1,2}'
# token de jugada en el texto: número opcional + SAN + anotación opcional
MOVE_TOKEN = re.compile(r'(?<![\w/\-.])(?:(\d{1,3})(?:\s*(\.\.\.|…)\s*|\.\s*|\s+))?(\.\.\.|…)?(' + SAN + r')(' + ANN + r')?(?![\w/])')
MAIN_RE = re.compile(r'^(\d+)\s+(?:(' + SAN + r')(?:/[a-h1-8]+)?(' + ANN + r')?|\.\s*\.\s*\.)(?:\s+(' + SAN + r')(' + ANN + r')?)?\s*(\(D\))?$')

import os
NOGUIDE = bool(os.environ.get('NOGUIDE'))
ANALYZE = [] if os.environ.get('ANALYZE') else None
BOLD_SPINE = bool(os.environ.get('BOLD'))
COMPARE_LOW = not os.environ.get('NOCMP')
MODE_PREV_LOW = not os.environ.get('PREVHIGH')
CONTENT_FIRST, CONTENT_LAST = 'part0000_split_006.html', 'part0000_split_041.html'
PARTS = {'part0000_split_007.html', 'part0000_split_021.html', 'part0000_split_027.html'}


def to_san(s):
    return s.replace('0-0-0', 'O-O-O').replace('0-0', 'O-O')


def parse_strict(board, san):
    """Como board.parse_san pero exige que la jugada escrita en el libro sea exactamente la notación
    correcta en esa posición (misma captura, misma desambiguación), salvo los signos de jaque."""
    mv = board.parse_san(to_san(san))
    canon = board.san(mv)
    clean = lambda t: to_san(t).replace('+', '').replace('#', '').replace('=', '')
    if clean(canon) != clean(san):
        raise ValueError(f'notación distinta: {san} / {canon}')
    return mv


def norm_text(s):
    return re.sub(r'\s+', ' ', s.replace(' ', ' ')).strip()


class Tree:
    """Árbol global de todo el libro: un nodo por camino de jugadas."""

    def __init__(self):
        self.parent = [-1]
        self.san = [None]
        self.uci = [None]
        self.fen = [chess.STARTING_FEN]
        self.children = [{}]
        self.main_hits = [0]
        self.refs = [0]

    def child(self, nid, move, board):
        san = board.san(move)
        ch = self.children[nid]
        if san in ch:
            return ch[san]
        k = len(self.parent)
        self.parent.append(nid); self.san.append(san); self.uci.append(move.uci())
        b = board.copy(); b.push(move)
        self.fen.append(b.fen()); self.children.append({}); self.main_hits.append(0); self.refs.append(0)
        ch[san] = k
        return k

    def idea_child(self, nid, san_text):
        """Jugada 'de plan' ('followed by 13...Bb7'): el rival no mueve. Se guarda como '--' + SAN."""
        b = chess.Board(self.fen[nid])
        if b.is_check():
            return None
        b.push(chess.Move.null())
        try:
            mv = parse_strict(b, san_text)
        except ValueError:
            return None
        key = '--' + b.san(mv)
        ch = self.children[nid]
        if key in ch:
            return ch[key]
        k = len(self.parent)
        self.parent.append(nid); self.san.append(key); self.uci.append(mv.uci())
        b.push(mv)
        self.fen.append(b.fen()); self.children.append({}); self.main_hits.append(0); self.refs.append(0)
        ch[key] = k
        return k

    def path(self, nid):
        out = []
        while nid > 0:
            out.append(nid); nid = self.parent[nid]
        return out[::-1]

    def board(self, nid):
        return chess.Board(self.fen[nid])


def ply_of(nid_board):
    b = nid_board
    return (b.fullmove_number - 1) * 2 + (0 if b.turn == chess.WHITE else 1)


class Parser:
    def __init__(self, diag_place=None, overrides=None):
        self.diag_place = diag_place or {}   # imagen -> colocación leída del diagrama
        self.overrides = overrides or {}
        self.tree = Tree()
        self.issues = []
        self.stats = {'main_moves': 0, 'text_moves': 0, 'text_unresolved': 0, 'paragraphs': 0}

    # ---------- utilidades
    def node_at_ply(self, path_nodes, ply):
        """path_nodes: lista de nodos desde la raíz (sin la raíz). Devuelve el nodo con 'ply' jugadas."""
        if ply == 0:
            return 0
        if ply <= len(path_nodes):
            return path_nodes[ply - 1]
        return None

    def try_play(self, nid, san):
        b = self.tree.board(nid)
        try:
            mv = parse_strict(b, san)
        except ValueError:
            return None
        return self.tree.child(nid, mv, b)

    def issue(self, where, msg):
        self.issues.append(f'{where}: {msg}')

    # ---------- capítulos
    def run(self, files):
        chapters = []
        active = False
        for f in files:
            if f['file'] == CONTENT_FIRST:
                active = True
            if not active:
                continue
            if f['file'] == 'part0000_split_038.html' and chapters:
                # el capítulo de la Siciliana continúa en otro archivo
                self.parse_file(f, chapters[-1], continuing=True)
            else:
                ch = {'id': f['file'].replace('part0000_split_', 'c').replace('.html', ''), 'title': None,
                      'part': f['file'] in PARTS, 'sections': []}
                self.parse_file(f, ch)
                chapters.append(ch)
            if f['file'] == CONTENT_LAST:
                break
        return chapters

    def parse_file(self, f, ch, continuing=False):
        where_file = f['file']
        if not continuing:
            self.spine = []  # nodos de la línea principal vigente
            self.runs = []
        sec = ch['sections'][-1] if continuing and ch['sections'] else None
        pending_diags = []  # nodos esperados para los próximos diagramas, en orden
        caption_wait = None
        blocks = f['blocks']
        def next_imgs(bi):
            out = []
            for nb in blocks[bi + 1:]:
                if nb['cls'] == 'diag':
                    if nb['img']:
                        out.append(self.diag_place.get(nb['img'][0]))
                    continue
                break
            return out
        for bi, b in enumerate(blocks):
            where = f'{where_file}#{bi}'
            text = norm_text(b['text'])
            if b['tag'] == 'h1' and not continuing and ch['title'] is None:
                ch['title'] = text
                sec = {'title': None, 'blocks': []}
                ch['sections'].append(sec)
                continue
            if b['tag'] == 'h1' and continuing:
                # cabecera repetida ("2 Nf3 e6"): se trata como sección
                sec = {'title': text, 'blocks': []}
                ch['sections'].append(sec)
                self.heading_moves(text, sec, where)
                continue
            if b['tag'] in ('h2', 'h3'):
                sec = {'title': text, 'blocks': []}
                ch['sections'].append(sec)
                self.heading_moves(text, sec, where)
                continue
            if sec is None:
                sec = {'title': None, 'blocks': []}
                ch['sections'].append(sec)
            if b['cls'] == 'diag':
                if b['img']:
                    node = pending_diags.pop(0) if pending_diags else None
                    if node is None and self.diag_place.get(b['img'][0]):
                        want = self.diag_place[b['img'][0]]
                        node = next((k for k in range(len(self.tree.fen)) if self.tree.fen[k].split(' ')[0] == want), None)
                    if node is None:
                        self.issue(where, f'diagrama {b["img"][0]} sin posición asociada')
                    blk = {'k': 'diag', 'img': b['img'][0], 'node': node}
                    sec['blocks'].append(blk)
                    caption_wait = blk
                elif caption_wait is not None and text in ('White to play', 'Black to play'):
                    caption_wait['turn'] = 'w' if text.startswith('White') else 'b'
                    caption_wait = None
                continue
            m = MAIN_RE.match(text) if b['segs'] and b['segs'][0].get('b') and re.match(r'^[  ]{3,}\d', b['segs'][0]['t']) else None
            if m:
                look = next_imgs(bi) if m.group(6) else []
                nodes = self.main_moves(m, where, look[0] if look else None)
                blk = {'k': 'main', 'nodes': nodes}
                sec['blocks'].append(blk)
                if m.group(6):
                    pending_diags.append(nodes[-1][0] if nodes else None)
                continue
            if b['tag'] == 'p' and text:
                self.stats['paragraphs'] += 1
                skip = self.overrides.get('diag_skip', {}).get(where, [])
                look = next_imgs(bi)
                for k in skip:
                    look.insert(k, None)
                segs, diags = self.prose(b['segs'], where, look)
                diags = [d for k, d in enumerate(diags) if k not in skip]
                sec['blocks'].append({'k': 'p', 'cls': b['cls'], 'segs': segs})
                pending_diags.extend(diags)
        if pending_diags:
            self.issue(where_file, f'{len(pending_diags)} marcas (D) sin diagrama')

    # ---------- línea principal
    def main_moves(self, m, where, expect=None):
        n = int(m.group(1))
        out = []
        white, black = m.group(2), m.group(4)
        plies = []
        if white:
            plies.append((2 * (n - 1), white, m.group(3)))
        if black:
            plies.append((2 * (n - 1) + 1, black, m.group(5)))
        for k, (ply, san, ann) in enumerate(plies):
            nid = self.play_main(ply, san, where, expect if k == len(plies) - 1 else None,
                                 plies[k + 1][1] if k + 1 < len(plies) else None, expect)
            if nid is None:
                break
            out.append([nid, ann or ''])
            self.stats['main_moves'] += 1
        self.runs = []
        return out

    def placement(self, nid):
        return self.tree.fen[nid].split(' ')[0]

    def play_main(self, ply, san, where, expect=None, nxt=None, final_expect=None):
        """Jugada de la línea principal. Candidatas: la línea principal vigente y las variantes del
        texto que llegan a ese número de jugada. Si hay diagrama, gana la candidata que lo reproduce."""
        cands = []
        base = self.node_at_ply(self.spine, ply)
        if base is not None:
            cands.append(('spine', base))
        for r in reversed(self.runs):
            nb = r['at'].get(ply)
            if nb is not None and all(nb != c[1] for c in cands):
                cands.append(('run', nb))
        legal = []
        for kind, nb in cands:
            b = self.tree.board(nb)
            try:
                mv = parse_strict(b, san)
            except ValueError:
                continue
            legal.append((kind, nb, mv))
        if not legal and final_expect:
            # ¿alguna posición del árbol en este número de jugada que lleve al diagrama?
            for nb in self.nodes_at_ply(ply):
                b = self.tree.board(nb)
                try:
                    mv = parse_strict(b, san)
                except ValueError:
                    continue
                b.push(mv)
                if nxt:
                    try:
                        b.push(parse_strict(b, nxt))
                    except ValueError:
                        continue
                if b.board_fen() == final_expect:
                    legal.append(('tree', nb, mv))
                    break
        if not legal:
            self.issue(where, f'ERROR línea principal: {ply // 2 + 1}{"..." if ply % 2 else "."}{san} no es legal (ply {ply}, espina {len(self.spine)})')
            return None
        choice = legal[0]
        if final_expect and len(legal) > 1:
            for c in legal:
                b = self.tree.board(c[1]); b.push(c[2])
                if nxt:
                    try:
                        b.push(parse_strict(b, nxt))
                    except ValueError:
                        continue
                if b.board_fen() == final_expect:
                    choice = c; break
        kind, nb, mv = choice
        nid = self.tree.child(nb, mv, self.tree.board(nb))
        if kind != 'spine':
            self.issue(where, f'aviso: línea principal {ply // 2 + 1}{"..." if ply % 2 else "."}{san} sigue desde {kind}')
        self.spine = self.tree.path(nid)
        self.tree.main_hits[nid] += 1
        return nid

    def nodes_at_ply(self, ply):
        # nodos del árbol con 'ply' jugadas (los más recientes primero)
        if not hasattr(self, '_ply_idx'):
            self._ply_idx, self._ply_n = {}, 0
        for nid in range(self._ply_n, len(self.tree.parent)):
            f = self.tree.fen[nid].split(' ')
            self._ply_idx.setdefault((int(f[5]) - 1) * 2 + (0 if f[1] == 'w' else 1), []).append(nid)
        self._ply_n = len(self.tree.parent)
        return self._ply_idx.get(ply, [])[::-1]

    def heading_moves(self, text, sec, where):
        """Títulos como '3...Nf6 4 Bg5': se enlazan si encajan con la línea principal."""
        nodes = []
        cur = None
        first = text.split(' / ')[0]
        for mt in MOVE_TOKEN.finditer(first):
            num, dots, dots2, san, ann = mt.groups()
            if num:
                ply = 2 * (int(num) - 1) + (1 if (dots or dots2) else 0)
                base = self.node_at_ply(self.spine, ply)
                if base is None:
                    cur = None; continue
                cur = self.try_play(base, san)
            elif cur is not None:
                cur = self.try_play(cur, san)
            else:
                continue
            if cur is not None:
                nodes.append(cur)
            else:
                break
        sec['nodes'] = nodes
        if nodes:
            # el título fija la línea principal de la sección (p. ej. '3...Nf6 4 Nf3 Nbd7')
            self.spine = self.tree.path(nodes[-1])
            self.runs = []

    # ---------- texto
    def prose(self, segs, where, look=()):
        """Devuelve (segmentos, nodos de diagramas). Los segmentos son texto plano o jugadas enlazadas.
        look: colocaciones leídas de los diagramas que siguen al párrafo, una por cada '(D)'."""
        full = ''
        bold = []
        for s in segs:
            t = s.get('t', '').replace('\u00a0', ' ')
            full += t
            bold.extend([bool(s.get('b'))] * len(t))
        self.full = full
        self.bold = bold
        self.para_id = getattr(self, 'para_id', 0) + 1
        if NOGUIDE:
            look = ()
        dpos = [m.start() for m in re.finditer(r'\(D\)', full)]
        self.dexp = {x: (look[k] if k < len(look) else None) for k, x in enumerate(dpos)}
        out = []
        pos = 0
        cur = None       # secuencia actual: {'start', 'at': {ply: nodo antes}, 'ply': siguiente, 'node': último}
        last_end = 0
        resolved = []    # (fin, nodo)
        tokens = list(MOVE_TOKEN.finditer(full))
        # paréntesis: grupo más interno de cada carácter
        self.groups = [None] * (len(full) + 1)
        stack, spans = [], []
        for k, c in enumerate(full):
            if c == '(':
                stack.append(k)
            elif c == ')' and stack:
                spans.append((stack.pop(), k))
        for a_, z_ in sorted(spans, key=lambda x: -(x[1] - x[0])):
            for k in range(a_, z_ + 1):
                self.groups[k] = (a_, z_)
        def closed_now(r, at):
            g = r.get('group')
            return g is not None and g[1] < at
        ti = 0
        while ti < len(tokens):
            mt = tokens[ti]
            num, dots, dots2, san, ann = mt.groups()
            gap = full[last_end:mt.start()]
            contiguous = cur is not None and re.fullmatch(r'\s*(\(D\)\s*)?', gap) is not None
            res = None
            if num:
                ply = 2 * (int(num) - 1) + (1 if (dots or dots2) else 0)
                res = self.start_run(ply, tokens, ti, full, cur, where, mt.start())
            elif contiguous and not dots2:
                nid = self.try_play(cur['node'], san)
                if nid is not None:
                    res = ('cont', nid)
            if res is None and num and cur is not None and cur['ply'] == ply - 1 and not closed_now(cur, mt.start()):
                # idea/plan: 'followed by 13...Bb7', 'threatening 9...Nxc3', '8 b4 and 9 Bb2'
                nid = self.tree.idea_child(cur['node'], san)
                if nid is not None:
                    self.stats['idea_moves'] = self.stats.get('idea_moves', 0) + 1
                    if pos < mt.start():
                        out.append(full[pos:mt.start()])
                    out.append({'m': nid, 't': full[mt.start():mt.end()], 'b': False, 'idea': True})
                    pos = last_end = mt.end()
                    resolved.append((mt.end(), nid))
                    ti += 1
                    continue
            if res is None:
                if num:
                    self.stats['text_unresolved'] += 1
                    self.issue(where, f'sin resolver: "{full[max(0, mt.start() - 40):mt.end() + 10]}"')
                    cur = None
                ti += 1
                continue
            kind, nid = res
            if kind == 'new':
                ply = ply_of(self.tree.board(self.tree.parent[nid]))
                cur = {'start': ply, 'at': {ply: self.tree.parent[nid]}, 'ply': ply, 'node': None,
                       'group': self.groups[mt.start()], 'para': self.para_id,
                       'compare': re.search(r'(than|compared (to|with)|instead of|as opposed to)\s*$', full[max(0, mt.start() - 20):mt.start()]) is not None}
                self.runs.append(cur)
            ply = cur['ply']
            cur['at'][ply] = self.tree.parent[nid]
            cur['ply'] = ply + 1
            cur['at'][ply + 1] = nid
            cur['node'] = nid
            self.tree.refs[nid] += 1
            self.stats['text_moves'] += 1
            if pos < mt.start():
                out.append(full[pos:mt.start()])
            out.append({'m': nid, 't': full[mt.start():mt.end()], 'b': bold[mt.start()] if mt.start() < len(bold) else False})
            pos = last_end = mt.end()
            resolved.append((mt.end(), nid))
            ti += 1
        if pos < len(full):
            out.append(full[pos:])
        # cada '(D)' corresponde a la jugada enlazada que tiene justo delante
        diags = []
        for x in dpos:
            node = None
            for end, nid in reversed(resolved):
                if end <= x:
                    if re.fullmatch(r'\s*', full[end:x]):
                        node = nid
                    break
            diags.append(node)
        return out, diags

    def start_run(self, ply, tokens, ti, full, cur, where, at):
        """Elige la posición de partida de una secuencia numerada. Candidatas, por orden: continuar la
        secuencia actual, posiciones de secuencias recientes (las encerradas en un paréntesis ya
        cerrado van al final), la línea principal. Se valida la cadena de jugadas que continúa la
        secuencia en el resto del párrafo y gana la candidata que valida más jugadas (en empate, la
        primera)."""
        def closed(r):
            g = r.get('group')
            return g is not None and g[1] < at
        tiers = [[], [], [], [], [], []]
        spine_nb = self.node_at_ply(self.spine, ply)
        if BOLD_SPINE and self.bold_at(at) and spine_nb is not None:
            # en el libro, una jugada numerada en negrita es una alternativa a la línea principal
            tiers[0].append(spine_nb)
        if cur is not None and cur['ply'] == ply and not closed(cur):
            tiers[0].append(cur['node'])
        for r in reversed(self.runs):
            nb = r['at'].get(ply)
            if nb is None:
                continue
            same = r.get('para') == self.para_id
            if (closed(r) and same) or (COMPARE_LOW and r.get('compare')):
                t = 5
            elif ply > r['start']:
                t = 1 if same else (3 if MODE_PREV_LOW else 1)
            else:
                t = 2 if same else 4
            tiers[t].append(nb)
        if spine_nb is not None:
            tiers[2 if MODE_PREV_LOW else 2].insert(0 if MODE_PREV_LOW else len(tiers[2]), spine_nb)
        ov = self.overrides.get('start', {}).get(where, {}).get(full[at:tokens[ti].end()])
        if ov is not None:
            nb = 0
            for san in ov.split():
                nb = self.try_play(nb, san)
                assert nb is not None, f'override ilegal en {where}: {ov}'
            self.issue(where, f'aviso: corrección manual para {full[at:tokens[ti].end()]}')
            tiers = [[nb]]
        cands = []
        self.cand_info = {}
        for ti_, t in enumerate(tiers):
            for nb in t:
                if nb not in cands:
                    cands.append(nb)
                    self.cand_info[nb] = ti_
        chain = self.chain(tokens, ti, full, ply)
        best = None
        scored = []
        for nb in cands:
            n, dok, dbad = self.score(nb, chain)
            if n == 0:
                continue
            key = (dok - 10 * dbad, n)
            scored.append((key, nb))
            if best is None or key > best[0]:
                best = (key, nb)
        nexp = sum(1 for c in chain if c[1])
        if nexp and (best is None or best[0][0] <= 0):
            # ningún contexto reproduce el diagrama: buscar en todo el árbol una posición desde la que
            # la secuencia llegue exactamente al diagrama impreso
            for nb in self.nodes_at_ply(ply):
                n, dok, dbad = self.score(nb, chain)
                if dok and not dbad:
                    best = ((dok, n), nb)
                    self.issue(where, f'aviso: contexto encontrado por diagrama para {chain[0][0]}')
                    break
            if best is None or best[0][0] <= 0:
                # un nivel más: posición previa del árbol + una jugada que el texto da por supuesta
                for pb in self.nodes_at_ply(ply - 1):
                    b = self.tree.board(pb)
                    found = None
                    for mv in list(b.legal_moves):
                        b2 = b.copy(); b2.push(mv)
                        n, dok, dbad = self.score_board(b2, chain)
                        if dok and not dbad:
                            found = mv; break
                    if found:
                        nb = self.tree.child(pb, found, b)
                        best = ((1, 1), nb)
                        self.issue(where, f'aviso: contexto reconstruido por diagrama ({self.tree.san[nb]}) para {chain[0][0]}')
                        break
        if best is not None:
            # ¿otra candidata igual de buena que lleva a una posición distinta? => decisión ambigua
            rivals = [nb for key, nb in scored if key == best[0] and nb != best[1]
                      and self.tree.fen[nb] != self.tree.fen[best[1]]]
            pinned = best[0][0] > 0
            self.last_ambiguous = bool(rivals) and not pinned
            if self.last_ambiguous:
                self.stats['ambiguous'] = self.stats.get('ambiguous', 0) + 1
            if ANALYZE is not None and any(c[1] for c in chain):
                exp_ok = [nb for key, nb in scored if key[0] > 0]
                full_ok = [nb for key, nb in scored if key[1] == len(chain)]
                if len(set(self.tree.fen[x] for x in full_ok)) > 1:
                    first = full_ok[0]
                    ANALYZE.append({'where': where, 'ok': [self.cand_info[x] for x in exp_ok], 'cands': [self.cand_info[x] for x in full_ok],
                                    'first_ok': first in exp_ok, 'ctx': full[max(0, at - 80):at + 30]})
        if best is None:
            return None
        nid = self.try_play(best[1], chain[0][0])
        return ('new', nid)

    def bold_at(self, at):
        return at < len(self.bold) and self.bold[at]

    def chain(self, tokens, ti, full, ply):
        """Jugadas que continúan la secuencia a partir del token ti: las contiguas y, tras un texto,
        la siguiente jugada numerada con el número esperado (saltando como mucho 3 jugadas de otras
        secuencias). Cada jugada lleva la colocación del diagrama que la sigue, si lo hay."""
        def exp_after(mt):
            m = re.match(r'\s*(\(D\))', full[mt.end():])
            return self.dexp.get(mt.end() + m.start(1)) if m else None
        out = [(tokens[ti].group(4), exp_after(tokens[ti]))]
        expect = ply + 1
        end = tokens[ti].end()
        skipped = 0
        following = True
        g0 = self.groups[tokens[ti].start()]
        for mt in tokens[ti + 1:]:
            gap = full[end:mt.start()] if following else ' x '
            num, dots, dots2, san, ann = mt.groups()
            g = self.groups[mt.start()]
            if g is not None and g != g0 and (g0 is None or g[0] > g0[0]):
                # dentro de un paréntesis abierto después: es otra línea, no la continuación
                following = False
                continue
            if num:
                p = 2 * (int(num) - 1) + (1 if (dots or dots2) else 0)
                if p != expect:
                    skipped += 1
                    following = False
                    if skipped > 3 or p < ply:
                        break
                    continue
            elif not (following and re.fullmatch(r'\s*(\(D\)\s*)?', gap)):
                following = False
                continue
            out.append((san, exp_after(mt))); expect += 1; end = mt.end(); following = True
        return out

    def score(self, nb, chain):
        return self.score_board(self.tree.board(nb), chain)

    def score_board(self, b, chain):
        """(jugadas legales, diagramas que coinciden, diagramas que no coinciden)."""
        b = b.copy()
        n = dok = dbad = 0
        for san, exp in chain:
            try:
                b.push(parse_strict(b, san))
            except ValueError:
                break
            n += 1
            if exp:
                if b.board_fen() == exp:
                    dok += 1
                else:
                    dbad += 1
        return n, dok, dbad


def main():
    files = json.load(open(sys.argv[1]))
    diag = {}
    if len(sys.argv) > 4:
        diag = {k: v['placement'] for k, v in json.load(open(sys.argv[4])).items()}
    ovp = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'overrides-fco.json')
    p = Parser(diag, json.load(open(ovp)) if os.path.exists(ovp) else None)
    chapters = p.run(files)
    t = p.tree
    data = {'chapters': chapters,
            'nodes': {'parent': t.parent, 'san': t.san, 'uci': t.uci},
            'stats': p.stats}
    json.dump(data, open(sys.argv[2], 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump({'fen': t.fen, 'main_hits': t.main_hits, 'refs': t.refs}, open(sys.argv[2] + '.aux.json', 'w'))
    rep = open(sys.argv[3], 'w') if len(sys.argv) > 3 else sys.stdout
    print(json.dumps(p.stats), f'nodos={len(t.parent)}', f'avisos={len(p.issues)}', file=rep)
    for i in p.issues:
        print(i, file=rep)
    print(json.dumps(p.stats), f'nodos={len(t.parent)}', f'avisos={len(p.issues)}')
    if ANALYZE is not None:
        json.dump(ANALYZE, open('/tmp/claude-0/analyze.json', 'w'), indent=0)


if __name__ == '__main__':
    main()
