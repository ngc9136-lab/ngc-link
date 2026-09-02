// Tienda de mentira que imita la estructura real de Tiendanube (tema atlantico):
// sitemapindex -> sitemap de productos -> fichas con .product-detail-slider y
// las fuentes en data-srcset. Sirve para probar el auditor sin tocar produccion.
import http from 'node:http';
import { png } from './png.mjs';

// id -> bytes. Dos entradas con el mismo id son identicas byte a byte.
const ARCHIVOS = {
  a1: { w: 1024, h: 1024, c: [220, 40, 40] },
  a2: { w: 900, h: 1200, c: [40, 220, 40] },
  a3: { w: 380, h: 380, c: [40, 40, 220] },
  a4: { w: 640, h: 480, c: [220, 220, 40] },
  a5: { w: 512, h: 512, c: [40, 220, 220] },
  b1: { w: 800, h: 800, c: [120, 60, 200] },
  b2: { w: 300, h: 450, c: [200, 120, 60] },
  b3: { w: 1024, h: 768, c: [60, 200, 120] },
  compartido: { w: 700, h: 700, c: [10, 10, 10] },
  c2: { w: 560, h: 560, c: [180, 180, 180] },
  c3: { w: 1024, h: 1024, c: [90, 90, 190] },
  c4: { w: 448, h: 597, c: [190, 90, 90] },
  d1: { w: 1024, h: 1024, c: [15, 90, 160] },
  d2: { w: 896, h: 896, c: [160, 90, 15] },
  d3: { w: 896, h: 1120, c: [90, 160, 15] },
  e2: { w: 1024, h: 1024, c: [33, 44, 55] },
  e3: { w: 396, h: 396, c: [55, 44, 33] },
  f1: { w: 750, h: 1000, c: [222, 111, 0] },
};

// Cada producto lista sus entradas de galeria en orden. El id se repite cuando
// la tienda muestra la misma foto una vez por variante.
const PRODUCTOS = [
  { slug: 'parche-f16', nombre: 'Parche bordado F-16', galeria: ['a1', 'a1', 'a1', 'a2', 'a2', 'a3', 'a4', 'a5'] },
  { slug: 'gorra-faa', nombre: 'Gorra FAA', galeria: ['b1', 'b2', 'b1', 'b3'] },
  { slug: 'llavero-hercules', nombre: 'Llavero Hercules C-130', galeria: ['compartido', 'c2', 'c3', 'c4', 'a4'] },
  { slug: 'jerarquias-abrojo', nombre: 'Jerarquias con abrojo', galeria: ['d1', 'd1', 'd1', 'd1', 'd1', 'd1', 'd2', 'd3', 'd2', 'd3', 'd2', 'd3'] },
  { slug: 'campera-bomber', nombre: 'Campera bomber', galeria: ['compartido', 'e2', 'e3'] },
  { slug: 'mochila-tactica', nombre: 'Mochila tactica', galeria: ['f1', 'f1'] },
];

// Cuentas esperadas, calculadas a mano a partir de PRODUCTOS.
export const ESPERADO = (() => {
  let entradas = 0, duplicados = 0, productosConDup = 0;
  for (const p of PRODUCTOS) {
    entradas += p.galeria.length;
    const cuenta = new Map();
    for (const id of p.galeria) cuenta.set(id, (cuenta.get(id) || 0) + 1);
    const d = [...cuenta.values()].reduce((s, n) => s + (n > 1 ? n - 1 : 0), 0);
    duplicados += d;
    if (d > 0) productosConDup++;
  }
  const idsUsados = new Set(PRODUCTOS.flatMap((p) => p.galeria));
  return {
    productos: PRODUCTOS.length,
    entradasGaleria: entradas,
    archivosDuplicados: duplicados,
    productosConDuplicados: productosConDup,
    archivosUnicosEnLaTienda: idsUsados.size,
  };
})();

// URL distinta por cada entrada (como hace Tiendanube con las variantes),
// mismo contenido cuando el id se repite.
const urlDeEntrada = (slug, i, id) => `/img/${slug}-v${i}-${id}-1024-1024.png`;
const idDeUrlImagen = (ruta) => {
  const m = ruta.match(/^\/img\/.*?-v\d+-([a-z0-9]+)-\d+-\d+\.png$/);
  return m ? m[1] : null;
};

function fichaHtml(base, p) {
  const slides = p.galeria
    .map((id, i) => {
      const u = base + urlDeEntrada(p.slug, i, id);
      const chico = u.replace('-1024-1024', '-240-240');
      return `<div class="swiper-slide"><img class="js-product-slide-img"
        data-srcset="${chico} 240w, ${u} 1024w"
        data-src="${u}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="${p.nombre} ${i + 1}"></div>`;
    })
    .join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta property="og:type" content="product">
<title>${p.nombre}</title></head><body>
<h1>${p.nombre}</h1>
<div class="product-detail-slider swiper-container"><div class="swiper-wrapper">
${slides}
</div></div>
<a class="item-link" href="#"><div class="js-item-name item-name">${p.nombre}</div></a>
</body></html>`;
}

export function crearServidor() {
  const server = http.createServer((req, res) => {
    const base = `http://${req.headers.host}`;
    const ruta = req.url.split('?')[0];

    if (ruta === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${base}/sitemap-products-1.xml</loc></sitemap>
  <sitemap><loc>${base}/sitemap-pages-1.xml</loc></sitemap>
</sitemapindex>`);
    }

    if (ruta === '/sitemap-products-1.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PRODUCTOS.map((p) => `  <url><loc>${base}/${p.slug}</loc></url>`).join('\n')}
</urlset>`);
    }

    if (ruta === '/sitemap-pages-1.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/parches-y-bordados</loc></url>
  <url><loc>${base}/pagina-rota</loc></url>
</urlset>`);
    }

    if (ruta === '/parches-y-bordados') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><html><body><h1>Parches</h1><div class="js-item-grid"></div></body></html>');
    }

    if (ruta === '/pagina-rota') {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('no existe');
    }

    const prod = PRODUCTOS.find((p) => ruta === '/' + p.slug);
    if (prod) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fichaHtml(base, prod));
    }

    const id = idDeUrlImagen(ruta);
    if (id && ARCHIVOS[id]) {
      const f = ARCHIVOS[id];
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(png(f.w, f.h, f.c));
    }

    res.writeHead(404).end('404');
  });
  return server;
}

export function arrancar() {
  return new Promise((resolve) => {
    const s = crearServidor();
    s.listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}

if (process.argv[1] && process.argv[1].endsWith('tienda-falsa.mjs')) {
  arrancar().then(({ base }) => {
    console.log('tienda falsa en', base);
    console.log('esperado:', ESPERADO);
  });
}
