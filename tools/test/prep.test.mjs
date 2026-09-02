// Prueba del pipeline de fotos con originales fabricados a proposito:
// duplicados byte a byte, una foto chica, aire de sobra alrededor del producto.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const ejecutar = promisify(execFile);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PREP = path.join(AQUI, '..', 'prep-photos.mjs');

let fallos = 0;
const prueba = async (n, fn) => {
  try { await fn(); console.log('  ok   ' + n); }
  catch (e) { fallos++; console.log('  FALLA ' + n + '\n        ' + e.message); }
};

// producto centrado sobre lienzo blanco con mucho aire alrededor
async function foto(ancho, alto, color, ladoProducto) {
  const p = Math.min(ladoProducto, ancho, alto);
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: p, height: p, channels: 3, background: color } }).png().toBuffer(), gravity: 'centre' }])
    .png()
    .toBuffer();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ngc-prep-'));
const entrada = path.join(tmp, 'originales');
const salida = path.join(tmp, 'listas');
fs.mkdirSync(path.join(entrada, 'Parche Jerarquia FAA Cabo Primero'), { recursive: true });
fs.mkdirSync(path.join(entrada, 'gorra faa'), { recursive: true });

const grande = await foto(2400, 2400, '#0B1327', 900);
fs.writeFileSync(path.join(entrada, 'Parche Jerarquia FAA Cabo Primero', 'IMG_2841.jpg'), grande);
// misma foto, otro nombre: duplicado byte a byte
fs.writeFileSync(path.join(entrada, 'Parche Jerarquia FAA Cabo Primero', 'sin-titulo-1500-x-1500-px.jpg'), grande);
fs.writeFileSync(path.join(entrada, 'Parche Jerarquia FAA Cabo Primero', 'vista trasera con abrojo.jpg'), await foto(1800, 2400, '#D8B868', 1200));
// no llega a 1600: tiene que ir a volver-a-fotografiar, sin agrandarse
fs.writeFileSync(path.join(entrada, 'Parche Jerarquia FAA Cabo Primero', 'chica.jpg'), await foto(900, 900, '#a5ec10', 600));
fs.writeFileSync(path.join(entrada, 'gorra faa', 'DSC_0001.jpg'), await foto(2000, 1600, '#133C5C', 1400));
fs.writeFileSync(path.join(entrada, 'gorra faa', 'leeme.txt'), 'no es una imagen');

const correr = () => ejecutar('node', [PREP, '--entrada', entrada, '--salida', salida], { maxBuffer: 1 << 24 });
const primera = await correr();
const segunda = await correr();
console.log(primera.stdout);

const informe = JSON.parse(fs.readFileSync(path.join(salida, 'informe-preparacion.json'), 'utf8'));
const informe2 = JSON.parse(fs.readFileSync(path.join(salida, 'informe-preparacion.json'), 'utf8'));

await prueba('deduplica por SHA-256 antes de procesar', () => {
  assert.equal(informe.resumen.duplicadasDescartadas, 1);
  assert.equal(informe.duplicadas[0].seQueda, 'IMG_2841.jpg');
  assert.equal(informe.duplicadas[0].descartada, 'sin-titulo-1500-x-1500-px.jpg');
});

await prueba('no agranda: la foto chica va a volver-a-fotografiar y no se exporta', () => {
  assert.equal(informe.resumen.noExportadasPorChicas, 1);
  assert.equal(informe.chicas[0].archivo, 'chica.jpg');
  assert.equal(informe.chicas[0].ladoMayor, 900);
  assert.equal(informe.chicas[0].faltan, 700);
  const csv = fs.readFileSync(path.join(salida, 'volver-a-fotografiar.csv'), 'utf8');
  assert.match(csv, /chica\.jpg/);
  assert.ok(!informe.exportados.some((e) => e.archivoOrigen === 'chica.jpg'));
});

