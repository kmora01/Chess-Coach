"""Convierte planes.md (planes típicos en español, escritos para la web) en planes.json.

Formato de planes.md: secciones que empiezan con una línea
  @@ parte white|black     → resumen del repertorio de ese color
  @@ capitulo <n>          → planes típicos de todo el capítulo
  @@ partida <n.m>         → plan de la línea de esa partida modelo
El texto de cada sección es markdown sencillo (### títulos, - listas, **negrita**, *cursiva*);
las jugadas numeradas ("1.e4 c5 2.Nf3") se enlazan al tablero en la web.
Uso: python3 -I planes.py planes.md planes.json
"""
import sys, json, re

KEYS = {'parte': 'parts', 'capitulo': 'chapters', 'partida': 'games'}


def main():
    out = {'parts': {}, 'chapters': {}, 'games': {}}
    cur = None
    buf = []
    def flush():
        if cur:
            out[cur[0]][cur[1]] = '\n'.join(buf).strip()
    for line in open(sys.argv[1], encoding='utf8').read().split('\n'):
        m = re.match(r'^@@\s+(parte|capitulo|partida)\s+(\S+)\s*$', line)
        if m:
            flush()
            cur = (KEYS[m.group(1)], m.group(2)); buf = []
        elif cur:
            buf.append(line)
    flush()
    json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
    print(f"planes: partes={len(out['parts'])} capítulos={len(out['chapters'])} partidas={len(out['games'])}")


if __name__ == '__main__':
    main()
