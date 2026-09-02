#!/usr/bin/env node
// Embebe Poppins en base64 dentro del HTML del banner y lo renderiza a PNG.
//
//   node build-banner.mjs                    -> banner-1.png (1920x800) + @2x
//   node build-banner.mjs --html banner-1.html --salida ngc-banner-1
//
// El HTML resultante queda autocontenido: sin Google Fonts, sin red.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const args = { html: 'banner-1.html', salida: null, ancho: 1920, alto: 800, escalas: [1, 2] };
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (t === '--html') args.html = process.argv[++i];
  else if (t === '--salida') args.salida = process.argv[++i];
  else if (t === '--ancho') args.ancho = parseInt(process.argv[++i], 10);
  else if (t === '--alto') args.alto = parseInt(process.argv[++i], 10);
  else if (t === '--solo-1x') args.escalas = [1];
}
const htmlPath = path.resolve(AQUI, args.html);
const base = args.salida || path.basename(htmlPath, '.html');

// --- fuentes ---------------------------------------------------------------
function dirPoppins() {
  const candidatos = [
    path.join(AQUI, '..', 'tools', 'node_modules', '@fontsource', 'poppins', 'files'),
    path.join(AQUI, '..', 'node_modules', '@fontsource', 'poppins', 'files'),
  ];
  for (const c of candidatos) if (fs.existsSync(c)) return c;
  try {
    return path.join(path.dirname(require.resolve('@fontsource/poppins/package.json')), 'files');
  } catch {
    return null;
  }
}

const PESOS = [400, 500, 600, 700, 800];
const dir = dirPoppins();
if (!dir) {
  console.error('Falta Poppins. Instalalo con:\n  npm i -D @fontsource/poppins   (dentro de tools/)');
  process.exit(1);
}
const caras = PESOS.map((p) => {
  const f = path.join(dir, `poppins-latin-${p}-normal.woff2`);
  if (!fs.existsSync(f)) throw new Error('falta ' + f);
  return `@font-face{font-family:'Poppins';font-style:normal;font-weight:${p};font-display:block;
  src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format('woff2')}`;
}).join('\n  ');

const htmlFuente = fs.readFileSync(htmlPath, 'utf8');
if (!htmlFuente.includes('/* __FUENTES__ */')) {
  console.error('El HTML no tiene el marcador /* __FUENTES__ */');
  process.exit(1);
}
const htmlFinal = htmlFuente.replace('/* __FUENTES__ */', caras);
const htmlSalida = path.join(AQUI, `${base}.embebido.html`);
fs.writeFileSync(htmlSalida, htmlFinal);

// --- render ----------------------------------------------------------------
// playwright puede estar instalado en tools/node_modules y no al lado de este script
async function cargarPlaywright() {
  const intentos = ['playwright'];
  for (const d of [path.join(AQUI, '..', 'tools', 'node_modules', 'playwright'), path.join(AQUI, '..', 'node_modules', 'playwright')]) {
    if (!fs.existsSync(d)) continue;
    for (const f of ['index.mjs', 'index.js']) {
      if (fs.existsSync(path.join(d, f))) intentos.push(pathToFileURL(path.join(d, f)).href);
    }
  }
  for (const via of intentos) {
    try {
      const m = await import(via);
      // un paquete CJS llega envuelto en .default
      if (m.chromium) return m;
      if (m.default && m.default.chromium) return m.default;
    } catch {}
  }
  return null;
}

let chromium;
const pw = await cargarPlaywright();
if (pw) {
  ({ chromium } = pw);
} else {
  console.log(`HTML autocontenido: ${htmlSalida} (${(htmlFinal.length / 1024).toFixed(0)} KB)`);
  console.log('Para renderizar el PNG instala playwright:  npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

const navegador = await chromium.launch();
const generados = [];
for (const escala of args.escalas) {
  const ctx = await navegador.newContext({
    viewport: { width: args.ancho, height: args.alto },
    deviceScaleFactor: escala,
  });
  const page = await ctx.newPage();
  await page.goto('file://' + htmlSalida, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  // control: si Poppins no cargo, el PNG sale con otra tipografia y no se nota
  const fuenteOk = await page.evaluate(() => document.fonts.check('700 82px Poppins'));
  if (!fuenteOk) {
    console.error('AVISO: Poppins no cargo, el render usaria la fuente de respaldo. Aborto.');
    await navegador.close();
    process.exit(1);
  }

  const clip = { x: 0, y: 0, width: args.ancho, height: args.alto };
  const sufijo = escala === 1 ? '' : `@${escala}x`;
  const destinoPng = path.join(AQUI, `${base}${sufijo}.png`);
  await page.screenshot({ path: destinoPng, clip });
  generados.push(destinoPng);
  // el panel de Tiendanube pesa menos con JPG y el banner no tiene transparencia
  const destinoJpg = path.join(AQUI, `${base}${sufijo}.jpg`);
  await page.screenshot({ path: destinoJpg, clip, type: 'jpeg', quality: 92 });
  generados.push(destinoJpg);
  await ctx.close();
}
await navegador.close();

for (const g of generados) {
  console.log(`  ${g}  ${(fs.statSync(g).size / 1024).toFixed(0)} KB`);
}
console.log(`  ${htmlSalida}  ${(htmlFinal.length / 1024).toFixed(0)} KB`);
