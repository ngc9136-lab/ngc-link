#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Verificador del front NGC. Corre despues de cada cambio en assortedJs.
//
//   node verify-front.mjs
//   node verify-front.mjs --producto https://ngctienda.mitiendanube.com/parche-...
//
// Sale con codigo 1 si algo falla.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Falta playwright. Instalalo con:\n  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

function parsearArgs(argv) {
  const a = {
    store: 'https://ngctienda.mitiendanube.com',
    producto: null,
    listado: null,
    altoMaximo: 12000,
    contrasteMinimo: 4.5,
    bannersEsperados: 4,
    escritorio: { width: 1366, height: 900 },
    celular: { width: 390, height: 844 },
    headed: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--store') a.store = argv[++i].replace(/\/+$/, '');
    else if (t === '--producto') a.producto = argv[++i];
    else if (t === '--listado') a.listado = argv[++i];
    else if (t === '--alto-maximo') a.altoMaximo = parseInt(argv[++i], 10);
    else if (t === '--contraste-minimo') a.contrasteMinimo = parseFloat(argv[++i]);
    else if (t === '--banners') a.bannersEsperados = parseInt(argv[++i], 10);
    else if (t === '--headed') a.headed = true;
    else if (t === '--help' || t === '-h') {
      console.log(`node verify-front.mjs [--store URL] [--producto URL] [--listado URL]
                          [--alto-maximo 12000] [--contraste-minimo 4.5] [--banners 4] [--headed]`);
      process.exit(0);
    }
  }
  if (!a.producto) a.producto = peorProductoDelInforme(a.store);
  if (!a.listado) a.listado = a.store + '/';
  return a;
}

// Si ya corriste el auditor, usa la ficha mas pesada como caso de prueba.
function peorProductoDelInforme(store) {
  try {
    const p = path.join(AQUI, 'salida', 'informe.json');
    const informe = JSON.parse(fs.readFileSync(p, 'utf8'));
    const peor = [...informe.productos].sort((a, b) => b.entradasGaleria - a.entradasGaleria)[0];
    if (peor) return peor.url;
  } catch {}
  return store + '/parche-bordado-jerarquia-fuerza-aerea-argentina-c-abrojo';
}

// --- funciones que corren dentro del navegador -----------------------------
// Se pasan como funciones reales (no como strings): Playwright serializa el
// codigo fuente y ademas permite pasarles argumentos.

