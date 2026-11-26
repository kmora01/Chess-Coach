"""Convierte planes.md (explicaciones en español de Winning Chess Middlegames) en planes.json.

Formato de planes.md: secciones que empiezan con una línea
  @@ libro                         → idea general del libro
  @@ capitulo <n>                  → planes del capítulo (tipo de estructura)
  @@ estructura <n.m> | <título>   → título en español y planes de esa estructura
  @@ partida <n>                   → explicación de la partida modelo
El texto es markdown sencillo (### títulos, - listas, **negrita**, *cursiva*). Las jugadas numeradas
se enlazan al tablero: en libro/capítulo/estructura sólo secuencias completas desde 1.; en una partida,
jugadas de su línea principal (lo comprueba tests/verify_sokolov.mjs). El resto se escribe sin número.
Uso: python3 -I planes.py planes.md planes.json
"""
import sys, json, re


def main():
    out = {'book': None, 'chapters': {}, 'structures': {}, 'games': {}}
    cur = None
    buf = []

    def flush():
        if not cur:
            return
        text = '\n'.join(buf).strip()
        kind, key, title = cur
        if kind == 'libro':
            out['book'] = text
        elif kind == 'capitulo':
            out['chapters'][key] = text
        elif kind == 'estructura':
            out['structures'][key] = {'title': title, 'text': text}
        else:
            out['games'][key] = text
    for line in open(sys.argv[1], encoding='utf8').read().split('\n'):
        m = re.match(r'^@@\s+(libro|capitulo|estructura|partida)\s*(\S*)\s*(?:\|\s*(.*?))?\s*$', line)
        if m:
            flush()
            cur = (m.group(1), m.group(2), m.group(3)); buf = []
        elif cur:
            buf.append(line)
    flush()
    json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
    print(f"planes: capítulos={len(out['chapters'])} estructuras={len(out['structures'])} partidas={len(out['games'])}")


if __name__ == '__main__':
    main()
