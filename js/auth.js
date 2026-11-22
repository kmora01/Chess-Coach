// Acceso privado: los libros están cifrados (AES-256-GCM) y sólo se leen con usuario y contraseña.
// La clave se deriva en el navegador (PBKDF2-SHA256) y nunca sale de él. Ver tools/crypt_books.py.

const MAGIC = 'CCE1';
const KEY_STORE = 'cc:key';
let keyPromise = null;
let authInfo = null;

const b64 = {
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
};

async function loadAuth() {
  if (!authInfo) authInfo = await (await fetch('books/auth.json', { cache: 'no-cache' })).json();
  return authInfo;
}

async function deriveKey(user, password) {
  const a = await loadAuth();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${user.trim().toLowerCase()}:${password}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64.dec(a.salt), iterations: a.iter }, base, 256);
  return bits;
}

async function importRaw(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}

async function decryptWith(key, buf) {
  const bytes = new Uint8Array(buf);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== MAGIC) throw new Error('Formato de archivo desconocido');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(4, 16) }, key, bytes.slice(16));
  // los datos van comprimidos con gzip antes de cifrar
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function savedRaw() {
  try { return sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE); } catch { return null; }
}

export function isLoggedIn() { return !!savedRaw(); }

export async function login(user, password, remember) {
  const a = await loadAuth();
  const raw = await deriveKey(user, password);
  const key = await importRaw(raw);
  const ok = await decryptWith(key, b64.dec(a.check)).then((t) => t === 'chess-coach-ok').catch(() => false);
  if (!ok) return false;
  try {
    sessionStorage.setItem(KEY_STORE, b64.enc(raw));
    if (remember) localStorage.setItem(KEY_STORE, b64.enc(raw)); else localStorage.removeItem(KEY_STORE);
  } catch { /* sin almacenamiento: la clave vive sólo en memoria */ }
  keyPromise = Promise.resolve(key);
  return true;
}

export function logout() {
  try { sessionStorage.removeItem(KEY_STORE); localStorage.removeItem(KEY_STORE); } catch { /* */ }
  keyPromise = null;
}

async function getKey() {
  if (keyPromise) return keyPromise;
  const raw = savedRaw();
  if (!raw) throw new AuthError();
  keyPromise = importRaw(b64.dec(raw));
  return keyPromise;
}

export class AuthError extends Error { constructor() { super('Hace falta iniciar sesión'); this.auth = true; } }

// Descarga y descifra un archivo .enc del sitio. Si la clave guardada ya no vale (p. ej. tras cambiar
// la contraseña), cierra la sesión y pide entrar de nuevo.
export async function fetchSecret(url) {
  const key = await getKey();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  try {
    return await decryptWith(key, buf);
  } catch (e) {
    if (e instanceof DOMException || e.name === 'OperationError') { logout(); throw new AuthError(); }
    throw e;
  }
}
