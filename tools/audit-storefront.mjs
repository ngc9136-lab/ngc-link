#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Auditor reproducible del storefront NGC (sin API de Tiendanube).
//
//   node audit-storefront.mjs --store https://ngctienda.mitiendanube.com
//
// Lee el sitemap publico, entra a cada ficha, saca las imagenes reales de
// .product-detail-slider (que viven en data-src / data-srcset), baja cada
// archivo, calcula SHA-256 y agrupa por hash DENTRO de cada producto.
// Solo eso cuenta como duplicado: la tienda publica repite la misma foto una
// vez por variante con URL distinta, asi que contar por URL da falsos positivos.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from 'image-size';

import { get, createLimiter } from './lib/net.mjs';
import { Cache } from './lib/cache.mjs';
import {
  parsearSitemap,
  extraerGaleria,
  slugDeUrl,
  nombreArchivoDeUrl,
} from './lib/extraer.mjs';
import { escribirHojaDeContacto } from './lib/informe-html.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.0';

function parsearArgs(argv) {
  const a = {
    store: 'https://ngctienda.mitiendanube.com',
    out: path.join(AQUI, 'salida'),
    cache: path.join(AQUI, '.cache'),
    concurrency: 6,
    refresh: false,
    limit: 0,
  };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--refresh') a.refresh = true;
    else if (t === '--store') a.store = argv[++i];
    else if (t === '--out') a.out = path.resolve(argv[++i]);
    else if (t === '--cache') a.cache = path.resolve(argv[++i]);
    else if (t === '--concurrency') a.concurrency = parseInt(argv[++i], 10);
    else if (t === '--limit') a.limit = parseInt(argv[++i], 10);
    else if (t === '--help' || t === '-h') {
      console.log(AYUDA);
      process.exit(0);
    }
  }
  a.store = a.store.replace(/\/+$/, '');
  return a;
}

const AYUDA = `
Auditor del storefront NGC

  node audit-storefront.mjs [opciones]

  --store URL        base de la tienda (default https://ngctienda.mitiendanube.com)
  --out DIR          carpeta de salida (default ./salida)
  --cache DIR        carpeta de cache (default ./.cache)
  --concurrency N    descargas en paralelo (default 6)
  --limit N          auditar solo las primeras N fichas (para probar)
  --refresh          ignorar el cache y volver a bajar todo
`;

const log = (...m) => console.log(...m);

// --- 1. sitemap ------------------------------------------------------------
async function juntarUrlsDelSitemap(cache, store, refresh) {
  const pendientes = [`${store}/sitemap.xml`];
  const vistas = new Set();
  const urls = new Set();
  let profundidad = 0;

  while (pendientes.length && profundidad < 5) {
    const tanda = pendientes.splice(0, pendientes.length);
    profundidad++;
    for (const sm of tanda) {
      if (vistas.has(sm)) continue;
      vistas.add(sm);
      const xml = await traerTexto(cache, sm, refresh);
      if (!xml) continue;
      const { esIndice, locs } = parsearSitemap(xml);
      for (const loc of locs) {
        if (esIndice || /sitemap.*\.xml/i.test(loc)) pendientes.push(loc);
        else urls.add(loc);
      }
    }
  }
  return [...urls];
}

async function traerTexto(cache, url, refresh) {
  if (!refresh) {
    const enCache = cache.leerPagina(url);
    if (enCache !== null) return enCache;
  }
  try {
    const { buffer } = await get(url);
    const texto = buffer.toString('utf8');
    cache.escribirPagina(url, texto);
    return texto;
  } catch (err) {
    return null;
  }
}

