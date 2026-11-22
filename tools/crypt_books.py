"""Cifra (o descifra) los datos de los libros para que sólo se lean con usuario y contraseña.

Formato de cada archivo .enc: b'CCE1' + IV (12 bytes) + AES-256-GCM(gzip(datos)).
La clave se deriva con PBKDF2-SHA256 de "usuario:contraseña" (usuario en minúsculas) con la sal
y las iteraciones de books/auth.json. auth.json incluye un bloque 'check' para validar el login.

  Crear/cambiar credenciales (vuelve a cifrar todo desde las fuentes en claro):
    python3 tools/crypt_books.py init  <usuario> <contraseña>
  Cifrar un archivo:
    python3 tools/crypt_books.py enc <usuario> <contraseña> fuente.ext books/<id>/fuente.ext.enc
  Descifrar un archivo:
    python3 tools/crypt_books.py dec <usuario> <contraseña> books/<id>/x.enc salida
"""
import sys, os, json, gzip, base64, hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH = os.path.join(ROOT, 'books', 'auth.json')
ITER = 310000
MAGIC = b'CCE1'


def derive(user, pw, salt, it):
    return hashlib.pbkdf2_hmac('sha256', f'{user.strip().lower()}:{pw}'.encode(), salt, it, 32)


def enc_bytes(key, data):
    iv = os.urandom(12)
    return MAGIC + iv + AESGCM(key).encrypt(iv, gzip.compress(data, 9, mtime=0), None)


def dec_bytes(key, blob):
    assert blob[:4] == MAGIC, 'formato desconocido'
    return gzip.decompress(AESGCM(key).decrypt(blob[4:16], blob[16:], None))


def load_key(user, pw):
    a = json.load(open(AUTH))
    key = derive(user, pw, base64.b64decode(a['salt']), a['iter'])
    dec_bytes(key, base64.b64decode(a['check']))  # lanza excepción si no es correcta
    return key


def main():
    cmd = sys.argv[1]
    if cmd == 'init':
        user, pw = sys.argv[2], sys.argv[3]
        salt = os.urandom(16)
        key = derive(user, pw, salt, ITER)
        json.dump({'v': 1, 'kdf': 'PBKDF2-SHA256', 'iter': ITER, 'salt': base64.b64encode(salt).decode(),
                   'check': base64.b64encode(enc_bytes(key, b'chess-coach-ok')).decode()}, open(AUTH, 'w'), indent=1)
        print('auth.json creado; vuelve a cifrar los libros con "enc"')
    elif cmd == 'enc':
        key = load_key(sys.argv[2], sys.argv[3])
        open(sys.argv[5], 'wb').write(enc_bytes(key, open(sys.argv[4], 'rb').read()))
    elif cmd == 'dec':
        key = load_key(sys.argv[2], sys.argv[3])
        open(sys.argv[5], 'wb').write(dec_bytes(key, open(sys.argv[4], 'rb').read()))
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