// Devuelve el color de fondo efectivo subiendo por los ancestros hasta
// encontrar uno opaco. Sin esto, un boton con fondo transparente da un
// contraste falso.
const CODIGO_CONTRASTE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { existe: false };
  const aRgb = (s) => {
    const m = (s || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = [c.r, c.g, c.b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const mezclar = (frente, fondo) => ({
    r: frente.r * frente.a + fondo.r * (1 - frente.a),
    g: frente.g * frente.a + fondo.g * (1 - frente.a),
    b: frente.b * frente.a + fondo.b * (1 - frente.a),
    a: 1,
  });
  let fondo = { r: 255, g: 255, b: 255, a: 1 };
  for (let n = el; n; n = n.parentElement) {
    const c = aRgb(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0) {
      fondo = c.a === 1 ? c : mezclar(c, fondo);
      if (c.a === 1) break;
    }
  }
  let texto = aRgb(getComputedStyle(el).color) || { r: 0, g: 0, b: 0, a: 1 };
  if (texto.a < 1) texto = mezclar(texto, fondo);
  const l1 = lum(texto);
  const l2 = lum(fondo);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return { existe: true, ratio: Math.round(ratio * 100) / 100, texto: hex(texto), fondo: hex(fondo) };
};

// Un nombre esta cortado si su contenido no entra en su caja.
// El nombre real es .js-item-name / .item-name, NO .item-link.
const CODIGO_CORTADOS = () => {
  const nodos = [...document.querySelectorAll('.js-item-name, .item-name')];
  const cortados = nodos
    .map((el) => {
      const cs = getComputedStyle(el);
      const desbordaAlto = el.scrollHeight > el.clientHeight + 1;
      const desbordaAncho = el.scrollWidth > el.clientWidth + 1;
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      return {
        texto: (el.textContent || '').trim().slice(0, 70),
        cortado: desbordaAlto || desbordaAncho,
        lineClamp: clamp ? cs.webkitLineClamp : null,
        textOverflow: cs.textOverflow === 'ellipsis' ? 'ellipsis' : null,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    })
    .filter((x) => x.cortado);
  return { total: nodos.length, cortados };
};

// Regla 3 del brief: .item-link es un contenedor con hijos, no el nombre.
// Si alguien le puso line-clamp o lo saco de display:inline, rompio las tarjetas.
const CODIGO_ITEM_LINK = () => {
  const nodos = [...document.querySelectorAll('.item-link')];
  if (!nodos.length) return { total: 0, display: null, maxHijos: 0, conLineClamp: 0 };
  const display = getComputedStyle(nodos[0]).display;
  const clamp = nodos.filter((n) => {
    const c = getComputedStyle(n).webkitLineClamp;
    return c && c !== 'none';
  }).length;
  return {
    total: nodos.length,
    display,
    conHijos: nodos.filter((n) => n.children.length > 0).length,
    maxHijos: Math.max(...nodos.map((n) => n.children.length)),
    conLineClamp: clamp,
  };
};

const CODIGO_BANNERS = () => {
  const cont = [...document.querySelectorAll('[class*="home-slider"]')];
  const imgs = cont.flatMap((c) => [...c.querySelectorAll('img')]);
  const vistos = new Set();
  const unicos = imgs.filter((i) => {
    const k = i.currentSrc || i.src;
    if (!k || k.startsWith('data:') || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return {
    contenedores: cont.map((c) => ({ clase: c.className, w: c.clientWidth, h: c.clientHeight, imgs: c.querySelectorAll('img').length })),
    total: imgs.length,
    conFuente: unicos.length,
    cargadas: unicos.filter((i) => i.naturalWidth > 0).length,
    detalle: unicos.map((i) => ({ src: (i.currentSrc || i.src).split('/').pop().slice(0, 60), nw: i.naturalWidth, nh: i.naturalHeight })),
  };
};

// --- corrida ---------------------------------------------------------------
const resultados = [];
const registrar = (nombre, ok, medido, detalle) => resultados.push({ nombre, ok, medido, detalle });

async function despertarLazy(page, vueltas = 12) {
  // El lazy loading del tema no dispara solo: hay que recorrer la pagina.
  await page.evaluate(async (n) => {
    for (let i = 0; i <= n; i++) {
      window.scrollTo(0, (document.body.scrollHeight * i) / n);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  }, vueltas);
  await page.waitForTimeout(700);
}

async function main() {
  const a = parsearArgs(process.argv);
  const navegador = await chromium.launch({ headless: !a.headed });
  const ctx = await navegador.newContext({ viewport: a.escritorio, locale: 'es-AR' });
  const page = await ctx.newPage();

  console.log(`> tienda   ${a.store}`);
  console.log(`> listado  ${a.listado}`);
  console.log(`> ficha    ${a.producto}\n`);

  // 1 + 2 + 5 + 6 sobre la portada
  await page.goto(a.listado, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await despertarLazy(page);

  const fix = await page.evaluate(() => ({
    style: !!document.getElementById('ngc-fix'),
    script: !!document.getElementById('ngc-fix-js'),
  }));
  registrar('existen #ngc-fix y #ngc-fix-js', fix.style && fix.script,
    `style=${fix.style} script=${fix.script}`,
    fix.style && fix.script ? '' : 'el bloque de assortedJs no llego al HTML');

  const banners = await page.evaluate(CODIGO_BANNERS);
  registrar(`los ${a.bannersEsperados} banners de portada cargan`,
    banners.cargadas >= a.bannersEsperados,
    `${banners.cargadas} cargadas de ${banners.total} <img> en el slider`,
    JSON.stringify(banners.contenedores));

  const link = await page.evaluate(CODIGO_ITEM_LINK);
  registrar('.item-link sigue con display:inline',
    link.total > 0 && link.display === 'inline' && link.conLineClamp === 0,
    `display=${link.display}, ${link.total} nodos, hasta ${link.maxHijos} hijos, ${link.conLineClamp} con line-clamp`,
    link.conLineClamp > 0 ? 'ALGUIEN LE PUSO LINE-CLAMP AL CONTENEDOR: deforma las tarjetas' : '');

  const contraste = await page.evaluate(CODIGO_CONTRASTE, '.btn-primary');
  registrar(`.btn-primary da ${a.contrasteMinimo}:1 o mas`,
    contraste.existe && contraste.ratio >= a.contrasteMinimo,
    contraste.existe ? `${contraste.ratio}:1 (texto ${contraste.texto} sobre ${contraste.fondo})` : 'no existe .btn-primary',
    '');

  const cortadosEscritorio = await page.evaluate(CODIGO_CORTADOS);
  registrar('ningun nombre cortado en el listado (escritorio)',
    cortadosEscritorio.cortados.length === 0,
    `${cortadosEscritorio.cortados.length} cortados de ${cortadosEscritorio.total}`,
    cortadosEscritorio.cortados.slice(0, 3).map((c) => c.texto).join(' | '));

  // el mismo chequeo en celular, que es donde el clamp muerde
  await page.setViewportSize(a.celular);
  await page.waitForTimeout(500);
  const cortadosCelular = await page.evaluate(CODIGO_CORTADOS);
  registrar('ningun nombre cortado en el listado (celular 390px)',
    cortadosCelular.cortados.length === 0,
    `${cortadosCelular.cortados.length} cortados de ${cortadosCelular.total}`,
    cortadosCelular.cortados.slice(0, 3).map((c) => c.texto).join(' | '));

  // 3 sobre la ficha
  await page.setViewportSize(a.escritorio);
  await page.goto(a.producto, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await despertarLazy(page);
  const alto = await page.evaluate(() => ({
    alto: document.documentElement.scrollHeight,
    fotos: document.querySelectorAll('.product-detail-slider img').length,
  }));
  registrar(`la ficha mide menos de ${a.altoMaximo} px`,
    alto.alto < a.altoMaximo,
    `${alto.alto} px con ${alto.fotos} fotos`,
    '');

  await navegador.close();

  // --- salida ---
  const anchoNombre = Math.max(...resultados.map((r) => r.nombre.length));
  console.log('');
  for (const r of resultados) {
    console.log(`  ${r.ok ? 'OK  ' : 'FALLA'} ${r.nombre.padEnd(anchoNombre)}  ${r.medido}`);
    if (!r.ok && r.detalle) console.log(`        ${r.detalle}`);
  }
  const fallas = resultados.filter((r) => !r.ok).length;
  console.log(`\n  ${resultados.length - fallas}/${resultados.length} chequeos pasan`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FALLO:', err && err.stack ? err.stack : err);
  process.exit(1);
});