// --- 2. fichas -------------------------------------------------------------
async function auditar(a) {
  const cache = new Cache(a.cache);
  const errores = [];

  log(`> tienda: ${a.store}`);
  const urls = await juntarUrlsDelSitemap(cache, a.store, a.refresh);
  cache.guardar();
  log(`> ${urls.length} URLs en el sitemap`);
  if (urls.length === 0) {
    errores.push({ tipo: 'sitemap-vacio', url: `${a.store}/sitemap.xml` });
  }

  const limitar = createLimiter(a.concurrency);
  const candidatas = a.limit > 0 ? urls.slice(0, a.limit) : urls;

  const fichas = [];
  let procesadas = 0;
  await Promise.all(
    candidatas.map((url) =>
      limitar(async () => {
        const html = await traerTexto(cache, url, a.refresh);
        procesadas++;
        if (procesadas % 25 === 0) log(`  ...${procesadas}/${candidatas.length} paginas`);
        if (html === null) {
          errores.push({ tipo: 'pagina-no-descargada', url });
          return;
        }
        let galeria;
        try {
          galeria = extraerGaleria(html, url);
        } catch (err) {
          errores.push({ tipo: 'html-ilegible', url, detalle: String(err.message) });
          return;
        }
        if (!galeria) return; // no es ficha de producto
        fichas.push({ url, slug: slugDeUrl(url), ...galeria });
      })
    )
  );
  cache.guardar();
  fichas.sort((x, y) => x.slug.localeCompare(y.slug));
  log(`> ${fichas.length} fichas de producto`);

  // --- 3. imagenes: bajar + SHA-256 ---------------------------------------
  const urlsImagen = [...new Set(fichas.flatMap((f) => f.entradas.map((e) => e.url)))];
  log(`> ${urlsImagen.length} URLs de imagen unicas por descargar`);

  const metaPorUrl = new Map();
  let bajadas = 0;
  let desdeCache = 0;
  await Promise.all(
    urlsImagen.map((url) =>
      limitar(async () => {
        let meta = a.refresh ? null : cache.leerBlobMeta(url);
        if (meta) {
          desdeCache++;
        } else {
          try {
            const { buffer, headers } = await get(url);
            meta = cache.escribirBlob(url, buffer, headers['content-type']);
            bajadas++;
          } catch (err) {
            errores.push({ tipo: 'imagen-no-descargada', url, detalle: String(err.message) });
            return;
          }
        }
        if (meta.ancho === undefined) {
          try {
            const dim = imageSize(cache.bytesDeBlob(meta));
            meta.ancho = dim.width || null;
            meta.alto = dim.height || null;
            meta.formato = dim.type || null;
          } catch {
            meta.ancho = null;
            meta.alto = null;
            meta.formato = null;
          }
          cache.indice.blobs[url] = meta;
        }
        metaPorUrl.set(url, meta);
        const hechas = bajadas + desdeCache;
        if (hechas % 100 === 0) log(`  ...${hechas}/${urlsImagen.length} imagenes`);
      })
    )
  );
  cache.guardar();
  log(`> imagenes: ${bajadas} bajadas, ${desdeCache} desde cache`);

  // --- 4. agrupar por hash dentro de cada producto -------------------------
  const productos = fichas.map((f) => {
    const entradas = f.entradas.map((e) => {
      const m = metaPorUrl.get(e.url);
      return {
        posicion: e.posicion,
        url: e.url,
        archivo: nombreArchivoDeUrl(e.url),
        alt: e.alt,
        origenAtributo: e.origenAtributo,
        sha256: m ? m.sha256 : null,
        bytes: m ? m.bytes : null,
        ancho: m ? m.ancho : null,
        alto: m ? m.alto : null,
        relacion: m && m.ancho && m.alto ? Number((m.ancho / m.alto).toFixed(4)) : null,
        cuadrada: m && m.ancho && m.alto ? m.ancho === m.alto : null,
        formato: m ? m.formato : null,
        rutaCache: m ? m.rutaRelativa : null,
      };
    });

    const porHash = new Map();
    for (const e of entradas) {
      if (!e.sha256) continue;
      if (!porHash.has(e.sha256)) porHash.set(e.sha256, []);
      porHash.get(e.sha256).push(e);
    }
    const grupos = [...porHash.entries()]
      .filter(([, arr]) => arr.length > 1)
      .map(([hash, arr]) => ({
        sha256: hash,
        repeticiones: arr.length,
        sobrantes: arr.length - 1,
        seQueda: arr[0].posicion,
        posiciones: arr.map((e) => e.posicion),
        entradas: arr,
      }))
      .sort((x, y) => y.repeticiones - x.repeticiones || x.sha256.localeCompare(y.sha256));

    return {
      slug: f.slug,
      url: f.url,
      nombre: f.nombre,
      entradasGaleria: entradas.length,
      archivosUnicos: porHash.size,
      archivosDuplicados: grupos.reduce((s, g) => s + g.sobrantes, 0),
      grupos,
      entradas,
    };
  });

  // --- 5. resumen ----------------------------------------------------------
  const todasLasEntradas = productos.flatMap((p) => p.entradas);
  const hashesGlobales = new Set(todasLasEntradas.map((e) => e.sha256).filter(Boolean));
  const anchos = todasLasEntradas.map((e) => e.ancho).filter((n) => typeof n === 'number');
  const cuadradas = todasLasEntradas.filter((e) => e.cuadrada === true).length;

  const resumen = {
    productos: productos.length,
    entradasGaleria: todasLasEntradas.length,
    archivosUnicosEnLaTienda: hashesGlobales.size,
    archivosDuplicados: productos.reduce((s, p) => s + p.archivosDuplicados, 0),
    productosConDuplicados: productos.filter((p) => p.archivosDuplicados > 0).length,
    peorProducto: (() => {
      const p = [...productos].sort((x, y) => y.archivosDuplicados - x.archivosDuplicados)[0];
      return p
        ? { slug: p.slug, entradasGaleria: p.entradasGaleria, archivosDuplicados: p.archivosDuplicados }
        : null;
    })(),
    resolucion: {
      medidas: anchos.length,
      menorA400: anchos.filter((n) => n < 400).length,
      menorA600: anchos.filter((n) => n < 600).length,
      menorA800: anchos.filter((n) => n < 800).length,
      mediana: mediana(anchos),
      maximo: anchos.length ? Math.max(...anchos) : null,
    },
    cuadradas,
    noCuadradas: todasLasEntradas.length - cuadradas,
    nombresSinDescripcion: todasLasEntradas.filter((e) => /sin-titulo|^\d|whatsapp|img[-_]?\d/i.test(e.archivo)).length,
  };

  const datos = { resumen, productos, errores: errores.sort(cmpError) };
  return { datos, cache };
}

