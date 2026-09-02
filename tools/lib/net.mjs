// Descarga con reintentos, timeout y limitador de concurrencia.
// Sin dependencias: usa el fetch nativo de Node >= 20.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ngc-audit/1.0';

export function createLimiter(max) {
  let activos = 0;
  const cola = [];
  const siguiente = () => {
    if (activos >= max || cola.length === 0) return;
    activos++;
    const { fn, resolve, reject } = cola.shift();
    fn().then(resolve, reject).finally(() => {
      activos--;
      siguiente();
    });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      cola.push({ fn, resolve, reject });
      siguiente();
    });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET con reintentos exponenciales. Devuelve { status, headers, buffer }.
 * Lanza si se agotan los reintentos o si el status no es 2xx.
 */
export async function get(url, { intentos = 4, timeoutMs = 30000 } = {}) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    if (i > 0) await dormir(1000 * 2 ** (i - 1));
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: '*/*' },
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!res.ok) {
        // 404/410 no se reintentan: son respuestas definitivas.
        if (res.status === 404 || res.status === 410) {
          const e = new Error(`HTTP ${res.status} en ${url}`);
          e.status = res.status;
          e.definitivo = true;
          throw e;
        }
        throw new Error(`HTTP ${res.status} en ${url}`);
      }
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers),
        buffer,
      };
    } catch (err) {
      if (err.definitivo) throw err;
      ultimoError = err;
    } finally {
      clearTimeout(t);
    }
  }
  throw ultimoError;
}
