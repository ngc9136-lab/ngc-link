// Cache en disco. Hace que el auditor sea idempotente y barato de repetir:
// una segunda corrida no vuelve a bajar nada salvo que se pase --refresh.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const clave = (url) => createHash('sha1').update(url).digest('hex');

export class Cache {
  constructor(dir) {
    this.dir = dir;
    this.paginasDir = path.join(dir, 'paginas');
    this.blobsDir = path.join(dir, 'blobs');
    this.indicePath = path.join(dir, 'indice.json');
    fs.mkdirSync(this.paginasDir, { recursive: true });
    fs.mkdirSync(this.blobsDir, { recursive: true });
    this.indice = fs.existsSync(this.indicePath)
      ? JSON.parse(fs.readFileSync(this.indicePath, 'utf8'))
      : { paginas: {}, blobs: {} };
  }

  guardar() {
    const tmp = this.indicePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.indice, null, 2));
    fs.renameSync(tmp, this.indicePath);
  }

  // --- paginas HTML/XML -----------------------------------------------
  leerPagina(url) {
    const e = this.indice.paginas[url];
    if (!e) return null;
    const p = path.join(this.paginasDir, e.archivo);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
  }

  escribirPagina(url, texto) {
    const archivo = clave(url) + '.txt';
    fs.writeFileSync(path.join(this.paginasDir, archivo), texto);
    this.indice.paginas[url] = { archivo, bajadoEn: new Date().toISOString() };
  }

  // --- imagenes --------------------------------------------------------
  leerBlobMeta(url) {
    const e = this.indice.blobs[url];
    if (!e) return null;
    if (!fs.existsSync(path.join(this.dir, e.rutaRelativa))) return null;
    return e;
  }

  escribirBlob(url, buffer, contentType) {
    const hash = sha256(buffer);
    const ext = extensionDe(contentType, url);
    const nombre = `${hash}${ext}`;
    const destino = path.join(this.blobsDir, nombre);
    if (!fs.existsSync(destino)) fs.writeFileSync(destino, buffer);
    const meta = {
      sha256: hash,
      bytes: buffer.length,
      contentType: contentType || '',
      rutaRelativa: path.posix.join('blobs', nombre),
      bajadoEn: new Date().toISOString(),
    };
    this.indice.blobs[url] = meta;
    return meta;
  }

  rutaBlob(meta) {
    return path.join(this.dir, meta.rutaRelativa);
  }

  bytesDeBlob(meta) {
    return fs.readFileSync(this.rutaBlob(meta));
  }
}

function extensionDe(contentType, url) {
  const porTipo = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
  };
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (porTipo[ct]) return porTipo[ct];
  const m = url.split('?')[0].match(/\.(jpe?g|png|webp|gif|avif)$/i);
  return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.bin';
}