function cmpError(a, b) {
  return (a.tipo + a.url).localeCompare(b.tipo + b.url);
}

function mediana(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// Huella estable del contenido: no incluye fechas ni rutas absolutas, asi que
// dos corridas seguidas sobre la misma tienda dan la misma huella.
async function huellaDe(datos) {
  const { createHash } = await import('node:crypto');
  const limpio = JSON.parse(JSON.stringify(datos, (k, v) => (k === 'rutaCache' ? undefined : v)));
  return createHash('sha256').update(JSON.stringify(limpio)).digest('hex');
}

async function main() {
  const a = parsearArgs(process.argv);
  const t0 = Date.now();
  const { datos } = await auditar(a);

  fs.mkdirSync(a.out, { recursive: true });
  const huella = await huellaDe(datos);
  const informe = {
    meta: {
      herramienta: 'ngc-audit',
      version: VERSION,
      tienda: a.store,
      generadoEn: new Date().toISOString(),
      huella,
    },
    ...datos,
  };
  const jsonPath = path.join(a.out, 'informe.json');
  fs.writeFileSync(jsonPath, JSON.stringify(informe, null, 2));

  const htmlPath = path.join(a.out, 'informe.html');
  escribirHojaDeContacto(htmlPath, informe, a.cache);

  const r = informe.resumen;
  log('');
  log('  productos auditados .............. ' + r.productos);
  log('  entradas de galeria ............... ' + r.entradasGaleria);
  log('  archivos unicos (byte a byte) ..... ' + r.archivosUnicosEnLaTienda);
  log('  archivos DUPLICADOS ............... ' + r.archivosDuplicados);
  log('  productos con duplicados .......... ' + r.productosConDuplicados);
  if (r.peorProducto)
    log(`  peor caso ......................... ${r.peorProducto.slug} (${r.peorProducto.entradasGaleria} fotos, ${r.peorProducto.archivosDuplicados} repetidas)`);
  log('  ancho: <400 / <600 / <800 ......... ' + `${r.resolucion.menorA400} / ${r.resolucion.menorA600} / ${r.resolucion.menorA800}`);
  log('  ancho mediana / maximo ............ ' + `${r.resolucion.mediana} / ${r.resolucion.maximo}`);
  log('  cuadradas ......................... ' + `${r.cuadradas} de ${r.entradasGaleria}`);
  log('  errores ........................... ' + informe.errores.length);
  log('  huella ............................ ' + huella.slice(0, 16));
  log('');
  log(`  ${jsonPath}`);
  log(`  ${htmlPath}`);
  log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

main().catch((err) => {
  console.error('FALLO:', err && err.stack ? err.stack : err);
  process.exit(1);
});
