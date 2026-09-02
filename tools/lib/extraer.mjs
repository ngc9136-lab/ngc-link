// Parseo del sitemap y de la galeria de la ficha de producto.
import * as cheerio from 'cheerio';

/** Devuelve todos los <loc> de un sitemap o sitemapindex. */
export function parsearSitemap(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const esIndice = $('sitemapindex').length > 0;
  const locs = $('loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return { esIndice, locs };
}

/**
 * Marcadores que confirman que una URL es realmente una ficha de producto.
 * Se comprueba contra el HTML real en vez de adivinar por la forma de la URL.
 */
export function esFichaDeProducto($) {
  if ($('.product-detail-slider').length > 0) return true;
  const ogType = $('meta[property="og:type"]').attr('content');
  return (ogType || '').toLowerCase() === 'product';
}

/** Normaliza una URL de imagen del CDN (protocolo relativo, espacios). */
export function normalizarUrl(u, base) {
  if (!u) return null;
  let s = u.trim();
  if (!s) return null;
  if (s.startsWith('//')) s = 'https:' + s;
  try {
    return new URL(s, base).href;
  } catch {
    return null;
  }
}

/**
 * Elige el candidato mas grande de un srcset.
 * Si todos traen descriptor `w` usa el de mayor ancho; si no, el ultimo,
 * que es la convencion que usa el tema atlantico (orden ascendente).
 */
export function mejorDeSrcset(srcset) {
  if (!srcset) return null;
  const candidatos = [];
  const re = /\s*([^\s,]+)(?:\s+([0-9.]+)([wx]))?\s*(?:,|$)/g;
  let m;
  while ((m = re.exec(srcset)) !== null) {
    if (!m[1]) continue;
    candidatos.push({ url: m[1], valor: m[2] ? parseFloat(m[2]) : null, unidad: m[3] || null });
    if (re.lastIndex === 0) break;
  }
  if (candidatos.length === 0) return null;
  const conAncho = candidatos.filter((c) => c.unidad === 'w' && c.valor);
  if (conAncho.length === candidatos.length) {
    return conAncho.reduce((a, b) => (b.valor > a.valor ? b : a)).url;
  }
  return candidatos[candidatos.length - 1].url;
}

/**
 * Extrae las entradas de galeria de una ficha, en orden del DOM.
 * Casi todas las fuentes viven en data-src / data-srcset (lazy loading),
 * no en src, por eso el orden de preferencia.
 */
export function extraerGaleria(html, urlBase) {
  const $ = cheerio.load(html);
  if (!esFichaDeProducto($)) return null;

  const entradas = [];
  const vistas = new Set();
  $('.product-detail-slider img').each((i, el) => {
    const $el = $(el);
    const candidato =
      mejorDeSrcset($el.attr('data-srcset')) ||
      mejorDeSrcset($el.attr('srcset')) ||
      $el.attr('data-src') ||
      $el.attr('src');
    const url = normalizarUrl(candidato, urlBase);
    if (!url) return;
    if (url.startsWith('data:')) return;
    const clave = url + '#' + i;
    if (vistas.has(clave)) return;
    vistas.add(clave);
    entradas.push({
      posicion: entradas.length + 1,
      url,
      alt: ($el.attr('alt') || '').trim(),
      origenAtributo: $el.attr('data-srcset')
        ? 'data-srcset'
        : $el.attr('srcset')
        ? 'srcset'
        : $el.attr('data-src')
        ? 'data-src'
        : 'src',
    });
  });

  return {
    nombre: ($('h1').first().text() || '').trim(),
    entradas,
  };
}

/** Ultimo segmento del path, sin extension: el slug del producto. */
export function slugDeUrl(url) {
  const p = new URL(url).pathname.replace(/\/+$/, '');
  return p.split('/').filter(Boolean).pop() || p;
}

/** Nombre de archivo del CDN, sin query. */
export function nombreArchivoDeUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
}
