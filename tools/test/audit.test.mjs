// Prueba del auditor contra una tienda de mentira con duplicados plantados.
// Comprueba: cuentas exactas, agrupacion por producto (no global) e idempotencia.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { arrancar, ESPERADO } from '../fixtures/tienda-falsa.mjs';

const ejecutar = promisify(execFile);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const AUDITOR = path.join(AQUI, '..', 'audit-storefront.mjs');

let fallos = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log('  ok   ' + nombre);
  } catch (err) {
    fallos++;
    console.log('  FALLA ' + nombre + '\n        ' + (err.message || err).split('\n').join('\n        '));
  }
}

const { server, base } = await arrancar();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ngc-audit-'));
const out = path.join(tmp, 'salida');
const cache = path.join(tmp, 'cache');

const correr = async () => {
  const { stdout } = await ejecutar('node', [AUDITOR, '--store', base, '--out', out, '--cache', cache], {
    maxBuffer: 1024 * 1024 * 32,
  });
  return { stdout, informe: JSON.parse(fs.readFileSync(path.join(out, 'informe.json'), 'utf8')) };
};

console.log('tienda falsa:', base);
const primera = await correr();
const segunda = await correr();
const r = primera.informe.resumen;

await prueba('encuentra las fichas de producto y descarta las paginas que no lo son', () => {
  assert.equal(r.productos, ESPERADO.productos);
});

await prueba('cuenta todas las entradas de galeria (incluida la repeticion por variante)', () => {
  assert.equal(r.entradasGaleria, ESPERADO.entradasGaleria);
});

await prueba('cuenta los archivos duplicados por SHA-256 dentro de cada producto', () => {
  assert.equal(r.archivosDuplicados, ESPERADO.archivosDuplicados);
});

await prueba('cuenta los productos afectados', () => {
  assert.equal(r.productosConDuplicados, ESPERADO.productosConDuplicados);
});

await prueba('el mismo archivo en dos productos distintos NO cuenta como duplicado', () => {
  assert.equal(r.archivosUnicosEnLaTienda, ESPERADO.archivosUnicosEnLaTienda);
  const c = primera.informe.productos.find((p) => p.slug === 'llavero-hercules');
  const e = primera.informe.productos.find((p) => p.slug === 'campera-bomber');
  const hashCompartido = c.entradas[0].sha256;
  assert.equal(e.entradas[0].sha256, hashCompartido, 'los dos productos comparten el archivo');
  assert.equal(c.archivosDuplicados, 0, 'pero ninguno lo reporta como duplicado');
  assert.equal(e.archivosDuplicados, 0);
});

await prueba('toma el candidato mas grande del data-srcset, no el placeholder del src', () => {
  const p = primera.informe.productos[0];
  assert.ok(p.entradas.every((e) => e.origenAtributo === 'data-srcset'), 'origen data-srcset');
  assert.ok(p.entradas.every((e) => !e.url.includes('-240-240')), 'ninguna es la chica');
  assert.ok(p.entradas.every((e) => e.ancho > 0 && e.alto > 0), 'todas midieron');
});

await prueba('registra ancho, alto, relacion de aspecto, peso y nombre por archivo', () => {
  const e = primera.informe.productos[0].entradas[0];
  for (const campo of ['ancho', 'alto', 'relacion', 'bytes', 'archivo', 'cuadrada', 'formato']) {
    assert.ok(e[campo] !== null && e[campo] !== undefined, 'falta ' + campo);
  }
});

await prueba('estadistica de resolucion coherente', () => {
  assert.equal(r.resolucion.medidas, ESPERADO.entradasGaleria);
  assert.equal(r.resolucion.maximo, 1024);
  assert.ok(r.resolucion.menorA400 <= r.resolucion.menorA600);
  assert.ok(r.resolucion.menorA600 <= r.resolucion.menorA800);
});

await prueba('registra la pagina rota como error y no la confunde con producto', () => {
  const rotos = primera.informe.errores.filter((e) => e.url.endsWith('/pagina-rota'));
  assert.equal(rotos.length, 1);
  assert.equal(rotos[0].tipo, 'pagina-no-descargada');
});

await prueba('idempotente: dos corridas seguidas dan la misma huella', () => {
  assert.equal(primera.informe.meta.huella, segunda.informe.meta.huella);
});

await prueba('la segunda corrida usa el cache y no vuelve a bajar nada', () => {
  assert.match(segunda.stdout, /imagenes: 0 bajadas/);
});

await prueba('emite informe.json y la hoja de contacto HTML con miniaturas reales', () => {
  const html = fs.readFileSync(path.join(out, 'informe.html'), 'utf8');
  assert.ok(fs.existsSync(path.join(out, 'informe.json')));
  assert.match(html, /class="queda"/);
  assert.match(html, /class="sobra"/);
  const imgs = html.match(/<img loading="lazy"/g) || [];
  assert.ok(imgs.length >= ESPERADO.archivosDuplicados, `${imgs.length} miniaturas en la hoja de contacto`);
});

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} PRUEBAS FALLADAS`);
process.exit(fallos === 0 ? 0 : 1);
