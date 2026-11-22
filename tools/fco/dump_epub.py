"""Convierte los capítulos del EPUB de FCO en bloques ordenados (JSON).
Uso: python3 -I dump_epub.py <dir_epub_descomprimido> <salida.json>"""
import sys, json, re, warnings
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning, NavigableString, Tag
warnings.filterwarnings('ignore', category=XMLParsedAsHTMLWarning)

def norm(s):
    return re.sub(r'[ \t\r\n ]+', ' ', s).strip()

def inline(el):
    """Devuelve lista de segmentos (texto, bold, italic, link)."""
    segs = []
    def walk(node, b=False, i=False, link=None):
        for c in node.children:
            if isinstance(c, NavigableString):
                t = str(c)
                if t: segs.append({'t': t, 'b': b, 'i': i, 'a': link})
            elif isinstance(c, Tag):
                if c.name == 'img':
                    segs.append({'img': c.get('src', '').split('/')[-1]})
                    continue
                walk(c, b or c.name in ('b', 'strong'), i or c.name in ('i', 'em'),
                     c.get('href') if c.name == 'a' and c.get('href') else link)
    walk(el)
    return segs

def main(root, out):
    opf = open(f'{root}/OEBPS/content.opf', encoding='utf8').read()
    ids = re.findall(r'<itemref idref="([^"]+)"', opf)
    hrefs = dict(re.findall(r'<item[^>]*?id="([^"]+)"[^>]*?href="([^"]+)"', opf))
    hrefs.update({m[1]: m[0] for m in re.findall(r'<item[^>]*?href="([^"]+)"[^>]*?id="([^"]+)"', opf)})
    files = []
    for i in ids:
        h = hrefs.get(i)
        if not h or not h.endswith('html'): continue
        s = BeautifulSoup(open(f'{root}/OEBPS/{h}', encoding='utf8'), 'lxml')
        blocks = []
        for el in s.body.find_all(['h1', 'h2', 'h3', 'p']):
            segs = inline(el)
            text = norm(''.join(x.get('t', '') for x in segs))
            img = [x['img'] for x in segs if 'img' in x]
            anchors = [a.get('id') for a in el.find_all('a') if a.get('id')]
            if not text and not img: continue
            blocks.append({'tag': el.name, 'cls': ' '.join(el.get('class', [])), 'text': text, 'img': img,
                           'segs': [x for x in segs if 'img' not in x], 'anchors': anchors})
        files.append({'file': h.split('/')[-1], 'blocks': blocks})
    json.dump(files, open(out, 'w'), ensure_ascii=False, indent=0)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