await prueba('exporta 3 fotos, una carpeta por producto', () => {
  assert.equal(informe.resumen.exportadas, 3);
  assert.ok(fs.existsSync(path.join(salida, 'parche-jerarquia-faa-cabo-primero')));
  assert.ok(fs.existsSync(path.join(salida, 'gorra-faa')));
});

await (async () => {
  const nombres = informe.exportados.map((e) => path.basename(e.destino)).sort();
  await prueba('nombres en kebab-case descriptivo', () => {
    assert.deepEqual(nombres, [
      'gorra-faa-01.jpg',
      'parche-jerarquia-faa-cabo-primero-01.jpg',
      'parche-jerarquia-faa-cabo-primero-vista-trasera-con-abrojo-02.jpg',
    ]);
    assert.ok(nombres.every((n) => /^[a-z0-9-]+\.jpg$/.test(n)), 'solo minusculas, numeros y guiones');
  });

  const metas = [];
  for (const e of informe.exportados) metas.push({ e, m: await sharp(e.destino).metadata() });

  await prueba('todas salen 1600x1600', () => {
    for (const { m } of metas) {
      assert.equal(m.width, 1600);
      assert.equal(m.height, 1600);
    }
  });

  await prueba('fondo blanco y producto centrado', async () => {
    for (const e of informe.exportados) {
      const recorte = await sharp(e.destino).extract({ left: 0, top: 0, width: 40, height: 40 }).png().toBuffer();
      const esquina = await sharp(recorte).stats();
      for (const c of esquina.channels) assert.ok(c.mean > 250, 'la esquina tiene que ser blanca, dio ' + c.mean.toFixed(1));
      const centroBuf = await sharp(e.destino).extract({ left: 790, top: 790, width: 20, height: 20 }).png().toBuffer();
      const centro = await sharp(centroBuf).stats();
      assert.ok(centro.channels.some((c) => c.mean < 240), 'el centro tiene que tener producto, no blanco');
    }
  });

  await prueba('margen uniforme de 8%: el contenido nunca pasa de 1344px', () => {
    for (const { e } of metas) {
      assert.ok(Math.max(e.anchoContenido, e.altoContenido) <= 1344, `${e.anchoContenido}x${e.altoContenido}`);
    }
    assert.ok(informe.resumen.margenRealMinimo >= 8, 'margen real ' + informe.resumen.margenRealMinimo + '%');
  });

  await prueba('avisa cuando el producto recortado no llena la caja, en vez de agrandarlo', () => {
    const aviso = informe.productoChico.find((x) => x.archivo === 'IMG_2841.jpg');
    assert.ok(aviso, 'IMG_2841.jpg tiene el producto en 900px, tiene que estar avisado');
    assert.equal(aviso.exportada, 'si');
    assert.match(aviso.motivo, /900px y la caja pide 1344px/);
    const csv = fs.readFileSync(path.join(salida, 'volver-a-fotografiar.csv'), 'utf8');
    assert.match(csv, /IMG_2841\.jpg/);
  });

  await prueba('recorta el aire y el producto queda grande dentro del cuadro', () => {
    // el original traia el producto ocupando ~37% del lienzo; despues del
    // recorte tiene que llenar la caja de contenido
    const e = informe.exportados.find((x) => x.archivoOrigen === 'IMG_2841.jpg');
    assert.ok(Math.max(e.anchoContenido, e.altoContenido) >= 890, 'contenido ' + e.anchoContenido + 'x' + e.altoContenido);
  });

  await prueba('ignora lo que no es imagen sin romperse', () => {
    assert.equal(informe.resumen.errores, 0);
    assert.ok(!informe.exportados.some((x) => x.archivoOrigen === 'leeme.txt'));
  });

  await prueba('idempotente: la segunda corrida no rehace nada', () => {
    assert.match(segunda.stdout, /exportadas \.+ 3 \(3 ya estaban\)/);
    assert.equal(informe2.resumen.exportadas, 3);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} PRUEBAS FALLADAS`);
  process.exit(fallos === 0 ? 0 : 1);
})();
